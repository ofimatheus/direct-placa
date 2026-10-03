import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getPublicEnv } from "@/lib/env";
import { getServerEnv } from "@/lib/env.server";

let cached: SupabaseClient | null = null;

/**
 * Cliente service_role: IGNORA RLS. Uso restrito a código de servidor que já
 * validou a autorização (rotas ADMIN) ou que não tem usuário (worker/cron).
 */
export function createAdminClient(): SupabaseClient {
  if (cached) return cached;
  const { supabaseUrl } = getPublicEnv();
  const { serviceRoleKey } = getServerEnv();
  cached = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return cached;
}

/** Cliente anônimo sem cookies — usado apenas pelo redirect público. */
export function createAnonClient(): SupabaseClient {
  const { supabaseUrl, supabaseAnonKey } = getPublicEnv();
  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
