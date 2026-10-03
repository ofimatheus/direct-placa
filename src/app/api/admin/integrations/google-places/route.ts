import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth/session";
import { removeCustomKey, saveNewKey } from "@/lib/integrations/google-places/admin";
import { placesAdminDeps, safeFailure } from "./deps";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * PUT: "Testar e salvar" uma chave nova (ADMIN). Só grava se o Google
 * autorizar; senão a chave atual continua. A resposta nunca contém a chave,
 * e o corpo da requisição nunca é registrado.
 */
export async function PUT(request: Request) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;
  try {
    const body = (await request.json().catch(() => null)) as { apiKey?: unknown } | null;
    const result = await saveNewKey(body?.apiKey, placesAdminDeps(auth.session.supabase));
    return NextResponse.json(result, { status: result.ok ? 200 : 422, headers: NO_STORE });
  } catch (error) {
    const f = safeFailure(error, "Não foi possível salvar a chave. A chave atual foi mantida.");
    return NextResponse.json(f.body, { status: f.status, headers: NO_STORE });
  }
}

/** DELETE: remove a chave do ADMIN (volta para GOOGLE_PLACES_API_KEY; o ambiente não é alterado). */
export async function DELETE() {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;
  try {
    const result = await removeCustomKey(placesAdminDeps(auth.session.supabase));
    return NextResponse.json(result, { headers: NO_STORE });
  } catch (error) {
    const f = safeFailure(error, "Não foi possível remover a configuração.");
    return NextResponse.json(f.body, { status: f.status, headers: NO_STORE });
  }
}
