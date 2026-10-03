/**
 * Interface do CMS da landing (Admin › Landing Page), em happy-dom.
 *   npm run test:ui-landing-editor
 */
import { Window } from "happy-dom";

const win = new Window({ url: "http://localhost/admin/landing" });
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLTextAreaElement", "HTMLSelectElement", "Node", "Event", "MouseEvent", "KeyboardEvent", "FocusEvent", "getComputedStyle", "File", "FormData"]) {
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
  const { defaultLandingContent } = await import("@/lib/landing/defaults");
  const { BUILTIN_IMAGES } = await import("@/lib/landing/schema");

  let dialogs = 0;
  for (const fn of ["alert", "confirm", "prompt"]) (globalThis as Record<string, unknown>)[fn] = (win as unknown as Record<string, unknown>)[fn] = () => void dialogs++;
  let copied: string | null = null;
  Object.defineProperty(win.navigator, "clipboard", { value: { writeText: async (t: string) => void (copied = t) }, configurable: true });
  const calls: { url: string; method: string; body: unknown }[] = [];
  let version = 0;
  (globalThis as Record<string, unknown>).fetch = async (url: string, init: RequestInit = {}) => {
    const body = init.body instanceof (win as unknown as { FormData: typeof FormData }).FormData || init.body instanceof FormData ? "multipart" : init.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url, method: String(init.method ?? "GET"), body });
    const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status, headers: { "Content-Type": "application/json" } });
    if (url === "/api/admin/landing/draft") return json({ version: ++version });
    if (url === "/api/admin/landing/publish") return json({ publishedAt: "2026-10-01T21:32:00.000Z" });
    if (url === "/api/admin/landing/media") return json({ id: "33333333-3333-4333-8333-333333333333", path: "media/33333333-3333-4333-8333-333333333333.png", mime: "image/png", width: 1200, height: 800, bytes: 90000 }, 201);
    if (url.startsWith("/api/admin/landing/media/")) return json({ ok: true });
    return json({ error: "?" }, 404);
  };
  let refreshed = 0;
  const router = { push() {}, replace() {}, refresh() { refreshed++; }, back() {}, forward() {}, prefetch() {} };
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container as unknown as Element);
  await act(async () =>
    root.render(
      <AppRouterContext.Provider value={router as never}>
        <LandingEditor
          installed
          initialContent={defaultLandingContent()}
          initialVersion={0}
          published={null}
          publishedAt={null}
          publicUrl="https://www.exemplo.com.br/revendedores"
          mediaBase="https://p.supabase.co"
          media={[]}
          builtinThumbs={Object.fromEntries(BUILTIN_IMAGES.map((k) => [k, `/_next/static/media/${k}.webp`])) as never}
        />
      </AppRouterContext.Provider>,
    ),
  );
  const q = <T,>(s: string) => container.querySelector(s) as unknown as T | null;
  const qa = <T,>(s: string) => [...container.querySelectorAll(s)] as unknown as T[];
  const text = (s: string) => container.querySelector(s)?.textContent ?? "";
  const click = (el: unknown) => act(async () => void (el as HTMLElement).dispatchEvent(new win.MouseEvent("click", { bubbles: true }) as unknown as Event));
  const button = (label: string, scope: ParentNode = container as unknown as ParentNode) => [...scope.querySelectorAll("button")].find((b) => b.textContent?.trim() === label) as HTMLButtonElement | undefined;
  const setValue = (el: unknown, v: string) =>
    act(async () => {
      const proto = (el as HTMLElement).tagName === "TEXTAREA" ? win.HTMLTextAreaElement.prototype : (el as HTMLElement).tagName === "SELECT" ? win.HTMLSelectElement.prototype : win.HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, v);
      (el as HTMLElement).dispatchEvent(new win.Event((el as HTMLElement).tagName === "SELECT" ? "change" : "input", { bubbles: true }) as unknown as Event);
    });
  const blur = (el: unknown) => act(async () => void (el as HTMLElement).dispatchEvent(new win.FocusEvent("focusout", { bubbles: true }) as unknown as Event));
  const field = (label: string, scope: ParentNode = container as unknown as ParentNode) => {
    const l = [...scope.querySelectorAll("label")].find((x) => x.querySelector("span span")?.textContent === label || x.querySelector(".field-label span")?.textContent === label);
    return l?.querySelector("input, textarea, select") as HTMLInputElement | undefined;
  };
  const openSection = async (id: string) => {
    const d = q<HTMLDetailsElement>(`[data-section-card="${id}"]`)!;
    await act(async () => void d.setAttribute("open", ""));
    return d;
  };
  const lastBody = () => calls.filter((c) => c.url === "/api/admin/landing/draft").at(-1)?.body as { content: ReturnType<typeof defaultLandingContent>; expectedVersion: number };

  // U1: estado inicial
  check(text("[data-status-text]").includes("Usando o conteúdo padrão") && text("[data-public-url]") === "https://www.exemplo.com.br/revendedores", "U1 estado");
  check(qa("[data-tab]").length === 4 && q("[data-section-card='hero']") && q("[data-section-card='finalCta']") && qa("[data-section-card]").length === 12, "U1 abas e seções");
  // Primeiro uso: nada salvo ainda → dá para salvar/publicar o conteúdo padrão como está.
  check(!q<HTMLButtonElement>("[data-action='save']")!.disabled && !q<HTMLButtonElement>("[data-action='publish']")!.disabled, "U1 primeiro uso salvável");
  check(!container.textContent?.includes("Há edições não salvas") && q("a[data-action='preview']"), "U1 sem aviso falso; pré-visualização liberada");
  ok("U1: módulo abre com o status 'Usando o conteúdo padrão', o link público real, 4 abas (Conteúdo, Comercial, Mídia, SEO e site) e as 12 seções (com Nossos Produtos); no primeiro uso, o conteúdo padrão já pode ser salvo e publicado como está");

  // U2: editar → não salvo → salvar rascunho
  const hero = await openSection("hero");
  await setValue(field("Título principal", hero), "Revenda placas inteligentes com a DirectPlaca");
  check(container.textContent?.includes("Há edições não salvas") && text("[data-status-text]").includes("Usando o conteúdo padrão") && q("span[data-action='preview']"), "U2 sujo");
  await click(q("[data-action='save']"));
  check(lastBody()?.expectedVersion === 0 && lastBody()?.content.hero.title === "Revenda placas inteligentes com a DirectPlaca", "U2 envio", lastBody());
  check(text("[data-landing-feedback]").includes("Rascunho salvo") && q("a[data-action='preview'][href='/preview/revendedores']") && !container.textContent?.includes("Há edições não salvas"), "U2 salvo");
  ok("U2: editar mostra 'Há edições não salvas' (e bloqueia a pré-visualização desatualizada); 'Salvar rascunho' envia o conteúdo com a versão; depois a pré-visualização abre /preview/revendedores");

  // U3: publicar com confirmação
  await click(q("[data-action='publish']"));
  check(q("[data-confirm]") && text("[data-confirm]").includes("Publicar alterações?") && !calls.some((c) => c.url.includes("publish")), "U3 confirmação");
  await click(q("[data-confirm-action]"));
  const pub = calls.find((c) => c.url === "/api/admin/landing/publish");
  check((pub?.body as { expectedVersion: number })?.expectedVersion === 1 && text("[data-landing-feedback]").includes("✓ Landing publicada com sucesso.") && text("[data-status-text]") === "● Publicada" && refreshed === 1, "U3 publicado", pub);
  ok("U3: 'Publicar alterações' pede confirmação no modal do sistema; ao confirmar, publica a versão salva e mostra '✓ Landing publicada com sucesso.' e '● Publicada'");

  // U4: copiar link
  await click(q("[data-action='copy']"));
  check(copied === "https://www.exemplo.com.br/revendedores" && text("[data-action='copy']") === "Link copiado", "U4 copiar", copied);
  ok("U4: 'Copiar link' copia a URL pública real e mostra 'Link copiado'");

  // U5: comercial — preços em centavos, mensalidade, primeiro período, WhatsApp
  await click(q("[data-tab='comercial']"));
  const tiers = qa<HTMLElement>("[data-commercial='wholesale'] [data-list-item]");
  await setValue(field("Preço por unidade", tiers[0]), "12,90");
  await blur(field("Preço por unidade", tiers[0]));
  await setValue(field("Preço por unidade", tiers[1]), "1.234,56");
  await blur(field("Preço por unidade", tiers[1]));
  const sub = q<HTMLElement>("[data-commercial='subscription']")!;
  await setValue(field("Valor mensal", sub), "59,90");
  await blur(field("Valor mensal", sub));
  await click(q("[data-testid='first-period']"));
  await click(button("Gerar texto", sub));
  const contact = q<HTMLElement>("[data-commercial='contact']")!;
  await setValue(field("WhatsApp (só números, com DDI e DDD)", contact), "+55 (11) 99999-8888");
  check(text("[data-contact-in-use]").includes("WhatsApp +5511999998888") && text("[data-whatsapp-url]").includes("https://wa.me/5511999998888?text="), "U5 contato", text("[data-contact-in-use]"));
  const before = calls.length;
  await click(button("+ Adicionar", q<HTMLElement>("[data-commercial='wholesale']")!));
  await click(q("[data-action='save']"));
  const c5 = lastBody().content;
  check(
    calls.length === before + 1 &&
      c5.wholesale.tiers[0]!.unitPriceCents === 1290 &&
      c5.wholesale.tiers[1]!.unitPriceCents === 123456 &&
      c5.wholesale.tiers.length === 5 &&
      c5.subscription.monthlyPriceCents === 5990 &&
      c5.subscription.firstPeriod.enabled &&
      c5.subscription.firstPeriod.text === "Primeiros 30 dias inclusos na primeira compra." &&
      c5.contact.whatsappNumber === "5511999998888",
    "U5 conteúdo salvo",
    { tiers: c5.wholesale.tiers.map((t) => t.unitPriceCents), sub: c5.subscription.monthlyPriceCents, first: c5.subscription.firstPeriod, wa: c5.contact.whatsappNumber },
  );
  check(text("[data-status-text]") === "Alterações não publicadas", "U5 status");
  ok("U5: preços digitados em reais viram centavos inteiros (12,90 → 1290; 1.234,56 → 123456), novo lote, mensalidade 59,90 → 5990, primeiro período '30 dias' com texto gerado, WhatsApp limpo para 5511999998888 e o canal em uso visível; status 'Alterações não publicadas'");

  // U6: FAQ, seção oculta e reordenação
  await click(q("[data-tab='conteudo']"));
  const faq = await openSection("faq");
  const faqCount = qa("[data-section-card='faq'] [data-list-item]").length;
  await click(button("+ Adicionar", faq));
  const items = qa<HTMLElement>("[data-section-card='faq'] [data-list-item]");
  await click(button("Ocultar", items[0]!));
  await click(q("[data-testid='toggle-about']"));
  await click(q("[aria-label='Subir Produto']"));
  await click(q("[data-action='save']"));
  const c6 = lastBody().content;
  check(c6.faq.items.length === faqCount + 1 && c6.faq.items[0]!.enabled === false && c6.faq.items.at(-1)!.q === "Nova pergunta?", "U6 FAQ", c6.faq.items.map((i) => i.enabled));
  check(c6.about.enabled === false && c6.order[0] === "product" && c6.order[1] === "howItWorks", "U6 seções", c6.order);
  ok("U6: FAQ ganha pergunta nova e oculta outra sem apagá-la; 'Sobre nós' desativada; Produto sobe acima de Como funciona (↑) — tudo salvo no rascunho");

  // U7: validação antes de salvar (o painel foi remontado na troca de aba: busca o card de novo)
  const hero7 = await openSection("hero");
  await setValue(field("Título principal", hero7), "");
  check(container.textContent?.includes("Há edições não salvas"), "U7 edição aplicada");
  const n7 = calls.length;
  await click(q("[data-action='save']"));
  check(calls.length === n7 && text("[data-landing-feedback]").includes("hero.title"), "U7", text("[data-landing-feedback]"));
  await setValue(field("Título principal", hero7), "Título de volta");
  ok("U7: campo obrigatório vazio é apontado (hero.title) e nada é enviado");

  // U8: mídia — SVG recusado sem enviar; PNG enviado; exclusão com confirmação
  await click(q("[data-tab='midia']"));
  const input = q<HTMLInputElement>("[data-media-input]")!;
  const pick = async (file: File) =>
    act(async () => {
      Object.defineProperty(input, "files", { value: [file], configurable: true });
      input.dispatchEvent(new win.Event("change", { bubbles: true }) as unknown as Event);
    });
  const n8 = calls.length;
  await pick(new win.File(["<svg/>"], "logo.svg", { type: "image/svg+xml" }) as unknown as File);
  check(calls.length === n8 && text("[data-landing-feedback]").includes("SVG"), "U8 svg");
  await pick(new win.File([new Uint8Array([137, 80, 78, 71])], "foto.png", { type: "image/png" }) as unknown as File);
  check(calls.at(-1)?.url === "/api/admin/landing/media" && q("[data-media-item='33333333-3333-4333-8333-333333333333']"), "U8 envio");
  await click(button("Excluir", q<HTMLElement>("[data-media-item]")!));
  check(q("[data-confirm]") && !calls.some((c) => c.method === "DELETE"), "U8 confirmação");
  await click(q("[data-confirm-action]"));
  check(calls.at(-1)?.method === "DELETE" && !q("[data-media-item]"), "U8 exclusão");
  ok("U8: SVG é recusado antes de qualquer envio; PNG vai para a biblioteca; excluir pede confirmação e só então chama o servidor");

  check(dialogs === 0, "sem alert/confirm/prompt nativos");
  ok("U9: nenhuma janela nativa (alert/confirm/prompt) — só os componentes do sistema");

  await act(async () => root.unmount());
  if (failures) {
    console.log(`${failures} falha(s)`);
    process.exit(1);
  }
  console.log("Interface do CMS da landing OK");
  process.exit(0);
}
main().catch((e) => {
  console.log("erro:", e instanceof Error ? e.stack : e);
  process.exit(1);
});
