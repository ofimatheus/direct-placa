import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth/session";
import { errorResponse, readJson } from "@/lib/http";
import { TEMPLATES_BUCKET } from "@/lib/storage";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertUploadRequestAllowed } from "@/lib/templates/image-validation";
import { uploadRequestSchema } from "@/lib/templates/schema";

/**
 * Passo 1 do upload: devolve uma URL assinada para o navegador enviar a arte
 * DIRETO ao Storage (em staging/), sem passar pelo limite de corpo da função
 * serverless. A validação real dos bytes acontece depois, no servidor, antes
 * de a arte virar uma versão.
 */
export async function POST(request: Request) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  try {
    const body = uploadRequestSchema.parse(await readJson(request));
    const ext = assertUploadRequestAllowed(body);
    const path = `staging/${crypto.randomUUID()}.${ext}`;

    const { data, error } = await createAdminClient()
      .storage
      .from(TEMPLATES_BUCKET)
      .createSignedUploadUrl(path);

    console.error("ERRO STORAGE UPLOAD:", error);

    if (error || !data) {
      throw new Error(
        `Não foi possível preparar o upload: ${error?.message ?? "erro desconhecido"}`
      );
    }

    return NextResponse.json({
      bucket: TEMPLATES_BUCKET,
      path: data.path,
      token: data.token,
    });
  } catch (error) {
    console.error("ERRO COMPLETO UPLOAD TEMPLATE:", error);
    return errorResponse(error);
  }
}