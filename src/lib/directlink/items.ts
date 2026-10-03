/**
 * DirectLink · tipos de botão, normalização do que o usuário digita e o
 * link final de cada botão. Puro (navegador e servidor). O banco valida de
 * novo (directlink_item_is_valid); aqui também se revalida ao exibir.
 */
export type DirectLinkItemType = "instagram" | "whatsapp" | "pix" | "youtube" | "facebook" | "site" | "menu" | "maps" | "phone" | "email" | "link";

type Kind = "url" | "whatsapp" | "phone" | "email" | "pix";

export const ITEM_TYPES: Record<DirectLinkItemType, { label: string; kind: Kind; placeholder: string; help: string }> = {
  instagram: { label: "Instagram", kind: "url", placeholder: "@seuperfil ou https://instagram.com/seuperfil", help: "Perfil ou link do Instagram." },
  whatsapp: { label: "WhatsApp", kind: "whatsapp", placeholder: "(11) 99999-8888", help: "Número com DDD (o 55 do Brasil é incluído)." },
  pix: { label: "PIX", kind: "pix", placeholder: "E-mail, CPF/CNPJ, telefone ou chave aleatória", help: "A chave é exibida para copiar. Não há cobrança nem integração bancária." },
  youtube: { label: "YouTube", kind: "url", placeholder: "https://youtube.com/@seucanal", help: "Canal ou vídeo." },
  facebook: { label: "Facebook", kind: "url", placeholder: "https://facebook.com/suapagina", help: "Página do Facebook." },
  site: { label: "Site", kind: "url", placeholder: "https://seusite.com.br", help: "Endereço do site." },
  menu: { label: "Cardápio", kind: "url", placeholder: "https://seusite.com.br/cardapio", help: "Link do cardápio." },
  maps: { label: "Localização", kind: "url", placeholder: "https://maps.app.goo.gl/...", help: "Link do Google Maps (ou outro mapa)." },
  phone: { label: "Telefone", kind: "phone", placeholder: "(11) 3333-4444", help: "Toque para ligar." },
  email: { label: "E-mail", kind: "email", placeholder: "contato@seusite.com.br", help: "Abre o e-mail do visitante." },
  link: { label: "Link", kind: "url", placeholder: "https://...", help: "Qualquer link (http ou https)." },
};

export const ITEM_TYPE_ORDER = Object.keys(ITEM_TYPES) as DirectLinkItemType[];
export const MAX_ITEMS = 30;

const URL_RE = /^https?:\/\/[a-z0-9.-]+\.[a-z]{2,}(:[0-9]{1,5})?([/?#][^\s]*)?$/i;

/** Só http(s) com domínio (mesma regra do banco). Bloqueia javascript:, data:, file: etc. */
export function isSafeHttpUrl(value: string): boolean {
  if (!value || value.length > 2048 || value !== value.trim() || !URL_RE.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export type Normalized = { ok: true; value: string } | { ok: false; error: string };

/** Transforma o que foi digitado no valor salvo. */
export function normalizeItemValue(type: DirectLinkItemType, raw: string): Normalized {
  const input = (raw ?? "").trim();
  if (!input) return { ok: false, error: "Preencha o destino do botão." };
  const kind = ITEM_TYPES[type]?.kind;
  if (!kind) return { ok: false, error: "Tipo de botão inválido." };

  if (kind === "pix") {
    if (input.length > 140 || /[\u0000-\u001f\u007f]/.test(input)) return { ok: false, error: "Chave PIX inválida." };
    return { ok: true, value: input };
  }
  if (kind === "whatsapp") {
    let digits = input.replace(/\D/g, "");
    if (digits.length === 10 || digits.length === 11) digits = `55${digits}`;
    return /^[0-9]{12,15}$/.test(digits) ? { ok: true, value: digits } : { ok: false, error: "Informe o WhatsApp com DDD, ex.: (11) 99999-8888." };
  }
  if (kind === "phone") {
    const plus = input.startsWith("+");
    const digits = input.replace(/\D/g, "");
    const value = `${plus ? "+" : ""}${digits}`;
    return /^\+?[0-9]{8,15}$/.test(value) ? { ok: true, value } : { ok: false, error: "Telefone inválido." };
  }
  if (kind === "email") {
    const value = input.toLowerCase();
    return value.length <= 254 && /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(value) ? { ok: true, value } : { ok: false, error: "E-mail inválido." };
  }
  // URL
  if (/^[a-z][a-z0-9+.-]*:/i.test(input) && !/^https?:\/\//i.test(input)) {
    return { ok: false, error: "Use um link que comece com https://." };
  }
  if (type === "instagram" && /^@?[A-Za-z0-9._]{1,30}$/.test(input)) {
    return { ok: true, value: `https://instagram.com/${input.replace(/^@/, "")}` };
  }
  const withScheme = /^https?:\/\//i.test(input) ? input : `https://${input}`;
  return isSafeHttpUrl(withScheme) ? { ok: true, value: withScheme } : { ok: false, error: "Link inválido. Use https://..." };
}

export interface PublicItem {
  type: DirectLinkItemType;
  title: string;
  value: string;
  receiver_name?: string | null;
}

/** Link final do botão. null = PIX (abre a chave) ou valor que não passa na revalidação. */
export function itemHref(item: PublicItem): string | null {
  const kind = ITEM_TYPES[item.type]?.kind;
  if (kind === "url") return isSafeHttpUrl(item.value) ? item.value : null;
  if (kind === "whatsapp") return /^[0-9]{10,15}$/.test(item.value) ? `https://wa.me/${item.value}` : null;
  if (kind === "phone") return /^\+?[0-9]{8,15}$/.test(item.value) ? `tel:${item.value}` : null;
  if (kind === "email") return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item.value) ? `mailto:${item.value}` : null;
  return null;
}

/** Imagem pública do bucket directlink-assets (caminho validado). */
export function directLinkAssetUrl(supabaseUrl: string, path: string | null | undefined): string | null {
  if (!path || !supabaseUrl || !/^[0-9a-f-]{36}\/(banner|logo)\/[0-9a-f-]{36}\.(png|jpg|webp)$/.test(path)) return null;
  return `${supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/public/directlink-assets/${path}`;
}

/**
 * URL pública permanente: <origem do domínio dos QR>/link/<código>.
 * Usa NEXT_PUBLIC_GO_BASE_URL (o mesmo domínio gravado nos QR Codes), que
 * serve /link/* tanto no domínio próprio de redirect quanto no app.
 */
export function directLinkPublicUrl(code: string, goBaseUrl = process.env.NEXT_PUBLIC_GO_BASE_URL ?? ""): string {
  let origin = "";
  try {
    origin = new URL(goBaseUrl).origin;
  } catch {
    origin = "";
  }
  return `${origin}/link/${code}`;
}
