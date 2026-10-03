import { NextResponse } from "next/server";
import { z } from "zod";
import { requireResellerApi } from "@/lib/auth/session";
import { errorResponse, httpErrorFromDb, readJson } from "@/lib/http";

const bodySchema = z.object({ status: z.enum(["pending", "paid", "cancelled"]) });

/**
 * Muda o status da venda final (set_reseller_sale_status).
 *
 * Cancelar encerra apenas o registro financeiro: a placa não é tocada — não
 * volta ao estoque do ADMIN, não muda de revendedor, não perde destino nem
 * deixa de funcionar. Se ainda estiver só RESERVADA, volta a ser elegível
 * para outra venda do mesmo revendedor.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireResellerApi();
  if (!auth.ok) return auth.response;
  try {
    const { id } = await params;
    z.string().uuid().parse(id);
    const { status } = bodySchema.parse(await readJson(request));
    const { data, error } = await auth.session.supabase.rpc("set_reseller_sale_status", {
      p_sale_id: id,
      p_status: status,
    });
    if (error) throw httpErrorFromDb(error, "Não foi possível alterar a venda.");
    return NextResponse.json({ sale: (data as unknown[])[0] ?? null });
  } catch (error) {
    return errorResponse(error);
  }
}
