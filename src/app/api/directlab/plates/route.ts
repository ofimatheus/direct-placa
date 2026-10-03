import { NextResponse } from "next/server";
import { requireDirectLabApi } from "@/lib/auth/session";
import { getCustomerDisplayName } from "@/lib/customers";
import type { DirectLabPlateOption } from "@/lib/directlab/types";
import { errorResponse, httpErrorFromDb } from "@/lib/http";


const LIMIT = 30;

/**
 * Placas que o usuário pode configurar, para "Usar em uma placa". Só LEITURA:
 * a alteração continua pelas rotas existentes (revendedor: RPC
 * configure_reseller_plate; ADMIN: PATCH /api/admin/plates/[id]).
 *   · revendedor: só as dele (RLS + filtro explícito), sem as bloqueadas
 *     (a RPC recusaria);
 *   · ADMIN: qualquer placa, como na tela da placa.
 */
export async function GET(request: Request) {
  const auth = await requireDirectLabApi();
  if (!auth.ok) return auth.response;
  try {
    const sb = auth.session.supabase;
    const term = (new URL(request.url).searchParams.get("q") ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);

    let query = sb
      .from("plates")
      .select("id, public_code, status, customer_id, reseller_id, destination_type, destination_url")
      .order("updated_at", { ascending: false })
      .limit(LIMIT);
    if (term) query = query.ilike("public_code", `%${term}%`);
    if (auth.role === "reseller") query = query.eq("reseller_id", auth.resellerId).neq("status", "blocked");

    const { data, error } = await query;
    if (error) throw httpErrorFromDb(error);
    const plates = (data ?? []) as (Omit<DirectLabPlateOption, "customer_name" | "reseller_name"> & { reseller_id: string | null })[];

    const customerIds = [...new Set(plates.map((p) => p.customer_id).filter((v): v is string => !!v))];
    const resellerIds = [...new Set(plates.map((p) => p.reseller_id).filter((v): v is string => !!v))];
    const [customers, resellers] = await Promise.all([
      customerIds.length ? sb.from("customers").select("id, name, company_name").in("id", customerIds) : Promise.resolve({ data: [], error: null }),
      auth.role === "admin" && resellerIds.length
        ? sb.from("reseller_profiles").select("id, company_name").in("id", resellerIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    const customerName = new Map(
      ((customers.data ?? []) as { id: string; name: string; company_name: string | null }[]).map((c) => [c.id, getCustomerDisplayName(c)]),
    );
    const resellerName = new Map(((resellers.data ?? []) as { id: string; company_name: string }[]).map((r) => [r.id, r.company_name]));

    const options: DirectLabPlateOption[] = plates.map((p) => ({
      id: p.id,
      public_code: p.public_code,
      status: p.status,
      customer_id: p.customer_id,
      customer_name: p.customer_id ? (customerName.get(p.customer_id) ?? null) : null,
      reseller_name: p.reseller_id ? (resellerName.get(p.reseller_id) ?? null) : null,
      destination_type: p.destination_type,
      destination_url: p.destination_url,
    }));
    return NextResponse.json({ role: auth.role, plates: options }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
