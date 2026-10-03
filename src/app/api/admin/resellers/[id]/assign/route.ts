import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminApi } from "@/lib/auth/session";
import { errorResponse, httpErrorFromDb, readJson } from "@/lib/http";

const bodySchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("quantity"), quantity: z.number().int().min(1).max(1000), batch_id: z.string().uuid().nullable().optional() }),
  z.object({ mode: z.literal("manual"), plate_ids: z.array(z.string().uuid()).min(1).max(1000) }),
]);

/** Atribui placas de estoque ao revendedor numa única transação (assign_plates_to_reseller). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;
  try {
    const { id } = await params;
    z.string().uuid().parse(id);
    const body = bodySchema.parse(await readJson(request));
    const { data, error } = await auth.session.supabase.rpc(
      "assign_plates_to_reseller",
      body.mode === "quantity"
        ? { p_reseller_id: id, p_quantity: body.quantity, p_plate_ids: null, p_batch_id: body.batch_id ?? null }
        : { p_reseller_id: id, p_quantity: null, p_plate_ids: body.plate_ids, p_batch_id: null },
    );
    if (error) throw httpErrorFromDb(error, "Não foi possível atribuir as placas.");
    return NextResponse.json({ assigned: data as number });
  } catch (error) {
    return errorResponse(error);
  }
}
