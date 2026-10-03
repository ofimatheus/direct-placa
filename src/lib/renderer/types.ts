import type { PlateFontKey } from "./fonts";

export type QrErrorCorrection = "L" | "M" | "Q" | "H";
export type CodeAlign = "left" | "center" | "right";

/**
 * Tudo o que o renderer precisa para desenhar uma placa (sem a imagem em si).
 * Coordenadas em pixels da arte original.
 *  - Caixa do QR: (qr_x, qr_y) é o canto superior esquerdo; a caixa INCLUI a zona de silêncio.
 *  - Código: code_x é a âncora horizontal conforme code_align; code_y é o centro vertical da linha.
 */
export interface PlateLayout {
  canvas_width: number;
  canvas_height: number;
  print_width_mm: number | null;
  print_height_mm: number | null;
  qr_x: number;
  qr_y: number;
  qr_width: number;
  qr_height: number;
  qr_error_correction: QrErrorCorrection;
  qr_quiet_zone: number;
  qr_color: string;
  qr_background_color: string;
  show_public_code: boolean;
  code_x: number;
  code_y: number;
  code_font_family: PlateFontKey;
  code_font_size: number;
  code_color: string;
  code_align: CodeAlign;
  code_max_width: number | null;
  safe_margin: number | null;
  renderer_version: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface QrGeometry {
  /** Caixa configurada (pintada com a cor de fundo). */
  box: Rect;
  /** Área efetivamente ocupada pelos módulos + zona de silêncio (centralizada na caixa). */
  drawn: Rect;
  moduleSize: number;
  moduleCount: number;
}

export interface TextGeometry {
  text: string;
  fontSize: number;
  /** Caixa aproximada dos glifos (altura de maiúscula), usada em guias e alertas. */
  box: Rect;
}

export interface RenderGeometry {
  qr: QrGeometry;
  text: TextGeometry | null;
}
