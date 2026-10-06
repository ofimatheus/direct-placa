import { NextResponse, type NextRequest } from "next/server";
import { requireAdminApi } from "@/lib/auth/session";
import { listPlateIds, type PlateFilters, type PlateView } from "@/lib/db/operations";
import type { PlateStatus } from "@/lib/db/types";
import { errorResponse } from "@/lib/http";
import { PLATE_STATUS_LABEL } from "@/lib/plates/labels";

/** "Selecionar todas do filtro": ids de todas as placas que a tela mostra com estes filtros (só ADMIN). */
export async function GET(request: NextRequest) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;
  try {
    const q = request.nextUrl.searchParams;
    const view = q.get("estado");
    const status = q.get("status");
    const configured = q.get("configured");
    const filters: PlateFilters = {
      code: q.get("code") || undefined,
      reseller: q.get("reseller") || undefined,
      status: status && status in PLATE_STATUS_LABEL ? (status as PlateStatus) : undefined,
      batch: q.get("batch") || undefined,
      configured: configured === "yes" || configured === "no" ? configured : undefined,
      view: (view === "quarantine" || view === "all" ? view : "operational") as PlateView,
    };
    return NextResponse.json(await listPlateIds(auth.session.supabase, filters), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
