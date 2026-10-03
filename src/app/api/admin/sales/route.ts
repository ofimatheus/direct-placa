import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminApi } from "@/lib/auth/session";
import { errorResponse, httpErrorFromDb, readJson } from "@/lib/http";
import { SALE_MAX_PLATES } from "@/lib/sales";

const money = z.number().finite().min(0).max(10_000_000);

const createSaleSchema = z
  .object({
    reseller_id: z.string().uuid("Escolha o revendedor"),
    quantity: z.number().int("Use um número inteiro").min(1).max(SALE_MAX_PLATES),
    unit_price: money,
    discount: money.default(0),
    notes: z.string().trim().max(1000).nullable().optional(),
    status: z.enum(["pending", "paid"]).default("pending"),
    selection: z.enum(["automatic", "manual"]),
    plate_ids: z.array(z.string().uuid()).max(SALE_MAX_PLATES).nullable().optional(),
    batch_id: z.string().uuid().nullable().optional(),
    idempotency_key: z.string().uuid(),
  })
  .superRefine((body, ctx) => {
    if (body.selection !== "manual") return;
    const selected = new Set(body.plate_ids ?? []).size;
    if (selected !== body.quantity) {
      ctx.addIssue({
        code: "custom",
        path: ["plate_ids"],
        message: `Selecione exatamente ${body.quantity} placa(s). Selecionadas: ${selected}.`,
      });
    }
  });

/**
 * Registra a venda E reserva as placas numa única transação no banco
 * (create_sale_with_plates): cria a venda, vincula as placas à venda e ao
 * revendedor, muda o status para RESERVADA e grava o histórico. Se qualquer
 * etapa falhar, nada fica gravado. Sem gateway, checkout ou cobrança.
 *
 * A idempotency_key nasce com o formulário: clique duplo ou retry devolvem a
 * mesma venda, sem reservar placas de novo.
 */
export async function POST(request: Request) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;
  try {
    const body = createSaleSchema.parse(await readJson(request));
    const { data, error } = await auth.session.supabase.rpc("create_sale_with_plates", {
      p_reseller_id: body.reseller_id,
      p_quantity: body.quantity,
      p_unit_price: body.unit_price,
      p_discount: body.discount,
      p_notes: body.notes ?? null,
      p_status: body.status,
      p_selection: body.selection,
      p_plate_ids: body.selection === "manual" ? [...new Set(body.plate_ids ?? [])] : null,
      p_batch_id: body.selection === "automatic" ? (body.batch_id ?? null) : null,
      p_idempotency_key: body.idempotency_key,
    });
    if (error) throw httpErrorFromDb(error, "Não foi possível registrar a venda.");
    return NextResponse.json({ saleId: data as string }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
