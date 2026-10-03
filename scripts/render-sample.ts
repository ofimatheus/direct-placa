/**
 * Teste do renderer de produção sem Supabase:
 *   npm run test:renderer
 * Gera uma arte base sintética, renderiza placas, confere determinismo,
 * decodifica o QR gerado e grava os arquivos em tmp/.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import jsQR from "jsqr";
import { createPlateRenderer, renderQrPng, renderQrSvg } from "@/lib/renderer/server";
import type { PlateLayout } from "@/lib/renderer/types";
import { checkLayout } from "@/lib/templates/geometry";
import { buildNfcUrl, buildQrUrl, PREVIEW_PUBLIC_CODE } from "@/lib/plates/urls";

process.env.NEXT_PUBLIC_GO_BASE_URL ??= "https://go.meudominio.com";

const W = 1181; // 100 mm a 300 DPI
const H = 1772; // 150 mm a 300 DPI

async function syntheticArt(): Promise<Buffer> {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  const gradient = ctx.createLinearGradient(0, 0, 0, H);
  gradient.addColorStop(0, "#111418");
  gradient.addColorStop(1, "#23303d");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 92px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("Avalie-nos", W / 2, 230);
  ctx.font = "bold 70px sans-serif";
  ctx.fillText("no Google", W / 2, 330);
  ctx.fillStyle = "#f5b400";
  for (let i = 0; i < 5; i++) ctx.fillRect(W / 2 - 250 + i * 104, 390, 84, 84);
  return canvas.encode("png");
}

const layout: PlateLayout = {
  canvas_width: W,
  canvas_height: H,
  print_width_mm: 100,
  print_height_mm: 150,
  qr_x: 240,
  qr_y: 560,
  qr_width: 700,
  qr_height: 700,
  qr_error_correction: "M",
  qr_quiet_zone: 4,
  qr_color: "#000000",
  qr_background_color: "#FFFFFF",
  show_public_code: true,
  code_x: Math.round(W / 2),
  code_y: 1380,
  code_font_family: "inter-bold",
  code_font_size: 110,
  code_color: "#FFFFFF",
  code_align: "center",
  code_max_width: 760,
  safe_margin: 60,
  renderer_version: 1,
};

async function decodeQr(png: Buffer) {
  const image = await loadImage(png);
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);
  const { data } = ctx.getImageData(0, 0, image.width, image.height);
  return jsQR(new Uint8ClampedArray(data.buffer), image.width, image.height)?.data ?? null;
}

const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex").slice(0, 16);

async function main() {
  mkdirSync("tmp", { recursive: true });
  const art = await syntheticArt();
  writeFileSync("tmp/base-art.png", art);

  const renderer = await createPlateRenderer(layout, art);
  const failures: string[] = [];

  for (const code of [PREVIEW_PUBLIC_CODE, "A7K482", "P8M392", "H4F782"]) {
    const url = buildQrUrl(code);
    const t0 = performance.now();
    const first = await renderer.render(code, url);
    const ms = Math.round(performance.now() - t0);
    const second = await renderer.render(code, url);
    const deterministic = sha(first.png) === sha(second.png);
    const decoded = await decodeQr(first.png);
    const check = checkLayout(layout, first.geometry);
    writeFileSync(`tmp/${code}.png`, first.png);
    console.log(
      `${code}  ${ms} ms  ${(first.png.length / 1024).toFixed(0)} KB  módulo=${first.geometry.qr.moduleSize}px  ` +
        `fonte=${first.geometry.text?.fontSize}px  determinístico=${deterministic}  QR="${decoded}"`,
    );
    if (!deterministic) failures.push(`${code}: render não determinístico`);
    if (decoded !== url) failures.push(`${code}: QR decodificado (${decoded}) difere de ${url}`);
    if (check.errors.length) failures.push(`${code}: ${check.errors.map((e) => e.message).join("; ")}`);
    if (check.warnings.length) console.log("   alertas:", check.warnings.map((w) => w.message).join(" | "));
  }

  const qrOpts = { errorCorrection: "M", quietZone: 4, color: "#000000", background: "#FFFFFF" } as const;
  const qrPng = await renderQrPng(buildQrUrl("A7K482"), { ...qrOpts, sizePx: 1024 });
  writeFileSync("tmp/A7K482-qr.png", qrPng);
  writeFileSync("tmp/A7K482-qr.svg", renderQrSvg(buildQrUrl("A7K482"), qrOpts));
  if ((await decodeQr(qrPng)) !== buildQrUrl("A7K482")) failures.push("QR avulso não decodificou");
  console.log(`NFC de A7K482: ${buildNfcUrl("A7K482")}`);

  if (failures.length) {
    console.error("FALHAS:\n" + failures.join("\n"));
    process.exit(1);
  }
  console.log("Renderer OK: arquivos em tmp/");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
