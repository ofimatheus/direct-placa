import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminApi } from "@/lib/auth/session";
import { BULK_MAX } from "@/lib/db/operations";
import { HttpError, errorResponse, httpErrorFromDb } from "@/lib/http";
import { removeDeletedPlateOutputs, verifyAdminPassword, type DeletedPlate } from "@/lib/plates/bulk";
import { createAdminClient } from "@/lib/supabase/admin";

const bodySchema = z.object({
  action: z.enum(["quarantine", "restore", "delete"]),
  ids: z.array(z.uuid()).min(1).max(BULK_MAX),
  reason: z.string().max(300).optional(),
  password: z.string().max(200).optional(),
});

/**
 * Ações em massa sobre placas (só ADMIN), em UMA chamada para até 5000 placas.
 * O banco trava e reconfere cada placa (existência, estado, vínculos,
 * histórico) na mesma transação — a lista enviada é só um pedido.
 * Excluir exige a senha do ADMIN (conferida no Supabase Auth; nunca guardada nem registrada).
 */
export async function POST(request: Request) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;
  try {
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "Pedido inválido.");
    const { action, ids, reason, password } = parsed.data;
    const sb = auth.session.supabase;

    if (action === "quarantine") {
      const { data, error } = await sb.rpc("admin_plates_quarantine", { p_plate_ids: ids, p_reason: reason ?? null });
      if (error) throw httpErrorFromDb(error, "Não foi possível colocar as placas em quarentena.");
      const r = (Array.isArray(data) ? data[0] : data) as { quarantined: number; already: number; skipped: number; skipped_codes: string[]; missing: number };
      return NextResponse.json({ action, ...r });
    }
    if (action === "restore") {
      const { data, error } = await sb.rpc("admin_plates_restore", { p_plate_ids: ids });
      if (error) throw httpErrorFromDb(error, "Não foi possível restaurar as placas.");
      const r = (Array.isArray(data) ? data[0] : data) as { restored: number; not_quarantined: number; still_batch_quarantine: number; missing: number };
      return NextResponse.json({ action, ...r });
    }

    // Exclusão definitiva: senha do ADMIN logado, com limite de tentativas.
    if (!password) throw new HttpError(400, "Digite sua senha de ADMIN para confirmar.");
    const userId = auth.session.user.id;
    const { data: limit } = await sb.rpc("consume_rate_limit", { p_bucket: `plates-delete-password:${userId}`, p_max: 5, p_window_seconds: 900 });
    const limitRow = (Array.isArray(limit) ? limit[0] : limit) as { allowed?: boolean; retry_after_seconds?: number } | null;
    if (limitRow && limitRow.allowed === false) {
      throw new HttpError(429, `Muitas tentativas de confirmação. Tente de novo em ${Math.ceil(Number(limitRow.retry_after_seconds ?? 900) / 60)} min. Nenhuma placa foi excluída.`);
    }
    if (!(await verifyAdminPassword(auth.session.user.email, userId, password))) {
      throw new HttpError(401, "Senha inválida. Nenhuma placa foi excluída.");
    }
    const { data, error } = await sb.rpc("admin_plates_delete_unused", { p_plate_ids: ids });
    if (error) throw httpErrorFromDb(error, "Não foi possível excluir as placas. Nenhuma placa foi excluída.");
    const r = (Array.isArray(data) ? data[0] : data) as {
      deleted: number;
      deleted_plates: DeletedPlate[];
      kept: number;
      kept_by_reason: Record<string, number>;
      kept_codes: string[];
      missing: number;
    };
    // Arquivos exclusivos das placas excluídas (cache da arte individual). Falhar aqui não desfaz a exclusão.
    let storage: { removed: number; failed: boolean } = { removed: 0, failed: false };
    if (r.deleted > 0) {
      try {
        storage = { removed: (await removeDeletedPlateOutputs(createAdminClient(), r.deleted_plates)).removed, failed: false };
      } catch (e) {
        console.error("plates_delete_storage_cleanup_failed", { message: e instanceof Error ? e.message : "erro" });
        storage = { removed: 0, failed: true };
      }
    }
    return NextResponse.json({ action, deleted: r.deleted, kept: r.kept, kept_by_reason: r.kept_by_reason, kept_codes: r.kept_codes, missing: r.missing, storage });
  } catch (error) {
    return errorResponse(error);
  }
}
