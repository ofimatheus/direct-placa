import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminApi } from "@/lib/auth/session";
import { errorResponse, httpErrorFromDb, readJson } from "@/lib/http";

const createBatchSchema = z.object({
  name: z.string().trim().min(1, "Informe o nome do lote").max(120),
  description: z.string().trim().max(1000).nullable().optional(),
  quantity: z.number().int("Use um número inteiro").min(1, "Mínimo: 1 placa").max(1000, "Máximo: 1000 placas"),
  template_id: z.string().uuid("Escolha um template"),
  idempotency_key: z.string().uuid(),
});

/**
 * Cria o lote + placas numa única transação (create_plate_batch).
 * A idempotency_key é gerada pelo formulário: clique duplo ou reenvio após
 * falha de rede devolvem o MESMO lote em vez de criar outro.
 */
export async function POST(request: Request) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  try {
    const body = createBatchSchema.parse(await readJson(request));
    const { data, error } = await auth.session.supabase.rpc("create_plate_batch", {
      p_name: body.name,
      p_description: body.description ?? null,
      p_quantity: body.quantity,
      p_template_id: body.template_id,
      p_idempotency_key: body.idempotency_key,
    });
    if (error) throw httpErrorFromDb(error, "Não foi possível criar o lote.");
    return NextResponse.json({ batchId: data as string }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
