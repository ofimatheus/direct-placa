import { reviewShortUrl } from "@/lib/directlab/short-link";
import { NextResponse } from "next/server";
import { requireDirectLabApi } from "@/lib/auth/session";
import { DirectLabError } from "@/lib/directlab/errors";
import { directLabErrorResponse, handleGoogleReviewRequest } from "@/lib/directlab/handler";
import { createCandidateTokens } from "@/lib/directlab/candidate-token";
import { chargeDirectLabGeneration, finalizeDirectLabGeneration, checkDirectLabGeneration, consumeDirectLabBurst } from "@/lib/directlab/quota";
import { readDirectLabSigningSecret } from "@/lib/env.server";
import { readJson } from "@/lib/http";
import { getGooglePlacesApiKey } from "@/lib/integrations/google-places/key";
import { PLACES_NOT_CONFIGURED_ADMIN, PLACES_NOT_CONFIGURED_RESELLER } from "@/lib/integrations/google-places/messages";

/**
 * DirectLab · Avaliação Google (ADMIN ou revendedor autenticado).
 *   { action: "resolve", url }       link do Google → link oficial de avaliação (ou lista)
 *   { action: "search",  query }     pesquisa manual → lista para escolher
 *   { action: "place",   placeId }   local escolhido → link oficial de avaliação
 * Cota do revendedor: 1 utilização = 1 link de avaliação GERADO COM SUCESSO
 * (pesquisar, resolver e escolher não cobram). Nada é gravado além dos
 * contadores (proteção curta, cota diária e o hash do local gerado no dia).
 * A chave do Google nunca sai do servidor. Chave efetiva: a do ADMIN
 * (Configurações > Integrações) ou, na falta dela, GOOGLE_PLACES_API_KEY.
 */
export async function POST(request: Request) {
  const auth = await requireDirectLabApi();
  if (!auth.ok) return auth.response;
  // Resolvida a cada requisição: trocar a chave vale na hora, sem restart.
  const apiKey = (await getGooglePlacesApiKey())?.key ?? null;
  try {
    const raw = await readJson(request).catch(() => null);
    const result = await handleGoogleReviewRequest(raw, {
      apiKey,
      consumeQuota: () => consumeDirectLabBurst(auth.session.supabase),
      checkGeneration: (placeId) => checkDirectLabGeneration(auth.session.supabase, placeId),
      chargeGeneration: (placeId) => chargeDirectLabGeneration(auth.session.supabase, placeId),
      // Link curto /r/<código>: cobrança + link na mesma transação (migration 028).
      finalizeGeneration: (placeId, destination) => finalizeDirectLabGeneration(auth.session.supabase, placeId, destination),
      shortLinkUrl: (code) => reviewShortUrl(code),
      tokens: createCandidateTokens(readDirectLabSigningSecret(), auth.session.user.id),
    });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    // Nenhuma chave (nem do ADMIN nem do ambiente): mensagem por papel.
    if (!apiKey && error instanceof DirectLabError && error.code === "not_configured") {
      console.error("[directlab] not_configured: chave da Google Places ausente (nem do ADMIN nem do ambiente)");
      return NextResponse.json(
        { error: auth.role === "admin" ? PLACES_NOT_CONFIGURED_ADMIN : PLACES_NOT_CONFIGURED_RESELLER, code: "not_configured" },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
    return directLabErrorResponse(error, apiKey);
  }
}
