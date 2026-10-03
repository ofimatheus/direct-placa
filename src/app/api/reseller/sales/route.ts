import { NextResponse } from "next/server";
import { requireResellerApi } from "@/lib/auth/session";
import { errorResponse, httpErrorFromDb, readJson } from "@/lib/http";
import { pricedSaleRequestSchema } from "@/lib/reseller-sales";

/**
 * Registra a venda final do revendedor a partir de VALOR UNITÁRIO e DESCONTO
 * (centavos). O total NÃO é aceito do cliente: a RPC
 * create_reseller_sale_priced (migration 022) deriva quantidade, subtotal e
 * total das placas realmente vendidas e grava o detalhamento.
 *
 * Cliente user-scoped, nunca service_role: o financeiro do revendedor é
 * privado e a RPC se amarra a current_reseller_id(), derivado de auth.uid().
 * Registrar a venda NÃO ativa a placa — isso continua sendo um passo à parte.
 */
export async function POST(request: Request) {
  const auth = await requireResellerApi();
  if (!auth.ok) return auth.response;
  try {
    const body = pricedSaleRequestSchema.parse(await readJson(request));
    const { data, error } = await auth.session.supabase.rpc("create_reseller_sale_priced", {
      p_plate_ids: body.plate_ids,
      p_unit_price_cents: body.unit_price_cents,
      p_discount_cents: body.discount_cents,
      p_customer_id: body.customer_id ?? null,
      p_status: body.status,
      p_sold_at: body.sold_at ?? null,
      p_notes: body.notes ?? null,
      p_idempotency_key: body.idempotency_key,
    });
    if (error) throw httpErrorFromDb(error, "Não foi possível registrar a venda.");
    return NextResponse.json({ sale_id: data as string }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
