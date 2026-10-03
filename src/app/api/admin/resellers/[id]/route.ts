import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminApi } from "@/lib/auth/session";
import { HttpError, errorResponse, httpErrorFromDb, readJson } from "@/lib/http";

const patchSchema = z.object({
  company_name: z.string().trim().min(1).max(120).optional(),
  contact_name: z.string().trim().min(1).max(120).optional(),
  document: z.string().trim().max(30).nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  active: z.boolean().optional(),
});

/**
 * Edita dados do revendedor e ativa/desativa o acesso. Desativar bloqueia o
 * login e todas as operações dele (RLS e RPCs), mas as placas continuam
 * redirecionando normalmente para os clientes finais.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;
  try {
    const { id } = await params;
    z.string().uuid().parse(id);
    const body = patchSchema.parse(await readJson(request));
    const sb = auth.session.supabase;

    const { data: reseller, error } = await sb.from("reseller_profiles").select("id, user_id").eq("id", id).maybeSingle<{ id: string; user_id: string }>();
    if (error) throw httpErrorFromDb(error);
    if (!reseller) throw new HttpError(404, "Revendedor não encontrado.");

    const resellerPatch: Record<string, unknown> = {};
    if (body.company_name !== undefined) resellerPatch.company_name = body.company_name;
    if (body.document !== undefined) resellerPatch.document = body.document || null;
    if (body.phone !== undefined) resellerPatch.phone = body.phone || null;
    if (Object.keys(resellerPatch).length) {
      const { error: e } = await sb.from("reseller_profiles").update(resellerPatch).eq("id", id);
      if (e) throw httpErrorFromDb(e);
    }

    const profilePatch: Record<string, unknown> = {};
    if (body.contact_name !== undefined) profilePatch.name = body.contact_name;
    if (body.active !== undefined) profilePatch.active = body.active;
    if (Object.keys(profilePatch).length) {
      const { error: e } = await sb.from("profiles").update(profilePatch).eq("id", reseller.user_id).eq("role", "reseller");
      if (e) throw httpErrorFromDb(e);
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
