import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlateTemplateVersionRow } from "@/lib/db/types";
import { HttpError, httpErrorFromDb } from "@/lib/http";
import { createPlateRenderer } from "@/lib/renderer/server";
import type { PlateLayout, RenderGeometry } from "@/lib/renderer/types";
import {
  OUTPUTS_BUCKET,
  TEMPLATES_BUCKET,
  downloadObject,
  objectExists,
  putGeneratedObject,
  putImmutableObject,
  signObject,
} from "@/lib/storage";
import { sha256Hex } from "@/lib/utils/hash";
import { validateTemplateImage } from "./image-validation";
import type { ImageMeta } from "./layout";
import type { ImageRef } from "./schema";

export const VERSION_COLUMNS =
  "id, template_id, version_number, base_image_path, base_image_mime_type, base_image_sha256, base_image_size_bytes, " +
  "canvas_width, canvas_height, print_width_mm, print_height_mm, qr_x, qr_y, qr_width, qr_height, qr_error_correction, " +
  "qr_quiet_zone, qr_color, qr_background_color, show_public_code, code_x, code_y, code_font_family, code_font_size, " +
  "code_color, code_align, code_max_width, safe_margin, renderer_version, locked_at, created_by, created_at, updated_at";

export async function getVersion(sb: SupabaseClient, versionId: string): Promise<PlateTemplateVersionRow> {
  const { data, error } = await sb
    .from("plate_template_versions")
    .select(VERSION_COLUMNS)
    .eq("id", versionId)
    .maybeSingle<PlateTemplateVersionRow>();
  if (error) throw httpErrorFromDb(error);
  if (!data) throw new HttpError(404, "Versão de template não encontrada.");
  return data;
}

export function metaFromVersion(version: PlateTemplateVersionRow): ImageMeta {
  return {
    mime: version.base_image_mime_type,
    ext: version.base_image_mime_type === "image/png" ? "png" : "jpg",
    width: version.canvas_width,
    height: version.canvas_height,
    sizeBytes: Number(version.base_image_size_bytes),
    sha256: version.base_image_sha256,
  };
}

export interface ResolvedImage {
  bytes: Buffer;
  meta: ImageMeta;
  stagingPath?: string;
  version?: PlateTemplateVersionRow;
}

/** Baixa a arte de versão com checagem de integridade (o sha256 é o nome e a garantia). */
export async function loadVersionImage(admin: SupabaseClient, version: PlateTemplateVersionRow): Promise<Buffer> {
  const bytes = await downloadObject(admin, TEMPLATES_BUCKET, version.base_image_path);
  if (sha256Hex(bytes) !== version.base_image_sha256) {
    throw new HttpError(500, `A arte da versão v${version.version_number} não confere com o sha256 registrado.`);
  }
  return bytes;
}

/**
 * Resolve a referência de imagem enviada pelo editor.
 *   staging → upload recém-feito: baixa e VALIDA no servidor (bytes reais)
 *   version → reaproveita a arte de uma versão existente
 * O cliente nunca informa caminho, hash ou dimensões: tudo é derivado aqui.
 */
export async function resolveImage(admin: SupabaseClient, ref: ImageRef): Promise<ResolvedImage> {
  if (ref.kind === "staging") {
    const bytes = await downloadObject(admin, TEMPLATES_BUCKET, ref.path);
    const mime = ref.path.endsWith(".png") ? "image/png" : "image/jpeg";
    const meta = await validateTemplateImage(bytes, { filename: ref.path, mime });
    return { bytes, meta, stagingPath: ref.path };
  }
  const version = await getVersion(admin, ref.versionId);
  const bytes = await loadVersionImage(admin, version);
  return { bytes, meta: metaFromVersion(version), version };
}

/**
 * Garante que a arte esteja no caminho definitivo e imutável do template:
 * plate-templates/{template_id}/{sha256}.{ext}. Nunca sobrescreve.
 */
export async function persistTemplateImage(
  admin: SupabaseClient,
  templateId: string,
  image: ResolvedImage,
): Promise<string> {
  if (image.version && image.version.template_id === templateId) {
    return image.version.base_image_path;
  }
  const path = `${templateId}/${image.meta.sha256}.${image.meta.ext}`;
  await putImmutableObject(admin, TEMPLATES_BUCKET, path, image.bytes, image.meta.mime);
  return path;
}

export interface RenderedPreview {
  url: string;
  geometry: RenderGeometry;
}

function previewKey(layout: PlateLayout, imageSha: string, publicCode: string, qrUrl: string): string {
  return sha256Hex(JSON.stringify({ layout, imageSha, publicCode, qrUrl }));
}

/**
 * Prévia fiel: usa o MESMO renderer da produção. O PNG vai para o Storage
 * (chave = hash do conteúdo) e a resposta é uma URL assinada — assim a prévia
 * de artes grandes não esbarra no limite de resposta das funções serverless.
 */
export async function renderPreview(
  admin: SupabaseClient,
  layout: PlateLayout,
  image: { bytes: Buffer; sha256: string },
  publicCode: string,
  qrUrl: string,
): Promise<RenderedPreview> {
  const renderer = await createPlateRenderer(layout, image.bytes);
  const { png, geometry } = await renderer.render(publicCode, qrUrl);
  const path = `previews/templates/${previewKey(layout, image.sha256, publicCode, qrUrl)}.png`;
  await putGeneratedObject(admin, OUTPUTS_BUCKET, path, png, "image/png");
  return { url: await signObject(admin, OUTPUTS_BUCKET, path, 600), geometry };
}

/** Versão com cache: se a mesma combinação já foi renderizada, só assina a URL. */
export async function cachedRenderUrl(
  admin: SupabaseClient,
  scope: string,
  layout: PlateLayout,
  version: PlateTemplateVersionRow,
  publicCode: string,
  qrUrl: string,
  downloadName?: string,
): Promise<string> {
  const path = `previews/${scope}/${previewKey(layout, version.base_image_sha256, publicCode, qrUrl)}.png`;
  if (!(await objectExists(admin, OUTPUTS_BUCKET, path))) {
    const bytes = await loadVersionImage(admin, version);
    const renderer = await createPlateRenderer(layout, bytes);
    const { png } = await renderer.render(publicCode, qrUrl);
    await putGeneratedObject(admin, OUTPUTS_BUCKET, path, png, "image/png");
  }
  return signObject(admin, OUTPUTS_BUCKET, path, 600, downloadName);
}
