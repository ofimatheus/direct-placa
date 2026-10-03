/**
 * Interações reais (happy-dom) da ferramenta Avaliação Google: estados,
 * copiar link, escolha entre candidatos e "Usar em uma placa".
 *   npm run test:ui-directlab
 */
import { Window } from "happy-dom";

const win = new Window({ url: "http://localhost/" });
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLTextAreaElement", "HTMLSelectElement", "Node", "Event", "KeyboardEvent", "MouseEvent", "getComputedStyle"]) {
  const value = key === "window" ? win : (win as unknown as Record<string, unknown>)[key];
  Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
}
Object.defineProperty(globalThis, "self", { value: win, configurable: true, writable: true });
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let failures = 0;
const ok = (label: string) => console.log(`OK ${label}`);
const check = (cond: unknown, label: string, detail?: unknown) => {
  if (!cond) {
    failures++;
    console.log(`FALHA ${label}`, detail ?? "");
  }
};

const REVIEW = "https://search.google.com/local/writereview?placeid=ChIJadegaMonster0001";
const FOUND = { status: "found", place: { placeId: "ChIJadegaMonster0001", name: "Adega Monster", address: "Av. Exemplo, 123 - Barueri", reviewUrl: REVIEW }, originalUrl: "https://share.google/UHvh2Pg8JPeIykuoO" };

async function main() {
  const React = await import("react");
  const { act } = React;
  const { createRoot } = await import("react-dom/client");
  const { AppRouterContext } = await import("next/dist/shared/lib/app-router-context.shared-runtime");
  const { GoogleReviewTool } = await import("@/components/directlab/GoogleReviewTool");

  const router = { push() {}, replace() {}, refresh() {}, back() {}, forward() {}, prefetch() {} };
  type Call = { url: string; method: string; body: unknown };
  let calls: Call[] = [];
  let reply: (url: string, body: Record<string, unknown> | null) => { status: number; body: unknown } = () => ({ status: 200, body: FOUND });
  (globalThis as Record<string, unknown>).fetch = async (url: string, init?: { method?: string; body?: string }) => {
    const body = init?.body ? JSON.parse(init.body) : null;
    calls.push({ url, method: init?.method ?? "GET", body });
    const r = reply(url, body);
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { "Content-Type": "application/json" } });
  };
  let clipboard = "";
  Object.defineProperty(win.navigator, "clipboard", { value: { writeText: async (t: string) => void (clipboard = t) }, configurable: true });

  const container = document.createElement("div");
  document.body.appendChild(container);
  let root = createRoot(container as unknown as Element);
  const mount = async (role: "admin" | "reseller") => {
    await act(async () => {
      root.unmount();
      root = createRoot(container as unknown as Element);
      root.render(<AppRouterContext.Provider value={router as never}><GoogleReviewTool role={role} /></AppRouterContext.Provider>);
    });
  };
  const q = <T,>(sel: string) => container.querySelector(sel) as unknown as T | null;
  const text = () => container.textContent ?? "";
  const button = (label: string) => [...container.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim() === label) as unknown as HTMLButtonElement | undefined;
  const click = async (el: unknown) => act(async () => void (el as HTMLElement).dispatchEvent(new win.MouseEvent("click", { bubbles: true }) as unknown as Event));
  const type = async (el: unknown, value: string) =>
    act(async () => {
      Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, "value")!.set!.call(el, value);
      (el as HTMLElement).dispatchEvent(new win.Event("input", { bubbles: true }) as unknown as Event);
    });
  const submit = async () => act(async () => void q<HTMLFormElement>("form")!.dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }) as unknown as Event));
  const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 350))));

  // ---------------- T1: estado vazio e validação local ----------------
  await mount("reseller");
  check(text().includes("Avaliação Google") && text().includes("Cole o link do estabelecimento") && button("Gerar link de avaliação")?.disabled, "T1 vazio");
  await type(q("#directlab-link"), "https://evil.com/maps/place/x");
  await submit();
  check(q('[data-directlab-error="domain_not_allowed"]') && calls.length === 0, "T1 domínio externo não deveria ir ao servidor", calls);
  await type(q("#directlab-link"), "isso não é link");
  await submit();
  check(q('[data-directlab-error="invalid_url"]') && calls.length === 0, "T1 link inválido");
  ok("T1: estado vazio; link inválido e domínio não permitido avisados na hora, sem chamar o servidor");

  // ---------------- T2: sucesso + copiar ----------------
  calls = [];
  await type(q("#directlab-link"), "https://share.google/UHvh2Pg8JPeIykuoO");
  await submit();
  check(calls.length === 1 && calls[0]!.url === "/api/directlab/google-review" && (calls[0]!.body as { action: string }).action === "resolve", "T2 chamada", calls);
  check(q('[data-directlab-state="found"]') && text().includes("Estabelecimento encontrado") && text().includes("Adega Monster") && text().includes("Av. Exemplo, 123 - Barueri"), "T2 card");
  check(q<HTMLInputElement>("#directlab-review-url")?.value === REVIEW && text().includes("ChIJadegaMonster0001") && text().includes("share.google/UHvh2Pg8JPeIykuoO"), "T2 link, Place ID e link original");
  await click(button("Copiar link"));
  check(clipboard === REVIEW && text().includes("✓ Link copiado"), "T2 copiar", { clipboard });
  ok("T2: sucesso mostra estabelecimento, endereço, link de avaliação, link original e Place ID (secundário); Copiar link usa a Clipboard API e mostra 'Link copiado'");

  // ---------------- T3: Usar em uma placa (revendedor) ----------------
  calls = [];
  const plates = [
    { id: "p-1", public_code: "JKJ4NN", status: "assigned", customer_id: "c-1", customer_name: "Adega Monster", reseller_name: null, destination_type: null, destination_url: null },
    { id: "p-2", public_code: "SPR34S", status: "active", customer_id: null, customer_name: null, reseller_name: null, destination_type: "instagram", destination_url: "https://instagram.com/x" },
  ];
  reply = (url) => (url.startsWith("/api/directlab/plates") ? { status: 200, body: { role: "reseller", plates } } : { status: 200, body: { plate: { status: "active" } } });
  await click(button("Usar em uma placa"));
  await settle();
  check(calls.some((c) => c.url.startsWith("/api/directlab/plates")), "T3 listou placas", calls);
  check(text().includes("JKJ4NN") && text().includes("SPR34S") && text().includes("Destino atual: Instagram"), "T3 lista");
  check(button("Continuar")?.disabled, "T3 continuar sem placa");
  await click([...container.querySelectorAll("[data-plate-list] button")].find((b) => b.textContent?.includes("JKJ4NN")));
  await click(button("Continuar"));
  check(text().includes("Confirmar novo destino") && text().includes("Avaliação no Google — " + REVIEW) && text().includes("mesma rotina da tela da placa"), "T3 confirmação");
  const before = calls.length;
  await click(button("Voltar"));
  check(calls.length === before && text().includes("Usar em uma placa"), "T3 voltar não salvou");
  await click(button("Continuar"));
  await click(q("[data-confirm]"));
  const save = calls.find((c) => c.url === "/api/reseller/plates/p-1");
  check(save && save.method === "POST" && JSON.stringify(save.body) === JSON.stringify({ customer_id: "c-1", destination_type: "google_review", destination_url: REVIEW }), "T3 rota existente", save);
  check(text().includes("Destino da placa JKJ4NN atualizado") && text().includes("Ativa") && q('a[href="/reseller/plates/p-1"]'), "T3 sucesso");
  ok("T3: Usar em uma placa → lista → selecionar → confirmar → POST /api/reseller/plates/[id] (rota existente) com o cliente mantido; mostra a situação devolvida pelo servidor");

  // ---------------- T4: erro do servidor fica no modal ----------------
  reply = (url) => (url.startsWith("/api/directlab/plates") ? { status: 200, body: { role: "reseller", plates } } : { status: 404, body: { error: "Placa não encontrada." } });
  await click(button("Usar em uma placa"));
  await settle();
  await click([...container.querySelectorAll("[data-plate-list] button")].find((b) => b.textContent?.includes("SPR34S")));
  await click(button("Continuar"));
  await click(q("[data-confirm]"));
  check(q('[role="dialog"]') && text().includes("Placa não encontrada."), "T4 erro no modal");
  await click(button("Voltar"));
  await click(button("Cancelar"));
  ok("T4: recusa do servidor (ex.: placa de outro revendedor) aparece no modal e nada muda");

  // ---------------- T5: ADMIN usa a rota do ADMIN ----------------
  calls = [];
  reply = (url) =>
    url === "/api/directlab/google-review"
      ? { status: 200, body: FOUND }
      : url.startsWith("/api/directlab/plates")
        ? { status: 200, body: { role: "admin", plates: [{ ...plates[0], reseller_name: "Jorge LTDA" }] } }
        : { status: 200, body: { plate: { status: "active" } } };
  await mount("admin");
  await type(q("#directlab-link"), "https://maps.app.goo.gl/AbC123");
  await submit();
  await click(button("Usar em uma placa"));
  await settle();
  check(text().includes("Jorge LTDA"), "T5 ADMIN vê revendedor");
  await click([...container.querySelectorAll("[data-plate-list] button")][0]);
  await click(button("Continuar"));
  await click(q("[data-confirm]"));
  const adminSave = calls.find((c) => c.url === "/api/admin/plates/p-1");
  check(adminSave && adminSave.method === "PATCH", "T5 rota do ADMIN", calls);
  ok("T5: ADMIN usa o mesmo fluxo pela rota existente PATCH /api/admin/plates/[id]");

  // ---------------- T6: ambíguo, não identificado, erros ----------------
  calls = [];
  reply = (_url, body) =>
    body?.action === "resolve"
      ? { status: 200, body: { status: "choose", candidates: [{ placeId: "ChIJaaaaaaaaaaaa1", name: "Adega Monster", address: "Barueri" }, { placeId: "ChIJbbbbbbbbbbbb2", name: "Adega Monster", address: "Osasco" }], originalUrl: "https://share.google/x" } }
      : { status: 200, body: FOUND };
  await mount("reseller");
  await type(q("#directlab-link"), "https://share.google/x");
  await submit();
  check(q('[data-directlab-state="choose"]') && text().includes("Barueri") && text().includes("Osasco") && calls.length === 1 && !q('[data-directlab-state="found"]'), "T6 ambíguo", calls);
  // Fluxo pedido nesta versão: "Selecionar" só escolhe (nenhuma chamada); o link é gerado em "Gerar link de avaliação".
  await click(button("Selecionar"));
  check(calls.length === 1 && q('[data-directlab-state="selected"]') && !q('[data-directlab-state="found"]'), "T6 selecionar não chama o servidor", calls);
  await click(q('[data-directlab-state="selected"] button.btn-primary'));
  check((calls[1]?.body as { action: string; placeId: string }).action === "place" && (calls[1]?.body as { placeId: string }).placeId === "ChIJaaaaaaaaaaaa1" && q('[data-directlab-state="found"]'), "T6 escolha gera o link", calls);
  ok("T6: resultado ambíguo mostra a lista; selecionar não chama o servidor; o link só é gerado em 'Gerar link de avaliação'");

  reply = (_url, body) =>
    body?.action === "resolve"
      ? { status: 200, body: { status: "not_identified", originalUrl: "https://share.google/y" } }
      : { status: 200, body: { status: "choose", candidates: [{ placeId: "ChIJcccccccccccc3", name: "Padaria Sol", address: "Centro" }], originalUrl: null } };
  await mount("reseller");
  await type(q("#directlab-link"), "https://share.google/y");
  await submit();
  check(text().includes("Não conseguimos identificar automaticamente este estabelecimento."), "T7 não identificado");
  await type(q("#directlab-search"), "Padaria Sol");
  await act(async () => void q<HTMLFormElement>('form[aria-label="Pesquisar estabelecimento"]')!.dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }) as unknown as Event));
  check(q('[data-directlab-state="choose"]') && text().includes("Padaria Sol") && !q('[data-directlab-state="found"]'), "T7 pesquisa manual pede escolha mesmo com 1 resultado");
  ok("T7: não identificado oferece 'Pesquisar estabelecimento'; mesmo com um resultado, o usuário escolhe");

  const errors: [number, string, string, string][] = [
    [503, "not_configured", "O DirectLab ainda não está configurado", "DirectLab não configurado"],
    [429, "quota_exceeded", "O limite de consultas ao Google foi atingido", "Limite do Google atingido"],
    [429, "rate_limited", "Você fez muitas consultas seguidas", "Tente de novo em 30 s"],
    [502, "google_unavailable", "O Google não respondeu agora", "Google indisponível"],
    [404, "not_found", "Não encontramos esse estabelecimento", "Pesquisar"],
  ];
  for (const [status, codeName, message, extra] of errors) {
    reply = () => ({ status, body: { error: `${message}.`, code: codeName, ...(codeName === "rate_limited" ? { retryAfterSeconds: 30 } : {}) } });
    await mount("reseller");
    await type(q("#directlab-link"), "https://share.google/z");
    await submit();
    check(q(`[data-directlab-error="${codeName}"]`) && text().includes(message) && text().includes(extra), `T8 ${codeName}`, text().slice(0, 300));
  }
  ok("T8: chave não configurada, quota do Google, rate limit (com tempo de espera), Google indisponível e não encontrado têm mensagens amigáveis");

  await act(async () => root.unmount());
  if (failures) {
    console.log(`${failures} falha(s)`);
    process.exit(1);
  }
  console.log("Interações do DirectLab OK");
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
