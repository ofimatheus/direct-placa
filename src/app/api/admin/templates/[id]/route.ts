import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminApi } from "@/lib/auth/session";
import { HttpError, errorResponse, httpErrorFromDb, readJson } from "@/lib/http";
import { updateTemplateMetaSchema } from "@/lib/templates/schema";

/**
 * Atualiza dados de identificação (nome, descrição, chave, ativo).
 * Esses campos não afetam a arte, por isso não geram nova versão.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  try {
    const { id } = await params;
    z.string().uuid().parse(id);
    const patch = updateTemplateMetaSchema.parse(await readJson(request));
    if (Object.keys(patch).length === 0) throw new HttpError(400, "Nada para atualizar.");

    const { data, error } = await auth.session.supabase
      .from("plate_templates")
      .update({
        ...patch,
        ...(patch.description !== undefined ? { description: patch.description || null } : {}),
      })
      .eq("id", id)
      .select("id, name, internal_key, description, active")
      .maybeSingle();
    if (error) {
      if (error.code === "23505") throw new HttpError(409, "Já existe um template com essa chave interna.");
      throw httpErrorFromDb(error);
    }
    if (!data) throw new HttpError(404, "Template não encontrado.");
    return NextResponse.json({ template: data });
  } catch (error) {
    return errorResponse(error);
  }
}
