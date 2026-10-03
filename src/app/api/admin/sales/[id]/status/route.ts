import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminApi } from "@/lib/auth/session";
import { errorResponse, httpErrorFromDb, readJson } from "@/lib/http";

const bodySchema = z.object({ status: z.enum(["pending", "paid", "cancelled"]) });

/** Muda o status da venda. As transições permitidas são validadas no banco (set_order_status). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;
  try {
    const { id } = await params;
    z.string().uuid().parse(id);
    const { status } = bodySchema.parse(await readJson(request));
    const { data, error } = await auth.session.supabase.rpc("set_order_status", { p_order_id: id, p_status: status });
    if (error) throw httpErrorFromDb(error);
    return NextResponse.json({ sale: (data as unknown[])[0] ?? null });
  } catch (error) {
    return errorResponse(error);
  }
}
