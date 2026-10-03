import { NextResponse } from "next/server";
import { z } from "zod";
import { requireDirectLabApi } from "@/lib/auth/session";
import { errorResponse, httpErrorFromDb, readJson } from "@/lib/http";

/** Ativa/desativa um DirectLink (desativado sai do ar; nada é apagado). */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireDirectLabApi();
  if (!auth.ok) return auth.response;
  try {
    const { id } = await context.params;
    z.string().uuid().parse(id);
    const { active } = z.object({ active: z.boolean() }).parse(await readJson(request));
    const { error } = await auth.session.supabase.rpc("directlink_set_active", { p_id: id, p_active: active });
    if (error) throw httpErrorFromDb(error, "Não foi possível alterar o DirectLink.");
    return NextResponse.json({ active });
  } catch (error) {
    return errorResponse(error);
  }
}
