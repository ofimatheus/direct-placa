import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { EditorInitial } from "@/components/directlink/DirectLinkEditor";
import { httpErrorFromDb } from "@/lib/http";
import type { DirectLinkItemType } from "./items";

export interface DirectLinkRow {
  id: string;
  public_code: string;
  title: string;
  is_active: boolean;
  updated_at: string;
  reseller_id: string | null;
  items: number;
  owner: string | null;
}

/** Lista pela sessão do usuário (RLS: revendedor só os dele; ADMIN todos). */
import type { DirectLinkPageStatus } from "./limits";
export { DIRECTLINK_LIMIT_MESSAGE, type DirectLinkPageStatus } from "./limits";

/** Status de páginas (RPC directlink_page_status, migration 024). null se indisponível. */
export async function directLinkPageStatus(sb: SupabaseClient): Promise<DirectLinkPageStatus | null> {
  const { data, error } = await sb.rpc("directlink_page_status");
  if (error) return null;
  const row = (Array.isArray(data) ? data[0] : data) as { used?: number; page_limit?: number | null } | undefined;
  if (!row) return null;
  return { used: Number(row.used ?? 0), limit: row.page_limit == null ? null : Number(row.page_limit) };
}

/**
 * Códigos que significam "a estrutura do DirectLink não existe neste banco"
 * (migration 20261004120000_directlink.sql não aplicada ou cache do PostgREST
 * desatualizado): tabela/função ausente.
 */
const MISSING_SCHEMA_CODES = new Set(["PGRST205", "PGRST202", "42P01", "42883"]);

/** Falha ao carregar DirectLinks. `missingSchema` = a migration não foi aplicada. */
export class DirectLinkLoadError extends Error {
  constructor(
    readonly missingSchema: boolean,
    readonly code: string | undefined,
  ) {
    super(missingSchema ? "Estrutura do DirectLink ausente no banco" : "Falha ao carregar DirectLinks");
  }
}

export async function listDirectLinks(sb: SupabaseClient, role: "admin" | "reseller"): Promise<DirectLinkRow[]> {
  const { data, error } = await sb.from("direct_links").select("id, public_code, title, is_active, updated_at, reseller_id").order("updated_at", { ascending: false }).limit(200);
  if (error) {
    // Detalhe técnico só no log do servidor; a tela mostra uma mensagem amigável.
    console.error("[directlink] falha ao listar DirectLinks", { code: error.code, message: error.message });
    throw new DirectLinkLoadError(MISSING_SCHEMA_CODES.has(error.code ?? ""), error.code);
  }
  const links = (data ?? []) as Omit<DirectLinkRow, "items" | "owner">[];
  if (links.length === 0) return [];
  const ids = links.map((l) => l.id);
  const { data: items } = await sb.from("direct_link_items").select("direct_link_id").in("direct_link_id", ids);
  const counts = new Map<string, number>();
  for (const i of (items ?? []) as { direct_link_id: string }[]) counts.set(i.direct_link_id, (counts.get(i.direct_link_id) ?? 0) + 1);
  let owners = new Map<string, string>();
  if (role === "admin") {
    const resellerIds = [...new Set(links.map((l) => l.reseller_id).filter((v): v is string => !!v))];
    if (resellerIds.length) {
      const { data: r } = await sb.from("reseller_profiles").select("id, company_name").in("id", resellerIds);
      owners = new Map(((r ?? []) as { id: string; company_name: string }[]).map((x) => [x.id, x.company_name]));
    }
  }
  return links.map((l) => ({ ...l, items: counts.get(l.id) ?? 0, owner: role === "admin" ? (l.reseller_id ? (owners.get(l.reseller_id) ?? "Revendedor") : "Plataforma") : null }));
}

/** Um DirectLink com botões, se o usuário puder vê-lo (RLS). */
export async function getDirectLink(sb: SupabaseClient, id: string): Promise<EditorInitial | null> {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const { data, error } = await sb.from("direct_links").select("id, public_code, title, description, banner_path, logo_path, is_active").eq("id", id).maybeSingle();
  if (error) throw httpErrorFromDb(error);
  if (!data) return null;
  const { data: items, error: itemsError } = await sb
    .from("direct_link_items")
    .select("id, type, title, value, receiver_name, is_active")
    .eq("direct_link_id", id)
    .order("sort_order");
  if (itemsError) throw httpErrorFromDb(itemsError);
  return {
    ...(data as Omit<EditorInitial, "items">),
    items: ((items ?? []) as { id: string; type: DirectLinkItemType; title: string; value: string; receiver_name: string | null; is_active: boolean }[]).map((i) => ({
      ...i,
      receiver_name: i.receiver_name ?? "",
    })),
  };
}
