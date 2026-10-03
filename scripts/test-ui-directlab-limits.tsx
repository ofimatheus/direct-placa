/**
 * Interface: hub do DirectLab, DirectLink no limite, erro amigável e
 * formulário de limites do ADMIN (happy-dom).
 *   npm run test:ui-directlab-limits
 */
import { Window } from "happy-dom";

const win = new Window({ url: "http://localhost/" });
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "Node", "Event", "MouseEvent", "KeyboardEvent", "getComputedStyle"]) {
  const value = key === "window" ? win : (win as unknown as Record<string, unknown>)[key];
  Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
}
Object.defineProperty(globalThis, "self", { value: win, configurable: true, writable: true });
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let failures = 0;
const ok = (l: string) => console.log(`OK ${l}`);
const check = (c: unknown, l: string, d?: unknown) => {
  if (!c) {
    failures++;
    console.log(`FALHA ${l}`, d ?? "");
  }
};
const PAGE_MSG = "Você atingiu o limite de páginas DirectLink definido para sua conta. Entre em contato com o administrador para aumentar o limite.";

async function main() {
  const React = await import("react");
  const { act } = React;
  const { createRoot } = await import("react-dom/client");
  const { AppRouterContext } = await import("next/dist/shared/lib/app-router-context.shared-runtime");
  const { DirectLabTools } = await import("@/components/directlab/DirectLabTools");
  const { DirectLinkList } = await import("@/components/directlink/DirectLinkList");
  const { DirectLinkLoadFailed } = await import("@/components/directlink/DirectLinkLoadFailed");
  const { DirectLabLimitsForm } = await import("@/components/resellers/DirectLabLimitsForm");
  let refreshed = 0;
  const router = { push() {}, replace() {}, refresh() { refreshed++; }, back() {}, forward() {}, prefetch() {} };
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root = createRoot(container as unknown as Element);
  const mount = async (node: React.ReactNode) =>
    act(async () => {
      root.unmount();
      root = createRoot(container as unknown as Element);
      root.render(<AppRouterContext.Provider value={router as never}>{node}</AppRouterContext.Provider>);
    });
  const q = <T,>(s: string) => container.querySelector(s) as unknown as T | null;
  const text = (s: string) => (container.querySelector(s)?.textContent ?? null);
  const status = (key: string) => container.querySelector(`[data-directlab-card="${key}"] [data-directlab-card-status]`)?.textContent ?? null;
  const href = (key: string) => container.querySelector(`[data-directlab-card="${key}"]`)?.getAttribute("href") ?? null;

  // U1: hub do revendedor
  await mount(<DirectLabTools role="reseller" quota={{ used: 4, limit: 10 }} pages={{ used: 2, limit: 3 }} />);
  check(status("google-review") === "4 de 10 utilizações hoje" && status("directlink") === "2 de 3 páginas", "U1 status", [status("google-review"), status("directlink")]);
  check(href("google-review") === "/reseller/directlab/google-review" && href("directlink") === "/reseller/directlab/directlink", "U1 links");
  check(!q("[data-directlab-tool]") && !q("#directlab-link") && container.querySelectorAll("[data-directlab-card]").length === 2, "U1 só cards");
  check(container.querySelector('[data-directlab-card="google-review"]')?.tagName === "A" && text('[data-directlab-card="google-review"]')?.includes("Abrir"), "U1 card inteiro é o link");
  await mount(<DirectLabTools role="reseller" quota={{ used: 10, limit: 10 }} pages={{ used: 3, limit: 3 }} />);
  check(q<HTMLElement>('[data-directlab-card="google-review"] [data-directlab-card-status]')?.className.includes("text-danger"), "U1 esgotado em vermelho");
  ok("U1: hub do revendedor só com os 2 cards (card inteiro clicável → página própria), limites '4 de 10 utilizações hoje' e '2 de 3 páginas'; esgotado em vermelho");

  // U2: hub do ADMIN
  await mount(<DirectLabTools role="admin" />);
  check(status("google-review") === "Sem limite diário" && status("directlink") === "Sem limite de páginas", "U2 ADMIN", [status("google-review"), status("directlink")]);
  check(href("google-review") === "/admin/directlab/google-review" && href("directlink") === "/admin/directlab/directlink", "U2 links");
  ok("U2: hub do ADMIN mantém 'Sem limite diário' (e 'Sem limite de páginas' no DirectLink); links para as páginas do ADMIN");

  // U3: lista do DirectLink abaixo e no limite
  const links = [{ id: "d1", public_code: "ABC2345", title: "Adega Monster", is_active: true, updated_at: new Date().toISOString(), reseller_id: "r1", items: 5, owner: null }];
  await mount(<DirectLinkList links={links as never} basePath="/reseller/directlab/directlink" showOwner={false} pages={{ used: 2, limit: 3 }} />);
  check(text("[data-directlink-pages]") === "2 de 3 páginas utilizadas" && q('a[href="/reseller/directlab/directlink/new"]') && !q("[data-directlink-limit]"), "U3 abaixo do limite");
  await mount(<DirectLinkList links={links as never} basePath="/reseller/directlab/directlink" showOwner={false} pages={{ used: 5, limit: 3 }} />);
  check(text("[data-directlink-pages]") === "5 de 3 páginas utilizadas" && text("[data-directlink-limit]") === PAGE_MSG, "U3 acima do limite");
  check(!q('a[href="/reseller/directlab/directlink/new"]') && q<HTMLElement>("[data-directlink-create-disabled]")?.getAttribute("aria-disabled") === "true", "U3 criar desabilitado");
  check(container.querySelectorAll("[data-directlink-list] li").length === 1, "U3 páginas existentes continuam listadas");
  await mount(<DirectLinkList links={links as never} basePath="/admin/directlab/directlink" showOwner={true} />);
  check(!q("[data-directlink-pages]") && q('a[href="/admin/directlab/directlink/new"]'), "U3 ADMIN sem limite");
  ok("U3: DirectLink mostra '2 de 3 páginas utilizadas'; acima do limite (5 de 3) mostra a mensagem pedida e bloqueia 'Criar', mantendo as páginas; ADMIN sem limite");

  // U4: erro amigável
  await mount(<DirectLinkLoadFailed retryHref="/admin/directlab/directlink" missingSchema={true} isAdmin={true} />);
  const a = text("[data-directlink-load-error]") ?? "";
  check(a.includes("Não foi possível carregar os DirectLinks.") && a.includes("Tente novamente.") && a.includes("20261004120000_directlink.sql") && q('a[href="/admin/directlab/directlink"]'), "U4 ADMIN", a);
  await mount(<DirectLinkLoadFailed retryHref="/reseller/directlab/directlink" missingSchema={true} isAdmin={false} />);
  const r = text("[data-directlink-load-error]") ?? "";
  check(r.includes("Não foi possível carregar os DirectLinks.") && !r.includes("migration"), "U4 revendedor", r);
  ok("U4: falha ao carregar → 'Não foi possível carregar os DirectLinks. Tente novamente.' + botão; só o ADMIN vê qual migration aplicar");

  // U5: formulário de limites do ADMIN
  const calls: { url: string; method: string; body: unknown }[] = [];
  let reply = { status: 200, body: { ok: true } as unknown };
  (globalThis as Record<string, unknown>).fetch = async (url: string, init: RequestInit) => {
    calls.push({ url, method: String(init.method), body: JSON.parse(String(init.body)) });
    return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { "Content-Type": "application/json" } });
  };
  await mount(<DirectLabLimitsForm resellerId="5e11e700-0000-4000-8000-000000000001" initial={{ googleReviewDaily: 10, directlinkPages: 3, customized: false, googleUsedToday: 7, directlinkCount: 2 }} />);
  const g = q<HTMLInputElement>("#limit-google")!;
  const p = q<HTMLInputElement>("#limit-pages")!;
  check(g.value === "10" && p.value === "3" && text("#limit-google-help")?.includes("Hoje: 7 de 10") && text("#limit-pages-help")?.includes("Em uso: 2 de 3"), "U5 valores iniciais");
  check(container.textContent?.includes("Usando os padrões (10/dia e 3 páginas)"), "U5 padrão indicado");
  const setVal = async (el: HTMLInputElement, v: string) =>
    act(async () => {
      Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, "value")!.set!.call(el, v);
      el.dispatchEvent(new win.Event("input", { bubbles: true }) as unknown as Event);
    });
  const submit = () => act(async () => void q<HTMLFormElement>("form")!.dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }) as unknown as Event));
  const button = () => q<HTMLButtonElement>('button[type="submit"]')!;
  await setVal(g, "-1");
  check(button().disabled && container.textContent?.includes("Use números inteiros de 0 a 1000."), "U5 inválido");
  await setVal(g, "5");
  await setVal(p, "10");
  await submit();
  check(calls.length === 1 && calls[0]?.method === "PUT" && calls[0]?.url === "/api/admin/resellers/5e11e700-0000-4000-8000-000000000001/directlab-limits" && JSON.stringify(calls[0]?.body) === '{"googleReviewDaily":5,"directlinkPages":10}', "U5 envio", calls);
  check(text("[data-directlab-limits-feedback]") === "Limites salvos. Já valem para o revendedor." && refreshed === 1, "U5 sucesso");
  reply = { status: 403, body: { error: "Somente ADMIN" } };
  await submit();
  check(text("[data-directlab-limits-feedback]") === "Somente ADMIN", "U5 erro do servidor");
  ok("U5: formulário do ADMIN mostra uso e padrões, recusa valores inválidos, envia PUT com Google 5/dia e DirectLink 10 páginas, confirma e recarrega; erro do servidor aparece sem alert");

  await act(async () => root.unmount());
  if (failures) {
    console.log(`${failures} falha(s)`);
    process.exit(1);
  }
  console.log("Interface dos limites OK");
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
