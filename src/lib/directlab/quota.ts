import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DirectLabError } from "./errors";
import type { QuotaSnapshot } from "./types";

interface ConsumeRow {
  allowed?: boolean;
  reason?: string | null;
  used_today?: number | null;
  daily_limit?: number | null;
  retry_after_seconds?: number | null;
}

/**
 * Contadores do DirectLab no banco (RPC directlab_consume, migration 021).
 * O papel (ADMIN ou revendedor) e os limites são decididos pelo banco a
 * partir da sessão — a aplicação só diz qual contador consumir.
 * Falha fechado: se o contador não estiver disponível, o Google não é consultado.
 */
async function consume(sb: SupabaseClient, kind: "burst" | "daily"): Promise<ConsumeRow> {
  const { data, error } = await sb.rpc("directlab_consume", { p_kind: kind });
  if (error) throw new DirectLabError("not_configured", `cota do DirectLab indisponível (${kind}): ${error.message}`);
  const row = (Array.isArray(data) ? data[0] : data) as ConsumeRow | undefined;
  if (!row) throw new DirectLabError("not_configured", `cota do DirectLab sem resposta (${kind})`);
  return row;
}

/** Proteção curta contra rajadas (10/min, todos os papéis). */
export async function consumeDirectLabBurst(sb: SupabaseClient): Promise<void> {
  const row = await consume(sb, "burst");
  if (!row.allowed) throw new DirectLabError("rate_limited", "rajada", Math.max(1, Number(row.retry_after_seconds ?? 60)));
}

/** Cota diária (revendedor: 10/dia; ADMIN: sem cota diária → null). */
export async function consumeDirectLabDaily(sb: SupabaseClient): Promise<QuotaSnapshot | null> {
  const row = await consume(sb, "daily");
  if (!row.allowed) throw new DirectLabError("daily_limit", "cota diária esgotada", Math.max(1, Number(row.retry_after_seconds ?? 3600)));
  return row.daily_limit == null ? null : { used: Number(row.used_today ?? 0), limit: Number(row.daily_limit) };
}

/** Situação da cota do dia (para exibir "7 de 10 utilizações hoje"). null = ADMIN ou indisponível. */
export async function directLabQuotaStatus(sb: SupabaseClient): Promise<QuotaSnapshot | null> {
  const { data, error } = await sb.rpc("directlab_quota_status");
  if (error) return null;
  const row = (Array.isArray(data) ? data[0] : data) as { role?: string; used_today?: number | null; daily_limit?: number | null } | undefined;
  if (!row || row.daily_limit == null) return null;
  return { used: Number(row.used_today ?? 0), limit: Number(row.daily_limit) };
}

interface GenerationRow {
  allowed?: boolean;
  charged?: boolean;
  used_today?: number | null;
  daily_limit?: number | null;
  retry_after_seconds?: number | null;
}

async function generationRpc(sb: SupabaseClient, fn: "directlab_generation_check" | "directlab_charge_generation", placeId: string): Promise<GenerationRow> {
  const { data, error } = await sb.rpc(fn, { p_place_id: placeId });
  if (error) throw new DirectLabError("not_configured", `cota do DirectLab indisponível (${fn}): ${error.message}`);
  const row = (Array.isArray(data) ? data[0] : data) as GenerationRow | undefined;
  if (!row) throw new DirectLabError("not_configured", `cota do DirectLab sem resposta (${fn})`);
  return row;
}

/** Consulta SEM consumir (migration 026): pode gerar o link deste local agora? */
export async function checkDirectLabGeneration(sb: SupabaseClient, placeId: string): Promise<void> {
  const row = await generationRpc(sb, "directlab_generation_check", placeId);
  if (!row.allowed) throw new DirectLabError("daily_limit", "cota diária esgotada (consulta)", Math.max(1, Number(row.retry_after_seconds ?? 3600)));
}

/** Cobrança atômica de um link GERADO COM SUCESSO (migration 026). Sem cota → daily_limit (link não entregue). */
export async function chargeDirectLabGeneration(sb: SupabaseClient, placeId: string): Promise<QuotaSnapshot | null> {
  const row = await generationRpc(sb, "directlab_charge_generation", placeId);
  if (!row.allowed) throw new DirectLabError("daily_limit", "cota diária esgotada (cobrança)", Math.max(1, Number(row.retry_after_seconds ?? 3600)));
  return row.daily_limit == null ? null : { used: Number(row.used_today ?? 0), limit: Number(row.daily_limit) };
}

export interface FinalizeResult {
  quota: QuotaSnapshot | null;
  /** Código do link curto; null se a migration 028 ainda não foi aplicada (segue como antes, só com o link do Google). */
  code: string | null;
}

/**
 * Conclui a geração (migration 028): cobra a utilização E cria/reaproveita o
 * link curto na MESMA transação do banco — se o link falhar, nada é cobrado.
 * Sem a migration, cobra como antes e entrega só o link do Google.
 */
export async function finalizeDirectLabGeneration(sb: SupabaseClient, placeId: string, destination: string): Promise<FinalizeResult> {
  const { data, error } = await sb.rpc("directlab_finalize_generation", { p_place_id: placeId, p_destination_url: destination });
  if (error) {
    if (error.code === "PGRST202" || error.code === "42883") {
      console.warn("directlab_short_link_not_installed", { code: error.code });
      return { quota: await chargeDirectLabGeneration(sb, placeId), code: null };
    }
    throw new DirectLabError("short_link_unavailable", `finalização da geração falhou: ${error.code} ${error.message}`);
  }
  const row = (Array.isArray(data) ? data[0] : data) as (GenerationRow & { public_code?: string | null }) | undefined;
  if (!row) throw new DirectLabError("short_link_unavailable", "finalização sem resposta");
  if (!row.allowed) throw new DirectLabError("daily_limit", "cota diária esgotada (finalização)", Math.max(1, Number(row.retry_after_seconds ?? 3600)));
  return { quota: row.daily_limit == null ? null : { used: Number(row.used_today ?? 0), limit: Number(row.daily_limit) }, code: row.public_code ?? null };
}
