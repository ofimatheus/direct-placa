/**
 * Interface: Configurações > Integrações > Google Places (happy-dom; chaves FALSAS).
 *   npm run test:ui-google-places
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
const NEW_KEY = "AIzaFAKEchaveDigitadaNaTelaDeTeste00K7m";

async function main() {
  const React = await import("react");
  const { act } = React;
  const { createRoot } = await import("react-dom/client");
  const { AppRouterContext } = await import("next/dist/shared/lib/app-router-context.shared-runtime");
  const { GooglePlacesCard } = await import("@/components/settings/GooglePlacesCard");
  let dialogs = 0;
  for (const fn of ["alert", "confirm", "prompt"]) {
    (win as unknown as Record<string, unknown>)[fn] = () => void dialogs++;
    (globalThis as Record<string, unknown>)[fn] = () => void dialogs++;
  }
  let refreshed = 0;
  const router = { push() {}, replace() {}, refresh() { refreshed++; }, back() {}, forward() {}, prefetch() {} };
  const calls: { url: string; method: string; body: string }[] = [];
  let reply: (url: string, method: string) => { status: number; body: unknown } = () => ({ status: 200, body: {} });
  (globalThis as Record<string, unknown>).fetch = async (url: string, init: RequestInit = {}) => {
    calls.push({ url, method: String(init.method), body: String(init.body ?? "") });
    const r = reply(url, String(init.method));
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { "Content-Type": "application/json" } });
  };
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root = createRoot(container as unknown as Element);
  const base = { available: true, configuredAt: null, lastTestStatus: null, lastTestSource: null, lastTestAt: null, serverCanReadCustom: true };
  const mount = async (view: Record<string, unknown>) =>
    act(async () => {
      root.unmount();
      root = createRoot(container as unknown as Element);
      root.render(
        <AppRouterContext.Provider value={router as never}>
          <GooglePlacesCard initial={{ ...base, ...view } as never} />
        </AppRouterContext.Provider>,
      );
    });
  const q = <T,>(s: string) => container.querySelector(s) as unknown as T | null;
  const text = (s: string) => container.querySelector(s)?.textContent ?? null;
  const click = (s: string) => act(async () => void q<HTMLElement>(s)!.dispatchEvent(new win.MouseEvent("click", { bubbles: true }) as unknown as Event));
  const button = (label: string) => [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === label) as unknown as HTMLButtonElement | undefined;
  const clickButton = (label: string) => act(async () => void button(label)!.dispatchEvent(new win.MouseEvent("click", { bubbles: true }) as unknown as Event));
  const setVal = (el: HTMLInputElement, v: string) =>
    act(async () => {
      Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, "value")!.set!.call(el, v);
      el.dispatchEvent(new win.Event("input", { bubbles: true }) as unknown as Event);
    });
  const submit = () => act(async () => void q<HTMLFormElement>("[data-gp-form]")!.dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }) as unknown as Event));

  // U1: chave do ADMIN
  await mount({ customConfigured: true, last4: "X9zQ", envAvailable: true, lastTestStatus: "ok", lastTestSource: "admin", lastTestAt: new Date().toISOString() });
  check(text("[data-gp-status]") === "● Configurada" && text("[data-gp-source]") === "Configuração do administrador", "U1 status/origem");
  check(text("[data-gp-masked]") === "AIza••••••••••••X9zQ" && text("[data-gp-last-test]")?.startsWith("✓ Conexão válida"), "U1 máscara/teste", text("[data-gp-masked]"));
  check(button("Testar conexão") && button("Alterar chave") && q("[data-gp-remove]") && container.textContent?.includes("O teste realiza uma solicitação à Google Places API."), "U1 ações e aviso");
  ok("U1: com chave do ADMIN: '● Configurada', origem 'Configuração do administrador', chave mascarada (só os 4 últimos), último teste, botões e o aviso de que o teste chama o Google");

  // U2: só ambiente / U3: nada
  await mount({ customConfigured: false, last4: null, envAvailable: true });
  check(text("[data-gp-source]") === "Variável de ambiente" && !q("[data-gp-masked]") && text("[data-gp-env]") === "Disponível" && button("Configurar chave personalizada") && !q("[data-gp-remove]"), "U2 ambiente");
  await mount({ customConfigured: false, last4: null, envAvailable: false });
  check(text("[data-gp-status]") === "Não configurada" && text("[data-gp-env]") === "Não definida" && button("Configurar chave") && button("Testar conexão")?.disabled, "U3 nada");
  ok("U2–U3: só ambiente mostra 'Variável de ambiente' sem exibir valor; sem nada mostra 'Não configurada' e 'Configurar chave'");

  // U4: formulário de chave nova
  await mount({ customConfigured: true, last4: "X9zQ", envAvailable: true });
  await clickButton("Alterar chave");
  const input = q<HTMLInputElement>("#gp-new-key")!;
  check(input.type === "password" && input.value === "" && input.getAttribute("autocomplete") === "off" && input.getAttribute("spellcheck") === "false", "U4 campo seguro");
  await setVal(input, "AIza-curta");
  check(button("Testar e salvar")?.disabled && container.textContent?.includes("começa com AIza e tem 39 caracteres"), "U4 formato local");
  await setVal(input, NEW_KEY);
  await clickButton("Mostrar");
  check(q<HTMLInputElement>("#gp-new-key")!.type === "text", "U4 mostrar só o que foi digitado");
  await clickButton("Ocultar");
  check(q<HTMLInputElement>("#gp-new-key")!.type === "password", "U4 ocultar");
  ok("U4: 'Alterar chave' abre campo password vazio (sem a chave atual), autocomplete off; valida o formato antes de enviar; mostrar/ocultar só a chave digitada");

  // U5: Google recusa → mantém
  reply = () => ({ status: 422, body: { ok: false, kind: "permission_denied", message: "Não foi possível validar a chave. Google retornou PERMISSION_DENIED. Verifique as restrições da chave, Places API e faturamento. A chave atual foi mantida." } });
  await submit();
  const put = calls.at(-1);
  check(put?.method === "PUT" && put.url === "/api/admin/integrations/google-places" && JSON.parse(put.body).apiKey === NEW_KEY, "U5 envio", put);
  check(text("[data-gp-feedback]")?.includes("PERMISSION_DENIED") && text("[data-gp-masked]") === "AIza••••••••••••X9zQ" && q("[data-gp-form]"), "U5 mensagem, formulário aberto e chave ATUAL mantida", text("[data-gp-masked]"));
  ok("U5: 'Testar e salvar' envia a chave nova ao servidor; se o Google recusar (PERMISSION_DENIED) a mensagem aparece e a chave atual é mantida");

  // U6: sucesso → máscara nova, campo limpo
  reply = () => ({ status: 200, body: { ok: true, kind: "ok", message: "✓ Chave testada e salva. Já está em uso pela Avaliação Google.", last4: "0K7m" } });
  await submit();
  check(!q("[data-gp-form]") && text("[data-gp-masked]") === "AIza••••••••••••0K7m" && text("[data-gp-feedback]")?.startsWith("✓") && refreshed >= 1, "U6 sucesso");
  check(!container.innerHTML.includes(NEW_KEY), "U6 a chave não fica na tela");
  ok("U6: chave aceita → formulário fecha, campo é descartado, aparece só a máscara nova; a chave digitada não fica em lugar nenhum da tela");

  // U7: testar conexão
  reply = () => ({ status: 200, body: { ok: false, kind: "invalid_key", message: "Não foi possível validar a chave. Google retornou API key not valid: a chave não existe ou foi digitada errada.", source: "admin" } });
  await clickButton("Testar conexão");
  check(calls.at(-1)?.url === "/api/admin/integrations/google-places/test" && text("[data-gp-feedback]")?.includes("API key not valid") && text("[data-gp-last-test]")?.startsWith("Chave inválida"), "U7 testar");
  ok("U7: 'Testar conexão' mostra o resultado (ex.: API key not valid) e atualiza o último teste");

  // U8: remover com confirmação (sem window.confirm)
  reply = () => ({ status: 200, body: { ok: true, source: "env" } });
  const before = calls.length;
  await click("[data-gp-remove]");
  check(calls.length === before && text("[role=alertdialog]")?.includes("volta a usar a variável de ambiente"), "U8 pede confirmação");
  await click("[data-gp-remove-confirm]");
  check(calls.at(-1)?.method === "DELETE" && text("[data-gp-source]") === "Variável de ambiente" && !q("[data-gp-masked]") && text("[data-gp-feedback]")?.includes("Usando a variável de ambiente"), "U8 removido");
  check(dialogs === 0, "U8 sem alert/confirm/prompt");
  ok("U8: remover pede confirmação na própria tela (sem window.confirm), apaga só a configuração personalizada e volta para a variável de ambiente");

  await act(async () => root.unmount());
  if (failures) {
    console.log(`${failures} falha(s)`);
    process.exit(1);
  }
  console.log("Interface do Google Places OK");
  process.exit(0);
}
main().catch((e) => {
  console.log(e instanceof Error ? e.message : "erro");
  process.exit(1);
});
