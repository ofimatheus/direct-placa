import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminApi } from "@/lib/auth/session";
import { errorResponse, httpErrorFromDb, readJson } from "@/lib/http";

const bodySchema = z.object({
  status: z.enum(["active", "quarantine", "archived"]),
  reason: z.string().trim().max(500).optional().nullable(),
});

/**
 * Muda o ciclo OPERACIONAL do lote (set_batch_lifecycle_status).
 *
 * A RPC é quem valida — e ela trava o lote e todas as placas antes de olhar,
 * então uma venda concorrente ou vence primeiro (e a quarentena é recusada)
 * ou perde (e não consegue reservar). Aqui não há regra de negócio nenhuma:
 * só o repasse e a tradução do erro.
 *
 *   409 (55000) quarentena com placa comprometida, ou arquivamento com estoque
 *   403 (42501) quem não é ADMIN
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;
  try {
    const { id } = await params;
    z.string().uuid().parse(id);
    const { status, reason } = bodySchema.parse(await readJson(request));
    const { data, error } = await auth.session.supabase.rpc("set_batch_lifecycle_status", {
      p_batch_id: id,
      p_status: status,
      p_reason: reason ?? null,
    });
    if (error) throw httpErrorFromDb(error, "Não foi possível alterar o estado do lote.");
    return NextResponse.json({ batch: (data as unknown[])[0] ?? null });
  } catch (error) {
    return errorResponse(error);
  }
}
