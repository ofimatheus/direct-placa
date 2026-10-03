import "server-only";
import path from "node:path";
import { GlobalFonts, createCanvas, loadImage, type Image } from "@napi-rs/canvas";
import { PLATE_FONTS, PLATE_FONT_KEYS } from "./fonts";
import { drawPlate, drawQr, assertSupportedRenderer } from "./draw";
import { buildQrMatrix, qrMatrixToSvg } from "./qr";
import type { PlateLayout, QrErrorCorrection, RenderGeometry } from "./types";

let fontsRegistered = false;

function ensureFonts(): void {
  if (fontsRegistered) return;
  for (const key of PLATE_FONT_KEYS) {
    const font = PLATE_FONTS[key];
    const file = path.join(process.cwd(), "public", "fonts", font.file);
    const ok = GlobalFonts.registerFromPath(file, font.family);
    if (!ok) throw new Error(`Não foi possível registrar a fonte ${font.file} (${file}).`);
  }
  fontsRegistered = true;
}

export interface RenderedPlate {
  png: Buffer;
  geometry: RenderGeometry;
}

export interface PlateRenderer {
  render(publicCode: string, qrUrl: string): Promise<RenderedPlate>;
}

/**
 * Prepara um renderer para uma versão de template: decodifica a arte base UMA vez
 * e reaproveita para todas as placas do lote.
 */
export async function createPlateRenderer(layout: PlateLayout, baseImageBytes: Buffer): Promise<PlateRenderer> {
  assertSupportedRenderer(layout.renderer_version);
  ensureFonts();
  const image: Image = await loadImage(baseImageBytes);
  if (image.width !== layout.canvas_width || image.height !== layout.canvas_height) {
    throw new Error(
      `A arte tem ${image.width}×${image.height}px, mas a versão espera ${layout.canvas_width}×${layout.canvas_height}px.`,
    );
  }

  return {
    async render(publicCode, qrUrl) {
      const canvas = createCanvas(layout.canvas_width, layout.canvas_height);
      const ctx = canvas.getContext("2d");
      const geometry = drawPlate(ctx, { layout, baseImage: image, publicCode, qrUrl });
      const png = await canvas.encode("png");
      return { png, geometry };
    },
  };
}

/** Forma conceitual pedida: renderPlate(templateVersion, publicCode, qrUrl). */
export async function renderPlate(
  layout: PlateLayout,
  baseImageBytes: Buffer,
  publicCode: string,
  qrUrl: string,
): Promise<RenderedPlate> {
  const renderer = await createPlateRenderer(layout, baseImageBytes);
  return renderer.render(publicCode, qrUrl);
}

export interface QrFileOptions {
  errorCorrection: QrErrorCorrection;
  quietZone: number;
  color: string;
  background: string;
  sizePx: number;
}

/** QR avulso em PNG (para o ZIP de QR Codes), usando o mesmo desenho da arte final. */
export async function renderQrPng(url: string, options: QrFileOptions): Promise<Buffer> {
  const canvas = createCanvas(options.sizePx, options.sizePx);
  const ctx = canvas.getContext("2d");
  drawQr(ctx, {
    box: { x: 0, y: 0, width: options.sizePx, height: options.sizePx },
    text: url,
    errorCorrection: options.errorCorrection,
    quietZone: options.quietZone,
    color: options.color,
    background: options.background,
  });
  return canvas.encode("png");
}

export function renderQrSvg(url: string, options: Omit<QrFileOptions, "sizePx">): string {
  const matrix = buildQrMatrix(url, options.errorCorrection);
  return qrMatrixToSvg(matrix, options.quietZone, options.color, options.background);
}
