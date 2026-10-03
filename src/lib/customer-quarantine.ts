import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireResellerApi } from "@/lib/auth/session";
import { errorResponse, httpErrorFromDb } from "@/lib/http";

type Context = { params: Promise<{ id: string }> };

/**
 * Quarentena e restauração de cliente. Sempre com o cliente do usuário
 * (nunca service_role): as RPCs se amarram a current_reseller_id(), então um
 * revendedor só alcança os próprios clientes (de outro → 404).
 */
export async function quarantineCustomerResponse(context: Context, reason: string | null): Promise<Response> {
  const auth = await requireResellerApi();
  if (!auth.ok) return auth.response;
  try {
    const { id } = await context.params;
    z.string().uuid().parse(id);
    const { data, error } = await auth.session.supabase.rpc("quarantine_customer", { p_customer_id: id, p_reason: reason });
    if (error) throw httpErrorFromDb(error, "Não foi possível mover o cliente para a quarentena.");
    return NextResponse.json({ customer: (data as unknown[])[0] ?? null });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function restoreCustomerResponse(context: Context): Promise<Response> {
  const auth = await requireResellerApi();
  if (!auth.ok) return auth.response;
  try {
    const { id } = await context.params;
    z.string().uuid().parse(id);
    const { data, error } = await auth.session.supabase.rpc("restore_customer", { p_customer_id: id });
    if (error) throw httpErrorFromDb(error, "Não foi possível restaurar o cliente.");
    return NextResponse.json({ customer: (data as unknown[])[0] ?? null });
  } catch (error) {
    return errorResponse(error);
  }
}

export const quarantineBodySchema = z.object({ reason: z.string().trim().max(500).nullable().optional() });
