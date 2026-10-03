import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminApi } from "@/lib/auth/session";
import { errorResponse, httpErrorFromDb, readJson } from "@/lib/http";

const bodySchema = z.object({ keep_plates_in_use: z.boolean().default(false) });

/**
 * Cancela a venda (cancel_order), numa única transação:
 *   · placas só RESERVADAS voltam ao estoque (DISPONÍVEL), sem revendedor;
 *   · se houver placa ativa ou em uso, o cancelamento é recusado (409, details
 *     "plates_in_use") — a não ser que o ADMIN escolha explicitamente
 *     keep_plates_in_use, que mantém essas placas com o mesmo revendedor.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;
  try {
    const { id } = await params;
    z.string().uuid().parse(id);
    const { keep_plates_in_use } = bodySchema.parse(await readJson(request));
    const { data, error } = await auth.session.supabase.rpc("cancel_order", {
      p_order_id: id,
      p_keep_plates_in_use: keep_plates_in_use,
    });
    if (error) throw httpErrorFromDb(error, "Não foi possível cancelar a venda.");
    return NextResponse.json({ sale: (data as unknown[])[0] ?? null });
  } catch (error) {
    return errorResponse(error);
  }
}
