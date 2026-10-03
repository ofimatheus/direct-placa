/**
 * Variáveis públicas (disponíveis no navegador). Referenciadas de forma
 * estática para que o Next.js as injete no bundle do cliente.
 */
export function getPublicEnv() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Defina NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY (veja .env.example).");
  }
  return { supabaseUrl, supabaseAnonKey };
}

/** Base da URL intermediária gravada no QR e no NFC, ex.: https://go.meudominio.com */
export function getGoBaseUrl(): string {
  const goBaseUrl = process.env.NEXT_PUBLIC_GO_BASE_URL;
  if (!goBaseUrl) {
    throw new Error("Defina NEXT_PUBLIC_GO_BASE_URL, ex.: https://go.meudominio.com (veja .env.example).");
  }
  return goBaseUrl.replace(/\/+$/, "");
}
