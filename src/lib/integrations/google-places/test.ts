import "server-only";
import type { PlacesTestKind } from "./messages";

export interface PlacesTestResult {
  kind: PlacesTestKind;
  /** Motivo do Google, só se estiver na lista de códigos conhecidos (nunca texto livre). */
  reason: string | null;
  httpStatus: number | null;
}

/** Motivos que podem ser mostrados ao ADMIN (códigos do Google, sem dados da chave). */
const SAFE_REASONS = new Set([
  "API_KEY_INVALID",
  "API_KEY_SERVICE_BLOCKED",
  "API_KEY_HTTP_REFERRER_BLOCKED",
  "API_KEY_IP_ADDRESS_BLOCKED",
  "API_KEY_ANDROID_APP_BLOCKED",
  "API_KEY_IOS_APP_BLOCKED",
  "BILLING_DISABLED",
  "SERVICE_DISABLED",
  "RATE_LIMIT_EXCEEDED",
]);

/**
 * Teste REAL e mínimo da chave: um Text Search da Places API (New), o mesmo
 * endpoint da Avaliação Google, pedindo só `places.id` e 1 resultado. Não
 * existe endpoint gratuito de "validar chave"; esta é uma chamada real ao
 * Google (pode contar na cota/faturamento da sua conta Google Cloud).
 * A chave vai só no cabeçalho X-Goog-Api-Key (nunca na URL) e nunca aparece
 * no resultado.
 */
export async function testGooglePlacesKey(apiKey: string, options: { fetch?: typeof fetch; timeoutMs?: number } = {}): Promise<PlacesTestResult> {
  const doFetch = options.fetch ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 8000);
  let response: Response;
  try {
    response = await doFetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": "places.id" },
      body: JSON.stringify({ textQuery: "Google", pageSize: 1 }),
      signal: controller.signal,
      cache: "no-store",
    });
  } catch {
    return { kind: "unavailable", reason: null, httpStatus: null };
  } finally {
    clearTimeout(timer);
  }
  if (response.ok) return { kind: "ok", reason: null, httpStatus: response.status };

  let status = "";
  let message = "";
  const reasons: string[] = [];
  try {
    const json = (await response.json()) as { error?: { status?: string; message?: string; details?: { reason?: string }[] } };
    status = json.error?.status ?? "";
    message = json.error?.message ?? "";
    for (const d of json.error?.details ?? []) if (d?.reason) reasons.push(d.reason);
  } catch {
    // corpo não-JSON: classifica só pelo HTTP
  }
  const reason = reasons.find((r) => SAFE_REASONS.has(r)) ?? null;
  if (reasons.includes("API_KEY_INVALID") || /api key not valid/i.test(message)) return { kind: "invalid_key", reason: "API_KEY_INVALID", httpStatus: response.status };
  // PERMISSION_DENIED só quando o PRÓPRIO Google diz isso no corpo. Um 403 sem
  // o erro do Google (ex.: proxy/firewall no caminho) não é problema da chave.
  if (status === "PERMISSION_DENIED") return { kind: "permission_denied", reason, httpStatus: response.status };
  if (response.status === 429 || status === "RESOURCE_EXHAUSTED") return { kind: "quota_exceeded", reason, httpStatus: response.status };
  if (response.status >= 500) return { kind: "unavailable", reason: null, httpStatus: response.status };
  return { kind: "unexpected", reason: null, httpStatus: response.status };
}
