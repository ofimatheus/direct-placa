import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminApi } from "@/lib/auth/session";
import type { PlateRow, PlateStatus } from "@/lib/db/types";
import { HttpError, errorResponse, httpErrorFromDb, readJson } from "@/lib/http";

const bodySchema = z.object({ action: z.enum(["activate", "deactivate", "block", "unblock"]) });

/** Ativar, desativar, bloquear e desbloquear (bloqueio é exclusivo do ADMIN). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;
  try {
    const { id } = await params;
    z.string().uuid().parse(id);
    const { action } = bodySchema.parse(await readJson(request));
    const sb = auth.session.supabase;

    const { data: plate, error: readError } = await sb
      .from("plates")
      .select("id, status, reseller_id, destination_url")
      .eq("id", id)
      .maybeSingle<Pick<PlateRow, "id" | "status" | "reseller_id" | "destination_url">>();
    if (readError) throw httpErrorFromDb(readError);
    if (!plate) throw new HttpError(404, "Placa não encontrada.");

    let next: PlateStatus;
    if (action === "block") {
      next = "blocked";
    } else if (action === "unblock") {
      if (plate.status !== "blocked") throw new HttpError(409, "A placa não está bloqueada.");
      next = plate.destination_url ? "active" : plate.reseller_id ? "assigned" : "in_stock";
    } else {
      if (plate.status === "blocked") throw new HttpError(409, "Desbloqueie a placa antes.");
      if (action === "activate" && !plate.destination_url) throw new HttpError(422, "Defina o destino antes de ativar a placa.");
      next = action === "activate" ? "active" : "inactive";
    }

    const { data, error } = await sb
      .from("plates")
      .update({ status: next })
      .eq("id", id)
      .eq("status", plate.status)
      .select("id, status")
      .maybeSingle();
    if (error) throw httpErrorFromDb(error);
    if (!data) throw new HttpError(409, "A placa foi alterada por outra pessoa. Recarregue a página.");
    return NextResponse.json({ plate: data });
  } catch (error) {
    return errorResponse(error);
  }
}
