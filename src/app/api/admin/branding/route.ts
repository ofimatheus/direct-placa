import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminApi } from "@/lib/auth/session";
import { BRANDING_LIMITS } from "@/lib/branding/defaults";
import { errorResponse, httpErrorFromDb, readJson } from "@/lib/http";

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional().transform((v) => (v ? v : null));
const assetPath = (kind: "logo" | "banner") =>
  z
    .string()
    .regex(new RegExp(`^${kind}/[0-9a-f-]{36}\\.(png|jpg|webp)$`), "Imagem inválida: envie de novo.")
    .nullable()
    .optional()
    .transform((v) => v ?? null);

const bodySchema = z.object({
  brand_name: optionalText(BRANDING_LIMITS.brandName),
  show_brand_name: z.boolean().default(true),
  eyebrow: optionalText(BRANDING_LIMITS.eyebrow),
  title: optionalText(BRANDING_LIMITS.title),
  subtitle: optionalText(BRANDING_LIMITS.subtitle),
  logo_path: assetPath("logo"),
  banner_path: assetPath("banner"),
});

/** Salva a personalização da tela de login (somente ADMIN; o banco revalida is_admin()). */
export async function PUT(request: Request) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;
  try {
    const body = bodySchema.parse(await readJson(request));
    const { data, error } = await auth.session.supabase.rpc("admin_save_branding", {
      p_brand_name: body.brand_name,
      p_show_brand_name: body.show_brand_name,
      p_eyebrow: body.eyebrow,
      p_title: body.title,
      p_subtitle: body.subtitle,
      p_logo_path: body.logo_path,
      p_banner_path: body.banner_path,
    });
    if (error) throw httpErrorFromDb(error, "Não foi possível salvar a personalização.");
    return NextResponse.json({ branding: (data as unknown[])[0] ?? null });
  } catch (error) {
    return errorResponse(error);
  }
}
