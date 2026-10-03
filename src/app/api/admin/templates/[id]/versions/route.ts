import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminApi } from "@/lib/auth/session";
import { HttpError, errorResponse, httpErrorFromDb, readJson } from "@/lib/http";
import { TEMPLATES_BUCKET, removeObjects } from "@/lib/storage";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkLayout } from "@/lib/templates/geometry";
import { layoutFromInput, versionPayload } from "@/lib/templates/layout";
import { saveLayoutSchema } from "@/lib/templates/schema";
import { persistTemplateImage, resolveImage } from "@/lib/templates/service";

export const maxDuration = 60;

/**
 * Salva o layout/arte do template. A decisão de versionamento é do banco
 * (save_template_layout), dentro de uma transação com o template travado:
 *   · sem mudanças → nada acontece
 *   · versão atual ainda não usada → editada no lugar
 *   · versão atual bloqueada → nova versão N+1
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  try {
    const { id } = await params;
    z.string().uuid().parse(id);
    const body = saveLayoutSchema.parse(await readJson(request));
    const admin = createAdminClient();

    const image = await resolveImage(admin, body.image);
    const layout = layoutFromInput(body.layout, image.meta);
    const { errors } = checkLayout(layout);
    if (errors.length) throw new HttpError(422, "O posicionamento tem erros.", errors);

    const imagePath = await persistTemplateImage(admin, id, image);
    const { data, error } = await auth.session.supabase.rpc("save_template_layout", {
      p_template_id: id,
      p_layout: versionPayload(layout, image.meta, imagePath),
    });
    if (error) throw httpErrorFromDb(error);
    if (image.stagingPath) await removeObjects(admin, TEMPLATES_BUCKET, [image.stagingPath]);

    const row = (
      data as { result_version_id: string; result_version_number: number; created_new: boolean; unchanged: boolean }[]
    )[0]!;
    return NextResponse.json({
      versionId: row.result_version_id,
      versionNumber: row.result_version_number,
      createdNew: row.created_new,
      unchanged: row.unchanged,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
