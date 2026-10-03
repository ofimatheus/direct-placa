import type { Cta, LandingContent } from "./schema";
import { SECTION_ANCHOR } from "./schema";

/**
 * Contato e destinos dos botões da landing (servidor e navegador).
 * Canal: o preferido pelo ADMIN, se configurado; senão WhatsApp → formulário → e-mail.
 * Sem nenhum canal, os botões de contato levam à seção final (#contato).
 */
export type ContactChannel = "whatsapp" | "form" | "email" | "none";

export interface LinkTarget {
  href: string;
  external: boolean;
}

export function whatsappUrl(number: string, message: string): string | null {
  const digits = number.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 15) return null;
  return `https://wa.me/${digits}${message.trim() ? `?text=${encodeURIComponent(message.trim())}` : ""}`;
}

export function resolveContact(contact: LandingContent["contact"]): { channel: ContactChannel; target: LinkTarget; description: string } {
  const options: Record<Exclude<ContactChannel, "none">, { href: string; description: string } | null> = {
    whatsapp: (() => {
      const href = whatsappUrl(contact.whatsappNumber, contact.whatsappMessage);
      return href ? { href, description: `WhatsApp +${contact.whatsappNumber.replace(/\D/g, "")}` } : null;
    })(),
    form: contact.formUrl ? { href: contact.formUrl, description: `Formulário ${contact.formUrl}` } : null,
    email: contact.email ? { href: `mailto:${contact.email}?subject=${encodeURIComponent("Revenda DirectPlaca")}`, description: `E-mail ${contact.email}` } : null,
  };
  const order: Exclude<ContactChannel, "none">[] = contact.preferred === "auto" ? ["whatsapp", "form", "email"] : [contact.preferred, "whatsapp", "form", "email"];
  for (const channel of order) {
    const opt = options[channel];
    if (opt) return { channel, target: { href: opt.href, external: true }, description: opt.description };
  }
  return { channel: "none", target: { href: "#contato", external: false }, description: "Nenhum canal configurado: os botões levam à seção final da página." };
}

/** Destino de um botão. */
export function ctaTarget(cta: Cta, contact: LandingContent["contact"]): LinkTarget {
  if (cta.action === "section" && cta.section) return { href: `#${SECTION_ANCHOR[cta.section]}`, external: false };
  if (cta.action === "url" && cta.url) return { href: cta.url, external: true };
  if (cta.action === "whatsapp") {
    const href = whatsappUrl(contact.whatsappNumber, contact.whatsappMessage);
    if (href) return { href, external: true };
  }
  return resolveContact(contact).target;
}

/** Domínio público da landing (SEO / link público). null = desconhecido. */
export function landingOrigin(siteUrl: string, fallbackHost?: string | null): string | null {
  const raw = siteUrl || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "") || (fallbackHost ?? "");
  if (!raw) return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

/** URL pública de uma imagem enviada (bucket público landing-assets). */
export function landingMediaUrl(supabaseUrl: string, path: string): string {
  return `${supabaseUrl.replace(/\/$/, "")}/storage/v1/object/public/landing-assets/${path.split("/").map(encodeURIComponent).join("/")}`;
}
