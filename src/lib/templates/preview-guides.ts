/**
 * Guias do PREVIEW RÁPIDO (somente navegador). Nunca entram na arte final:
 * são desenhadas por cima, depois do drawPlate. Cores de processo (CMYK),
 * o vocabulário de quem prepara arquivo para gráfica.
 */
import type { PlateLayout, RenderGeometry } from "@/lib/renderer/types";

const CYAN = "#00AEEF";
const MAGENTA = "#EC008C";
const YELLOW = "#FFD400";

export function drawGuides(ctx: CanvasRenderingContext2D, layout: PlateLayout, geometry: RenderGeometry | null): void {
  const unit = Math.max(2, Math.round(Math.min(layout.canvas_width, layout.canvas_height) / 400));
  ctx.save();
  ctx.lineWidth = unit;
  ctx.setLineDash([unit * 5, unit * 3]);

  // Margem de segurança
  const margin = layout.safe_margin ?? 0;
  if (margin > 0) {
    ctx.strokeStyle = CYAN;
    ctx.strokeRect(margin, margin, layout.canvas_width - margin * 2, layout.canvas_height - margin * 2);
  }

  // Caixa do QR (inclui a zona de silêncio)
  ctx.strokeStyle = MAGENTA;
  ctx.strokeRect(layout.qr_x, layout.qr_y, layout.qr_width, layout.qr_height);

  if (layout.show_public_code) {
    // Área máxima do texto
    const height = Math.round(layout.code_font_size * 1.1);
    const maxWidth = layout.code_max_width;
    if (maxWidth) {
      const left =
        layout.code_align === "left" ? layout.code_x : layout.code_align === "center" ? layout.code_x - maxWidth / 2 : layout.code_x - maxWidth;
      ctx.strokeStyle = YELLOW;
      ctx.strokeRect(left, layout.code_y - height / 2, maxWidth, height);
    }
    // Âncora do código
    ctx.setLineDash([]);
    ctx.strokeStyle = YELLOW;
    const arm = unit * 8;
    ctx.beginPath();
    ctx.moveTo(layout.code_x - arm, layout.code_y);
    ctx.lineTo(layout.code_x + arm, layout.code_y);
    ctx.moveTo(layout.code_x, layout.code_y - arm);
    ctx.lineTo(layout.code_x, layout.code_y + arm);
    ctx.stroke();

    if (geometry?.text) {
      ctx.setLineDash([unit, unit * 2]);
      ctx.strokeStyle = "rgba(255, 212, 0, 0.8)";
      const b = geometry.text.box;
      ctx.strokeRect(b.x, b.y, b.width, b.height);
    }
  }
  ctx.restore();
}

export const GUIDE_LEGEND = [
  { color: CYAN, label: "Margem de segurança" },
  { color: MAGENTA, label: "Área do QR" },
  { color: YELLOW, label: "Área máxima do código" },
] as const;
