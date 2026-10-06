/**
 * Painel de exportações do lote (happy-dom): o download em massa entrega as ARTES.
 *   npm run test:ui-exports-panel
 */
import { Window } from "happy-dom";

const win = new Window({ url: "http://localhost/admin/batches/b1" });
for (const key of ["window", "document", "navigator", "HTMLElement", "Node", "Event", "MouseEvent", "getComputedStyle"]) {
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

async function main() {
  const React = await import("react");
  const { act } = React;
  const { createRoot } = await import("react-dom/client");
  const { ExportsPanel } = await import("@/components/batches/ExportsPanel");

  const assigned: string[] = [];
  (win.location as unknown as { assign: (u: string) => void }).assign = (u: string) => void assigned.push(u);
  const posted: unknown[] = [];
  let polls = 0;
  let pollFiles = [{ name: "Lote-Teste.zip", path: "exports/b1/j1/Lote-Teste.zip", size_bytes: 1000, content_type: "application/zip" }];
  const job = (status: string, files: unknown[] = []) => ({ id: "j1", batch_id: "b1", kind: "art_png_zip", status, files, progress_total: 10, progress_done: status === "done" ? 10 : 0, error_message: null, created_at: "2026-10-05T12:00:00Z", finished_at: status === "done" ? "2026-10-05T12:01:00Z" : null });
  (globalThis as Record<string, unknown>).fetch = async (url: string, init?: { method?: string; body?: string }) => {
    if (init?.method === "POST") {
      posted.push(JSON.parse(init.body!));
      return new Response(JSON.stringify({ export: job("pending") }), { status: 201, headers: { "Content-Type": "application/json" } });
    }
    polls++;
    return new Response(JSON.stringify({ exports: [job("done", pollFiles)] }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root = createRoot(container as unknown as Element);
  const mount = (canGenerateArt: boolean) =>
    act(async () => {
      root.unmount();
      root = createRoot(container as unknown as Element);
      root.render(<ExportsPanel batchId="b1" initial={[]} canGenerateArt={canGenerateArt} />);
    });
  const buttons = () => [...container.querySelectorAll("button")].map((b) => ({ text: (b.textContent ?? "").trim(), primary: b.className.includes("btn-primary"), disabled: (b as unknown as HTMLButtonElement).disabled }));
  const click = (label: string) => act(async () => void [...container.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim() === label)!.dispatchEvent(new win.MouseEvent("click", { bubbles: true }) as unknown as Event));
  const wait = (ms: number) => act(async () => void (await new Promise((r) => setTimeout(r, ms))));

  // P1: botões e nota
  await mount(true);
  const b = buttons();
  check(b[0]?.text === "Baixar artes das placas (PNG)" && b[0].primary && !b[0].disabled, "P1 principal", b);
  check(b.some((x) => x.text === "QR Codes avulsos (PNG + SVG)" && !x.primary) && b.some((x) => x.text === "Exportar CSV"), "P1 secundários", b);
  check((container.querySelector("[data-qr-pack-note]")?.textContent ?? "").includes("Chrome HTML Document"), "P1 nota do QR");
  ok("P1: o primeiro botão (principal) é 'Baixar artes das placas (PNG)'; 'QR Codes avulsos (PNG + SVG)' e 'Exportar CSV' ficam secundários, com a nota explicando o .svg");

  // P2: 1 clique → pede as artes e baixa sozinho quando ficam prontas
  await click("Baixar artes das placas (PNG)");
  check(JSON.stringify(posted) === JSON.stringify([{ kind: "art_png_zip" }]), "P2 pedido", posted);
  await wait(2800);
  check(polls >= 1 && assigned.length === 1 && assigned[0] === "/api/admin/exports/j1/download?file=0", "P2 download automático", { polls, assigned });
  check(container.querySelector("[data-art-download]")?.getAttribute("href") === "/api/admin/exports/j1/download?file=0", "P2 link para baixar de novo");
  ok("P2: um clique pede o pacote de ARTES (art_png_zip) e, quando fica pronto, o download começa sozinho; o botão 'Baixar artes' fica para baixar de novo");

  // P3: várias partes → um botão por parte (sem download automático em série)
  assigned.length = 0;
  pollFiles = [
    { name: "Lote-Teste-parte-01.zip", path: "exports/b1/j1/p1.zip", size_bytes: 1000, content_type: "application/zip" },
    { name: "Lote-Teste-parte-02.zip", path: "exports/b1/j1/p2.zip", size_bytes: 1000, content_type: "application/zip" },
  ];
  await mount(true);
  await click("Baixar artes das placas (PNG)");
  await wait(2800);
  const parts = [...container.querySelectorAll("[data-art-download]")].map((a) => a.textContent);
  check(assigned.length === 0 && parts.join("|") === "Baixar Lote-Teste-parte-01.zip|Baixar Lote-Teste-parte-02.zip", "P3", { assigned, parts });
  ok("P3: lote grande dividido em partes → um botão por ZIP (o navegador não é forçado a baixar vários arquivos de uma vez)");

  // P4: sem template → artes indisponíveis
  await mount(false);
  check(buttons()[0]?.disabled && (container.textContent ?? "").includes("não tem template vinculado"), "P4");
  ok("P4: lote sem template: 'Baixar artes' desabilitado, com a explicação (como antes)");

  await act(async () => root.unmount());
  if (failures) {
    console.log(`${failures} falha(s)`);
    process.exit(1);
  }
  console.log("Painel de exportações OK");
  process.exit(0);
}
main().catch((e) => {
  console.log("erro:", e instanceof Error ? e.stack : e);
  process.exit(1);
});
