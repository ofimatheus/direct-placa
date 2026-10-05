/**
 * Erros do DirectLab. O usuário vê só a mensagem amigável; detalhes técnicos
 * ficam no log do servidor. Seguro para o navegador (sem segredos).
 */
export type DirectLabErrorCode =
  | "invalid_url"
  | "domain_not_allowed"
  | "redirect_blocked"
  | "not_found"
  | "review_link_unavailable"
  | "google_unavailable"
  | "google_denied"
  | "quota_exceeded"
  | "rate_limited"
  | "daily_limit"
  | "not_configured"
  | "short_link_unavailable"
  | "invalid_query";

export const DIRECTLAB_ERRORS: Record<DirectLabErrorCode, { status: number; message: string }> = {
  invalid_url: { status: 422, message: "Isso não parece um link válido. Copie o link do estabelecimento no Google e cole aqui." },
  domain_not_allowed: {
    status: 422,
    message: "Use um link do Google: share.google, maps.app.goo.gl ou google.com/maps. Links de outros sites não são aceitos.",
  },
  redirect_blocked: {
    status: 422,
    message: "Este link leva para fora do Google e foi bloqueado por segurança. Copie o link direto do estabelecimento no Google.",
  },
  not_found: { status: 404, message: "Não encontramos esse estabelecimento no Google." },
  review_link_unavailable: {
    status: 422,
    message: "O Google não forneceu o link de avaliação deste local. Confira se é um estabelecimento com perfil no Google.",
  },
  google_unavailable: { status: 502, message: "O Google não respondeu agora. Tente de novo em instantes." },
  short_link_unavailable: { status: 503, message: "Não foi possível concluir o link agora. Nada foi descontado; tente de novo em instantes." },
  google_denied: { status: 502, message: "A consulta ao Google foi recusada. Avise o administrador do sistema." },
  quota_exceeded: { status: 429, message: "O limite de consultas ao Google foi atingido. Tente novamente mais tarde." },
  rate_limited: { status: 429, message: "Você fez muitas consultas seguidas. Aguarde um pouco e tente de novo." },
  daily_limit: {
    status: 429,
    message: "Você atingiu o limite diário definido para sua conta. Entre em contato com o administrador para aumentar o limite.",
  },
  not_configured: {
    status: 503,
    message: "O DirectLab ainda não está configurado no servidor (chave da Google Places API). Avise o administrador.",
  },
  invalid_query: { status: 422, message: "Digite o nome ou o endereço do estabelecimento (pelo menos 3 letras)." },
};

export class DirectLabError extends Error {
  constructor(
    public readonly code: DirectLabErrorCode,
    /** Detalhe técnico: só para o log do servidor, nunca para a resposta. */
    public readonly detail?: string,
    public readonly retryAfterSeconds?: number,
  ) {
    super(DIRECTLAB_ERRORS[code].message);
  }
}
