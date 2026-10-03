import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth/session";
import { HttpError, errorResponse, httpErrorFromDb, readJson } from "@/lib/http";
import { validateLandingContent } from "@/lib/landing/schema";

/** Salva o RASCUNHO da landing (só ADMIN). Não muda a página pública. */
export async function PUT(request: Request) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;
  try {
    const body = (await readJson(request)) as { content?: unknown; expectedVersion?: unknown };
    const expected = Number.isInteger(body?.expectedVersion) ? Number(body.expectedVersion) : -1;
    const valid = validateLandingContent(body?.content);
    if (!valid.ok) return NextResponse.json({ error: "Há campos inválidos no conteúdo.", errors: valid.errors }, { status: 422 });
    const { data, error } = await auth.session.supabase.rpc("admin_landing_save_draft", { p_content: valid.content, p_expected_version: expected });
    if (error) throw httpErrorFromDb(error, "Não foi possível salvar o rascunho.");
    return NextResponse.json({ version: Number(data), savedAt: new Date().toISOString() });
  } catch (error) {
    if (error instanceof SyntaxError) return errorResponse(new HttpError(400, "Corpo inválido."));
    return errorResponse(error);
  }
}
