import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireDirectLabApi } from "@/lib/auth/session";
import { BRANDING_UPLOAD_RULES, validateBrandingImage } from "@/lib/branding/image";
import { directLinkAssetUrl } from "@/lib/directlink/items";
import { getPublicEnv } from "@/lib/env";
import { HttpError, errorResponse } from "@/lib/http";

/**
 * Banner ou logo de DirectLink. Mesma validação das imagens de branding:
 * tipo pelos BYTES (PNG/JPG/WEBP, sem SVG), tamanho e dimensões. Nome único
 * na pasta do próprio usuário (<uid>/<tipo>/<uuid>.<ext>); a policy do
 * Storage só aceita a própria pasta. Nada é sobrescrito.
 */
export async function POST(request: Request) {
  const auth = await requireDirectLabApi();
  if (!auth.ok) return auth.response;
  try {
    const form = await request.formData().catch(() => {
      throw new HttpError(400, "Envie o arquivo como formulário (multipart/form-data).");
    });
    const kind = z.enum(["banner", "logo"]).parse(form.get("kind"));
    const file = form.get("file");
    if (!(file instanceof File)) throw new HttpError(400, "Selecione uma imagem.");
    if (file.size > BRANDING_UPLOAD_RULES[kind].maxBytes) {
      throw new HttpError(413, `${kind === "logo" ? "A logo" : "O banner"} pode ter no máximo ${Math.round(BRANDING_UPLOAD_RULES[kind].maxBytes / 1024 / 1024)} MB.`);
    }
    const bytes = Buffer.from(await file.arrayBuffer());
    const image = await validateBrandingImage(bytes, kind, { filename: file.name, mime: file.type || undefined });
    const path = `${auth.session.user.id}/${kind}/${randomUUID()}.${image.ext}`;
    const { error } = await auth.session.supabase.storage.from("directlink-assets").upload(path, bytes, {
      contentType: image.mime,
      cacheControl: "31536000",
      upsert: false,
    });
    if (error) throw new HttpError(502, `Não foi possível armazenar a imagem: ${error.message}`);
    return NextResponse.json({ path, url: directLinkAssetUrl(getPublicEnv().supabaseUrl, path) }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
