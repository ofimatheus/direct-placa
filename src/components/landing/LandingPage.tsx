import Image from "next/image";
import Link from "next/link";
import { BRAND_LOGO_SRC, BrandLogo } from "@/components/shell/BrandLogo";
import { Icon } from "@/components/ui/icons";
import { formatCents } from "@/config/landing-config";
import { ctaTarget, landingMediaUrl, type LinkTarget } from "@/lib/landing/contact";
import { SECTION_ANCHOR, type Cta, type ImageRef, type LandingContent, type MiddleSection, type SectionId } from "@/lib/landing/schema";
import { isSectionVisible, visibleProducts } from "@/lib/landing/visibility";
import { BUILTIN_IMAGE_DATA } from "./builtin-images";
import { ProductsCarousel, type CarouselProduct } from "./ProductsCarousel";
import { PlateIllustration } from "./PlateIllustration";
import { productPhoto } from "./product-photo";

/**
 * Landing pública de revendedores, desenhada a partir do CONTEÚDO do CMS
 * (Admin > Landing Page). A estrutura visual é do código; o ADMIN só muda
 * conteúdo, imagens, itens, ordem e visibilidade. Server Component.
 */

interface Ctx {
  content: LandingContent;
  mediaBase: string;
}

/* ------------------------------------------------------------------ */
/* Peças                                                               */
/* ------------------------------------------------------------------ */

function Check() {
  return (
    <svg viewBox="0 0 24 24" className="mt-0.5 size-4 shrink-0 text-mat" fill="none" stroke="currentColor" strokeWidth={2.4} aria-hidden>
      <path d="m5 12 4.5 4.5L19 7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function TargetLink({ target, className, children, contactCta = true }: { target: LinkTarget; className: string; children: React.ReactNode; contactCta?: boolean }) {
  return (
    <a
      href={target.href}
      {...(target.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      className={className}
      {...(contactCta ? { "data-landing-cta": "" } : {})}
      data-cta-configured={target.href === "#contato" ? "false" : "true"}
    >
      {children}
    </a>
  );
}

const BUTTON = {
  primary: "bg-mat text-white hover:bg-[#0a57c4] shadow-[0_10px_24px_rgb(11_99_222/0.28)]",
  light: "bg-white text-navy hover:bg-[#eef4fd]",
  ghost: "border border-white/25 text-white hover:bg-white/10",
  outline: "border border-line text-ink hover:bg-paper",
};

function CtaButton({
  cta: original,
  ctx,
  variant = "primary",
  className = "",
  truncate = false,
  required = false,
}: {
  cta: Cta;
  ctx: Ctx;
  variant?: keyof typeof BUTTON;
  className?: string;
  truncate?: boolean;
  /** Botão principal: se a seção de destino estiver oculta, leva ao contato (opcional: não aparece). */
  required?: boolean;
}) {
  let cta = original;
  if (cta.action === "section" && cta.section && !isSectionVisible(ctx.content, cta.section)) {
    if (!required) return null;
    cta = { label: cta.label, action: "contact" };
  }
  // Só botões de contato recebem data-landing-cta (os de âncora/URL não).
  const isContact = cta.action === "contact" || cta.action === "whatsapp";
  return (
    <TargetLink target={ctaTarget(cta, ctx.content.contact)} className={`landing-btn ${BUTTON[variant]} ${className}`} contactCta={isContact}>
      {truncate ? <span className="min-w-0 truncate">{cta.label}</span> : <span className="landing-wrap">{cta.label}</span>}
    </TargetLink>
  );
}

function Eyebrow({ children, dark = false }: { children: React.ReactNode; dark?: boolean }) {
  if (!children) return null;
  return <p className={`text-xs font-bold tracking-[0.16em] uppercase ${dark ? "text-[#7fb2ff]" : "text-mat"}`}>{children}</p>;
}

function SectionHeading({ eyebrow, title, text, center = false }: { eyebrow: string; title: string; text?: string; center?: boolean }) {
  return (
    <div className={center ? "mx-auto max-w-2xl text-center" : "max-w-2xl"}>
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2 className={`landing-h2 landing-wrap ${eyebrow ? "mt-3" : ""}`}>{title}</h2>
      {text && <p className="landing-wrap mt-4 text-[1.05rem] leading-relaxed text-ink-soft">{text}</p>}
    </div>
  );
}

/** Imagem do CMS: captura que vem com o projeto (next/image) ou arquivo enviado (Storage). */
function LandingImage({ image, ctx, sizes, priority = false, className = "block h-auto w-full" }: { image: ImageRef; ctx: Ctx; sizes: string; priority?: boolean; className?: string }) {
  if (image.kind === "builtin") {
    return <Image src={BUILTIN_IMAGE_DATA[image.key]} alt={image.alt} sizes={sizes} priority={priority} placeholder="blur" className={className} />;
  }
  return (
    // Imagem enviada pelo ADMIN (bucket público landing-assets): tamanho real informado evita salto de layout.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={landingMediaUrl(ctx.mediaBase, image.path)} alt={image.alt} width={image.width} height={image.height} loading={priority ? "eager" : "lazy"} decoding="async" className={className} />
  );
}

function ScreenFrame({ image, ctx, priority = false, sizes, className = "" }: { image: ImageRef; ctx: Ctx; priority?: boolean; sizes: string; className?: string }) {
  return (
    <div className={`landing-frame ${className}`}>
      <div className="landing-frame-bar" aria-hidden>
        <span />
        <span />
        <span />
      </div>
      <LandingImage image={image} ctx={ctx} sizes={sizes} priority={priority} />
    </div>
  );
}

function PhoneFrame({ image, ctx, className = "" }: { image: ImageRef; ctx: Ctx; className?: string }) {
  return (
    <div className={`landing-phone ${className}`}>
      <LandingImage image={image} ctx={ctx} sizes="(min-width: 1024px) 260px, 60vw" />
    </div>
  );
}

/** Placa: imagem do CMS → foto do projeto (product-photo.ts) → ilustração identificada. */
async function ProductVisual({ ctx, className = "" }: { ctx: Ctx; className?: string }) {
  const image = ctx.content.product.image;
  if (image) return <LandingImage image={image} ctx={ctx} sizes="(min-width: 1024px) 420px, 80vw" className={`h-auto w-full rounded-2xl ${className}`} />;
  if (productPhoto) return <Image src={productPhoto} alt="Placa DirectPlaca" sizes="(min-width: 1024px) 420px, 80vw" placeholder="blur" className={`h-auto w-full rounded-2xl ${className}`} />;
  return <PlateIllustration className={className} />;
}

/** Colunas no desktop conforme a quantidade de cards (não deixa buracos nem cards espremidos). */
const LG_COLS: Record<number, string> = { 1: "lg:grid-cols-1", 2: "lg:grid-cols-2", 3: "lg:grid-cols-3", 4: "lg:grid-cols-4", 5: "lg:grid-cols-3", 6: "lg:grid-cols-3" };
const lgCols = (n: number) => LG_COLS[Math.min(Math.max(n, 1), 6)] ?? "lg:grid-cols-3";
const singleWidth = (n: number) => (n === 1 ? "mx-auto max-w-sm" : "");

/* ------------------------------------------------------------------ */
/* Seções                                                              */
/* ------------------------------------------------------------------ */

function Hero({ ctx }: { ctx: Ctx }) {
  const h = ctx.content.hero;
  return (
    <section id={SECTION_ANCHOR.hero} className="landing-hero relative overflow-hidden bg-navy text-white">
      <div className={`landing-container relative grid items-center gap-12 pt-8 pb-14 sm:py-20 lg:gap-10 lg:py-24 ${h.image ? "lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]" : ""}`}>
        <div className={`landing-rise ${h.image ? "" : "max-w-3xl"}`}>
          <Eyebrow dark>{h.eyebrow}</Eyebrow>
          <h1 className={`landing-h1 landing-wrap ${h.eyebrow ? "mt-4" : ""}`}>
            {h.title}
            {h.titleHighlight && <span className="block text-[#8fbcff]">{h.titleHighlight}</span>}
          </h1>
          {h.text && <p className="landing-wrap mt-5 max-w-xl text-[1.08rem] leading-relaxed text-white/75">{h.text}</p>}
          <div className="mt-7 flex flex-col gap-3 sm:mt-8 sm:flex-row">
            <CtaButton cta={h.primaryCta} ctx={ctx} required />
            {h.secondaryCta && <CtaButton cta={h.secondaryCta} ctx={ctx} variant="ghost" />}
          </div>
          {h.bullets.length > 0 && (
            <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-white/70">
              {h.bullets.map((t, i) => (
                <li key={`${i}-${t}`} className="flex items-center gap-2">
                  <span className="size-1.5 shrink-0 rounded-full bg-[#4f9bff]" aria-hidden />
                  {t}
                </li>
              ))}
            </ul>
          )}
        </div>
        {h.image && (
          <div className="landing-rise landing-rise-2 relative mx-auto w-full max-w-[640px] lg:mx-0">
            <ScreenFrame image={h.image} ctx={ctx} priority sizes="(min-width: 1024px) 560px, 92vw" />
            {h.showPlate && (
              <div className="absolute -bottom-8 -left-3 w-[34%] max-w-[190px] sm:-left-6 lg:-left-10">
                <ProductVisual ctx={ctx} />
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function HowItWorks({ ctx, tone }: { ctx: Ctx; tone: string }) {
  const s = ctx.content.howItWorks;
  const steps = s.steps.filter((x) => x.enabled);
  return (
    <section id={SECTION_ANCHOR.howItWorks} className={`landing-section ${tone}`}>
      <div className="landing-container">
        <SectionHeading eyebrow={s.eyebrow} title={s.title} text={s.text} center />
        {steps.length > 0 && (
          <ol className={`mt-12 grid gap-4 sm:grid-cols-2 ${lgCols(steps.length)} ${singleWidth(steps.length)}`}>
            {steps.map((step, i) => (
              <li key={step.id} className="landing-card relative">
                <span className="text-xs font-bold text-mat tabular-nums">{String(i + 1).padStart(2, "0")}</span>
                <span className="landing-icon mt-3">
                  <Icon name={step.icon} className="size-5" />
                </span>
                <h3 className="landing-wrap mt-4 text-lg font-bold">{step.title}</h3>
                {step.text && <p className="landing-wrap mt-1.5 text-[0.95rem] leading-relaxed text-ink-soft">{step.text}</p>}
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}

function Product({ ctx, tone }: { ctx: Ctx; tone: string }) {
  const s = ctx.content.product;
  const features = s.features.filter((f) => f.enabled);
  const showCaption = s.imageCaption && !s.image && !productPhoto;
  return (
    <section id={SECTION_ANCHOR.product} className={`landing-section ${tone}`}>
      <div className="landing-container grid items-center gap-12 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <div className="mx-auto w-full max-w-[250px] sm:max-w-[320px]">
          <ProductVisual ctx={ctx} />
          {showCaption && <p className="mt-4 text-center text-xs text-ink-soft">{s.imageCaption}</p>}
          {s.image && s.imageCaption && <p className="mt-4 text-center text-xs text-ink-soft">{s.imageCaption}</p>}
        </div>
        <div className="min-w-0">
          <SectionHeading eyebrow={s.eyebrow} title={s.title} text={s.text} />
          {features.length > 0 && (
            <ul className="mt-8 grid gap-x-6 gap-y-5 sm:grid-cols-2">
              {features.map((f) => (
                <li key={f.id} className="flex min-w-0 gap-3.5">
                  <span className="landing-icon landing-icon-sm">
                    <Icon name={f.icon} className="size-[18px]" />
                  </span>
                  <div className="min-w-0">
                    <h3 className="landing-wrap font-bold">{f.title}</h3>
                    {f.text && <p className="landing-wrap mt-0.5 text-sm leading-relaxed text-ink-soft">{f.text}</p>}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {s.cta && <CtaButton cta={s.cta} ctx={ctx} className="mt-8" />}
        </div>
      </div>
    </section>
  );
}

function Products({ ctx, tone }: { ctx: Ctx; tone: string }) {
  const s = ctx.content.products;
  const items: CarouselProduct[] = visibleProducts(ctx.content).map((p) => {
    const img = p.image!;
    const data = img.kind === "builtin" ? BUILTIN_IMAGE_DATA[img.key] : null;
    return {
      id: p.id,
      src: data ? data.src : landingMediaUrl(ctx.mediaBase, (img as { path: string }).path),
      width: data ? data.width : (img as { width: number }).width,
      height: data ? data.height : (img as { height: number }).height,
      alt: img.alt || p.title || "Placa DirectPlaca",
      title: p.title,
      text: p.text,
    };
  });
  if (items.length === 0) return null;
  const hasHead = Boolean(s.eyebrow || s.title || s.text);
  return (
    <section id={SECTION_ANCHOR.products} className={`landing-section ${tone}`}>
      <div className="landing-container">
        {hasHead && (
          <div className="mx-auto max-w-2xl text-center">
            <Eyebrow>{s.eyebrow}</Eyebrow>
            {s.title && <h2 className={`landing-h2 landing-wrap ${s.eyebrow ? "mt-3" : ""}`}>{s.title}</h2>}
            {s.text && <p className={`landing-wrap text-[1.05rem] leading-relaxed text-ink-soft ${s.eyebrow || s.title ? "mt-4" : ""}`}>{s.text}</p>}
          </div>
        )}
        <div className={hasHead ? "mt-12" : ""}>
          <ProductsCarousel items={items} label={s.title || "Nossos produtos"} />
        </div>
      </div>
    </section>
  );
}

function Platform({ ctx, tone }: { ctx: Ctx; tone: string }) {
  const s = ctx.content.platform;
  const shots = s.screenshots.filter((x) => x.enabled);
  const [first, ...rest] = shots;
  const sideBySide = rest.length > 0 && rest.length <= 2;
  return (
    <section id={SECTION_ANCHOR.platform} className={`landing-section ${tone}`}>
      <div className="landing-container">
        <SectionHeading eyebrow={s.eyebrow} title={s.title} text={s.text} center />
        {first && (
          <div className={`mt-12 grid gap-5 ${sideBySide ? "lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]" : ""}`}>
            <figure className={rest.length === 0 ? "mx-auto w-full max-w-4xl" : ""}>
              <ScreenFrame image={first.image} ctx={ctx} sizes="(min-width: 1024px) 720px, 92vw" />
              {first.caption && <figcaption className="landing-caption landing-wrap">{first.caption}</figcaption>}
            </figure>
            {rest.length > 0 && (
              <div className={`grid gap-5 sm:grid-cols-2 ${sideBySide ? "lg:grid-cols-1" : "lg:grid-cols-3"}`}>
                {rest.map((shot) => (
                  <figure key={shot.id}>
                    <ScreenFrame image={shot.image} ctx={ctx} sizes="(min-width: 1024px) 440px, (min-width: 640px) 46vw, 92vw" />
                    {shot.caption && <figcaption className="landing-caption landing-wrap">{shot.caption}</figcaption>}
                  </figure>
                ))}
              </div>
            )}
          </div>
        )}
        {s.note && <p className="mt-6 text-center text-xs text-ink-soft">{s.note}</p>}
        {s.cta && (
          <div className="mt-8 flex justify-center">
            <CtaButton cta={s.cta} ctx={ctx} />
          </div>
        )}
      </div>
    </section>
  );
}

function DirectLab({ ctx, tone }: { ctx: Ctx; tone: string }) {
  const s = ctx.content.directlab;
  const tools = s.tools.filter((t) => t.enabled);
  return (
    <section id={SECTION_ANCHOR.directlab} className={`landing-section ${tone}`}>
      <div className="landing-container">
        <SectionHeading eyebrow={s.eyebrow} title={s.title} text={s.text} />
        {tools.length > 0 && (
          <div className={`mt-10 grid gap-5 ${tools.length > 1 ? "lg:grid-cols-2" : ""}`}>
            {tools.map((tool) => (
              <article key={tool.id} className="landing-card flex min-w-0 flex-col overflow-hidden p-0">
                <div className="p-6 sm:p-7">
                  <span className="landing-icon">
                    <Icon name={tool.icon} className="size-5" />
                  </span>
                  <h3 className="landing-wrap mt-4 text-xl font-bold">{tool.title}</h3>
                  {tool.text && <p className="landing-wrap mt-1.5 leading-relaxed text-ink-soft">{tool.text}</p>}
                  {tool.cta && <CtaButton cta={tool.cta} ctx={ctx} variant="outline" className="landing-btn-sm mt-5" />}
                </div>
                {tool.image &&
                  (tool.imageStyle === "phone" ? (
                    <div className="mt-auto flex justify-center overflow-hidden px-6 sm:px-7">
                      <PhoneFrame image={tool.image} ctx={ctx} className="landing-phone-peek w-[62%] max-w-[260px]" />
                    </div>
                  ) : (
                    <div className="mt-auto px-6 sm:px-7">
                      <ScreenFrame image={tool.image} ctx={ctx} sizes="(min-width: 1024px) 520px, 88vw" className="rounded-b-none" />
                    </div>
                  ))}
              </article>
            ))}
          </div>
        )}
        {s.hubImage && (
          <figure className="mt-5">
            <ScreenFrame image={s.hubImage} ctx={ctx} sizes="(min-width: 1024px) 1100px, 92vw" />
            {s.hubCaption && <figcaption className="landing-caption landing-wrap">{s.hubCaption}</figcaption>}
          </figure>
        )}
      </div>
    </section>
  );
}

function Wholesale({ ctx, tone }: { ctx: Ctx; tone: string }) {
  const s = ctx.content.wholesale;
  const tiers = s.tiers.filter((t) => t.enabled);
  return (
    <section id={SECTION_ANCHOR.wholesale} className={`landing-section ${tone}`}>
      <div className="landing-container">
        <div className="flex flex-col items-start justify-between gap-6 md:flex-row md:items-end">
          <SectionHeading eyebrow={s.eyebrow} title={s.title} text={s.text} />
          {s.badge && <p className="landing-pill landing-wrap shrink-0">{s.badge}</p>}
        </div>
        {tiers.length > 0 && (
          <ul className={`mt-10 grid gap-4 sm:grid-cols-2 ${lgCols(tiers.length)} ${singleWidth(tiers.length)}`} data-landing-tiers="">
            {tiers.map((tier) => {
              const dark = tier.custom;
              return (
                <li key={tier.id} className={`landing-card relative flex min-w-0 flex-col ${dark ? "bg-navy text-white" : ""} ${tier.highlight && !dark ? "border-mat shadow-[0_18px_40px_rgb(11_99_222/0.14)]" : ""}`} data-tier={tier.quantity}>
                  {tier.badge && <span className={`landing-tier-badge ${dark ? "bg-white text-navy" : "bg-mat text-white"}`}>{tier.badge}</span>}
                  <p className={`landing-wrap text-xs font-bold tracking-[0.14em] uppercase ${dark ? "text-[#8fbcff]" : "text-mat"}`}>{tier.label}</p>
                  {tier.custom ? (
                    <p className="landing-wrap mt-4 text-2xl font-bold">{tier.customTitle || s.priceOnRequest}</p>
                  ) : tier.unitPriceCents !== null ? (
                    <>
                      <p className="mt-4 text-[2rem] leading-none font-extrabold tracking-tight break-words tabular-nums">{formatCents(tier.unitPriceCents)}</p>
                      {tier.unitLabel && <p className="mt-1.5 text-sm text-ink-soft">{tier.unitLabel}</p>}
                    </>
                  ) : (
                    <>
                      <p className="landing-wrap mt-4 text-2xl font-bold text-ink">{s.priceOnRequest}</p>
                      {s.priceOnRequestHint && <p className="landing-wrap mt-1.5 text-sm text-ink-soft">{s.priceOnRequestHint}</p>}
                    </>
                  )}
                  {tier.description && <p className={`landing-wrap mt-1.5 text-sm ${dark ? "text-white/70" : "text-ink-soft"}`}>{tier.description}</p>}
                  <div className="mt-auto pt-6">
                    <CtaButton cta={{ label: tier.ctaLabel, action: "contact" }} ctx={ctx} variant={dark ? "light" : "primary"} className="landing-btn-sm w-full" />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {s.note && <p className="landing-wrap mt-6 text-sm text-ink-soft">{s.note}</p>}
      </div>
    </section>
  );
}

function Subscription({ ctx, tone }: { ctx: Ctx; tone: string }) {
  const s = ctx.content.subscription;
  return (
    <section id={SECTION_ANCHOR.subscription} className={`landing-section ${tone}`}>
      <div className="landing-container grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          <SectionHeading eyebrow={s.eyebrow} title={s.title} text={s.text} />
          {s.covers.length > 0 && (
            <>
              {s.coversTitle && <p className="mt-6 font-semibold">{s.coversTitle}</p>}
              <ul className="mt-3 grid gap-2.5 sm:grid-cols-2">
                {s.covers.map((t, i) => (
                  <li key={`${i}-${t}`} className="landing-wrap flex gap-2.5 text-[0.95rem]">
                    <Check />
                    {t}
                  </li>
                ))}
              </ul>
            </>
          )}
          {s.transparency && (
            <p className="landing-wrap mt-6 rounded-xl border border-line bg-white px-5 py-4 text-sm leading-relaxed">
              <strong>Transparência:</strong> {s.transparency}
            </p>
          )}
        </div>
        <div className="landing-card landing-price-card min-w-0 p-7 sm:p-8" data-landing-plan="">
          <p className="landing-wrap text-sm font-bold">{s.planName}</p>
          {s.monthlyPriceCents !== null ? (
            <p className="mt-3 flex flex-wrap items-baseline gap-1.5">
              <span className="text-[2.6rem] leading-none font-extrabold tracking-tight tabular-nums">{formatCents(s.monthlyPriceCents)}</span>
              {s.periodLabel && <span className="text-ink-soft">{s.periodLabel}</span>}
            </p>
          ) : (
            <p className="mt-3">
              <span className="landing-wrap text-2xl font-bold">{s.priceNullTitle}</span>
              {s.priceNullText && <span className="landing-wrap mt-1 block text-sm text-ink-soft">{s.priceNullText}</span>}
            </p>
          )}
          {s.firstPeriod.enabled && s.firstPeriod.text && (
            <p className="landing-pill landing-wrap mt-4" data-landing-first-period="">
              {s.firstPeriod.text}
            </p>
          )}
          {s.features.length > 0 && (
            <ul className="mt-6 grid gap-2.5 border-t border-line pt-6">
              {s.features.map((f, i) => (
                <li key={`${i}-${f}`} className="landing-wrap flex gap-2.5 text-[0.95rem]">
                  <Check />
                  {f}
                </li>
              ))}
            </ul>
          )}
          <CtaButton cta={{ label: s.ctaLabel, action: "contact" }} ctx={ctx} className="mt-7 w-full" />
        </div>
      </div>
    </section>
  );
}

function Why({ ctx, tone }: { ctx: Ctx; tone: string }) {
  const s = ctx.content.why;
  const items = s.items.filter((x) => x.enabled);
  return (
    <section id={SECTION_ANCHOR.why} className={`landing-section ${tone}`}>
      <div className="landing-container">
        <SectionHeading eyebrow={s.eyebrow} title={s.title} text={s.text} center />
        {items.length > 0 && (
          <ul className={`mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 ${singleWidth(items.length)}`}>
            {items.map((w) => (
              <li key={w.id} className="landing-card flex min-w-0 gap-4">
                <span className="landing-icon landing-icon-sm">
                  <Icon name={w.icon} className="size-[18px]" />
                </span>
                <div className="min-w-0">
                  <h3 className="landing-wrap font-bold">{w.title}</h3>
                  {w.text && <p className="landing-wrap mt-1 text-sm leading-relaxed text-ink-soft">{w.text}</p>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function About({ ctx, tone }: { ctx: Ctx; tone: string }) {
  const s = ctx.content.about;
  return (
    <section id={SECTION_ANCHOR.about} className={`landing-section ${tone}`}>
      <div className={`landing-container ${s.image ? "grid items-center gap-10 lg:grid-cols-2" : "max-w-3xl text-center"}`}>
        <div className="min-w-0">
          <Eyebrow>{s.eyebrow}</Eyebrow>
          <h2 className={`landing-h2 landing-wrap ${s.eyebrow ? "mt-3" : ""}`}>{s.title}</h2>
          {s.text && <p className="landing-wrap mt-5 text-[1.05rem] leading-relaxed whitespace-pre-line text-ink-soft">{s.text}</p>}
        </div>
        {s.image && <LandingImage image={s.image} ctx={ctx} sizes="(min-width: 1024px) 560px, 92vw" className="h-auto w-full rounded-2xl" />}
      </div>
    </section>
  );
}

function Faq({ ctx, tone }: { ctx: Ctx; tone: string }) {
  const s = ctx.content.faq;
  const items = s.items.filter((x) => x.enabled);
  if (items.length === 0) return null;
  return (
    <section id={SECTION_ANCHOR.faq} className={`landing-section ${tone}`}>
      <div className="landing-container max-w-3xl">
        <SectionHeading eyebrow={s.eyebrow} title={s.title} text={s.text} center />
        <div className="mt-10 divide-y divide-line rounded-2xl border border-line bg-white" data-landing-faq="">
          {items.map((item) => (
            <details key={item.id} className="landing-faq group">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 font-semibold sm:px-6">
                <span className="landing-wrap min-w-0">{item.q}</span>
                <span className="landing-faq-icon" aria-hidden>
                  <Icon name="chevron-down" className="size-4" />
                </span>
              </summary>
              <p className="landing-wrap px-5 pb-5 leading-relaxed whitespace-pre-line text-ink-soft sm:px-6">{item.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

function FinalCta({ ctx, showConfigHint }: { ctx: Ctx; showConfigHint: boolean }) {
  const s = ctx.content.finalCta;
  return (
    <section id={SECTION_ANCHOR.finalCta} className="landing-hero relative overflow-hidden bg-navy text-white">
      <div className="landing-container relative py-16 text-center sm:py-20">
        <Eyebrow dark>{s.eyebrow}</Eyebrow>
        <h2 className={`landing-h2 landing-wrap text-white ${s.eyebrow ? "mt-3" : ""}`}>{s.title}</h2>
        {s.text && <p className="landing-wrap mx-auto mt-4 max-w-xl text-[1.05rem] text-white/75">{s.text}</p>}
        <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          <CtaButton cta={s.primaryCta} ctx={ctx} required />
          {s.secondaryCta && <CtaButton cta={s.secondaryCta} ctx={ctx} variant="ghost" />}
        </div>
        {showConfigHint && (
          <p className="mx-auto mt-6 max-w-md rounded-lg border border-dashed border-[#ffd166]/60 px-4 py-2 text-xs text-[#ffd166]" data-landing-config-hint="">
            Configure o WhatsApp, formulário ou e-mail em Admin › Landing Page › Contato (aviso visível só em desenvolvimento e na pré-visualização).
          </p>
        )}
      </div>
    </section>
  );
}

const SOCIAL_LABEL: Record<string, string> = { instagram: "Instagram", whatsapp: "WhatsApp", youtube: "YouTube", facebook: "Facebook", linkedin: "LinkedIn", tiktok: "TikTok" };

/* ------------------------------------------------------------------ */
/* Página                                                              */
/* ------------------------------------------------------------------ */

const MIDDLE: Record<MiddleSection, (p: { ctx: Ctx; tone: string }) => React.ReactNode> = {
  howItWorks: HowItWorks,
  product: Product,
  products: Products,
  platform: Platform,
  directlab: DirectLab,
  wholesale: Wholesale,
  subscription: Subscription,
  why: Why,
  about: About,
  faq: Faq,
};

export { isSectionVisible } from "@/lib/landing/visibility";

export async function LandingPage({ content, mediaBase, preview = null }: { content: LandingContent; mediaBase: string; preview?: { publishedAt: string | null } | null }) {
  const ctx: Ctx = { content, mediaBase };
  const showConfigHint = ctaTarget({ label: "x", action: "contact" }, content.contact).href === "#contato" && (process.env.NODE_ENV !== "production" || preview !== null);
  // Fundo alternado (branco / cinza) conforme a posição real, para seções vizinhas nunca terem o mesmo tom.
  // "Nossos Produtos" fica FORA da contagem e usa o tom da seção seguinte: assim, ligar ou desligar
  // a seção nunca muda as cores das outras seções.
  const visibleMiddle = content.order.filter((id) => isSectionVisible(content, id));
  const tones: Partial<Record<MiddleSection, string>> = {};
  visibleMiddle.filter((id) => id !== "products").forEach((id, i) => (tones[id] = i % 2 === 1 ? "bg-paper" : ""));
  const productsAt = visibleMiddle.indexOf("products");
  if (productsAt >= 0) {
    const prev = visibleMiddle.slice(0, productsAt).filter((id) => id !== "products").at(-1);
    tones.products = prev && tones[prev] === "bg-paper" ? "" : prev ? "bg-paper" : "";
  }
  const nav = content.nav.filter((n) => n.enabled && isSectionVisible(content, n.section));
  const year = String(new Date().getFullYear());
  const footerLinks = content.footer.links.filter((l) => l.enabled);
  const socials = content.footer.socials.filter((s) => s.enabled);

  return (
    <div className="landing">
      {preview && (
        <div className="bg-[#ffd166] px-4 py-2 text-center text-sm font-semibold text-navy" role="status" data-landing-preview="">
          Pré-visualização do RASCUNHO — este conteúdo ainda não está publicado.
        </div>
      )}
      {/* Navy sólido: o logo atual tem fundo navy (sem transparência) e precisa se fundir com o cabeçalho. */}
      <header className="sticky top-0 z-40 border-b border-white/10 bg-navy">
        <div className="landing-container flex h-16 items-center justify-between gap-4">
          <a href={`#${SECTION_ANCHOR.hero}`} className="shrink-0" aria-label="DirectPlaca — início">
            <BrandLogo className="h-[34px] w-auto" />
          </a>
          {nav.length > 0 && (
            // Conteúdo vem do CMS: itens longos ganham reticências e os que não couberem numa linha
            // deixam de aparecer no cabeçalho (a página continua navegável rolando), sem empurrar o layout.
            <nav className="landing-nav hidden min-w-0 flex-1 flex-wrap items-center justify-center gap-x-7 overflow-hidden lg:flex" aria-label="Seções">
              {nav.map((n) => (
                <a key={n.id} href={`#${SECTION_ANCHOR[n.section]}`} className="max-w-[9rem] truncate text-sm leading-[1.25rem] font-medium text-white/75 transition-colors hover:text-white">
                  {n.label}
                </a>
              ))}
            </nav>
          )}
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <Link href="/login" className="hidden shrink-0 text-sm font-semibold text-white/80 hover:text-white sm:inline">
              Entrar
            </Link>
            {content.headerCta.enabled && <CtaButton cta={content.headerCta.cta} ctx={ctx} className="landing-btn-sm min-w-0 max-w-[11rem]" truncate required />}
          </div>
        </div>
      </header>

      <main>
        <Hero ctx={ctx} />
        {visibleMiddle.map((id) => {
          const Section = MIDDLE[id];
          return <Section key={id} ctx={ctx} tone={tones[id] ?? ""} />;
        })}
        {isSectionVisible(content, "finalCta") && <FinalCta ctx={ctx} showConfigHint={showConfigHint} />}
      </main>

      <footer className="border-t border-white/10 bg-navy text-white/60">
        <div className="landing-container flex flex-col items-center justify-between gap-4 py-8 text-center text-sm sm:flex-row sm:text-left">
          <Image src={BRAND_LOGO_SRC} alt="DirectPlaca" width={250} height={68} className="h-[28px] w-auto shrink-0" />
          <p className="landing-wrap">
            {content.footer.copyright.replaceAll("{ano}", year)}
            {content.footer.text ? ` ${content.footer.text}` : ""}
          </p>
          {(footerLinks.length > 0 || socials.length > 0) && (
            <nav className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2" aria-label="Rodapé">
              {footerLinks.map((l) =>
                l.url.startsWith("/") ? (
                  <Link key={l.id} href={l.url} className="font-semibold text-white/80 hover:text-white">
                    {l.label}
                  </Link>
                ) : (
                  <a key={l.id} href={l.url} {...(l.url.startsWith("https://") ? { target: "_blank", rel: "noopener noreferrer" } : {})} className="font-semibold text-white/80 hover:text-white">
                    {l.label}
                  </a>
                ),
              )}
              {socials.map((s) => (
                <a key={s.id} href={s.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-white/80 hover:text-white" data-landing-social={s.network}>
                  {SOCIAL_LABEL[s.network]}
                </a>
              ))}
            </nav>
          )}
        </div>
      </footer>
    </div>
  );
}
