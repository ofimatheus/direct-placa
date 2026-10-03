import "server-only";
import { readGooglePlacesEnvKey } from "@/lib/env.server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { KeySource } from "./messages";

export interface EffectiveKey {
  key: string;
  source: KeySource;
}

export interface KeyResolverDeps {
  /** Chave do ADMIN (Supabase Vault) ou null. Pode lançar (banco/service role indisponível). */
  readAdminKey: () => Promise<string | null>;
  /** GOOGLE_PLACES_API_KEY do ambiente ou null. */
  readEnvKey: () => string | null;
}

/**
 * Ordem: 1) chave configurada pelo ADMIN (Vault); 2) GOOGLE_PLACES_API_KEY.
 * Sem cache: cada operação lê de novo, então trocar/remover a chave vale na
 * hora, sem restart nem redeploy (inclusive em várias instâncias na Vercel).
 * Se a leitura do Vault falhar, registra só um código seguro e cai no ambiente.
 */
export async function resolveGooglePlacesApiKey(deps: KeyResolverDeps): Promise<EffectiveKey | null> {
  let adminKey: string | null = null;
  try {
    adminKey = (await deps.readAdminKey())?.trim() || null;
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : "lookup_failed";
    console.warn("google_places_key_lookup_failed", { code });
  }
  if (adminKey) return { key: adminKey, source: "admin" };
  const envKey = deps.readEnvKey();
  return envKey ? { key: envKey, source: "env" } : null;
}

/** Lê a chave do ADMIN no Vault pela service role (só servidor). */
async function readAdminKeyFromVault(): Promise<string | null> {
  let client;
  try {
    client = createAdminClient();
  } catch {
    throw Object.assign(new Error("service role ausente"), { code: "service_role_missing" });
  }
  const { data, error } = await client.rpc("google_places_api_key");
  if (error) throw Object.assign(new Error("vault"), { code: error.code ?? "rpc_error" });
  return typeof data === "string" && data ? data : null;
}

/** Função ÚNICA para obter a chave efetiva da Google Places API. */
export function getGooglePlacesApiKey(): Promise<EffectiveKey | null> {
  return resolveGooglePlacesApiKey({ readAdminKey: readAdminKeyFromVault, readEnvKey: readGooglePlacesEnvKey });
}
