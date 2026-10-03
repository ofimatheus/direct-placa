/**
 * "Nossos Produtos" — editor do CMS e carrossel (happy-dom).
 *   npm run test:ui-landing-products
 */
import { Window } from "happy-dom";

const win = new Window({ url: "http://localhost/admin/landing" });
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLTextAreaElement", "HTMLSelectElement", "Node", "Event", "MouseEvent", "KeyboardEvent", "FocusEvent", "getComputedStyle"]) {
  const value = key === "window" ? win : (win as unknown as Record<string, unknown>)[key];
  if (value !== undefined) Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
}
Object.defineProperty(globalThis, "self", { value: win, configurable: true, writable: true });
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let failures = 0;
const ok = (l: string) => console.log(`OK ${l}`);
const check = (c: unknown, l: string, d?: unknown) => {
  if (!c) {
    failures++;
    console.log(`FALHA ${l}`, JSON.stringify(d ?? "").slice(0, 300));
  }
};

async function main() {
  const React = await import("react");
  const { act } = React;
  const { createRoot } = await import("react-dom/client");
  const { AppRouterContext } = await import("next/dist/shared/lib/app-router-context.shared-runtime");
  const { LandingEditor } = await import("@/components/landing-cms/LandingEditor");
  const { ProductsCarousel } = await import("@/components/landing/ProductsCarousel");
  const { defaultLandingContent } = await import("@/lib/landing/defaults");
  const { BUILTIN_IMAGES } = await import("@/lib/landing/schema");

  const bodies: { content: ReturnType<typeof defaultLandingContent> }[] = [];
  (globalThis as Record<string, unknown>).fetch = async (_u: string, init: RequestInit = {}) => {
    bodies.push(JSON.parse(String(init.body)));
    return new Response(JSON.stringify({ version: bodies.length }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const router = { push() {}, replace() {}, refresh() {}, back() {}, forward() {}, prefetch() {} };
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root = createRoot(container as unknown as Element);
  const mount = (node: React.ReactNode) =>
    act(async () => {
      root.unmount();
      root = createRoot(container as unknown as Element);
      root.render(<AppRouterContext.Provider value={router as never}>{node}</AppRouterContext.Provider>);
    });
  const q = <T,>(s: string) => container.querySelector(s) as unknown as T | null;
  const qa = <T,>(s: string) => [...container.querySelectorAll(s)] as unknown as T[];
  const click = (el: unknown) => act(async () => void (el as HTMLElement).dispatchEvent(new win.MouseEvent("click", { bubbles: true }) as unknown as Event));
  const button = (label: string, scope: ParentNode) => [...scope.querySelectorAll("button")].find((b) => b.textContent?.trim() === label) as HTMLButtonElement | undefined;
  const setValue = (el: unknown, v: string) =>
    act(async () => {
      const proto = (el as HTMLElement).tagName === "SELECT" ? win.HTMLSelectElement.prototype : win.HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, v);
      (el as HTMLElement).dispatchEvent(new win.Event((el as HTMLElement).tagName === "SELECT" ? "change" : "input", { bubbles: true }) as unknown as Event);
    });

  // ---------------- editor ----------------
  await mount(
    <LandingEditor
      installed
      initialContent={defaultLandingContent()}
      initialVersion={1}
      published={defaultLandingContent()}
      publishedAt="2026-10-01T21:32:00.000Z"
      publicUrl="https://www.exemplo.com.br/revendedores"
      mediaBase="https://p.supabase.co"
      media={[{ id: "33333333-3333-4333-8333-333333333333", path: "media/33333333-3333-4333-8333-333333333333.webp", mime: "image/webp", width: 800, height: 1200, bytes: 90000 }]}
      builtinThumbs={Object.fromEntries(BUILTIN_IMAGES.map((k) => [k, `/_next/static/media/${k}.webp`])) as never}
    />,
  );
  const cards = qa<HTMLElement>("[data-section-card]").map((d) => d.getAttribute("data-section-card"));
  check(cards.indexOf("products") === cards.indexOf("product") + 1 && cards.indexOf("platform") === cards.indexOf("products") + 1, "E1 posição", cards);
  const card = q<HTMLDetailsElement>("[data-section-card='products']")!;
  await act(async () => void card.setAttribute("open", ""));
  check(card.textContent?.includes("Nossos Produtos") && q("[data-testid='toggle-products']") && button("+ Adicionar produto", card), "E1 seção no CMS");
  ok("E1: 'Nossos Produtos' aparece em Admin › Landing Page › Conteúdo, entre Produto e Plataforma, com 'Exibir esta seção', ↑↓ e '+ Adicionar produto'");

  await click(button("+ Adicionar produto", card));
  await click(button("+ Adicionar produto", card));
  let items = qa<HTMLElement>("[data-section-card='products'] [data-list-item]");
  check(items.length === 2 && items[0]!.textContent?.includes("Sem imagem, este produto não aparece na landing."), "E2 produto novo sem imagem avisa");
  await setValue(items[0]!.querySelector("[data-image-picker] select"), "m:33333333-3333-4333-8333-333333333333");
  const alt = [...items[0]!.querySelectorAll("label")].find((l) => l.textContent?.includes("Texto alternativo"))!.querySelector("input");
  await setValue(alt, "Placa de mesa Avaliação Google");
  await setValue([...items[1]!.querySelectorAll("label")].find((l) => l.textContent?.includes("Título (opcional)"))!.querySelector("input"), "Segundo modelo");
  await click(button("↓", items[0]!));
  items = qa<HTMLElement>("[data-section-card='products'] [data-list-item]");
  await click(button("Ocultar", items[0]!));
  await click(q("[data-action='save']"));
  const saved = bodies.at(-1)!.content.products.items;
  check(saved.length === 2 && saved[0]!.title === "Segundo modelo" && saved[0]!.enabled === false && saved[1]!.image?.kind === "media" && saved[1]!.image.alt === "Placa de mesa Avaliação Google" && saved[1]!.enabled, "E2 salvo", saved);
  ok("E2: ADMIN adiciona produtos, escolhe a imagem da biblioteca (landing-assets) com texto alternativo, reordena (↓), oculta um (continua salvo) e salva no rascunho");

  for (let i = 0; i < 28; i++) await click(button("+ Adicionar produto", card));
  const add = button("+ Adicionar produto", card)!;
  check(qa("[data-section-card='products'] [data-list-item]").length === 30 && add.disabled && q<HTMLElement>("[data-section-card='products'] [data-list-limit]")?.textContent?.includes("Limite de 30 produtos atingido"), "E3 limite");
  ok("E3: com 30 produtos, '+ Adicionar produto' fica desabilitado e aparece a mensagem discreta do limite");

  // ---------------- carrossel ----------------
  const make = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, src: `/img/${i}.webp`, width: 800, height: 1200, alt: `Placa ${i + 1}`, title: i % 2 ? `Modelo ${i + 1}` : "", text: "" }));
  await mount(<ProductsCarousel items={make(1)} label="Nossos produtos" />);
  check(qa("[data-product-card]").length === 1 && !q("[data-products-controls]") && q<HTMLElement>("[data-products-track]")!.getAttribute("tabindex") === "-1" && q<HTMLElement>("[data-products-carousel]")!.getAttribute("data-autoplay") === "off", "C1 um produto");
  check(!q(".landing-product-body") && q<HTMLElement>("img")!.getAttribute("alt") === "Placa 1", "C1 sem título: só a imagem");
  ok("C1: 1 produto → sem setas, sem indicadores, sem movimento automático; sem título/descrição, só a imagem (nenhuma área vazia); alt text presente");

  await mount(<ProductsCarousel items={make(30)} label="Nossos produtos" />);
  const imgs = qa<HTMLImageElement>("[data-product-card] img");
  check(qa("[data-product-card]").length === 30 && imgs.length <= 7 && imgs.every((i) => i.getAttribute("loading") === "lazy" && i.getAttribute("width") === "800"), "C2 carregamento", imgs.length);
  check(qa(".landing-product-placeholder").length === 30 - imgs.length, "C2 placeholders");
  ok(`C2: 30 produtos → 30 cards, mas só ${imgs.length} imagens carregadas no início (o resto entra conforme o carrossel avança), todas lazy e com largura/altura reais (sem salto de layout)`);

  (win as unknown as { matchMedia: unknown }).matchMedia = (q2: string) => ({ matches: q2.includes("reduce"), addEventListener() {}, removeEventListener() {} });
  (globalThis as Record<string, unknown>).matchMedia = (win as unknown as { matchMedia: unknown }).matchMedia;
  await mount(<ProductsCarousel items={make(10)} label="Nossos produtos" />);
  check(q<HTMLElement>("[data-products-carousel]")!.getAttribute("data-autoplay") === "off" && !q("[data-products-pause]"), "C3 movimento reduzido");
  ok("C3: com prefers-reduced-motion, o movimento automático fica desligado (o comportamento no navegador real é provado no E2E)");

  await act(async () => root.unmount());
  if (failures) {
    console.log(`${failures} falha(s)`);
    process.exit(1);
  }
  console.log("Interface de Nossos Produtos OK");
  process.exit(0);
}
main().catch((e) => {
  console.log("erro:", e instanceof Error ? e.stack : e);
  process.exit(1);
});
