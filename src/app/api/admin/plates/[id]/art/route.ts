import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireAdminApi } from "@/lib/auth/session";
import type { PlateRow } from "@/lib/db/types";
import { HttpError, errorResponse, httpErrorFromDb } from "@/lib/http";
import { buildQrUrl } from "@/lib/plates/urls";
import { createAdminClient } from "@/lib/supabase/admin";
import { layoutFromVersion } from "@/lib/templates/layout";
import { cachedRenderUrl, getVersion } from "@/lib/templates/service";

export const maxDuration = 60;

/** Arte final de UMA placa (conferência rápida / reimpressão avulsa). ?download=1 baixa o PNG. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  try {
    const { id } = await params;
    z.string().uuid().parse(id);
    const sb = auth.session.supabase;

    const { data: plate, error } = await sb
      .from("plates")
      .select("id, public_code, batch_id")
      .eq("id", id)
      .maybeSingle<Pick<PlateRow, "id" | "public_code" | "batch_id">>();
    if (error) throw httpErrorFromDb(error);
    if (!plate?.batch_id) throw new HttpError(404, "Placa não encontrada.");

    const { data: batch, error: batchError } = await sb
      .from("plate_batches")
      .select("template_version_id")
      .eq("id", plate.batch_id)
      .single<{ template_version_id: string | null }>();
    if (batchError) throw httpErrorFromDb(batchError);
    if (!batch.template_version_id) throw new HttpError(409, "O lote desta placa não tem template.");

    const version = await getVersion(sb, batch.template_version_id);
    const download = request.nextUrl.searchParams.get("download") === "1";
    const url = await cachedRenderUrl(
      createAdminClient(),
      "plates",
      layoutFromVersion(version),
      version,
      plate.public_code,
      buildQrUrl(plate.public_code),
      download ? `${plate.public_code}.png` : undefined,
    );
    return NextResponse.redirect(url, { status: 302, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
