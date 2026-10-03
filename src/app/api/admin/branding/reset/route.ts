import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth/session";
import { errorResponse, httpErrorFromDb } from "@/lib/http";

/** Restaura o padrão DirectPlaca (somente ADMIN). As imagens enviadas continuam no bucket. */
export async function POST() {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;
  try {
    const { data, error } = await auth.session.supabase.rpc("admin_reset_branding");
    if (error) throw httpErrorFromDb(error, "Não foi possível restaurar o padrão.");
    return NextResponse.json({ branding: (data as unknown[])[0] ?? null });
  } catch (error) {
    return errorResponse(error);
  }
}
