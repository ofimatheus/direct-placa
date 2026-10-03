import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth/session";
import { errorResponse, httpErrorFromDb, readJson } from "@/lib/http";
import { loadLandingAdminState } from "@/lib/landing/load";
import { validateLandingContent } from "@/lib/landing/schema";

/**
 * Publica o rascunho (só ADMIN). O rascunho é REVALIDADO antes; a troca é
 * atômica no banco. Qualquer erro → a versão pública anterior continua.
 * Depois, /revendedores é regenerada.
 */
export async function POST(request: Request) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;
  try {
    const body = (await readJson(request)) as { expectedVersion?: unknown };
    const expected = Number.isInteger(body?.expectedVersion) ? Number(body.expectedVersion) : -1;
    const state = await loadLandingAdminState(auth.session.supabase);
    if (!state.installed) return NextResponse.json({ error: "Aplique a migration 20261008120000_landing_cms.sql para publicar pelo painel." }, { status: 503 });
    if (state.draftVersion === 0) return NextResponse.json({ error: "Salve o rascunho antes de publicar." }, { status: 409 });
    const valid = validateLandingContent(state.draft);
    if (!valid.ok) return NextResponse.json({ error: "O rascunho tem campos inválidos; nada foi publicado.", errors: valid.errors }, { status: 422 });
    const { data, error } = await auth.session.supabase.rpc("admin_landing_publish", { p_expected_version: expected });
    if (error) throw httpErrorFromDb(error, "Não foi possível publicar. A versão pública anterior continua no ar.");
    revalidatePath("/revendedores");
    return NextResponse.json({ publishedAt: String(data) });
  } catch (error) {
    return errorResponse(error);
  }
}
