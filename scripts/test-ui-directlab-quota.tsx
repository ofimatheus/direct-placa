/**
 * Interface da cota diária do DirectLab (happy-dom): contador, mensagem de
 * limite (sem alert) e ADMIN sem contador.
 *   npm run test:ui-directlab-quota
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
const MESSAGE = "Você atingiu o limite diário definido para sua conta. Entre em contato com o administrador para aumentar o limite.";
const FOUND = { status: "found", place: { placeId: "ChIJadegaMonster0001", name: "Adega Monster", address: "Barueri", reviewUrl: "https://search.google.com/local/writereview?placeid=ChIJadegaMonster0001" }, originalUrl: null };

async function main() {
  const React = await import("react");
  const { act } = React;
  const { createRoot } = await import("react-dom/client");
  const { AppRouterContext } = await import("next/dist/shared/lib/app-router-context.shared-runtime");
  const { GoogleReviewTool } = await import("@/components/directlab/GoogleReviewTool");
  let alerts = 0;
  (win as unknown as { alert: () => void }).alert = () => void alerts++;
  (globalThis as Record<string, unknown>).alert = () => void alerts++;
  let calls = 0;
  let reply: () => { status: number; body: unknown } = () => ({ status: 200, body: { ...FOUND, quota: { used: 8, limit: 10 } } });
  (globalThis as Record<string, unknown>).fetch = async () => {
    calls++;
    const r = reply();
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { "Content-Type": "application/json" } });
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
  const type = async (el: unknown, v: string) =>
    act(async () => {
      Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, "value")!.set!.call(el, v);
      (el as HTMLElement).dispatchEvent(new win.Event("input", { bubbles: true }) as unknown as Event);
    });
  const submit = async () => act(async () => void q<HTMLFormElement>("form")!.dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }) as unknown as Event));
  const generateButton = () => [...container.querySelectorAll("button")].find((b) => b.textContent?.includes("Gerar")) as unknown as HTMLButtonElement;

  await mount(<GoogleReviewTool role="reseller" quota={{ used: 7, limit: 10 }} />);
  check(q<HTMLElement>("[data-directlab-quota]")?.textContent === "7 de 10 utilizações hoje", "U1 contador inicial", q<HTMLElement>("[data-directlab-quota]")?.textContent);
  await type(q("#directlab-link"), "https://share.google/abc");
  await submit();
  check(q<HTMLElement>("[data-directlab-quota]")?.textContent === "8 de 10 utilizações hoje" && q('[data-directlab-state="found"]'), "U1 contador atualizado");
  ok("U1: revendedor vê '7 de 10 utilizações hoje', atualizado pelo servidor a cada consulta (8 de 10)");

  reply = () => ({ status: 429, body: { error: MESSAGE, code: "daily_limit", retryAfterSeconds: 3600 } });
  await type(q("#directlab-link"), "https://share.google/def");
  await submit();
  const err = q<HTMLElement>('[data-directlab-error="daily_limit"]');
  check(err && err.textContent?.includes("Limite diário atingido") && err.textContent.includes(MESSAGE), "U2 mensagem", err?.textContent);
  check(q<HTMLElement>("[data-directlab-quota]")?.textContent === "10 de 10 utilizações hoje" && generateButton().disabled, "U2 bloqueio visual");
  check(alerts === 0 && err?.getAttribute("role") === "alert", "U2 sem alert nativo");
  ok("U2: ao estourar, mostra a mensagem pedida no padrão visual (sem alert), contador 10 de 10 e botão desabilitado");

  calls = 0;
  await mount(<GoogleReviewTool role="reseller" quota={{ used: 10, limit: 10 }} />);
  check(q<HTMLElement>("[data-directlab-exhausted]")?.textContent === MESSAGE && generateButton().disabled, "U3 já esgotado ao abrir");
  await type(q("#directlab-link"), "https://share.google/ghi");
  check(generateButton().disabled && calls === 0, "U3 nenhum envio", calls);
  ok("U3: abrindo com 10 de 10, a mensagem aparece e nada é enviado (a trava real continua no servidor)");

  reply = () => ({ status: 200, body: FOUND });
  await mount(<GoogleReviewTool role="admin" />);
  check(!q<HTMLElement>("[data-directlab-quota]") && !q<HTMLElement>("[data-directlab-exhausted]"), "U4 ADMIN sem contador");
  await type(q("#directlab-link"), "https://share.google/jkl");
  await submit();
  check(q('[data-directlab-state="found"]') && !q<HTMLElement>("[data-directlab-quota]"), "U4 ADMIN usa normalmente");
  ok("U4: ADMIN não vê contador nem limite diário");

  await act(async () => root.unmount());
  if (failures) {
    console.log(`${failures} falha(s)`);
    process.exit(1);
  }
  console.log("Interface da cota OK");
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
