import type { LandingContent, SectionId } from "./schema";

/** Produtos que aparecem no carrossel: ativos E com imagem (a imagem é o essencial de cada placa). */
export function visibleProducts(content: LandingContent) {
  return content.products.items.filter((p) => p.enabled && p.image);
}

/** A seção aparece na landing? (seção oculta/vazia não é renderizada nem aparece no menu). */
export function isSectionVisible(content: LandingContent, section: SectionId): boolean {
  if (section === "hero") return true;
  if (section === "faq") return content.faq.enabled && content.faq.items.some((i) => i.enabled);
  if (section === "products") return content.products.enabled && visibleProducts(content).length > 0;
  return content[section].enabled;
}
