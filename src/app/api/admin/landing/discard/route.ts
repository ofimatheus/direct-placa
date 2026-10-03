import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth/session";
import { errorResponse, httpErrorFromDb } from "@/lib/http";

/** Descarta o rascunho: volta ao conteúdo publicado (ou ao padrão). Só ADMIN. */
export async function POST() {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;
  try {
    const { error } = await auth.session.supabase.rpc("admin_landing_discard_draft");
    if (error) throw httpErrorFromDb(error, "Não foi possível descartar o rascunho.");
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
