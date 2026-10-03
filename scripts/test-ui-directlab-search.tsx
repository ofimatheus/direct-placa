/**
 * Interface da Avaliação Google: modos (link | pesquisa), selecionar sem
 * chamar o servidor, trocar, gerar com comprovante, contador e limite (happy-dom).
 *   npm run test:ui-directlab-search
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
    console.log(`FALHA ${l}`, JSON.stringify(d ?? ""));
  }
};
const REVIEW = "https://www.google.com/maps/place//data=!4m3!3m2!1s0x94cf:0x1a2b!12e1";
const CANDS = [
  { placeId: "ChIJcarvalhoBarueri01", name: "Barbearia do Carvalho", address: "Av. Exemplo, 123 - Barueri - SP", token: "tok-1" },
  { placeId: "ChIJcarvalhoPremium02", name: "Barbearia Carvalho Premium", address: "Rua Exemplo, 456 - Santana de Parnaíba - SP", token: "tok-2" },
];

async function main() {
  const React = await import("react");
  const { act } = React;
  const { createRoot } = await import("react-dom/client");
  const { AppRouterContext } = await import("next/dist/shared/lib/app-router-context.shared-runtime");
  const { GoogleReviewTool } = await import("@/components/directlab/GoogleReviewTool");
  let dialogs = 0;
  for (const fn of ["alert", "confirm"]) (globalThis as Record<string, unknown>)[fn] = () => void dialogs++;
  const calls: Record<string, unknown>[] = [];
  let used = 5;
  let limit = 8;
  (globalThis as Record<string, unknown>).fetch = async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    calls.push(body);
    if (body.action === "search") {
      return new Response(JSON.stringify(/nada/.test(String(body.query)) ? { error: "Não encontramos esse estabelecimento no Google.", code: "not_found" } : { status: "choose", candidates: CANDS, originalUrl: null }), { status: /nada/.test(String(body.query)) ? 404 : 200 });
    }
    if (used >= limit) return new Response(JSON.stringify({ error: "Você atingiu o limite diário definido para sua conta. Entre em contato com o administrador para aumentar o limite.", code: "daily_limit" }), { status: 429 });
    used++;
    const c = CANDS.find((x) => x.placeId === body.placeId)!;
    return new Response(JSON.stringify({ status: "found", place: { placeId: c.placeId, name: c.name, address: c.address, reviewUrl: REVIEW }, originalUrl: null, quota: { used, limit } }), { status: 200 });
  };
  const router = { push() {}, replace() {}, refresh() {}, back() {}, forward() {}, prefetch() {} };
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
  const text = (s = "") => (s ? container.querySelector(s)?.textContent : container.textContent) ?? "";
  const click = (el: unknown) => act(async () => void (el as HTMLElement).dispatchEvent(new win.MouseEvent("click", { bubbles: true }) as unknown as Event));
  const type = (el: unknown, v: string) =>
    act(async () => {
      Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, "value")!.set!.call(el, v);
      (el as HTMLElement).dispatchEvent(new win.Event("input", { bubbles: true }) as unknown as Event);
    });
  const submitSearch = () => act(async () => void q<HTMLFormElement>("[data-directlab-search-form]")!.dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }) as unknown as Event));
  const selectBtns = () => [...container.querySelectorAll('[data-directlab-state="choose"] li button')] as unknown as HTMLButtonElement[];

  // U1: dois modos
  await mount(<GoogleReviewTool role="reseller" quota={{ used, limit }} />);
  check(text().includes("Como deseja localizar o estabelecimento?") && q('[data-directlab-mode="link"][aria-pressed="true"]') && q("#directlab-link") && !q("[data-directlab-search-form]"), "U1 modo link padrão");
  check(text("[data-directlab-quota]") === "5 de 8 utilizações hoje" && text("[data-directlab-quota-note]") === "Uma utilização é descontada somente quando o link é gerado com sucesso.", "U1 contador + aviso");
  await click(q('[data-directlab-mode="search"]'));
  check(q('[data-directlab-mode="search"][aria-pressed="true"]') && q("[data-directlab-search-form]") && !q("#directlab-link") && text().includes("Nome ou endereço"), "U1 modo pesquisa");
  ok("U1: 'Como deseja localizar o estabelecimento?' com [Colar link do Google] [Pesquisar estabelecimento]; contador '5 de 8 utilizações hoje' + aviso discreto");

  // U2: não pesquisa enquanto digita; mínimo de 3 letras
  const input = q<HTMLInputElement>("#directlab-search")!;
  await type(input, "B");
  await type(input, "Ba");
  check(calls.length === 0 && q<HTMLButtonElement>("[data-directlab-search-form] button[type=submit]")!.disabled, "U2 digitar não chama");
  await type(input, "Barbearia do Carvalho Barueri");
  check(calls.length === 0, "U2 digitar não chama (2)");
  await submitSearch();
  check(calls.length === 1 && calls[0]!.action === "search" && calls[0]!.query === "Barbearia do Carvalho Barueri", "U2 pesquisa só no clique", calls);
  check(text('[data-directlab-state="choose"]').includes("Resultados encontrados") && text().includes("Av. Exemplo, 123 - Barueri - SP") && text().includes("Santana de Parnaíba") && text("[data-directlab-quota]") === "5 de 8 utilizações hoje", "U2 resultados");
  ok("U2: digitar não chama a API (nem com 1, 2 ou muitas letras); só o clique em Pesquisar chama; resultados com nome e endereço (cidade/UF); continua 5 de 8");

  // U3: selecionar e trocar sem chamar; gerar com comprovante
  await click(selectBtns()[0]);
  check(calls.length === 1 && text('[data-directlab-state="selected"]').includes("Estabelecimento selecionado") && text('[data-directlab-state="selected"]').includes("Barbearia do Carvalho"), "U3 selecionado");
  await click([...container.querySelectorAll('[data-directlab-state="selected"] button')].find((b) => b.textContent === "Alterar estabelecimento"));
  check(calls.length === 1 && selectBtns().length === 2, "U3 alterar volta à lista sem chamar");
  await click(selectBtns()[1]);
  await click(q('[data-directlab-state="selected"] button.btn-primary'));
  check(calls.length === 2 && calls[1]!.action === "place" && calls[1]!.placeId === "ChIJcarvalhoPremium02" && calls[1]!.token === "tok-2", "U3 gerar envia o escolhido + comprovante", calls[1]);
  check(q('[data-directlab-state="found"]') && text().includes("Barbearia Carvalho Premium") && text("[data-directlab-quota]") === "6 de 8 utilizações hoje", "U3 link gerado e contador 6 de 8");
  ok("U3: selecionar e 'Alterar estabelecimento' não chamam o servidor; 'Gerar link de avaliação' envia o local escolhido (com o comprovante) e só então o contador vai de 5 para 6 de 8");

  // U4: pesquisa sem resultados
  await click(q('[data-directlab-mode="link"]'));
  await click(q('[data-directlab-mode="search"]'));
  await type(q("#directlab-search"), "nada parecido");
  await submitSearch();
  check(q('[data-directlab-error="not_found"]') && text("[data-directlab-quota]") === "6 de 8 utilizações hoje", "U4 sem resultados");
  ok("U4: pesquisa sem resultados mostra 'Estabelecimento não encontrado' e o contador não muda");

  // U5: no limite, pesquisar continua; gerar fica bloqueado
  used = 8;
  await mount(<GoogleReviewTool role="reseller" quota={{ used: 8, limit: 8 }} />);
  await click(q('[data-directlab-mode="search"]'));
  check(text("[data-directlab-exhausted]").includes("Você ainda pode pesquisar."), "U5 aviso");
  await type(q("#directlab-search"), "Barbearia do Carvalho");
  const before = calls.length;
  await submitSearch();
  check(calls.length === before + 1 && selectBtns().length === 2, "U5 pesquisa no limite");
  await click(selectBtns()[0]);
  check(q<HTMLButtonElement>('[data-directlab-state="selected"] button.btn-primary')!.disabled, "U5 gerar bloqueado");
  ok("U5: com 8 de 8, a pesquisa continua funcionando (com aviso 'Você ainda pode pesquisar.'), mas 'Gerar link de avaliação' fica bloqueado (e o servidor recusa de qualquer forma)");

  // U6: ADMIN
  await mount(<GoogleReviewTool role="admin" />);
  await click(q('[data-directlab-mode="search"]'));
  check(text("[data-directlab-unlimited]") === "Sem limite diário" && !q("[data-directlab-quota-note]"), "U6 ADMIN");
  ok("U6: ADMIN tem os dois modos e mantém 'Sem limite diário'");
  check(dialogs === 0, "sem alert/confirm");

  await act(async () => root.unmount());
  if (failures) {
    console.log(`${failures} falha(s)`);
    process.exit(1);
  }
  console.log("Interface da pesquisa OK");
  process.exit(0);
}
main().catch((e) => {
  console.log("erro:", e instanceof Error ? e.stack : e);
  process.exit(1);
});
