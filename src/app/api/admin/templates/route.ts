import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth/session";
import { HttpError, errorResponse, httpErrorFromDb, readJson } from "@/lib/http";
import { TEMPLATES_BUCKET, removeObjects } from "@/lib/storage";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkLayout } from "@/lib/templates/geometry";
import { layoutFromInput, versionPayload } from "@/lib/templates/layout";
import { createTemplateSchema } from "@/lib/templates/schema";
import { persistTemplateImage, resolveImage } from "@/lib/templates/service";

export const maxDuration = 60;

/** Cria o template e sua versão 1 (atômico no banco via create_plate_template). */
export async function POST(request: Request) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  try {
    const body = createTemplateSchema.parse(await readJson(request));
    const admin = createAdminClient();
    const image = await resolveImage(admin, body.image);
    const layout = layoutFromInput(body.layout, image.meta);

    const { errors } = checkLayout(layout);
    if (errors.length) throw new HttpError(422, "O posicionamento tem erros.", errors);

    const templateId = crypto.randomUUID();
    const imagePath = await persistTemplateImage(admin, templateId, image);

    // RPC com o cliente do usuário: auth.uid() e is_admin() valem dentro do banco.
    const { data, error } = await auth.session.supabase.rpc("create_plate_template", {
      p_template_id: templateId,
      p_name: body.name,
      p_internal_key: body.internal_key,
      p_description: body.description,
      p_layout: versionPayload(layout, image.meta, imagePath),
    });
    if (error) {
      if (error.code === "23505") throw new HttpError(409, "Já existe um template com essa chave interna.");
      throw httpErrorFromDb(error);
    }
    if (image.stagingPath) await removeObjects(admin, TEMPLATES_BUCKET, [image.stagingPath]);

    const row = (data as { result_template_id: string; result_version_id: string }[])[0]!;
    return NextResponse.json({ templateId: row.result_template_id, versionId: row.result_version_id }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
