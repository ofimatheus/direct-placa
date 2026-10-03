import type { Metadata } from "next";
import { landingMediaUrl } from "./contact";
import type { LandingContent } from "./schema";

/** Metadados de SEO da landing a partir do conteúdo (com padrões quando um campo está vazio). */
export function landingMetadata(content: LandingContent, origin: string | null, mediaBase: string): Metadata {
  const seo = content.seo;
  const title = seo.title || "DirectPlaca | Placas inteligentes para revendedores";
  const description = seo.description || content.hero.text;
  const ogTitle = seo.ogTitle || title;
  const ogDescription = seo.ogDescription || description;
  const ogImage = seo.ogImage
    ? seo.ogImage.kind === "media"
      ? [{ url: landingMediaUrl(mediaBase, seo.ogImage.path), width: seo.ogImage.width, height: seo.ogImage.height, alt: seo.ogImage.alt }]
      : undefined
    : undefined;
  return {
    ...(origin ? { metadataBase: new URL(origin) } : {}),
    title: { absolute: title },
    description,
    alternates: { canonical: "/revendedores" },
    // O restante do site (painel) é noindex no layout raiz; esta página segue a escolha do ADMIN.
    robots: seo.index ? { index: true, follow: true } : { index: false, follow: false },
    openGraph: {
      type: "website",
      locale: "pt_BR",
      siteName: "DirectPlaca",
      url: "/revendedores",
      title: ogTitle,
      description: ogDescription,
      ...(ogImage ? { images: ogImage } : {}),
    },
    twitter: { card: "summary_large_image", title: ogTitle, description: ogDescription, ...(ogImage ? { images: ogImage.map((i) => i.url) } : {}) },
  };
}
