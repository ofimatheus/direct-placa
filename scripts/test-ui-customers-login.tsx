/**
 * Interações reais (happy-dom): quarentena de clientes, nome de exibição nos
 * seletores, variações da tela de login e o editor de branding.
 *   npm run test:ui-customers-login
 */
import { Window } from "happy-dom";

const win = new Window({ url: "http://localhost/" });
const g = globalThis as Record<string, unknown>;
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLTextAreaElement", "HTMLSelectElement", "Node", "Event", "KeyboardEvent", "MouseEvent", "getComputedStyle", "ResizeObserver"]) {
  const value = key === "window" ? win : (win as unknown as Record<string, unknown>)[key];
  if (value !== undefined) Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
}
if (!g.ResizeObserver) g.ResizeObserver = class { observe() {} disconnect() {} unobserve() {} };
Object.defineProperty(globalThis, "self", { value: win, configurable: true, writable: true });
g.IS_REACT_ACT_ENVIRONMENT = true;

let failures = 0;
const ok = (label: string) => console.log(`OK ${label}`);
const check = (condition: unknown, label: string, detail?: unknown) => {
  if (!condition) {
    failures++;
    console.log(`FALHA ${label}`, detail ?? "");
  }
};

async function main() {
  const React = await import("react");
  const { act } = React;
  const { createRoot } = await import("react-dom/client");
  const { renderToString } = await import("react-dom/server");
  const { AppRouterContext } = await import("next/dist/shared/lib/app-router-context.shared-runtime");
  const { CustomerManager } = await import("@/components/reseller/CustomerManager");
  const { NewResellerSaleForm } = await import("@/components/reseller/NewResellerSaleForm");
  const { LoginScreen } = await import("@/components/login/LoginScreen");
  const { BrandingEditor } = await import("@/components/settings/BrandingEditor");
  const { DEFAULT_BRANDING, resolveBranding } = await import("@/lib/branding/defaults");

  const router = { push() {}, replace() {}, refresh() {}, back() {}, forward() {}, prefetch() {} };
  type Call = { url: string; method: string; body: unknown };
  let calls: Call[] = [];
  let reply: (url: string) => { status: number; body: unknown } = () => ({ status: 200, body: {} });
  g.fetch = async (url: string, init?: { method?: string; body?: unknown }) => {
    const raw = init?.body;
    const body = typeof raw === "string" ? JSON.parse(raw) : raw ?? null;
    calls.push({ url, method: init?.method ?? "GET", body });
    const r = reply(url);
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { "Content-Type": "application/json" } });
  };

  const container = document.createElement("div");
  document.body.appendChild(container);
  let root = createRoot(container as unknown as Element);
  const mount = async (node: React.ReactNode) => {
    await act(async () => {
      root.unmount();
      root = createRoot(container as unknown as Element);
      root.render(<AppRouterContext.Provider value={router as never}>{node}</AppRouterContext.Provider>);
    });
  };
  const q = <T,>(sel: string) => container.querySelector(sel) as unknown as T | null;
  const byText = (tag: string, text: string) =>
    [...container.querySelectorAll(tag)].find((el) => (el.textContent ?? "").trim() === text) as unknown as HTMLElement | undefined;
  const click = async (el: unknown) => {
    await act(async () => {
      (el as HTMLElement).dispatchEvent(new win.MouseEvent("click", { bubbles: true }) as unknown as Event);
    });
  };
  const type = async (el: unknown, value: string) => {
    await act(async () => {
      const proto = el instanceof win.HTMLTextAreaElement ? win.HTMLTextAreaElement.prototype : win.HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
      (el as HTMLElement).dispatchEvent(new win.Event("input", { bubbles: true }) as unknown as Event);
    });
  };
  const dialog = () => q<HTMLElement>('[role="dialog"]');
  const confirmButton = () => q<HTMLButtonElement>("[data-confirm]");

  const customers = [
    { id: "c1", name: "João da Silva", company_name: "Adega Monster", phone: "11 9999", email: null, notes: null, plates: 2, archived_at: null, archive_reason: null },
    { id: "c2", name: "Ana Beatriz", company_name: null, phone: null, email: null, notes: null, plates: 0, archived_at: null, archive_reason: null },
    { id: "c3", name: "Rui", company_name: "Bar Antigo", phone: null, email: null, notes: null, plates: 1, archived_at: "2026-09-30T12:00:00Z", archive_reason: "Fechou" },
  ];

  // ---------------- Q1: aba Ativos + Excluir = quarentena ----------------
  {
    calls = [];
    reply = () => ({ status: 200, body: { customer: {} } });
    await mount(<CustomerManager customers={customers} tab="active" />);
    const text = container.textContent ?? "";
    check(text.includes("Adega Monster") && text.includes("João da Silva"), "Q1 empresa + responsável");
    check(!text.includes("Bar Antigo"), "Q1 cliente em quarentena apareceu nos ativos");
    check(text.includes("Ativos 2") && text.includes("Quarentena 1") && text.includes("Todos 3"), "Q1 contagens das abas", text.slice(0, 300));

    await click([...container.querySelectorAll("button")].find((b) => b.textContent === "Excluir"));
    const d = dialog()?.textContent ?? "";
    check(d.includes("Excluir Adega Monster") && d.includes("não será apagado") && d.includes("Quarentena"), "Q1 modal explica a quarentena", d);
    await click(byText("button", "Cancelar"));
    check(!dialog() && calls.length === 0, "Q1 cancelar executou a ação", calls);

    await click([...container.querySelectorAll("button")].find((b) => b.textContent === "Excluir"));
    await type(q('[role="dialog"] textarea'), "Encerrou as atividades");
    await click(confirmButton());
    check(
      calls.length === 1 && calls[0]!.url === "/api/reseller/customers/c1/quarantine" && calls[0]!.method === "POST" &&
        (calls[0]!.body as { reason: string }).reason === "Encerrou as atividades",
      "Q1 envio da quarentena",
      calls,
    );
    check(!calls.some((c) => c.method === "DELETE"), "Q1 usou DELETE");
    ok("Q1: lista mostra a empresa (responsável abaixo); Excluir abre modal de quarentena; Cancelar não faz nada; confirmar envia a quarentena (sem DELETE)");
  }

  // ---------------- Q2: aba Quarentena + Restaurar ----------------
  {
    calls = [];
    await mount(<CustomerManager customers={customers} tab="quarantine" />);
    const text = container.textContent ?? "";
    check(text.includes("Bar Antigo") && text.includes("Rui") && text.includes("Em quarentena desde") && text.includes("Fechou"), "Q2 colunas", text);
    check(!text.includes("Adega Monster"), "Q2 ativo apareceu na quarentena");
    await click(byText("button", "Restaurar"));
    await click(confirmButton());
    check(calls.length === 1 && calls[0]!.url === "/api/reseller/customers/c3/restore", "Q2 restaurar", calls);
    ok("Q2: aba Quarentena mostra comércio, responsável, data e motivo; Restaurar envia a restauração");
  }

  // ---------------- Q3: busca ----------------
  {
    await mount(<CustomerManager customers={customers} tab="all" />);
    await type(q('input[type="search"]'), "joao");
    const rows = [...container.querySelectorAll("tbody tr")].map((r) => r.textContent);
    check(rows.length === 1 && rows[0]!.includes("Adega Monster"), "Q3 busca pelo responsável", rows);
    await type(q('input[type="search"]'), "antigo");
    check([...container.querySelectorAll("tbody tr")].length === 1, "Q3 busca pela empresa");
    ok("Q3: busca na tela Clientes encontra pelo responsável e pela empresa");
  }

  // ---------------- Q4: seletor da Nova Venda ----------------
  {
    const plates = [{ plate_id: "p1", public_code: "JKJ4NN", status: "assigned", batch_name: null, created_at: "" }];
    await mount(<NewResellerSaleForm plates={plates as never} customers={[{ id: "c2", name: "Ana Beatriz", company_name: null }, { id: "c1", name: "João da Silva", company_name: "Adega Monster" }]} />);
    const options = [...container.querySelector("select")!.querySelectorAll("option")].map((o) => o.textContent);
    check(options.includes("Adega Monster (João da Silva)") && options.includes("Ana Beatriz") && !options.some((o) => o?.includes("Bar Antigo")), "Q4 opções", options);
    ok("Q4: Nova Venda mostra a empresa como nome do cliente (responsável entre parênteses)");
  }

  // ---------------- L: tela de login ----------------
  const noop = async () => {};
  const html = (branding: typeof DEFAULT_BRANDING, action?: typeof noop) =>
    renderToString(<LoginScreen branding={branding} formAction={action} next="/admin/plates" />);
  {
    const page = html(DEFAULT_BRANDING, noop);
    for (const needle of ['data-login-banner="default"', ">Direct<", ">Placa<", "Acesso à plataforma", ">Entrar<", "Gerencie placas, revendedores e clientes em um só lugar.", 'name="email"', 'name="password"', 'type="submit"', "Acesso seguro para administradores e revendedores", "PLACAS QUE MOVEM NEGÓCIOS", 'value="/admin/plates"'])
      check(page.includes(needle), `L1 padrão sem "${needle}"`);
    check(!/Lembrar de mim|Esqueci/i.test(page), "L1 não deve ter funções falsas");
    ok("L1: login padrão DirectPlaca completo (marca, textos, e-mail, senha, Entrar) e sem botões falsos");

    const custom = resolveBranding(
      { brand_name: "Minha Marca", show_brand_name: true, eyebrow: "Área do parceiro", title: "Bem-vindo", subtitle: "Sub", logo_path: "logo/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1.png", banner_path: "banner/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1.webp" },
      "https://proj.supabase.co",
    );
    const customHtml = html(custom, noop);
    check(customHtml.includes('data-login-banner="custom"') && customHtml.includes("/branding/banner/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1.webp"), "L2 banner");
    check(customHtml.includes("/branding/logo/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1.png") && customHtml.includes("Bem-vindo") && customHtml.includes("Área do parceiro"), "L2 logo e textos");
    check(!customHtml.includes("PLACAS QUE MOVEM NEGÓCIOS") && customHtml.includes('name="password"') && customHtml.includes('type="submit"'), "L2 formulário fora do banner");
    const onlyLogo = html({ ...custom, showBrandName: false }, noop);
    const cardLogo = onlyLogo.slice(onlyLogo.indexOf("data-login-logo"), onlyLogo.indexOf("data-login-eyebrow"));
    check(!cardLogo.includes("login-wordmark") && cardLogo.includes("<img"), "L2 somente logo", cardLogo);
    ok("L2: banner e logo personalizados trocam só a arte; o formulário continua o mesmo; modo 'somente logo' funciona");

    const preview = html(DEFAULT_BRANDING);
    check(preview.includes('type="button"') && !preview.includes('type="submit"') && (preview.match(/disabled=""/g) ?? []).length >= 3, "L3 prévia inerte");
    ok("L3: a prévia não envia nada (campos e botão desabilitados)");
  }

  // ---------------- E: editor de branding ----------------
  {
    calls = [];
    const LOGO = "logo/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1.png";
    reply = (url) => (url === "/api/admin/branding/upload" ? { status: 201, body: { path: LOGO, url: "x" } } : { status: 200, body: { branding: {} } });
    await mount(<BrandingEditor initial={null} supabaseUrl="https://proj.supabase.co" available />);
    const saveButton = () => byText("button", "Salvar alterações") as HTMLButtonElement;
    check(saveButton()?.disabled, "E1 salvar habilitado sem alterações");

    const inputs = [...container.querySelectorAll("[data-branding-editor] input.input")] as unknown as HTMLInputElement[];
    const titleInput = inputs.find((i) => i.value === "Entrar")!;
    await type(titleInput, "Bem-vindo, parceiro");
    check((q<HTMLElement>("[data-branding-preview]")?.textContent ?? "").includes("Bem-vindo, parceiro"), "E1 prévia não atualizou");

    const file = new win.File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "logo.png", { type: "image/png" });
    const logoInput = q<HTMLInputElement>('input[data-upload="logo"]')!;
    await act(async () => {
      Object.defineProperty(logoInput, "files", { value: [file], configurable: true });
      logoInput.dispatchEvent(new win.Event("change", { bubbles: true }) as unknown as Event);
    });
    const upload = calls.find((c) => c.url === "/api/admin/branding/upload");
    check(upload && upload.method === "POST" && (upload.body as FormData).get("kind") === "logo", "E2 upload", upload);

    await click(saveButton());
    const saved = calls.find((c) => c.url === "/api/admin/branding" && c.method === "PUT");
    check(
      saved && (saved.body as { title: string }).title === "Bem-vindo, parceiro" && (saved.body as { logo_path: string }).logo_path === LOGO &&
        (saved.body as { brand_name: unknown }).brand_name === null,
      "E3 salvar",
      saved,
    );
    ok("E1–E3: a prévia acompanha a edição; upload envia a imagem; salvar grava textos e a logo (campo igual ao padrão vai nulo)");

    await click(byText("button", "Visualizar prévia"));
    check(container.querySelector('[aria-label="Prévia da tela de login"] [data-login-screen]'), "E4 prévia completa");
    await click(byText("button", "Fechar prévia"));

    calls = [];
    await click(byText("button", "Restaurar padrão"));
    check((dialog()?.textContent ?? "").includes("não são apagadas"), "E4 modal de restaurar");
    await click(byText("button", "Cancelar"));
    check(calls.length === 0, "E4 cancelar restaurou", calls);
    await click(byText("button", "Restaurar padrão"));
    await click(confirmButton());
    check(calls.length === 1 && calls[0]!.url === "/api/admin/branding/reset", "E4 restaurar", calls);
    ok("E4: Visualizar prévia abre a tela inteira; Restaurar padrão pede confirmação (Cancelar não faz nada)");
  }

  await act(async () => root.unmount());
  if (failures) {
    console.log(`${failures} falha(s)`);
    process.exit(1);
  }
  console.log("Interações de clientes e login OK");
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
