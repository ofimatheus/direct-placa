/**
 * Regras de geometria do layout (compartilhadas: preview rápido e servidor).
 *   errors   → impedem salvar e renderizar
 *   warnings → alertas de produção; o ADMIN decide
 */
import type { PlateLayout, Rect, RenderGeometry } from "@/lib/renderer/types";

export interface LayoutIssue {
  field?: string;
  message: string;
}

export interface LayoutCheck {
  errors: LayoutIssue[];
  warnings: LayoutIssue[];
}

const MIN_QR_MM = 20;
const MIN_MODULE_PX = 4;
const TARGET_DPI = 300;

function inside(inner: Rect, outer: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

export function mmPerPixel(layout: PlateLayout): number | null {
  if (!layout.print_width_mm) return null;
  return layout.print_width_mm / layout.canvas_width;
}

export function dpiOf(layout: PlateLayout): number | null {
  if (!layout.print_width_mm) return null;
  return Math.round(layout.canvas_width / (layout.print_width_mm / 25.4));
}

export function checkLayout(layout: PlateLayout, geometry?: RenderGeometry | null): LayoutCheck {
  const errors: LayoutIssue[] = [];
  const warnings: LayoutIssue[] = [];
  const canvas: Rect = { x: 0, y: 0, width: layout.canvas_width, height: layout.canvas_height };
  const qrBox: Rect = { x: layout.qr_x, y: layout.qr_y, width: layout.qr_width, height: layout.qr_height };

  if (layout.qr_width !== layout.qr_height) {
    errors.push({ field: "qr_width", message: "O QR é quadrado: largura e altura devem ser iguais." });
  }
  if (!inside(qrBox, canvas)) {
    errors.push({ field: "qr_x", message: "A área do QR ultrapassa os limites da arte." });
  }
  if (layout.code_x < 0 || layout.code_x > layout.canvas_width || layout.code_y < 0 || layout.code_y > layout.canvas_height) {
    errors.push({ field: "code_x", message: "A posição do código está fora da arte." });
  }
  if (layout.code_max_width !== null && layout.code_max_width > layout.canvas_width) {
    errors.push({ field: "code_max_width", message: "A largura máxima do código é maior que a arte." });
  }
  const margin = layout.safe_margin ?? 0;
  if (margin * 2 >= Math.min(layout.canvas_width, layout.canvas_height)) {
    errors.push({ field: "safe_margin", message: "A margem de segurança é grande demais para esta arte." });
  }

  if (geometry) {
    if (geometry.qr.moduleSize < MIN_MODULE_PX) {
      warnings.push({
        field: "qr_width",
        message: `Cada módulo do QR tem só ${geometry.qr.moduleSize} px. Aumente o QR para uma impressão nítida (mínimo recomendado: ${MIN_MODULE_PX} px).`,
      });
    }
    const text = geometry.text;
    if (text) {
      if (!inside(text.box, canvas)) {
        warnings.push({ field: "code_x", message: "O código sai dos limites da arte e será cortado." });
      }
      if (overlaps(text.box, qrBox)) {
        warnings.push({ field: "code_y", message: "O código está sobrepondo a área do QR." });
      }
      if (text.fontSize < layout.code_font_size) {
        warnings.push({
          field: "code_font_size",
          message: `O código foi reduzido para ${text.fontSize} px para caber na largura máxima.`,
        });
      }
    }
  }

  if (margin > 0) {
    const safe: Rect = { x: margin, y: margin, width: layout.canvas_width - margin * 2, height: layout.canvas_height - margin * 2 };
    if (!inside(qrBox, safe)) warnings.push({ field: "qr_x", message: "O QR invade a margem de segurança." });
    if (geometry?.text && !inside(geometry.text.box, safe)) {
      warnings.push({ field: "code_x", message: "O código invade a margem de segurança." });
    }
  }

  const perPx = mmPerPixel(layout);
  if (perPx !== null && layout.print_height_mm) {
    const qrMm = layout.qr_width * perPx;
    if (qrMm < MIN_QR_MM) {
      warnings.push({
        field: "qr_width",
        message: `O QR terá ${qrMm.toFixed(1).replace(".", ",")} mm impresso. Abaixo de ${MIN_QR_MM} mm a leitura fica difícil.`,
      });
    }
    const dpi = dpiOf(layout);
    if (dpi !== null && dpi < TARGET_DPI) {
      warnings.push({
        field: "print_width_mm",
        message: `A arte terá ${dpi} DPI nesse tamanho. Para impressão, o ideal é ${TARGET_DPI} DPI ou mais.`,
      });
    }
    const artRatio = layout.canvas_width / layout.canvas_height;
    const printRatio = layout.print_width_mm! / layout.print_height_mm;
    if (Math.abs(artRatio - printRatio) / printRatio > 0.02) {
      warnings.push({
        field: "print_height_mm",
        message: "A proporção do tamanho de impressão não bate com a proporção da arte.",
      });
    }
  }

  return { errors, warnings };
}
