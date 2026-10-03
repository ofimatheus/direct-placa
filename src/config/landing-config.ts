/**
 * ===========================================================================
 * LANDING DE REVENDEDORES (/revendedores) — CONFIGURAÇÃO ÚNICA
 * ===========================================================================
 * Tudo o que provavelmente vai mudar fica AQUI: preços, quantidades,
 * mensalidade, contato/WhatsApp, textos dos botões e respostas do FAQ que
 * ainda dependem de decisão comercial.
 *
 * Regras:
 *   · valores em CENTAVOS (ex.: R$ 12,90 → 1290);
 *   · `null` = ainda não definido → a página mostra "Sob consulta" (preços)
 *     ou simplesmente omite o item (FAQ, período incluso). Nada é inventado.
 * ===========================================================================
 */

export interface WholesaleTier {
  /** Quantidade mínima do lote. */
  quantity: number;
  /** Rótulo do card (ex.: "10 unidades"). */
  label: string;
  /** Preço por unidade em centavos; null = "Sob consulta". */
  unitPriceCents: number | null;
  /** Lote "a partir de" com condição negociada (ex.: 100+). */
  custom?: boolean;
  /** Destaque visual opcional (ex.: lote mais escolhido). Use só se for verdade. */
  highlight?: string | null;
}

export const LANDING_CONFIG = {
  /**
   * Domínio público do site (para SEO/Open Graph), ex.: "https://www.seudominio.com.br".
   * null = usa o domínio de produção da Vercel (VERCEL_PROJECT_PRODUCTION_URL), se existir.
   * (Fora da Vercel e sem este valor, o Next usa http://localhost:3000 nos links das imagens sociais.)
   */
  siteUrl: null as string | null,

  /** Lotes de compra no atacado (placas). Ordem = ordem de exibição. */
  wholesaleTiers: [
    { quantity: 10, label: "10 unidades", unitPriceCents: null },
    { quantity: 25, label: "25 unidades", unitPriceCents: null },
    { quantity: 50, label: "50 unidades", unitPriceCents: null },
    { quantity: 100, label: "100+ unidades", unitPriceCents: null, custom: true },
  ] satisfies WholesaleTier[],

  /** Assinatura da plataforma (separada da compra das placas). */
  platform: {
    /** Mensalidade em centavos; null = "valor informado antes da compra". */
    monthlyPriceCents: null as number | null,
    /**
     * Primeiro período de acesso incluso na primeira compra (opcional).
     * Deixe `enabled: false` até definir a regra; quando definir, ajuste o texto
     * (ex.: "30 dias de plataforma inclusos na primeira compra").
     */
    firstPeriodIncluded: {
      enabled: false,
      text: "Primeiro período de acesso incluso na primeira compra.",
    },
    features: [
      "Painel do revendedor",
      "Gestão das placas",
      "Gestão de clientes",
      "Ativação e configuração das placas",
      "QR Code",
      "NFC",
      "DirectLink",
      "DirectLab",
      "Avaliação Google",
      "Novas ferramentas da plataforma",
    ],
  },

  /**
   * Contato comercial (destino dos botões "Quero ser revendedor").
   * Prioridade: WhatsApp → formulário (URL) → e-mail. Se nenhum for
   * definido, os botões levam à seção final da página (#contato).
   */
  contact: {
    /** Só dígitos, com DDI e DDD (ex.: "5511999998888"). */
    whatsappNumber: null as string | null,
    whatsappMessage: "Olá! Quero saber mais sobre a revenda DirectPlaca.",
    /** URL de um formulário externo (ex.: Google Forms, Typeform). */
    formUrl: null as string | null,
    email: null as string | null,
  },

  /** Textos dos botões principais. */
  cta: {
    primary: "Quero ser revendedor",
    secondary: "Conhecer a DirectPlaca",
    wholesale: "Escolher meu lote",
    custom: "Fale conosco",
    final: "Quero ser revendedor",
  },

  /** Respostas do FAQ que dependem de decisão comercial (null = pergunta não aparece). */
  faqPending: {
    /** "Preciso ter empresa para revender?" */
    requiresCompany: null as string | null,
  },

  // Foto real da placa: veja src/components/landing/product-photo.ts
  // (enquanto não houver foto, a página mostra uma ILUSTRAÇÃO identificada).
} as const;

// ---------------------------------------------------------------------------
// Utilidades (não precisa editar)
// ---------------------------------------------------------------------------

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export function formatCents(cents: number): string {
  return brl.format(cents / 100);
}

export interface CtaTarget {
  href: string;
  external: boolean;
  /** true quando nenhum contato foi configurado ainda. */
  unconfigured: boolean;
}

/** Destino dos botões de contato, conforme a configuração acima. */
export function contactTarget(): CtaTarget {
  const { whatsappNumber, whatsappMessage, formUrl, email } = LANDING_CONFIG.contact;
  const digits = (whatsappNumber ?? "").replace(/\D/g, "");
  if (digits.length >= 10) return { href: `https://wa.me/${digits}?text=${encodeURIComponent(whatsappMessage)}`, external: true, unconfigured: false };
  if (formUrl && /^https:\/\//.test(formUrl)) return { href: formUrl, external: true, unconfigured: false };
  if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { href: `mailto:${email}?subject=${encodeURIComponent("Revenda DirectPlaca")}`, external: true, unconfigured: false };
  return { href: "#contato", external: false, unconfigured: true };
}

/** URL base do site para SEO (ou undefined). */
export function landingSiteUrl(): URL | undefined {
  const raw = LANDING_CONFIG.siteUrl ?? (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : null);
  if (!raw) return undefined;
  try {
    return new URL(raw);
  } catch {
    return undefined;
  }
}
