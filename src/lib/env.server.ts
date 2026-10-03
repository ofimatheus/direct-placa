import "server-only";

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function getServerEnv() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    throw new Error("Defina SUPABASE_SERVICE_ROLE_KEY (somente no servidor; veja .env.example).");
  }
  return {
    serviceRoleKey,
    cronSecret: process.env.CRON_SECRET ?? null,
  };
}

/** Limites configuráveis. Os padrões funcionam no plano gratuito do Supabase e na Vercel Hobby. */
export const limits = {
  templateMaxUploadBytes: intFromEnv("TEMPLATE_MAX_UPLOAD_MB", 25) * 1024 * 1024,
  templateMaxDimension: intFromEnv("TEMPLATE_MAX_DIMENSION", 8000),
  templateMaxPixels: intFromEnv("TEMPLATE_MAX_PIXELS", 50_000_000),
  exportPartMaxBytes: intFromEnv("EXPORT_PART_MAX_MB", 45) * 1024 * 1024,
  exportTimeBudgetMs: intFromEnv("EXPORT_TIME_BUDGET_MS", 45_000),
  exportPartTimeLimitMs: intFromEnv("EXPORT_PART_TIME_LIMIT_MS", 30_000),
};

/**
 * Chave de FALLBACK da Google Places API (variável de ambiente, só no
 * servidor; nunca NEXT_PUBLIC_). Único ponto do projeto que lê
 * GOOGLE_PLACES_API_KEY. A chave efetiva (ADMIN > ambiente) é resolvida por
 * getGooglePlacesApiKey() em src/lib/integrations/google-places/key.ts.
 */
export function readGooglePlacesEnvKey(): string | null {
  const key = process.env.GOOGLE_PLACES_API_KEY?.trim();
  return key ? key : null;
}

/**
 * Segredo do servidor usado para DERIVAR a chave que assina os comprovantes
 * de candidatos do DirectLab (nunca sai do servidor). null = sem assinatura
 * (o DirectLab consulta o Google de novo ao gerar o link).
 */
export function readDirectLabSigningSecret(): string | null {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || null;
}

/** Só diz SE a service role está configurada (nunca o valor). */
export function hasServiceRoleKey(): boolean {
  return Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
}
