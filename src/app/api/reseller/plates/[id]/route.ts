import { NextResponse } from "next/server";
import { z } from "zod";
import { requireResellerApi } from "@/lib/auth/session";
import type { PlateRow } from "@/lib/db/types";
import { errorResponse, httpErrorFromDb, readJson } from "@/lib/http";
import { destinationSchema } from "@/lib/plates/destinations";

const statusSchema = z.object({ status: z.enum(["active", "inactive"]).nullable().optional() });

/**
 * RESELLER configura a própria placa pela RPC configure_reseller_plate:
 * o banco valida dono, cliente, tipo, URL e transições. Não existe UPDATE
 * direto na tabela para o revendedor.
 *   · status omitido: a primeira configuração válida ativa a placa (assigned → active)
 *   · status "active" / "inactive": alterna depois de configurada
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireResellerApi();
  if (!auth.ok) return auth.response;
  try {
    const { id } = await params;
    z.string().uuid().parse(id);
    const raw = await readJson(request);
    const destination = destinationSchema.parse(raw);
    const { status } = statusSchema.parse(raw);

    const { data, error } = await auth.session.supabase.rpc("configure_reseller_plate", {
      p_plate_id: id,
      p_customer_id: destination.customer_id,
      p_destination_type: destination.destination_type,
      p_destination_url: destination.destination_url,
      p_status: status ?? null,
    });
    if (error) throw httpErrorFromDb(error);
    const plate = ((data ?? []) as PlateRow[])[0];
    return NextResponse.json({
      plate: plate && {
        id: plate.id,
        status: plate.status,
        customer_id: plate.customer_id,
        destination_type: plate.destination_type,
        destination_url: plate.destination_url,
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
