import { RENDERER_VERSION } from "@/lib/renderer/draw";
import type { PlateLayout } from "@/lib/renderer/types";
import type { PlateTemplateVersionRow } from "@/lib/db/types";
import type { LayoutInput } from "./schema";

export interface ImageMeta {
  mime: "image/png" | "image/jpeg";
  ext: "png" | "jpg";
  width: number;
  height: number;
  sizeBytes: number;
  sha256: string;
}

export function layoutFromInput(input: LayoutInput, canvas: { width: number; height: number }): PlateLayout {
  return { ...input, canvas_width: canvas.width, canvas_height: canvas.height, renderer_version: RENDERER_VERSION };
}

export function layoutFromVersion(version: PlateTemplateVersionRow): PlateLayout {
  return {
    canvas_width: version.canvas_width,
    canvas_height: version.canvas_height,
    print_width_mm: version.print_width_mm === null ? null : Number(version.print_width_mm),
    print_height_mm: version.print_height_mm === null ? null : Number(version.print_height_mm),
    qr_x: version.qr_x,
    qr_y: version.qr_y,
    qr_width: version.qr_width,
    qr_height: version.qr_height,
    qr_error_correction: version.qr_error_correction,
    qr_quiet_zone: version.qr_quiet_zone,
    qr_color: version.qr_color,
    qr_background_color: version.qr_background_color,
    show_public_code: version.show_public_code,
    code_x: version.code_x,
    code_y: version.code_y,
    code_font_family: version.code_font_family,
    code_font_size: version.code_font_size,
    code_color: version.code_color,
    code_align: version.code_align,
    code_max_width: version.code_max_width,
    safe_margin: version.safe_margin,
    renderer_version: version.renderer_version,
  };
}

export function inputFromVersion(version: PlateTemplateVersionRow): LayoutInput {
  const { canvas_width: _w, canvas_height: _h, renderer_version: _r, ...input } = layoutFromVersion(version);
  return input;
}

/** Layout inicial razoável para uma arte recém-enviada: QR centralizado, código logo abaixo. */
export function defaultLayoutFor(width: number, height: number): LayoutInput {
  const qrSize = Math.max(21, Math.round(Math.min(width, height) * 0.45));
  const qrX = Math.round((width - qrSize) / 2);
  const qrY = Math.round((height - qrSize) / 2);
  const fontSize = Math.max(12, Math.round(qrSize * 0.12));
  return {
    print_width_mm: null,
    print_height_mm: null,
    qr_x: qrX,
    qr_y: qrY,
    qr_width: qrSize,
    qr_height: qrSize,
    qr_error_correction: "M",
    qr_quiet_zone: 4,
    qr_color: "#000000",
    qr_background_color: "#FFFFFF",
    show_public_code: true,
    code_x: Math.round(width / 2),
    code_y: Math.min(height - fontSize, qrY + qrSize + Math.round(fontSize * 1.2)),
    code_font_family: "inter-bold",
    code_font_size: fontSize,
    code_color: "#000000",
    code_align: "center",
    code_max_width: Math.round(qrSize * 1.1),
    safe_margin: Math.round(Math.min(width, height) * 0.04),
  };
}

/** Payload completo (jsonb) aceito pelas RPCs create_plate_template / save_template_layout. */
export function versionPayload(layout: PlateLayout, image: ImageMeta, imagePath: string) {
  return {
    ...layout,
    base_image_path: imagePath,
    base_image_mime_type: image.mime,
    base_image_sha256: image.sha256,
    base_image_size_bytes: image.sizeBytes,
  };
}
