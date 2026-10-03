import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminApi } from "@/lib/auth/session";
import { BRANDING_BUCKET, brandingPublicUrl } from "@/lib/branding/defaults";
import { BRANDING_UPLOAD_RULES, validateBrandingImage } from "@/lib/branding/image";
import { getPublicEnv } from "@/lib/env";
import { HttpError, errorResponse } from "@/lib/http";

const kindSchema = z.enum(["logo", "banner"]);

/**
 * Upload de logo ou banner da tela de login (somente ADMIN).
 *
 * O arquivo é validado pelos bytes (PNG/JPG/WEBP, sem SVG), tamanho e
 * dimensões, e gravado com nome único (<kind>/<uuid>.<ext>): trocar a imagem
 * nunca sobrescreve a anterior nem sofre com cache. O upload usa a sessão do
 * ADMIN — a policy do Storage exige is_admin() —, sem service role.
 * Enviar não muda a tela de login: vale só depois de "Salvar alterações".
 */
export async function POST(request: Request) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;
  try {
    const form = await request.formData().catch(() => {
      throw new HttpError(400, "Envie o arquivo como formulário (multipart/form-data).");
    });
    const kind = kindSchema.parse(form.get("kind"));
    const file = form.get("file");
    if (!(file instanceof File)) throw new HttpError(400, "Selecione uma imagem.");
    if (file.size > BRANDING_UPLOAD_RULES[kind].maxBytes) {
      throw new HttpError(413, `${BRANDING_UPLOAD_RULES[kind].label} pode ter no máximo ${Math.round(BRANDING_UPLOAD_RULES[kind].maxBytes / 1024 / 1024)} MB.`);
    }
    const bytes = Buffer.from(await file.arrayBuffer());
    const image = await validateBrandingImage(bytes, kind, { filename: file.name, mime: file.type || undefined });

    const path = `${kind}/${randomUUID()}.${image.ext}`;
    const { error } = await auth.session.supabase.storage.from(BRANDING_BUCKET).upload(path, bytes, {
      contentType: image.mime,
      cacheControl: "31536000",
      upsert: false,
    });
    if (error) throw new HttpError(502, `Não foi possível armazenar a imagem: ${error.message}`);

    return NextResponse.json(
      { path, url: brandingPublicUrl(getPublicEnv().supabaseUrl, path), width: image.width, height: image.height },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
