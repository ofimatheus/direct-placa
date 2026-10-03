import "server-only";
import type { EffectiveKey } from "./key";
import { GOOGLE_KEY_FORMAT, PLACES_FORMAT_MESSAGE, PLACES_NOT_CONFIGURED_ADMIN, placesTestMessage, type KeySource, type PlacesTestKind } from "./messages";
import type { PlacesTestResult } from "./test";

/** Dependências injetáveis (testes usam Google/banco simulados). */
export interface PlacesAdminDeps {
  resolveKey: () => Promise<EffectiveKey | null>;
  testKey: (apiKey: string) => Promise<PlacesTestResult>;
  /** Grava/troca no Vault (RPC do ADMIN). Devolve só os últimos 4. */
  saveKey: (apiKey: string) => Promise<string>;
  removeKey: () => Promise<void>;
  recordTest: (kind: PlacesTestKind, source: KeySource) => Promise<void>;
}

/** Resposta segura para o navegador: nunca contém a chave. */
export interface PlacesAdminResult {
  ok: boolean;
  kind: PlacesTestKind | "not_configured" | "invalid_format";
  message: string;
  reason: string | null;
  source: KeySource | null;
  last4?: string;
}

function logFailure(result: PlacesTestResult, source: KeySource | "new") {
  // Só códigos seguros; a chave nunca é registrada.
  console.warn("google_places_test_failed", { kind: result.kind, reason: result.reason, httpStatus: result.httpStatus, source });
}

/** "Testar conexão": testa a chave EFETIVA (ADMIN > ambiente). Não toca na cota do DirectLab. */
export async function testEffectiveConnection(deps: PlacesAdminDeps): Promise<PlacesAdminResult> {
  const effective = await deps.resolveKey();
  if (!effective) return { ok: false, kind: "not_configured", message: PLACES_NOT_CONFIGURED_ADMIN, reason: null, source: null };
  const result = await deps.testKey(effective.key);
  if (result.kind !== "ok") logFailure(result, effective.source);
  await deps.recordTest(result.kind, effective.source).catch(() => undefined);
  return { ok: result.kind === "ok", kind: result.kind, message: placesTestMessage(result.kind, result.reason, result.httpStatus), reason: result.reason, source: effective.source };
}

/**
 * "Testar e salvar": 1) formato; 2) teste real no Google; 3) só se o Google
 * autorizar, grava no Vault. Qualquer falha mantém a chave atual.
 */
export async function saveNewKey(rawKey: unknown, deps: PlacesAdminDeps): Promise<PlacesAdminResult> {
  const apiKey = typeof rawKey === "string" ? rawKey.trim() : "";
  if (!GOOGLE_KEY_FORMAT.test(apiKey)) return { ok: false, kind: "invalid_format", message: PLACES_FORMAT_MESSAGE, reason: null, source: null };
  const result = await deps.testKey(apiKey);
  if (result.kind !== "ok") {
    logFailure(result, "new");
    return { ok: false, kind: result.kind, message: `${placesTestMessage(result.kind, result.reason, result.httpStatus)} A chave atual foi mantida.`, reason: result.reason, source: null };
  }
  const last4 = await deps.saveKey(apiKey);
  await deps.recordTest("ok", "admin").catch(() => undefined);
  return { ok: true, kind: "ok", message: "✓ Chave testada e salva. Já está em uso pela Avaliação Google.", reason: null, source: "admin", last4 };
}

/** Remove a chave do ADMIN; a aplicação volta ao ambiente (que não é alterado). */
export async function removeCustomKey(deps: Pick<PlacesAdminDeps, "removeKey" | "resolveKey">): Promise<{ ok: true; source: KeySource | null }> {
  await deps.removeKey();
  const effective = await deps.resolveKey();
  return { ok: true, source: effective?.source ?? null };
}
