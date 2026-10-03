/** Limite de páginas DirectLink (seguro para servidor e navegador). */
export const DIRECTLINK_LIMIT_MESSAGE =
  "Você atingiu o limite de páginas DirectLink definido para sua conta. Entre em contato com o administrador para aumentar o limite.";

/** Páginas do usuário: revendedor → usadas e limite; ADMIN → limit null (sem limite). */
export interface DirectLinkPageStatus {
  used: number;
  limit: number | null;
}
