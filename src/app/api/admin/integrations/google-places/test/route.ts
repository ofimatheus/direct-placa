import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth/session";
import { testEffectiveConnection } from "@/lib/integrations/google-places/admin";
import { placesAdminDeps, safeFailure } from "../deps";

/**
 * POST: "Testar conexão" com a chave EFETIVA (ADMIN > ambiente). Faz uma
 * chamada real e mínima ao Google. Não consome a cota diária do DirectLab
 * (não passa pelos contadores dos revendedores).
 */
export async function POST() {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;
  try {
    const result = await testEffectiveConnection(placesAdminDeps(auth.session.supabase));
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const f = safeFailure(error, "Não foi possível testar agora.");
    return NextResponse.json(f.body, { status: f.status, headers: { "Cache-Control": "no-store" } });
  }
}
