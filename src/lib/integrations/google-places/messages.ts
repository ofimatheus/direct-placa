/**
 * Google Places · textos e tipos seguros para servidor E navegador.
 * Nada aqui contém ou recebe a chave.
 */
export type PlacesTestKind = "ok" | "invalid_key" | "permission_denied" | "quota_exceeded" | "unavailable" | "unexpected";
export type KeySource = "admin" | "env";

/** Formato de chave de API do Google: "AIza" + 35 caracteres (39 no total). */
export const GOOGLE_KEY_FORMAT = /^AIza[0-9A-Za-z_-]{35}$/;

export const PLACES_NOT_CONFIGURED_ADMIN = "Google Places ainda não foi configurado. Entre em Configurações > Integrações.";
export const PLACES_NOT_CONFIGURED_RESELLER = "A integração com o Google está temporariamente indisponível. Entre em contato com o administrador.";
export const PLACES_FORMAT_MESSAGE = "Formato inválido: a chave da Google Places API começa com AIza e tem 39 caracteres.";
export const PLACES_TEST_NOTE = "O teste realiza uma solicitação à Google Places API.";

/** Mensagem para o ADMIN a partir de um resultado de teste (só códigos seguros). */
export function placesTestMessage(kind: PlacesTestKind, reason: string | null, httpStatus: number | null): string {
  switch (kind) {
    case "ok":
      return "✓ Conexão realizada com sucesso. Google Places está disponível.";
    case "invalid_key":
      return "Não foi possível validar a chave. Google retornou API key not valid: a chave não existe ou foi digitada errada.";
    case "permission_denied":
      return `Não foi possível validar a chave. Google retornou PERMISSION_DENIED${reason ? ` (${reason})` : ""}. Verifique as restrições da chave, Places API e faturamento.`;
    case "quota_exceeded":
      return "Não foi possível validar a chave. Google retornou RESOURCE_EXHAUSTED: a cota da chave acabou. Revise as cotas no Google Cloud ou tente mais tarde.";
    case "unavailable":
      return "Não foi possível falar com o Google agora (falha de rede ou Google indisponível). Tente novamente em instantes.";
    default:
      return `O Google respondeu de forma inesperada${httpStatus ? ` (HTTP ${httpStatus})` : ""}. Tente novamente.`;
  }
}

/** Representação mascarada a partir só dos últimos 4 caracteres (a chave nunca vem ao navegador). */
export function maskedKey(last4: string | null): string {
  return `AIza${"•".repeat(12)}${last4 ?? "••••"}`;
}
