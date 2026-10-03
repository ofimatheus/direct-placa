import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlacesAdminDeps } from "@/lib/integrations/google-places/admin";
import { getGooglePlacesApiKey } from "@/lib/integrations/google-places/key";
import { testGooglePlacesKey } from "@/lib/integrations/google-places/test";

/**
 * Dependências reais das rotas de ADMIN. Gravar/remover/registrar usam a
 * SESSÃO do ADMIN (o banco confere is_admin()); a chave efetiva é lida pela
 * service role (só servidor). Erros do banco viram mensagens sem a chave.
 */
export function placesAdminDeps(supabase: SupabaseClient): PlacesAdminDeps {
  return {
    resolveKey: getGooglePlacesApiKey,
    testKey: (apiKey) => testGooglePlacesKey(apiKey),
    saveKey: async (apiKey) => {
      const { data, error } = await supabase.rpc("admin_google_places_set", { p_api_key: apiKey });
      if (error) throw Object.assign(new Error("Não foi possível salvar a chave."), { code: error.code });
      return String(data ?? "");
    },
    removeKey: async () => {
      const { error } = await supabase.rpc("admin_google_places_remove");
      if (error) throw Object.assign(new Error("Não foi possível remover a configuração."), { code: error.code });
    },
    recordTest: async (kind, source) => {
      await supabase.rpc("admin_google_places_record_test", { p_status: kind, p_source: source });
    },
  };
}

/** Erro sem detalhes (nunca a chave nem a mensagem do banco). */
export function safeFailure(error: unknown, fallback: string) {
  const code = error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : "unexpected";
  console.error("google_places_admin_failed", { code });
  const status = code === "42501" ? 403 : 500;
  return { status, body: { ok: false, error: status === 403 ? "Somente ADMIN." : fallback } };
}
