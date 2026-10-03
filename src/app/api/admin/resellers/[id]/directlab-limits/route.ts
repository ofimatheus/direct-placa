import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminApi } from "@/lib/auth/session";
import { errorResponse, httpErrorFromDb, readJson } from "@/lib/http";

const bodySchema = z.object({
  googleReviewDaily: z.number().int().min(0).max(1000),
  directlinkPages: z.number().int().min(0).max(1000),
});

/**
 * ADMIN define os limites do DirectLab de um revendedor (valor atual, sem
 * histórico). O banco confere de novo que quem chama é ADMIN.
 */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;
  try {
    const { id } = await params;
    z.string().uuid().parse(id);
    const body = bodySchema.parse(await readJson(request));
    const { error } = await auth.session.supabase.rpc("admin_set_directlab_limits", {
      p_reseller_id: id,
      p_google_review_daily: body.googleReviewDaily,
      p_directlink_pages: body.directlinkPages,
    });
    if (error) throw httpErrorFromDb(error, "Não foi possível salvar os limites.");
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
