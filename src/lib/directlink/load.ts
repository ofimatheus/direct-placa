import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { DirectLinkItemType, PublicItem } from "./items";

export interface PublicDirectLink {
  code: string;
  title: string;
  description: string | null;
  banner_path: string | null;
  logo_path: string | null;
  items: PublicItem[];
}

/**
 * Página pública (sem login): lê SÓ a RPC public_direct_link(código) com a
 * chave anônima. Inexistente, inativa ou falha → null (a página responde 404).
 */
export async function loadPublicDirectLink(code: string): Promise<PublicDirectLink | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey || !/^[23456789A-Za-z]{7}$/.test(code)) return null;
  try {
    const client = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: (input, init) => fetch(input, { ...init, cache: "no-store", signal: AbortSignal.timeout(4000) }) },
    });
    const { data, error } = await client.rpc("public_direct_link", { p_code: code });
    if (error || !data) return null;
    const page = data as PublicDirectLink;
    return { ...page, items: (page.items ?? []).map((i) => ({ ...i, type: i.type as DirectLinkItemType })) };
  } catch {
    return null;
  }
}
