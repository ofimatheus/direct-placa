import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminApi } from "@/lib/auth/session";
import type { PlateRow } from "@/lib/db/types";
import { HttpError, errorResponse, httpErrorFromDb, readJson } from "@/lib/http";
import { destinationSchema } from "@/lib/plates/destinations";

/**
 * ADMIN edita cliente e destino. Mesma regra do revendedor: a primeira
 * configuração válida de uma placa "assigned" a ativa; remover o destino de
 * uma placa ativa a tira do ar. Cliente de outro revendedor é recusado pelo
 * banco (trigger guard_plate_customer).
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;
  try {
    const { id } = await params;
    z.string().uuid().parse(id);
    const body = destinationSchema.parse(await readJson(request));
    const sb = auth.session.supabase;

    const { data: plate, error: readError } = await sb
      .from("plates")
      .select("id, status, reseller_id")
      .eq("id", id)
      .maybeSingle<Pick<PlateRow, "id" | "status" | "reseller_id">>();
    if (readError) throw httpErrorFromDb(readError);
    if (!plate) throw new HttpError(404, "Placa não encontrada.");
    if (body.customer_id && !plate.reseller_id) throw new HttpError(422, "Atribua um revendedor antes de vincular um cliente.");

    let status = plate.status;
    if (!body.destination_url && status === "active") status = plate.reseller_id ? "assigned" : "in_stock";
    if (body.destination_url && status === "assigned") status = "active";

    const { data, error } = await sb
      .from("plates")
      .update({
        customer_id: body.customer_id,
        destination_type: body.destination_url ? body.destination_type : null,
        destination_url: body.destination_url,
        status,
      })
      .eq("id", id)
      .eq("status", plate.status)
      .select("id, status, customer_id, destination_type, destination_url")
      .maybeSingle();
    if (error) throw httpErrorFromDb(error);
    if (!data) throw new HttpError(409, "A placa foi alterada por outra pessoa. Recarregue a página.");
    return NextResponse.json({ plate: data });
  } catch (error) {
    return errorResponse(error);
  }
}
