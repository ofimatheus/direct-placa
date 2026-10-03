import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { DIRECTLAB_ERRORS, DirectLabError } from "./errors";
import type { CandidateTokens } from "./candidate-token";
import type { PlaceSummary, PlacesClientOptions } from "./places";
import type { ResolveOptions } from "./resolver";
import { generateReviewLink, identifyFromLink, searchPlacesForReview, toCandidates, type GenerationGate, type ReviewPlace } from "./service";
import { parseUserGoogleUrl } from "./urls";

/**
 * Limites do DirectLab. A regra vale no BANCO (migrations 021, 024 e 026);
 * estes números só espelham a regra para exibição e testes.
 *   · proteção curta: 10 operações por minuto, para todos (inclusive ADMIN);
 *   · cota diária do revendedor (padrão 10, definida pelo ADMIN): 1 utilização
 *     = 1 link de avaliação GERADO COM SUCESSO. ADMIN não tem cota diária.
 */
export const DIRECTLAB_LIMITS = { burstPerMinute: 10, resellerDaily: 10 } as const;

export type { QuotaSnapshot } from "./types";
import type { QuotaSnapshot } from "./types";

export const googleReviewRequestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("resolve"), url: z.string().max(2048) }),
  z.object({ action: z.literal("search"), query: z.string().max(200) }),
  z.object({
    action: z.literal("place"),
    placeId: z.string().regex(/^[A-Za-z0-9_-]{10,512}$/),
    originalUrl: z.string().max(2048).nullable().optional(),
    /** Comprovante assinado do candidato (opcional; inválido = ignorado). */
    token: z.string().max(4096).optional(),
  }),
]);

export interface HandlerContext {
  apiKey: string | null;
  /** Proteção curta (anti-rajada); lança DirectLabError("rate_limited") quando estoura. */
  consumeQuota: () => Promise<void>;
  /**
   * Cota diária — consulta SEM consumir, antes da chamada final ao Google na
   * GERAÇÃO do link. Lança DirectLabError("daily_limit") se não houver cota.
   */
  checkGeneration?: (placeId: string) => Promise<void>;
  /**
   * Cota diária — cobrança ATÔMICA, chamada só depois que o link oficial foi
   * obtido e validado. Lança DirectLabError("daily_limit") se a cota acabou
   * (o link então não é entregue). Revendedor devolve o uso do dia; ADMIN, null.
   */
  chargeGeneration?: (placeId: string) => Promise<QuotaSnapshot | null>;
  /** Comprovantes assinados de candidatos (evitam repetir a chamada ao Google). */
  tokens?: CandidateTokens;
  /** @deprecated Regra antiga (cobrar antes do Google). Não é mais chamado. */
  consumeDaily?: () => Promise<QuotaSnapshot | null>;
  fetch?: typeof fetch;
  resolve?: ResolveOptions;
}

/**
 * Regras do endpoint (a rota só autentica e monta o contexto):
 *   1. valida a entrada ANTES de qualquer acesso à rede;
 *   2. sem chave configurada → not_configured;
 *   3. proteção curta contra rajadas (toda operação válida);
 *   4. pesquisar, resolver link, listar candidatos → NUNCA cobram (nem
 *      checam a cota: pesquisar funciona com o limite atingido);
 *   5. gerar o link: consulta a cota → obtém e valida o link oficial →
 *      SÓ ENTÃO cobra 1 utilização (atômico). Erro em qualquer etapa = 0.
 */
export async function handleGoogleReviewRequest(raw: unknown, ctx: HandlerContext) {
  const parsed = googleReviewRequestSchema.safeParse(raw);
  if (!parsed.success) {
    const action = (raw as { action?: string } | null)?.action;
    throw new DirectLabError(action === "search" ? "invalid_query" : "invalid_url", "corpo inválido");
  }
  const body = parsed.data;
  if (body.action === "resolve") parseUserGoogleUrl(body.url);
  if (body.action === "search" && body.query.replace(/\s+/g, " ").trim().length < 3) throw new DirectLabError("invalid_query");

  if (!ctx.apiKey) throw new DirectLabError("not_configured", "GOOGLE_PLACES_API_KEY ausente");
  await ctx.consumeQuota();

  const places: PlacesClientOptions = { apiKey: ctx.apiKey, fetch: ctx.fetch };
  const deps = { places, resolve: { fetch: ctx.fetch, ...ctx.resolve } };
  const gate: GenerationGate = {
    check: ctx.checkGeneration ?? (async () => undefined),
    charge: ctx.chargeGeneration ?? (async () => null),
  };
  const withTokens = (results: PlaceSummary[]) =>
    toCandidates(results).map((c, i) => {
      const token = ctx.tokens?.sign(results[i]!);
      return token ? { ...c, token } : c;
    });
  const found = (generated: { place: ReviewPlace; quota: QuotaSnapshot | null }, originalUrl: string | null) =>
    generated.quota ? { status: "found" as const, place: generated.place, originalUrl, quota: generated.quota } : { status: "found" as const, place: generated.place, originalUrl };

  if (body.action === "resolve") {
    const { identified, originalUrl } = await identifyFromLink(body.url, deps);
    if (identified.kind === "place") return found(await generateReviewLink(identified.place, deps, gate), originalUrl);
    if (identified.kind === "choose") return { status: "choose" as const, candidates: withTokens(identified.results), originalUrl };
    return { status: "not_identified" as const, originalUrl };
  }
  if (body.action === "search") {
    return { status: "choose" as const, candidates: withTokens(await searchPlacesForReview(body.query, deps)), originalUrl: null };
  }
  const known = ctx.tokens?.verify(body.token, body.placeId) ?? null;
  return found(await generateReviewLink(known ?? { placeId: body.placeId }, deps, gate), body.originalUrl ? safeOriginal(body.originalUrl) : null);
}

function safeOriginal(value: string): string | null {
  try {
    return parseUserGoogleUrl(value).toString();
  } catch {
    return null;
  }
}

/** Erro → resposta amigável. Detalhe técnico só no log do servidor (sem a chave). */
export function directLabErrorResponse(error: unknown, secret?: string | null): NextResponse {
  if (error instanceof DirectLabError) {
    const info = DIRECTLAB_ERRORS[error.code];
    if (error.detail && info.status >= 500) {
      const detail = secret ? error.detail.split(secret).join("***") : error.detail;
      console.error(`[directlab] ${error.code}: ${detail}`);
    }
    const headers = error.retryAfterSeconds ? { "Retry-After": String(error.retryAfterSeconds) } : undefined;
    return NextResponse.json(
      { error: info.message, code: error.code, ...(error.retryAfterSeconds ? { retryAfterSeconds: error.retryAfterSeconds } : {}) },
      { status: info.status, headers },
    );
  }
  console.error("[directlab] erro inesperado:", error instanceof Error ? error.message : "desconhecido");
  return NextResponse.json({ error: "Não foi possível concluir agora. Tente de novo.", code: "unexpected" }, { status: 500 });
}
