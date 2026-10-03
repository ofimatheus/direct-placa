import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminApi } from "@/lib/auth/session";
import { errorResponse } from "@/lib/http";
import { TEMPLATES_BUCKET, signObject } from "@/lib/storage";
import { createAdminClient } from "@/lib/supabase/admin";
import { getVersion } from "@/lib/templates/service";

/** Arte base de uma versão (bucket privado → URL assinada de curta duração). */
export async function GET(_request: Request, { params }: { params: Promise<{ versionId: string }> }) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  try {
    const { versionId } = await params;
    z.string().uuid().parse(versionId);
    const version = await getVersion(auth.session.supabase, versionId);
    const url = await signObject(createAdminClient(), TEMPLATES_BUCKET, version.base_image_path, 600);
    return NextResponse.redirect(url, { status: 302, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
