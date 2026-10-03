import "server-only";
import { createClient } from "@supabase/supabase-js";
import { DEFAULT_BRANDING, resolveBranding, type BrandingRow, type LoginBranding } from "./defaults";

const TIMEOUT_MS = 2500;

/**
 * Branding para a tela de login (sem sessão). Lê SÓ a RPC pública
 * public_login_branding() com a chave anônima. Qualquer falha — Supabase fora
 * do ar, timeout, variável ausente, migration ainda não aplicada — devolve o
 * padrão DirectPlaca: a tela de login nunca quebra por causa do branding.
 */
export async function loadLoginBranding(): Promise<LoginBranding> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return DEFAULT_BRANDING;
  try {
    const client = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: (input, init) => fetch(input, { ...init, cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) }) },
    });
    const { data, error } = await client.rpc("public_login_branding");
    if (error) return DEFAULT_BRANDING;
    const row = (Array.isArray(data) ? data[0] : data) as BrandingRow | undefined;
    return resolveBranding(row ?? null, url);
  } catch {
    return DEFAULT_BRANDING;
  }
}
