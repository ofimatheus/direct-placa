/**
 * Desenho da placa — puro e determinístico.
 *
 * Este módulo não conhece React, DOM nem Node: recebe um contexto 2D
 * compatível com Canvas (o do navegador no preview rápido, o do
 * @napi-rs/canvas/Skia no servidor) e desenha exatamente a mesma coisa.
 * Mudanças de comportamento exigem um novo RENDERER_VERSION, para que
 * versões antigas continuem sendo reimpressas de forma idêntica.
 */
import { fontCss, isPlateFontKey, type PlateFontKey } from "./fonts";
import { buildQrMatrix, computeQrGeometry, type QrMatrix } from "./qr";
import type { PlateLayout, QrErrorCorrection, QrGeometry, Rect, RenderGeometry, TextGeometry } from "./types";

export const RENDERER_VERSION = 1;
export const SUPPORTED_RENDERER_VERSIONS: readonly number[] = [1];
const MIN_FONT_SIZE = 6;

export interface Canvas2DLike<TImage> {
  fillStyle: unknown;
  font: string;
  textAlign: string;
  textBaseline: string;
  imageSmoothingEnabled: boolean;
  save(): void;
  restore(): void;
  fillRect(x: number, y: number, width: number, height: number): void;
  fillText(text: string, x: number, y: number): void;
  measureText(text: string): { width: number; actualBoundingBoxAscent: number };
  drawImage(image: TImage, dx: number, dy: number, dw: number, dh: number): void;
}

export interface DrawPlateInput<TImage> {
  layout: PlateLayout;
  baseImage: TImage;
  publicCode: string;
  qrUrl: string;
}

export function assertSupportedRenderer(version: number): void {
  if (!SUPPORTED_RENDERER_VERSIONS.includes(version)) {
    throw new Error(`renderer_version ${version} não é suportado por este build.`);
  }
}

export function drawPlate<TImage>(ctx: Canvas2DLike<TImage>, input: DrawPlateInput<TImage>): RenderGeometry {
  const { layout, baseImage, publicCode, qrUrl } = input;
  assertSupportedRenderer(layout.renderer_version);

  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(baseImage, 0, 0, layout.canvas_width, layout.canvas_height);

  const qr = drawQr(ctx, {
    box: { x: layout.qr_x, y: layout.qr_y, width: layout.qr_width, height: layout.qr_height },
    text: qrUrl,
    errorCorrection: layout.qr_error_correction,
    quietZone: layout.qr_quiet_zone,
    color: layout.qr_color,
    background: layout.qr_background_color,
  });

  const text = layout.show_public_code ? drawCode(ctx, layout, publicCode) : null;
  ctx.restore();
  return { qr, text };
}

export interface DrawQrOptions {
  box: Rect;
  text: string;
  errorCorrection: QrErrorCorrection;
  quietZone: number;
  color: string;
  background: string;
  matrix?: QrMatrix;
}

export function drawQr<TImage>(ctx: Canvas2DLike<TImage>, options: DrawQrOptions): QrGeometry {
  const matrix = options.matrix ?? buildQrMatrix(options.text, options.errorCorrection);
  const geometry = computeQrGeometry(options.box, matrix.size, options.quietZone);
  if (geometry.moduleSize < 1) {
    throw new Error("A área do QR é pequena demais para o conteúdo: aumente o tamanho do QR.");
  }

  const { box, drawn, moduleSize } = geometry;
  ctx.fillStyle = options.background;
  ctx.fillRect(box.x, box.y, box.width, box.height);

  // Módulos escuros agrupados em faixas horizontais: menos chamadas e sem emendas.
  ctx.fillStyle = options.color;
  const originX = drawn.x + options.quietZone * moduleSize;
  const originY = drawn.y + options.quietZone * moduleSize;
  for (let row = 0; row < matrix.size; row++) {
    let col = 0;
    while (col < matrix.size) {
      if (!matrix.isDark(row, col)) {
        col++;
        continue;
      }
      const start = col;
      while (col < matrix.size && matrix.isDark(row, col)) col++;
      ctx.fillRect(originX + start * moduleSize, originY + row * moduleSize, (col - start) * moduleSize, moduleSize);
    }
  }
  return geometry;
}

function resolveFont(key: string): PlateFontKey {
  return isPlateFontKey(key) ? key : "inter-bold";
}

/** Reduz a fonte até o texto caber em code_max_width (nunca quebra linha). */
function fitFontSize<TImage>(ctx: Canvas2DLike<TImage>, key: PlateFontKey, text: string, size: number, maxWidth: number | null) {
  ctx.font = fontCss(key, size);
  let width = ctx.measureText(text).width;
  if (!maxWidth || width <= maxWidth) return { size, width };

  let fitted = Math.max(MIN_FONT_SIZE, Math.floor((size * maxWidth) / width));
  ctx.font = fontCss(key, fitted);
  width = ctx.measureText(text).width;
  while (width > maxWidth && fitted > MIN_FONT_SIZE) {
    fitted -= 1;
    ctx.font = fontCss(key, fitted);
    width = ctx.measureText(text).width;
  }
  return { size: fitted, width };
}

export function drawCode<TImage>(ctx: Canvas2DLike<TImage>, layout: PlateLayout, publicCode: string): TextGeometry {
  const key = resolveFont(layout.code_font_family);
  const { size, width } = fitFontSize(ctx, key, publicCode, layout.code_font_size, layout.code_max_width);

  // Centro vertical pela altura de maiúscula ("H"): igual para todos os códigos
  // do lote, independentemente das letras sorteadas.
  const capHeight = ctx.measureText("H").actualBoundingBoxAscent || size * 0.72;
  const baseline = Math.round(layout.code_y + capHeight / 2);

  ctx.fillStyle = layout.code_color;
  ctx.textAlign = layout.code_align;
  ctx.textBaseline = "alphabetic";
  ctx.fillText(publicCode, layout.code_x, baseline);

  const left =
    layout.code_align === "left" ? layout.code_x : layout.code_align === "center" ? layout.code_x - width / 2 : layout.code_x - width;
  return {
    text: publicCode,
    fontSize: size,
    box: { x: left, y: baseline - capHeight, width, height: capHeight },
  };
}

