import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminApi } from "@/lib/auth/session";
import { listAvailablePlates } from "@/lib/db/operations";
import { errorResponse } from "@/lib/http";

const querySchema = z.object({
  q: z.string().max(40).optional(),
  batch: z.string().uuid().optional().or(z.literal("")),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
});

/** Placas disponíveis para seleção manual numa venda (somente ADMIN). */
export async function GET(request: Request) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;
  try {
    const url = new URL(request.url);
    const query = querySchema.parse(Object.fromEntries(url.searchParams));
    const result = await listAvailablePlates(auth.session.supabase, {
      q: query.q,
      batchId: query.batch || null,
      limit: query.limit,
      offset: query.offset,
    });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
