/**
 * Resultado da Avaliação Google com o link curto DirectPlaca (happy-dom).
 *   npm run test:ui-directlab-shortlink
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
const ok = (l: string) => console.log(`OK ${l}`);
const check = (c: unknown, l: string, d?: unknown) => {
  if (!c) {
    failures++;
    console.log(`FALHA ${l}`, JSON.stringify(d ?? "").slice(0, 300));
  }
};

const REVIEW = "https://www.google.com/maps/place//data=!4m3!3m2!1s0x94cf01b30bf59ca7:0x21e10e82e733c4f7!12e1?g_mp=Cidnb29nbGUubWFwcy5wbGFjZXMudjEuUGxhY2VzLkdldFBsYWNl";
const SHORT = "https://go.directplaca.com/r/A7K4829";
const place = { placeId: "ChIJadegaMonster0001", name: "Adega Monster", address: "Av. Exemplo, 123 - Barueri", reviewUrl: REVIEW };
const FOUND = { status: "found", place, originalUrl: null, shortLink: { code: "A7K4829", url: SHORT, bytes: Buffer.byteLength(SHORT, "utf8") } };

async function main() {
  const React = await import("react");
  const { act } = React;
  const { createRoot } = await import("react-dom/client");
  const { AppRouterContext } = await import("next/dist/shared/lib/app-router-context.shared-runtime");
  const { GoogleReviewTool } = await import("@/components/directlab/GoogleReviewTool");
  const router = { push() {}, replace() {}, refresh() {}, back() {}, forward() {}, prefetch() {} };
  const calls: { url: string; method: string; body: unknown }[] = [];
  let reply: (url: string) => { status: number; body: unknown } = () => ({ status: 200, body: FOUND });
  (globalThis as Record<string, unknown>).fetch = async (url: string, init?: { method?: string; body?: string }) => {
    calls.push({ url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(init.body) : null });
    const r = reply(url);
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { "Content-Type": "application/json" } });
  };
  let clipboard = "";
  Object.defineProperty(win.navigator, "clipboard", { value: { writeText: async (t: string) => void (clipboard = t) }, configurable: true });
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root = createRoot(container as unknown as Element);
  const q = <T,>(s: string) => container.querySelector(s) as unknown as T | null;
  const text = () => container.textContent ?? "";
  const button = (label: string) => [...container.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim() === label) as unknown as HTMLButtonElement | undefined;
  const click = (el: unknown) => act(async () => void (el as HTMLElement).dispatchEvent(new win.MouseEvent("click", { bubbles: true }) as unknown as Event));
  const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 350))));
  const generate = async () => {
    await act(async () => {
      root.unmount();
      root = createRoot(container as unknown as Element);
      root.render(<AppRouterContext.Provider value={router as never}><GoogleReviewTool role="reseller" /></AppRouterContext.Provider>);
    });
    await act(async () => {
      const input = q<HTMLInputElement>("#directlab-link")!;
      Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, "value")!.set!.call(input, "https://share.google/UHvh2Pg8JPeIykuoO");
      input.dispatchEvent(new win.Event("input", { bubbles: true }) as unknown as Event);
    });
    await act(async () => void q<HTMLFormElement>("form")!.dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }) as unknown as Event));
    await settle();
  };

  // U1: resultado principal = link curto
  await generate();
  const shortInput = q<HTMLInputElement>("[data-directlab-short-url]");
  const bytesText = q<HTMLElement>("[data-directlab-short-bytes]")?.textContent ?? "";
  check(text().includes("Link de avaliação gerado") && text().includes("Link curto DirectPlaca") && shortInput?.value === SHORT, "U1 principal");
  check(bytesText === "36 bytes do endereço · otimizado para NFC" && !text().includes("Este link possui"), "U1 bytes", bytesText);
  check(!q("#directlab-review-url"), "U1 link gigante não é o principal");
  ok(`U1: resultado principal: '✓ Link de avaliação gerado', 'Link curto DirectPlaca' = ${SHORT} e '${bytesText}'; o endereço longo do Google não ocupa mais o destaque`);

  // U2: copiar = link curto; original secundário
  await click(button("Copiar link"));
  check(clipboard === SHORT, "U2 copiar", clipboard);
  const details = q<HTMLElement>("[data-directlab-original-link]");
  check(details && details.textContent?.includes("Ver link original do Google") && (details.querySelector("input") as unknown as HTMLInputElement).value === REVIEW, "U2 original");
  await click([...details!.querySelectorAll("button")].find((b) => b.textContent?.includes("Copiar link do Google")));
  check(clipboard === REVIEW, "U2 copiar original", clipboard);
  ok("U2: 'Copiar link' copia o link CURTO; 'Ver link original do Google' (recolhido) mostra e copia o endereço oficial");

  // U3: Usar em uma placa grava o link ORIGINAL (sem redirect duplo)
  const plates = [{ id: "p-1", public_code: "JKJ4NN", status: "assigned", customer_id: "c-1", customer_name: "Adega Monster", reseller_name: null, destination_type: null, destination_url: null }];
  reply = (url) => (url.startsWith("/api/directlab/plates") ? { status: 200, body: { role: "reseller", plates } } : { status: 200, body: { plate: { status: "active" } } });
  await click(button("Usar em uma placa"));
  await settle();
  await click([...container.querySelectorAll("[data-plate-list] button")].find((b) => b.textContent?.includes("JKJ4NN")));
  await click(button("Continuar"));
  await click(q("[data-confirm]"));
  const save = calls.find((c) => c.url === "/api/reseller/plates/p-1");
  check(save && JSON.stringify(save.body) === JSON.stringify({ customer_id: "c-1", destination_type: "google_review", destination_url: REVIEW }) && !JSON.stringify(save.body).includes("/r/"), "U3", save);
  ok("U3: 'Usar em uma placa' continua pelo fluxo atual e grava na placa o link ORIGINAL do Google (placa /go/<código> → Google, sem passar por /r/)");

  // U4: domínio longo → aviso discreto (não bloqueia)
  const LONG = "https://links.minha-empresa-de-placas.com.br/r/A7K4829";
  reply = () => ({ status: 200, body: { ...FOUND, shortLink: { code: "A7K4829", url: LONG, bytes: Buffer.byteLength(LONG, "utf8") } } });
  await generate();
  const warn = q<HTMLElement>("[data-directlab-short-bytes]")?.textContent ?? "";
  check(warn === `Este link possui ${Buffer.byteLength(LONG, "utf8")} bytes. Considere utilizar um domínio mais curto para tags com pouca memória.` && q<HTMLInputElement>("[data-directlab-short-url]")?.value === LONG, "U4", warn);
  ok(`U4: com domínio longo (${Buffer.byteLength(LONG, "utf8")} bytes), só um aviso discreto — o link continua gerado e copiável`);

  // U5: sem link curto (migration ainda não aplicada) → tela como antes
  reply = () => ({ status: 200, body: { status: "found", place, originalUrl: null } });
  await generate();
  check(text().includes("Estabelecimento encontrado") && q<HTMLInputElement>("#directlab-review-url")?.value === REVIEW && !q("[data-directlab-short-url]") && !q("[data-directlab-original-link]"), "U5");
  await click(button("Copiar link"));
  check(clipboard === REVIEW, "U5 copiar");
  ok("U5: sem link curto na resposta (ex.: migration ainda não aplicada), a tela fica exatamente como antes (link do Google como principal)");

  await act(async () => root.unmount());
  if (failures) {
    console.log(`${failures} falha(s)`);
    process.exit(1);
  }
  console.log("Interface do link curto OK");
  process.exit(0);
}
main().catch((e) => {
  console.log("erro:", e instanceof Error ? e.stack : e);
  process.exit(1);
});
