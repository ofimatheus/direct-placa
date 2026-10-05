/**
 * Link curto da Avaliação Google: <origem de NEXT_PUBLIC_GO_BASE_URL>/r/<7 caracteres>.
 * Pensado para gravação em tags NFC. Seguro para servidor e navegador.
 *
 * NÃO é um encurtador genérico: o destino só pode ser um link de avaliação do
 * Google (mesma regra do banco, directlab_review_destination_ok) e só é
 * gravado pela finalização da geração no servidor.
 */

export const REVIEW_SHORT_CODE_RE = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{7}$/;
/** Referência para tags NFC com pouca memória (aviso discreto acima disso; nunca bloqueia). */
export const NFC_SHORT_LINK_TARGET_BYTES = 40;

/** Tamanho REAL em bytes UTF-8 (não url.length). */
export function urlByteLength(url: string): number {
  return new TextEncoder().encode(url).length;
}

const DESTINATION_PATTERNS = [/^https:\/\/(www\.|maps\.)?google\.com\/maps\//, /^https:\/\/search\.google\.com\/local\/writereview(\?|$)/, /^https:\/\/g\.page\/r\//];

/** Só links de avaliação do Google, em https, sem truques (google.com/url, "..", espaços, usuário na URL…). */
export function isShortLinkDestination(url: unknown): url is string {
  if (typeof url !== "string" || url.length < 20 || url.length > 2048) return false;
  if (/[\s<>"\\]/.test(url) || /(\.\.|%2e|%5c)/i.test(url)) return false;
  return DESTINATION_PATTERNS.some((re) => re.test(url));
}

/** URL pública do link curto (origem de NEXT_PUBLIC_GO_BASE_URL). null se a origem não estiver configurada. */
export function reviewShortUrl(code: string, goBaseUrl = process.env.NEXT_PUBLIC_GO_BASE_URL ?? ""): string | null {
  try {
    const origin = new URL(goBaseUrl).origin;
    return origin && origin !== "null" ? `${origin}/r/${code}` : null;
  } catch {
    return null;
  }
}

export interface ReviewShortLink {
  code: string;
  url: string;
  /** Bytes UTF-8 do ENDEREÇO (o registro NDEF completo tem um pequeno acréscimo do formato). */
  bytes: number;
}

export function buildReviewShortLink(code: string | null | undefined, goBaseUrl?: string): ReviewShortLink | null {
  if (!code || !REVIEW_SHORT_CODE_RE.test(code)) return null;
  const url = reviewShortUrl(code, goBaseUrl);
  return url ? { code, url, bytes: urlByteLength(url) } : null;
}

export function normalizeShortCode(raw: string): string | null {
  const code = String(raw ?? "").trim().toUpperCase();
  return REVIEW_SHORT_CODE_RE.test(code) ? code : null;
}

export type ShortLinkResolution = { status: 302; location: string } | { status: 404 } | { status: 503 };

/**
 * Rota pública /r/<código>: valida o formato, consulta SÓ o código no banco
 * e redireciona (302) para o destino guardado. Nunca aceita destino vindo
 * da requisição; não chama o Google; não toca em cota.
 */
export async function resolveReviewShortLink(rawCode: string, lookup: (code: string) => Promise<string | null>): Promise<ShortLinkResolution> {
  const code = normalizeShortCode(rawCode);
  if (!code) return { status: 404 };
  let destination: string | null;
  try {
    destination = await lookup(code);
  } catch {
    return { status: 503 };
  }
  if (!isShortLinkDestination(destination)) return { status: 404 };
  return { status: 302, location: destination };
}
