import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminApi } from "@/lib/auth/session";
import { errorResponse, httpErrorFromDb, readJson } from "@/lib/http";

const bodySchema = z.object({ reseller_id: z.string().uuid().nullable() });

/**
 * Atribuir, trocar ou remover o revendedor de uma placa (set_plate_reseller).
 * Troca/remoção zera cliente e destino; o histórico vai para plate_assignments.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;
  try {
    const { id } = await params;
    z.string().uuid().parse(id);
    const { reseller_id } = bodySchema.parse(await readJson(request));
    const { data, error } = await auth.session.supabase.rpc("set_plate_reseller", { p_plate_id: id, p_reseller_id: reseller_id });
    if (error) throw httpErrorFromDb(error);
    return NextResponse.json({ plate: (data as unknown[])[0] ?? null });
  } catch (error) {
    return errorResponse(error);
  }
}
