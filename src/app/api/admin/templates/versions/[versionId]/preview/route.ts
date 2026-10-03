import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminApi } from "@/lib/auth/session";
import { errorResponse } from "@/lib/http";
import { PREVIEW_PUBLIC_CODE, buildQrUrl } from "@/lib/plates/urls";
import { createAdminClient } from "@/lib/supabase/admin";
import { layoutFromVersion } from "@/lib/templates/layout";
import { cachedRenderUrl, getVersion } from "@/lib/templates/service";

export const maxDuration = 60;

/** Prévia fiel (TESTE01) de uma versão salva — inclusive versões antigas bloqueadas. */
export async function GET(_request: Request, { params }: { params: Promise<{ versionId: string }> }) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  try {
    const { versionId } = await params;
    z.string().uuid().parse(versionId);
    const version = await getVersion(auth.session.supabase, versionId);
    const url = await cachedRenderUrl(
      createAdminClient(),
      "versions",
      layoutFromVersion(version),
      version,
      PREVIEW_PUBLIC_CODE,
      buildQrUrl(PREVIEW_PUBLIC_CODE),
    );
    return NextResponse.redirect(url, { status: 302, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
