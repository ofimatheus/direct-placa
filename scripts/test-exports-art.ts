/**
 * Download em massa das ARTES de um lote: abre cada PNG exportado e confere
 * arte base, QR (lido de verdade), código, dimensões, versão do template e o
 * renderizador oficial. Banco e Storage simulados; renderizador e exportador reais.
 *   npm run test:exports-art
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { unzipSync } from "fflate";
import jsQR from "jsqr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadExportContext } from "@/lib/exports/context";
import { EXPORTERS } from "@/lib/exports/exporters";
import type { ExportState } from "@/lib/exports/types";
import { urlsFor } from "@/lib/exports/zip-parts";
import { OUTPUTS_BUCKET } from "@/lib/storage";
import { renderPreview } from "@/lib/templates/service";
import type { PlateLayout } from "@/lib/renderer/types";

process.env.NEXT_PUBLIC_GO_BASE_URL ??= "https://go.meudominio.com";

let failures = 0;
const ok = (l: string) => console.log(`OK ${l}`);
const check = (c: unknown, l: string, d?: unknown) => {
  if (!c) {
    failures++;
    console.log(`FALHA ${l}`, JSON.stringify(d ?? "").slice(0, 400));
  }
};

const W = 1024;
const H = 1536;
const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

/** Arte base com elementos identificáveis (cabeçalho, "logo", rodapé). */
async function makeArt(body: string) {
  const c = createCanvas(W, H);
  const g = c.getContext("2d");
  g.fillStyle = body;
  g.fillRect(0, 0, W, H);
  g.fillStyle = "#0d1a2a"; // cabeçalho navy
  g.fillRect(0, 0, W, 200);
  g.fillStyle = "#e4572e"; // "logo"
  g.fillRect(412, 230, 200, 200);
  g.fillStyle = "#0b63de"; // rodapé azul
  g.fillRect(0, H - 200, W, 200);
  return Buffer.from(await c.encode("png"));
}

const base: Omit<PlateLayout, "qr_x" | "qr_y" | "qr_width" | "qr_height" | "code_x" | "code_y"> = {
  canvas_width: W, canvas_height: H, print_width_mm: 80, print_height_mm: 120,
  qr_error_correction: "M", qr_quiet_zone: 4, qr_color: "#000000", qr_background_color: "#FFFFFF",
  show_public_code: true, code_font_family: "inter-bold", code_font_size: 72, code_color: "#0d1a2a",
  code_align: "center", code_max_width: 600, safe_margin: 40, renderer_version: 1,
};
const V1: PlateLayout = { ...base, qr_x: 312, qr_y: 520, qr_width: 400, qr_height: 400, code_x: 512, code_y: 1100 };
const V2: PlateLayout = { ...base, qr_x: 100, qr_y: 240, qr_width: 300, qr_height: 300, code_x: 512, code_y: 1250 };

/** Supabase simulado: tabelas em memória + Storage em memória. */
/** Tipo de conteúdo de cada gravação no Storage simulado (caminho → contentType). */
const contentTypes = new Map<string, string>();
function fakeDb(tables: Record<string, Record<string, unknown>[]>, store: Map<string, Uint8Array>) {
  const query = (rows: Record<string, unknown>[]) => {
    let r = [...rows];
    const b: Record<string, unknown> = {
      select: () => b,
      eq: (c: string, v: unknown) => ((r = r.filter((x) => x[c] === v)), b),
      in: (c: string, vs: unknown[]) => ((r = r.filter((x) => vs.includes(x[c]))), b),
      order: (c: string) => ((r = [...r].sort((a, z) => String(a[c]).localeCompare(String(z[c])))), b),
      range: (f: number, t: number) => ((r = r.slice(f, t + 1)), b),
      single: async () => (r[0] ? { data: r[0], error: null } : { data: null, error: { message: "não encontrado" } }),
      maybeSingle: async () => ({ data: r[0] ?? null, error: null }),
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve({ data: r, error: null }).then(res, rej),
    };
    return b;
  };
  return {
    from: (t: string) => query(tables[t] ?? []),
    storage: {
      from: (bucket: string) => ({
        download: async (path: string) => {
          const bytes = store.get(`${bucket}/${path}`);
          return bytes ? { data: new Blob([new Uint8Array(bytes)]), error: null } : { data: null, error: { message: "sem arquivo" } };
        },
        upload: async (path: string, body: Uint8Array, opts?: { contentType?: string }) => {
          store.set(`${bucket}/${path}`, body);
          contentTypes.set(`${bucket}/${path}`, opts?.contentType ?? "");
          return { data: { path }, error: null };
        },
        createSignedUrl: async (path: string) => ({ data: { signedUrl: `https://storage.exemplo/${bucket}/${path}?token=x` }, error: null }),
      }),
    },
  } as unknown as SupabaseClient;
}

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
/** Códigos únicos (base 31 de um número distinto por placa). */
const codeFor = (i: number) => {
  let n = 40_000_000 + i * 7919;
  return Array.from({ length: 6 }, () => {
    const d = ALPHABET[n % ALPHABET.length]!;
    n = Math.floor(n / ALPHABET.length);
    return d;
  }).join("");
};

async function exportBatch(n: number, opts: { maxPartBytes?: number } = {}) {
  const store = new Map<string, Uint8Array>();
  const art1 = await makeArt("#f5e6c8");
  const art2 = await makeArt("#c8f5d8");
  store.set("plate-templates/t/v1.png", art1);
  store.set("plate-templates/t/v2.png", art2);
  const version = (id: string, num: number, layout: PlateLayout, path: string, art: Buffer) => ({
    id, template_id: "tpl-1", version_number: num, base_image_path: path, base_image_mime_type: "image/png",
    base_image_sha256: sha(art), base_image_size_bytes: art.length, ...layout,
  });
  const codes = Array.from({ length: n }, (_, i) => codeFor(i));
  if (new Set(codes).size !== n) throw new Error("códigos de teste repetidos");
  const tables = {
    // O lote foi criado com a V1; o template já tem uma V2 (outra arte e outra posição de QR).
    plate_batches: [{ id: "batch-1", name: "Lote Teste Artes", description: null, quantity: n, template_id: "tpl-1", template_version_id: "ver-1", idempotency_key: "k", created_by: null, created_at: "2026-10-01" }],
    plate_template_versions: [version("ver-1", 1, V1, "t/v1.png", art1), version("ver-2", 2, V2, "t/v2.png", art2)],
    plates: codes.map((c, i) => ({ id: `p${i}`, batch_id: "batch-1", public_code: c, status: "in_stock", reseller_id: null })),
    reseller_profiles: [],
  };
  const admin = fakeDb(tables, store);
  const job = { id: "job-1", batch_id: "batch-1", kind: "art_png_zip", template_version_id: null } as never;
  const ctx = await loadExportContext(admin, job);
  const exporter = EXPORTERS.art_png_zip;
  let state: ExportState = { nextOffset: 0, partCount: 0, files: [] };
  while (state.nextOffset < ctx.plates.length) state = await exporter.step(ctx, state, { deadline: Date.now() + 60_000, maxPartBytes: opts.maxPartBytes ?? 200 * 1024 * 1024 });
  const result = await exporter.finalize(ctx, state);
  const entries: Record<string, Uint8Array> = {};
  for (const f of result.files) Object.assign(entries, unzipSync(store.get(`${OUTPUTS_BUCKET}/${f.path}`)!));
  return { ctx, result, entries, art1, art2, codes, admin, store };
}

async function pixels(png: Uint8Array) {
  const img = await loadImage(Buffer.from(png));
  const c = createCanvas(img.width, img.height);
  const g = c.getContext("2d");
  g.drawImage(img, 0, 0);
  return { w: img.width, h: img.height, data: g.getImageData(0, 0, img.width, img.height).data };
}
const at = (p: { w: number; data: Uint8ClampedArray }, x: number, y: number) => {
  const i = (y * p.w + x) * 4;
  return `#${[p.data[i], p.data[i + 1], p.data[i + 2]].map((v) => v!.toString(16).padStart(2, "0")).join("")}`;
};
function readQr(p: { w: number; data: Uint8ClampedArray }, box: { x: number; y: number; s: number }) {
  const out = new Uint8ClampedArray(box.s * box.s * 4);
  for (let y = 0; y < box.s; y++) for (let x = 0; x < box.s; x++) {
    const src = ((box.y + y) * p.w + (box.x + x)) * 4;
    out.set(p.data.subarray(src, src + 4), (y * box.s + x) * 4);
  }
  return jsQR(out, box.s, box.s)?.data ?? null;
}

async function main() {
  // ---------- E1: 1 placa → 1 PNG ----------
  const one = await exportBatch(1);
  check(Object.keys(one.entries).length === 1 && Object.keys(one.entries)[0] === `${one.codes[0]}.png`, "E1", Object.keys(one.entries));
  ok(`E1: lote com 1 placa → ZIP com exatamente 1 arquivo: ${Object.keys(one.entries)[0]}`);

  // ---------- E2: 10 placas → 10 PNGs, conteúdo completo ----------
  const ten = await exportBatch(10);
  const names = Object.keys(ten.entries);
  check(names.length === 10 && names.every((n) => /^[A-Z0-9]{6}\.png$/.test(n)) && new Set(names).size === 10, "E2 nomes", names);
  check(names.sort().join() === ten.codes.map((c) => `${c}.png`).sort().join(), "E2 nomes = códigos");
  check(!names.some((n) => /\.(html?|svg|csv)$/i.test(n) || !n.includes(".")), "E2 nada além de PNG");
  ok(`E2: lote com 10 placas → 10 arquivos, todos <código>.png (nomes = códigos públicos); nenhum .html, .svg, .csv ou arquivo sem extensão`);

  const decoded: string[] = [];
  const problems: string[] = [];
  for (const code of ten.codes) {
    const bytes = ten.entries[`${code}.png`]!;
    if (!PNG_SIG.every((b, i) => bytes[i] === b)) problems.push(`${code}: assinatura`);
    const p = await pixels(bytes);
    if (p.w !== W || p.h !== H) problems.push(`${code}: ${p.w}x${p.h}`);
    // arte base presente (fora das áreas de QR e código)
    if (at(p, 40, 100) !== "#0d1a2a" || at(p, 512, 330) !== "#e4572e" || at(p, 40, H - 100) !== "#0b63de" || at(p, 40, 800) !== "#f5e6c8") problems.push(`${code}: arte base ${[at(p, 40, 100), at(p, 512, 330), at(p, 40, H - 100), at(p, 40, 800)]}`);
    // QR lido na posição da V1 = URL desta placa
    const qr = readQr(p, { x: V1.qr_x, y: V1.qr_y, s: V1.qr_width });
    if (qr !== urlsFor({ public_code: code } as never).qr) problems.push(`${code}: QR ${qr}`);
    decoded.push(qr ?? "");
    // código desenhado na posição configurada (pixels na cor do texto ao redor de code_y)
    let ink = 0;
    for (let y = V1.code_y - 50; y < V1.code_y + 50; y++) for (let x = 212; x < 812; x++) if (at(p, x, y) !== "#f5e6c8") ink++;
    if (ink < 1500) problems.push(`${code}: código ausente (${ink} px)`);
  }
  check(problems.length === 0, "E3 conteúdo", problems);
  check(new Set(decoded).size === 10 && decoded.every((u, i) => u.includes(ten.codes[i]!)), "E3 QR único", decoded);
  ok(`E3: cada PNG tem assinatura PNG válida, ${W}×${H} (= template), a arte base intacta (cabeçalho, logo, rodapé e fundo nas cores do template), o QR LIDO na posição configurada com a URL da própria placa e o código desenhado na posição configurada; 10 QR diferentes`);

  // Amostra para conferência visual (opcional): ART_SAMPLE=/caminho.png grava uma arte exportada.
  if (process.env.ART_SAMPLE) (await import("node:fs")).writeFileSync(process.env.ART_SAMPLE, ten.entries[`${ten.codes[0]}.png`]!);

  // ---------- E4: só QR e código mudam entre placas ----------
  const a = await pixels(ten.entries[`${ten.codes[0]}.png`]!);
  const b = await pixels(ten.entries[`${ten.codes[1]}.png`]!);
  let minX = W, minY = H, maxX = 0, maxY = 0, diff = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    if (a.data[i] !== b.data[i] || a.data[i + 1] !== b.data[i + 1] || a.data[i + 2] !== b.data[i + 2]) {
      diff++; minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    }
  }
  const inside = minX >= V1.qr_x - 300 && maxX <= V1.qr_x + V1.qr_width + 300 && minY >= V1.qr_y && maxY <= V1.code_y + 60;
  check(diff > 0 && inside, "E4", { diff, minX, minY, maxX, maxY });
  ok(`E4: entre duas placas, só mudam a área do QR e a do código (${diff} px, entre y=${minY} e y=${maxY}); a arte é idêntica`);

  // ---------- E5: versão do template do lote ----------
  const p0 = await pixels(ten.entries[`${ten.codes[0]}.png`]!);
  check(ten.ctx.version?.id === "ver-1" && at(p0, 40, 800) === "#f5e6c8" && readQr(p0, { x: V2.qr_x, y: V2.qr_y, s: V2.qr_width }) === null, "E5 V1", { versao: ten.ctx.version?.id });
  ok("E5: o lote foi criado na V1 e o template já tem V2 (outra arte e outro lugar do QR): o export continua na V1 — arte e posição do QR da V1, nada da V2");

  // ---------- E6: mesmo renderizador da prévia (arte individual) ----------
  const code = ten.codes[3]!;
  const preview = await renderPreview(ten.admin, V1, { bytes: ten.art1, sha256: sha(ten.art1) }, code, urlsFor({ public_code: code } as never).qr);
  const previewKey = [...ten.store.keys()].find((k) => k.startsWith(`${OUTPUTS_BUCKET}/previews/templates/`))!;
  const previewPng = ten.store.get(previewKey)!;
  check(preview.url.includes(previewKey.replace(`${OUTPUTS_BUCKET}/`, "")) && Buffer.compare(Buffer.from(previewPng), Buffer.from(ten.entries[`${code}.png`]!)) === 0, "E6 idêntico à prévia");
  check(contentTypes.get(previewKey) === "image/png", "E6 MIME da arte individual", contentTypes.get(previewKey));
  const zipKeys = ten.result.files.map((f) => `${OUTPUTS_BUCKET}/${f.path}`);
  check(zipKeys.every((k) => contentTypes.get(k) === "application/zip") && ten.result.files.every((f) => f.content_type === "application/zip" && f.name.endsWith(".zip")), "E6 MIME do pacote", zipKeys.map((k) => contentTypes.get(k)));
  const exporterSrc = readFileSync("src/lib/exports/exporters/art-png-zip.ts", "utf8");
  const contextSrc = readFileSync("src/lib/exports/context.ts", "utf8");
  check(exporterSrc.includes("ctx.getRenderer()") && contextSrc.includes("createPlateRenderer(layout, bytes)"), "E6 renderizador oficial");
  ok("E6: a arte exportada é IDÊNTICA byte a byte à da prévia fiel (renderPreview — arte individual): os dois usam createPlateRenderer/render; a arte individual é gravada como image/png e o pacote como application/zip (.zip)");

  // ---------- E7: lote grande, em partes ----------
  const big = await exportBatch(120, { maxPartBytes: 2 * 1024 * 1024 });
  const bigNames = Object.keys(big.entries);
  let bad = 0;
  for (const n of bigNames) {
    const bytes = big.entries[n]!;
    if (!PNG_SIG.every((v, i) => bytes[i] === v)) bad++;
    else {
      const img = await loadImage(Buffer.from(bytes));
      if (img.width !== W || img.height !== H) bad++;
    }
  }
  const zipsOnly = big.result.files.every((f) => f.name.endsWith(".zip"));
  check(bigNames.length === 120 && new Set(bigNames).size === 120 && bad === 0 && big.result.files.length > 1 && zipsOnly, "E7", { arquivos: bigNames.length, ruins: bad, partes: big.result.files.length });
  ok(`E7: lote com 120 placas dividido em ${big.result.files.length} ZIPs → 120 PNGs, todos decodificáveis em ${W}×${H}, nenhum corrompido, nenhum arquivo extra`);

  if (failures) {
    console.log(`${failures} falha(s)`);
    process.exit(1);
  }
  console.log("Artes do lote OK");
  process.exit(0);
}
main().catch((e) => {
  console.log("erro:", e instanceof Error ? e.stack : e);
  process.exit(1);
});
