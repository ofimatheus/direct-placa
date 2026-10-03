import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth/session";
import { BRANDING_UPLOAD_RULES, validateBrandingImage } from "@/lib/branding/image";
import { HttpError, errorResponse, httpErrorFromDb } from "@/lib/http";

const BUCKET = "landing-assets";

/**
 * Envia uma imagem para a biblioteca da landing (só ADMIN). O tipo é
 * conferido pelos BYTES (PNG/JPG/WEBP; SVG e outros recusados), com limite de
 * tamanho e dimensões. Nome único (media/<uuid>.<ext>); nada é sobrescrito.
 */
export async function POST(request: Request) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;
  try {
    const form = await request.formData().catch(() => {
      throw new HttpError(400, "Envie o arquivo como formulário (multipart/form-data).");
    });
    const file = form.get("file");
    if (!(file instanceof File)) throw new HttpError(400, "Selecione uma imagem.");
    if (file.size > BRANDING_UPLOAD_RULES.landing.maxBytes) throw new HttpError(413, "A imagem pode ter no máximo 4 MB.");
    const bytes = Buffer.from(await file.arrayBuffer());
    const image = await validateBrandingImage(bytes, "landing", { filename: file.name, mime: file.type || undefined });
    const path = `media/${randomUUID()}.${image.ext}`;
    const sb = auth.session.supabase;
    const { error: upErr } = await sb.storage.from(BUCKET).upload(path, bytes, { contentType: image.mime, cacheControl: "31536000", upsert: false });
    if (upErr) throw new HttpError(502, `Não foi possível armazenar a imagem: ${upErr.message}`);
    const { data, error } = await sb.rpc("admin_landing_media_register", { p_path: path, p_mime: image.mime, p_width: image.width, p_height: image.height, p_bytes: bytes.length });
    if (error) {
      await sb.storage.from(BUCKET).remove([path]);
      throw httpErrorFromDb(error, "Não foi possível registrar a imagem.");
    }
    return NextResponse.json({ id: String(data), path, mime: image.mime, width: image.width, height: image.height, bytes: bytes.length }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
