import { NextResponse } from "next/server";
import { z } from "zod";
import { requireResellerApi } from "@/lib/auth/session";
import { customerSchema } from "@/lib/customers";
import { HttpError, errorResponse, httpErrorFromDb, readJson } from "@/lib/http";
import { quarantineCustomerResponse } from "@/lib/customer-quarantine";

/** Atualiza cliente do próprio revendedor (a RLS filtra por reseller_id; de outro revendedor → 404). */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireResellerApi();
  if (!auth.ok) return auth.response;
  try {
    const { id } = await params;
    z.string().uuid().parse(id);
    const body = customerSchema.parse(await readJson(request));
    const { data, error } = await auth.session.supabase
      .from("customers")
      .update(body)
      .eq("id", id)
      .eq("reseller_id", auth.resellerId)
      .select("id, name, company_name, phone, email, notes, created_at")
      .maybeSingle();
    if (error) throw httpErrorFromDb(error);
    if (!data) throw new HttpError(404, "Cliente não encontrado.");
    return NextResponse.json({ customer: data });
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * "Excluir" cliente = mover para a Quarentena. Não existe exclusão física:
 * o banco recusa DELETE em customers. Mantido para compatibilidade com
 * chamadas antigas; a tela usa POST /quarantine.
 */
export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  return quarantineCustomerResponse(context, null);
}
