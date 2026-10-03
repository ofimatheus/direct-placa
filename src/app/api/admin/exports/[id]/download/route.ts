import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireAdminApi } from "@/lib/auth/session";
import type { BatchExportRow } from "@/lib/db/types";
import { HttpError, errorResponse, httpErrorFromDb } from "@/lib/http";
import { OUTPUTS_BUCKET, signObject } from "@/lib/storage";
import { createAdminClient } from "@/lib/supabase/admin";

/** Download de um arquivo do export: valida ADMIN e redireciona para uma URL assinada de 2 minutos. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  try {
    const { id } = await params;
    z.string().uuid().parse(id);
    const index = z.coerce.number().int().min(0).parse(request.nextUrl.searchParams.get("file") ?? "0");

    const { data, error } = await auth.session.supabase
      .from("batch_exports")
      .select("id, status, files")
      .eq("id", id)
      .maybeSingle<Pick<BatchExportRow, "id" | "status" | "files">>();
    if (error) throw httpErrorFromDb(error);
    if (!data) throw new HttpError(404, "Exportação não encontrada.");
    if (data.status !== "done") throw new HttpError(409, "A exportação ainda não foi concluída.");

    const file = data.files[index];
    if (!file) throw new HttpError(404, "Arquivo não encontrado nesta exportação.");
    const url = await signObject(createAdminClient(), OUTPUTS_BUCKET, file.path, 120, file.name);
    return NextResponse.redirect(url, { status: 302, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
