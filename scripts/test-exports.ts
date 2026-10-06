/**
 * Teste do pipeline de exportação sem Supabase (Storage em memória):
 *   npm run test:exports
 * Executa o mesmo laço step/finalize do worker e confere partes, nomes e manifests.
 */
import { createCanvas } from "@napi-rs/canvas";
import { strFromU8, unzipSync } from "fflate";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BatchExportRow, ExportKind } from "@/lib/db/types";
import type { ExportContext, ExportPlate } from "@/lib/exports/context";
import { EXPORTERS } from "@/lib/exports/exporters";
import type { ExportState } from "@/lib/exports/types";
import { createPlateRenderer } from "@/lib/renderer/server";
import type { PlateLayout } from "@/lib/renderer/types";

process.env.NEXT_PUBLIC_GO_BASE_URL ??= "https://go.meudominio.com";

const store = new Map<string, Uint8Array>();
const fakeAdmin = {
  storage: {
    from: (bucket: string) => ({
      upload: async (path: string, body: Uint8Array) => {
        store.set(`${bucket}/${path}`, body);
        return { data: { path }, error: null };
      },
    }),
  },
} as unknown as SupabaseClient;

const layout: PlateLayout = {
  canvas_width: 600, canvas_height: 900, print_width_mm: 50, print_height_mm: 75,
  qr_x: 100, qr_y: 200, qr_width: 400, qr_height: 400, qr_error_correction: "M", qr_quiet_zone: 4,
  qr_color: "#000000", qr_background_color: "#FFFFFF", show_public_code: true, code_x: 300, code_y: 700,
  code_font_family: "inter-bold", code_font_size: 60, code_color: "#111111", code_align: "center",
  code_max_width: 420, safe_margin: 30, renderer_version: 1,
};

async function baseArt() {
  const canvas = createCanvas(layout.canvas_width, layout.canvas_height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#e8d7a8";
  ctx.fillRect(0, 0, layout.canvas_width, layout.canvas_height);
  return canvas.encode("png");
}

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const plates: ExportPlate[] = Array.from({ length: 30 }, (_, i): ExportPlate => ({
  id: `p${i}`,
  public_code: Array.from({ length: 6 }, (_, j) => ALPHABET[(i * 7 + j * 11) % ALPHABET.length]).join(""),
  status: "in_stock",
  reseller_name: i === 0 ? "=XP Comunicação" : null,
})).sort((a, b) => a.public_code.localeCompare(b.public_code));

async function run(kind: ExportKind, maxPartBytes: number) {
  store.clear();
  const art = await baseArt();
  const rendererPromise = createPlateRenderer(layout, art);
  const ctx: ExportContext = {
    admin: fakeAdmin,
    job: { id: "job-1", kind } as BatchExportRow,
    batch: { id: "batch-1", name: "Lote Setembro 2026" } as ExportContext["batch"],
    plates,
    version: null,
    layout,
    slug: "Lote-Setembro-2026",
    storagePrefix: "exports/batch-1/job-1",
    getRenderer: () => rendererPromise,
  };
  const exporter = EXPORTERS[kind];
  let state: ExportState = { nextOffset: 0, partCount: 0, files: [] };
  while (state.nextOffset < plates.length) {
    state = await exporter.step(ctx, state, { deadline: Date.now() + 30_000, maxPartBytes });
  }
  return exporter.finalize(ctx, state);
}

const failures: string[] = [];
const expect = (ok: boolean, message: string) => {
  if (!ok) failures.push(message);
};

async function main() {
  // 1) Artes cabendo numa parte: nome simples e SOMENTE os PNGs das placas (pedido: sem manifest no pacote de artes)
  let result = await run("art_png_zip", 45 * 1024 * 1024);
  expect(result.files.length === 1 && result.files[0]!.name === "Lote-Setembro-2026.zip", "ZIP único com o nome do lote");
  let zip = unzipSync(store.get(`plate-outputs/${result.files[0]!.path}`)!);
  expect(plates.every((p) => zip[`${p.public_code}.png`]), "um PNG por placa");
  expect(Object.keys(zip).length === 30 && Object.keys(zip).every((n) => n.endsWith(".png")), "artes: só os 30 PNGs (sem manifest)");
  expect(result.filePath === result.files[0]!.path, "file_path do export único");
  console.log(`Artes em 1 parte: ${result.files[0]!.name} (${Object.keys(zip).length} arquivos)`);

  // 2) Limite pequeno força várias partes; artes continuam só PNG (sem manifest dentro nem à parte)
  result = await run("art_png_zip", 60 * 1024);
  const zips = result.files.filter((f) => f.name.endsWith(".zip"));
  expect(zips.length > 1 && zips[0]!.name === "Lote-Setembro-2026-parte-01.zip", "partes numeradas");
  expect(zips.length === result.files.length, "artes em partes: só ZIPs (sem manifest avulso)");
  const seen: string[] = [];
  for (const f of zips) {
    const part = unzipSync(store.get(`plate-outputs/${f.path}`)!);
    seen.push(...Object.keys(part).filter((n) => n.endsWith(".png")));
    expect(Object.keys(part).every((n) => n.endsWith(".png")), `só PNG dentro de ${f.name}`);
  }
  expect(seen.length === 30 && new Set(seen).size === 30, "cada placa em exatamente uma parte");
  expect(result.filePath === null, "sem file_path quando há várias partes");
  console.log(`Artes em ${zips.length} partes: ${zips.map((z) => z.name).join(", ")}`);

  // 2b) O manifesto continua existindo onde é útil: pacote de QR (dentro e, com várias partes, completo com zip_file)
  result = await run("qr_zip", 60 * 1024);
  const qrZips = result.files.filter((f) => f.name.endsWith(".zip"));
  const fullQr = result.files.find((f) => f.name === "Lote-Setembro-2026-QR-Codes-manifest.csv");
  expect(qrZips.length > 1 && qrZips.every((f) => !!unzipSync(store.get(`plate-outputs/${f.path}`)!)["manifest.csv"]), "QR em partes: manifest dentro de cada parte");
  expect(!!fullQr && strFromU8(store.get(`plate-outputs/${fullQr.path}`)!).trim().split("\r\n")[0]!.endsWith(",zip_file"), "QR em partes: manifest completo com zip_file");
  console.log(`QR em ${qrZips.length} partes + ${fullQr?.name}`);

  // 3) QR Codes: PNG + SVG por placa
  result = await run("qr_zip", 45 * 1024 * 1024);
  zip = unzipSync(store.get(`plate-outputs/${result.files[0]!.path}`)!);
  expect(result.files[0]!.name === "Lote-Setembro-2026-QR-Codes.zip", "nome do ZIP de QR");
  expect(plates.every((p) => zip[`${p.public_code}.png`] && zip[`${p.public_code}.svg`]), "PNG e SVG por placa");
  const manifest = strFromU8(zip["manifest.csv"]!).replace(/^\uFEFF/, "").trim().split("\r\n");
  expect(manifest[0] === "public_code,qr_url,nfc_url,filename,svg_filename" && manifest.length === 31, "QR: manifest com cabeçalho e 30 linhas");
  console.log(`QR Codes: ${result.files[0]!.name} (${Object.keys(zip).length} arquivos)`);

  // 4) CSV com BOM e proteção contra fórmula
  result = await run("csv", 45 * 1024 * 1024);
  const csvBytes = store.get(`plate-outputs/${result.files[0]!.path}`)!;
  const csv = strFromU8(csvBytes);
  expect(csvBytes[0] === 0xef && csvBytes[1] === 0xbb && csvBytes[2] === 0xbf, "CSV com BOM UTF-8");
  expect(csv.startsWith("public_code,qr_url,nfc_url,status,revendedor,lote\r\n"), "cabeçalho do CSV sem campos de NFC físico");
  expect(csv.includes(`https://go.meudominio.com/${plates[0]!.public_code}?src=nfc`), "CSV mantém a URL NFC");
  expect(csv.includes("'=XP Comunicação"), "CSV neutraliza fórmulas");
  console.log(`CSV: ${result.files[0]!.name}`);

  if (failures.length) {
    console.error("FALHAS:\n" + failures.join("\n"));
    process.exit(1);
  }
  console.log("Exportações OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
