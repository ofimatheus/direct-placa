import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminApi } from "@/lib/auth/session";
import { errorResponse, httpErrorFromDb } from "@/lib/http";

/** Exclui uma imagem da biblioteca (só ADMIN). Recusada se estiver em uso no rascunho ou no publicado. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;
  try {
    const { id } = await params;
    z.uuid().parse(id);
    const sb = auth.session.supabase;
    const { data, error } = await sb.rpc("admin_landing_media_delete", { p_id: id });
    if (error) throw httpErrorFromDb(error, "Não foi possível excluir a imagem.");
    await sb.storage.from("landing-assets").remove([String(data)]);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
