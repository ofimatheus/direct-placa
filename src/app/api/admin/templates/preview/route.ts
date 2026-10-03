import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth/session";
import { HttpError, errorResponse, readJson } from "@/lib/http";
import { PREVIEW_PUBLIC_CODE, buildQrUrl } from "@/lib/plates/urls";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkLayout } from "@/lib/templates/geometry";
import { layoutFromInput } from "@/lib/templates/layout";
import { previewRequestSchema } from "@/lib/templates/schema";
import { renderPreview, resolveImage } from "@/lib/templates/service";

export const maxDuration = 60;

/**
 * PREVIEW FIEL: mesmo renderer da produção, com o código TESTE01.
 * Não cria placa, lote nem versão. Devolve a URL assinada do PNG gerado.
 */
export async function POST(request: Request) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  try {
    const body = previewRequestSchema.parse(await readJson(request));
    const admin = createAdminClient();
    const image = await resolveImage(admin, body.image);
    const layout = layoutFromInput(body.layout, image.meta);

    const precheck = checkLayout(layout);
    if (precheck.errors.length) throw new HttpError(422, "Corrija o posicionamento antes da prévia.", precheck.errors);

    const qrUrl = buildQrUrl(PREVIEW_PUBLIC_CODE);
    const preview = await renderPreview(admin, layout, { bytes: image.bytes, sha256: image.meta.sha256 }, PREVIEW_PUBLIC_CODE, qrUrl);
    const { warnings } = checkLayout(layout, preview.geometry);

    return NextResponse.json({
      url: preview.url,
      width: layout.canvas_width,
      height: layout.canvas_height,
      qrUrl,
      geometry: preview.geometry,
      warnings,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
