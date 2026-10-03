import { z } from "zod";

/**
 * ===========================================================================
 * CMS da landing de revendedores — ESQUEMA DO CONTEÚDO
 * ===========================================================================
 * O ADMIN edita CONTEÚDO (textos, preços, imagens, links, itens, ordem e
 * visibilidade). A estrutura visual, o grid e os componentes continuam no
 * código. Todo campo tem limite de tamanho e toda lista tem limite de itens,
 * para que conteúdo extremo não quebre o layout.
 *
 * Seguro para servidor e navegador (sem segredos, sem acesso a dados).
 * ===========================================================================
 */

export const LANDING_SCHEMA_VERSION = 1 as const;

/** Seções que podem ser reordenadas (o Hero fica sempre no topo; CTA final e rodapé, no fim). */
export const MIDDLE_SECTIONS = ["howItWorks", "product", "products", "platform", "directlab", "wholesale", "subscription", "why", "about", "faq"] as const;
export type MiddleSection = (typeof MIDDLE_SECTIONS)[number];
export const ALL_SECTIONS = ["hero", ...MIDDLE_SECTIONS, "finalCta"] as const;
export type SectionId = (typeof ALL_SECTIONS)[number];

/** Âncora (id HTML) de cada seção — a mesma da landing original. */
export const SECTION_ANCHOR: Record<SectionId, string> = {
  hero: "inicio",
  howItWorks: "como-funciona",
  product: "produto",
  products: "nossos-produtos",
  platform: "plataforma",
  directlab: "directlab",
  wholesale: "atacado",
  subscription: "mensalidade",
  why: "vantagens",
  about: "sobre",
  faq: "faq",
  finalCta: "contato",
};

export const SECTION_LABEL: Record<SectionId, string> = {
  hero: "Hero",
  howItWorks: "Como funciona",
  product: "Produto",
  products: "Nossos Produtos",
  platform: "Plataforma",
  directlab: "DirectLab",
  wholesale: "Atacado",
  subscription: "Mensalidade",
  why: "Por que revender",
  about: "Sobre nós",
  faq: "FAQ",
  finalCta: "CTA final",
};

/** Ícones permitidos (do design system). */
export const LANDING_ICONS = ["box", "dashboard", "tag", "qr", "nfc", "plate", "settings", "link", "layers", "revenue", "lab", "star", "customers", "chart", "lock", "help", "store", "accesses"] as const;
export type LandingIcon = (typeof LANDING_ICONS)[number];

/** Imagens que já vêm com o projeto (capturas reais da plataforma). */
export const BUILTIN_IMAGES = ["tela-dashboard", "tela-placas", "tela-clientes", "tela-directlab", "tela-avaliacao-google", "tela-directlink-publico"] as const;
export type BuiltinImage = (typeof BUILTIN_IMAGES)[number];

export const SOCIAL_NETWORKS = ["instagram", "whatsapp", "youtube", "facebook", "linkedin", "tiktok"] as const;

// ---------------------------------------------------------------------------
// Peças
// ---------------------------------------------------------------------------

const text = (max: number) => z.string().trim().max(max, `Use no máximo ${max} caracteres.`);
const required = (max: number) => text(max).min(1, "Campo obrigatório.");
const id = z.string().regex(/^[a-z0-9-]{1,40}$/, "Identificador inválido.");

/** https:// apenas (links externos). */
export const httpsUrl = z
  .string()
  .trim()
  .max(500)
  .refine((v) => {
    try {
      const u = new URL(v);
      return u.protocol === "https:" && !u.username && !u.password && u.hostname.includes(".");
    } catch {
      return false;
    }
  }, "Use um endereço completo começando com https://");

/** Link do rodapé: https://, caminho interno (/login) ou âncora (#faq). */
const footerUrl = z
  .string()
  .trim()
  .max(500)
  .refine((v) => /^\/[A-Za-z0-9/_-]*$/.test(v) || /^#[a-z0-9-]{1,40}$/.test(v) || httpsUrl.safeParse(v).success, "Use https://, um caminho como /login ou uma âncora como #faq.");

/** Imagem: capturas que vêm com o projeto ou arquivo enviado pelo ADMIN (Storage). */
export const imageRef = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("builtin"), key: z.enum(BUILTIN_IMAGES), alt: text(200) }),
  z.object({
    kind: z.literal("media"),
    mediaId: z.uuid(),
    path: z.string().regex(/^media\/[0-9a-f-]{36}\.(png|jpg|webp)$/),
    width: z.number().int().min(1).max(10000),
    height: z.number().int().min(1).max(10000),
    alt: text(200),
  }),
]);
export type ImageRef = z.infer<typeof imageRef>;

/** Destino de um botão. "contact" usa o canal de contato configurado (seção Contato). */
export const cta = z
  .object({
    label: required(60),
    action: z.enum(["contact", "whatsapp", "section", "url"]),
    section: z.enum(ALL_SECTIONS).optional(),
    url: z.string().trim().max(500).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.action === "section" && !v.section) ctx.addIssue({ code: "custom", message: "Escolha a seção de destino.", path: ["section"] });
    if (v.action === "url" && !httpsUrl.safeParse(v.url ?? "").success) ctx.addIssue({ code: "custom", message: "Use um endereço completo começando com https://", path: ["url"] });
  });
export type Cta = z.infer<typeof cta>;

const iconItem = z.object({ id, icon: z.enum(LANDING_ICONS), title: required(80), text: text(300), enabled: z.boolean() });
export type IconItem = z.infer<typeof iconItem>;

const sectionHead = { enabled: z.boolean(), eyebrow: text(60), title: required(160), text: text(600) };

// ---------------------------------------------------------------------------
// Documento
// ---------------------------------------------------------------------------

/**
 * Ordem das seções do meio. Documentos salvos antes de uma seção existir não
 * a têm na ordem: ela é incluída automaticamente ("products" logo depois de
 * "product"; outras, no fim). Repetição continua inválida.
 */
export function normalizeOrder(order: readonly MiddleSection[]): MiddleSection[] {
  const next = [...order];
  for (const id of MIDDLE_SECTIONS) {
    if (next.includes(id)) continue;
    const after = id === "products" ? next.indexOf("product") : -1;
    if (after >= 0) next.splice(after + 1, 0, id);
    else next.push(id);
  }
  return next;
}

/** Nossos Produtos: até 30 placas; a imagem é o essencial (título e descrição são opcionais). */
export const PRODUCTS_MAX = 30;
export const productsSectionSchema = z.object({
  enabled: z.boolean(),
  eyebrow: text(60),
  title: text(160),
  text: text(600),
  items: z
    .array(
      z.object({
        id,
        /** null = produto ainda sem imagem (não aparece na landing até ter uma). */
        image: imageRef.nullable(),
        title: text(80),
        text: text(200),
        enabled: z.boolean(),
      }),
    )
    .max(PRODUCTS_MAX, `No máximo ${PRODUCTS_MAX} produtos.`),
});
export type ProductsSection = z.infer<typeof productsSectionSchema>;
export const DEFAULT_PRODUCTS_SECTION: ProductsSection = {
  enabled: true,
  eyebrow: "Nossos produtos",
  title: "Conheça nossas placas",
  text: "Modelos desenvolvidos para diferentes negócios e aplicações.",
  items: [],
};

export const landingContentSchema = z.object({
  schemaVersion: z.literal(LANDING_SCHEMA_VERSION),
  /** Ordem das seções do meio (sem repetição; seções novas entram automaticamente). */
  order: z
    .array(z.enum(MIDDLE_SECTIONS))
    .max(MIDDLE_SECTIONS.length)
    .refine((v) => new Set(v).size === v.length, "Ordem inválida.")
    .transform(normalizeOrder),
  nav: z.array(z.object({ id, label: required(30), section: z.enum(ALL_SECTIONS), enabled: z.boolean() })).max(8),
  headerCta: z.object({ enabled: z.boolean(), cta }),
  hero: z.object({
    eyebrow: text(60),
    title: required(140),
    titleHighlight: text(140),
    text: text(600),
    primaryCta: cta,
    secondaryCta: cta.nullable(),
    bullets: z.array(text(60)).max(4),
    image: imageRef.nullable(),
    showPlate: z.boolean(),
  }),
  howItWorks: z.object({ ...sectionHead, steps: z.array(iconItem).min(1).max(6) }),
  product: z.object({ ...sectionHead, image: imageRef.nullable(), imageCaption: text(160), features: z.array(iconItem).max(8), cta: cta.nullable() }),
  /** Ausente em documentos salvos antes desta seção existir → padrão (sem produtos). */
  products: productsSectionSchema.default(() => structuredClone(DEFAULT_PRODUCTS_SECTION)),
  platform: z.object({
    ...sectionHead,
    screenshots: z.array(z.object({ id, image: imageRef, caption: text(160), enabled: z.boolean() })).max(6),
    note: text(200),
    cta: cta.nullable(),
  }),
  directlab: z.object({
    ...sectionHead,
    tools: z
      .array(z.object({ id, icon: z.enum(LANDING_ICONS), title: required(60), text: text(300), image: imageRef.nullable(), imageStyle: z.enum(["screen", "phone"]), cta: cta.nullable(), enabled: z.boolean() }))
      .max(6),
    hubImage: imageRef.nullable(),
    hubCaption: text(200),
  }),
  wholesale: z.object({
    ...sectionHead,
    badge: text(80),
    note: text(300),
    tiers: z
      .array(
        z.object({
          id,
          label: required(40),
          quantity: z.number().int().min(1).max(1_000_000),
          /** Centavos (inteiro). null = "Sob consulta". */
          unitPriceCents: z.number().int().min(0).max(100_000_000).nullable(),
          unitLabel: text(30),
          description: text(200),
          badge: text(30),
          highlight: z.boolean(),
          /** Condição personalizada (ex.: 100+): mostra o texto em vez do preço. */
          custom: z.boolean(),
          customTitle: text(60),
          ctaLabel: required(40),
          enabled: z.boolean(),
        }),
      )
      .min(1)
      .max(6),
    priceOnRequest: required(40),
    priceOnRequestHint: text(120),
  }),
  subscription: z.object({
    ...sectionHead,
    coversTitle: text(80),
    covers: z.array(required(60)).max(10),
    transparency: text(300),
    planName: required(60),
    /** Centavos (inteiro). null = mostra o texto de "valor informado antes da compra". */
    monthlyPriceCents: z.number().int().min(0).max(100_000_000).nullable(),
    periodLabel: text(20),
    priceNullTitle: required(60),
    priceNullText: text(160),
    firstPeriod: z.object({ enabled: z.boolean(), amount: z.number().int().min(1).max(365), unit: z.enum(["dias", "meses"]), text: text(160) }),
    features: z.array(required(60)).max(14),
    ctaLabel: required(40),
  }),
  why: z.object({ ...sectionHead, items: z.array(iconItem).min(1).max(9) }),
  about: z.object({ ...sectionHead, image: imageRef.nullable() }),
  faq: z.object({ ...sectionHead, items: z.array(z.object({ id, q: required(160), a: required(1200), enabled: z.boolean() })).max(40) }),
  finalCta: z.object({ ...sectionHead, primaryCta: cta, secondaryCta: cta.nullable() }),
  contact: z.object({
    /** Só dígitos com DDI e DDD (ex.: 5511999998888). Vazio = sem WhatsApp. */
    whatsappNumber: z.string().trim().regex(/^(\d{10,15})?$/, "Use só números, com DDI e DDD (ex.: 5511999998888)."),
    whatsappMessage: text(300),
    email: z.union([z.literal(""), z.email("E-mail inválido.").max(120)]),
    formUrl: z.union([z.literal(""), httpsUrl]),
    /** Canal preferido; "auto" = WhatsApp → formulário → e-mail. */
    preferred: z.enum(["auto", "whatsapp", "form", "email"]),
  }),
  footer: z.object({
    text: text(300),
    copyright: text(120),
    links: z.array(z.object({ id, label: required(40), url: footerUrl, enabled: z.boolean() })).max(8),
    socials: z.array(z.object({ id, network: z.enum(SOCIAL_NETWORKS), url: httpsUrl, enabled: z.boolean() })).max(8),
  }),
  seo: z.object({
    title: text(70),
    description: text(200),
    /** Domínio público (https://…). Vazio = domínio de produção da Vercel, se houver. */
    siteUrl: z.union([z.literal(""), httpsUrl]),
    ogTitle: text(90),
    ogDescription: text(200),
    ogImage: imageRef.nullable(),
    index: z.boolean(),
  }),
});

export type LandingContent = z.infer<typeof landingContentSchema>;

/** Valida e devolve o conteúdo, ou as mensagens de erro (com o caminho do campo). */
export function validateLandingContent(value: unknown): { ok: true; content: LandingContent } | { ok: false; errors: { path: string; message: string }[] } {
  const parsed = landingContentSchema.safeParse(value);
  if (parsed.success) return { ok: true, content: parsed.data };
  return { ok: false, errors: parsed.error.issues.slice(0, 20).map((i) => ({ path: i.path.join("."), message: i.message })) };
}

/** Mídias enviadas que o documento usa (para impedir apagar imagem em uso). */
export function mediaPathsIn(content: unknown): string[] {
  const found = new Set<string>();
  const walk = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      if (o.kind === "media" && typeof o.path === "string") found.add(o.path);
      Object.values(o).forEach(walk);
    }
  };
  walk(content);
  return [...found];
}
