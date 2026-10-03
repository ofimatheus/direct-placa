import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { PlaceSummary } from "./places";
import { isValidReviewUrl } from "./service";

/**
 * Comprovante de candidato: quando a busca no Google já trouxe o link
 * oficial de avaliação de um resultado, o servidor entrega junto um
 * comprovante ASSINADO (HMAC-SHA256), ligado ao usuário e válido por 15 min.
 * Ao gerar o link desse resultado, o servidor confere a assinatura e
 * reaproveita o link — sem outra chamada ao Google e sem confiar em dado
 * vindo do navegador. Inválido/vencido/de outro usuário → o servidor consulta
 * o Google de novo (nunca falha por causa do comprovante).
 *
 * O conteúdo (nome, endereço e link de avaliação) é o mesmo que o usuário
 * já vê; o comprovante só garante que não foi alterado.
 */
export interface CandidateTokens {
  sign: (place: PlaceSummary) => string | undefined;
  verify: (token: string | undefined, placeId: string) => PlaceSummary | null;
}

const TTL_SECONDS = 15 * 60;
const b64 = (data: Buffer | string) => Buffer.from(data).toString("base64url");

interface Payload {
  p: string;
  n: string;
  a: string | null;
  r: string;
  u: string;
  e: number;
}

export function createCandidateTokens(secret: string | null, userId: string, now: () => number = Date.now): CandidateTokens {
  if (!secret) return { sign: () => undefined, verify: () => null };
  // Chave derivada (o segredo original nunca é usado diretamente nem exposto).
  const key = createHash("sha256").update(`directplaca:directlab:candidate:v1\0${secret}`).digest();
  const mac = (body: string) => createHmac("sha256", key).update(body).digest();

  return {
    sign(place) {
      if (!isValidReviewUrl(place.reviewUrl)) return undefined;
      const payload: Payload = { p: place.placeId, n: place.name, a: place.address, r: place.reviewUrl, u: userId, e: Math.floor(now() / 1000) + TTL_SECONDS };
      const body = b64(JSON.stringify(payload));
      return `${body}.${b64(mac(body))}`;
    },
    verify(token, placeId) {
      if (!token || token.length > 4096) return null;
      const [body, sig] = token.split(".");
      if (!body || !sig) return null;
      const expected = mac(body);
      const given = Buffer.from(sig, "base64url");
      if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
      let payload: Payload;
      try {
        payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Payload;
      } catch {
        return null;
      }
      if (payload.u !== userId || payload.p !== placeId || !(payload.e > Math.floor(now() / 1000)) || !isValidReviewUrl(payload.r)) return null;
      return { placeId: payload.p, name: payload.n, address: payload.a, reviewUrl: payload.r };
    },
  };
}
