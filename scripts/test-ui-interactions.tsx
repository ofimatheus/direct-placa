/**
 * Interações reais (DOM do happy-dom, cliques, digitação, Esc) nos modais do
 * sistema, no formulário de venda do revendedor e nos gráficos. Sem navegador
 * e sem Supabase: fetch e roteador são simulados.
 *   npm run test:ui
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { Window } from "happy-dom";

const win = new Window({ url: "http://localhost/" });
const g = globalThis as Record<string, unknown>;
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLTextAreaElement", "HTMLSelectElement", "Node", "Event", "KeyboardEvent", "MouseEvent", "getComputedStyle"]) {
  const value = key === "window" ? win : (win as unknown as Record<string, unknown>)[key];
  Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
}
g.IS_REACT_ACT_ENVIRONMENT = true;

let failures = 0;
const ok = (label: string) => console.log(`OK ${label}`);
const check = (condition: unknown, label: string, detail?: unknown) => {
  if (condition) return true;
  failures++;
  console.log(`FALHA ${label}`, detail ?? "");
  return false;
};

async function main() {
  const React = await import("react");
  const { act } = React;
  const { createRoot } = await import("react-dom/client");
  const { renderToString } = await import("react-dom/server");
  const { AppRouterContext } = await import("next/dist/shared/lib/app-router-context.shared-runtime");
  const { ConfirmDialog } = await import("@/components/ui/Modal");
  const { BatchLifecycleActions } = await import("@/components/batches/BatchLifecycleActions");
  const { SaleStatusActions } = await import("@/components/sales/SaleStatusActions");
  const { NewResellerSaleForm, NEW_CUSTOMER, NO_CUSTOMER } = await import("@/components/reseller/NewResellerSaleForm");
  const { RevenueChart } = await import("@/components/dashboard/RevenueChart");
  const { SalesRevenueChart } = await import("@/components/reseller/SalesRevenueChart");
  const { seriesShape } = await import("@/lib/utils/chart");

  const pushed: string[] = [];
  const router = { push: (h: string) => void pushed.push(h), replace() {}, refresh() {}, back() {}, forward() {}, prefetch() {} };

  type FetchCall = { url: string; body: unknown };
  let fetchCalls: FetchCall[] = [];
  let fetchReply: (url: string) => { status: number; body: unknown } = () => ({ status: 200, body: {} });
  g.fetch = async (url: string, init?: { body?: string }) => {
    fetchCalls.push({ url, body: init?.body ? JSON.parse(init.body) : null });
    const reply = fetchReply(url);
    return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { "Content-Type": "application/json" } });
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
  const q = <T extends Element = HTMLElement>(sel: string) => container.querySelector(sel) as unknown as T | null;
  const byText = (tag: string, text: string) =>
    [...container.querySelectorAll(tag)].find((el) => (el.textContent ?? "").trim() === text) as unknown as HTMLElement | undefined;
  const click = async (el: Element | null | undefined) => {
    await act(async () => {
      (el as HTMLElement).dispatchEvent(new win.MouseEvent("click", { bubbles: true }) as unknown as Event);
    });
  };
  const type = async (el: Element | null, value: string) => {
    await act(async () => {
      const proto = el instanceof win.HTMLTextAreaElement ? win.HTMLTextAreaElement.prototype : win.HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
      (el as HTMLElement).dispatchEvent(new win.Event("input", { bubbles: true }) as unknown as Event);
    });
  };
  const choose = async (el: Element | null, value: string) => {
    await act(async () => {
      Object.getOwnPropertyDescriptor(win.HTMLSelectElement.prototype, "value")!.set!.call(el, value);
      (el as HTMLElement).dispatchEvent(new win.Event("change", { bubbles: true }) as unknown as Event);
    });
  };
  const pressEscape = async () => {
    await act(async () => {
      document.dispatchEvent(new win.KeyboardEvent("keydown", { key: "Escape", bubbles: true }) as unknown as Event);
    });
  };
  const dialog = () => q('[role="dialog"]');
  const confirmButton = () => q<HTMLButtonElement>("[data-confirm]");

  // ---------------- M1: ConfirmDialog ----------------
  {
    let confirmed = 0;
    let cancelled = 0;
    const Harness = () => {
      const [open, setOpen] = React.useState(true);
      return (
        <ConfirmDialog
          open={open}
          title="Colocar lote em quarentena"
          confirmLabel="Colocar em quarentena"
          reason={{ label: "Motivo", minLength: 3 }}
          onCancel={() => {
            cancelled++;
            setOpen(false);
          }}
          onConfirm={() => {
            confirmed++;
          }}
        />
      );
    };
    await mount(<Harness />);
    check(confirmButton()?.disabled, "M1 confirmar habilitado sem motivo");
    await click(byText("button", "Cancelar"));
    check(confirmed === 0 && cancelled === 1 && !dialog(), "M1 cancelar", { confirmed, cancelled });
    ok("M1: diálogo exige o motivo e Cancelar fecha sem executar a ação");
  }

  // ---------------- M2: quarentena de lote (fluxo real) ----------------
  {
    fetchCalls = [];
    fetchReply = () => ({ status: 200, body: { batch: {} } });
    await mount(<BatchLifecycleActions batchId="b1" batchName="Lote Setembro" status="active" committed={0} availableStock={10} />);
    await click(byText("button", "Colocar em quarentena"));
    const text = dialog()?.textContent ?? "";
    check(text.includes("Colocar lote em quarentena") && text.includes("Nenhum QR ou código será apagado"), "M2 texto do modal", text);
    const reason = q('[role="dialog"] textarea');
    check(reason && (q('[role="dialog"] label')?.textContent ?? "").includes("Motivo"), "M2 campo Motivo dentro do modal");
    check(confirmButton()?.disabled, "M2 confirmar sem motivo");

    await click(byText("button", "Cancelar"));
    check(!dialog() && fetchCalls.length === 0, "M2 cancelar executou a ação", fetchCalls);

    await click(byText("button", "Colocar em quarentena"));
    await pressEscape();
    check(!dialog() && fetchCalls.length === 0, "M2 Esc executou a ação", fetchCalls);

    await click(byText("button", "Colocar em quarentena"));
    await type(q('[role="dialog"] textarea'), "ab");
    check(confirmButton()?.disabled, "M2 aceitou motivo com 2 caracteres");
    await type(q('[role="dialog"] textarea'), "Falha de impressão");
    check(!confirmButton()?.disabled, "M2 motivo válido não habilitou");
    await click(confirmButton());
    check(
      fetchCalls.length === 1 &&
        fetchCalls[0]!.url === "/api/admin/batches/b1/lifecycle" &&
        JSON.stringify(fetchCalls[0]!.body) === JSON.stringify({ status: "quarantine", reason: "Falha de impressão" }),
      "M2 envio",
      fetchCalls,
    );
    check(!dialog(), "M2 modal não fechou após sucesso");
    ok("M2: quarentena abre modal com Motivo; Cancelar e Esc não enviam nada; só envia com motivo válido");
  }

  // ---------------- M3: erro do servidor fica no modal ----------------
  {
    fetchCalls = [];
    fetchReply = () => ({ status: 409, body: { error: "Este lote tem 2 placa(s) em uso" } });
    await mount(<BatchLifecycleActions batchId="b1" batchName="Lote" status="quarantine" committed={0} availableStock={0} />);
    await click(byText("button", "Restaurar lote"));
    await click(confirmButton());
    check(dialog() && (dialog()!.textContent ?? "").includes("Este lote tem 2 placa(s) em uso"), "M3 erro no modal");
    ok("M3: recusa do servidor aparece dentro do modal, que continua aberto");
  }

  // ---------------- M4: cancelar venda mantendo placas exige o número ----------------
  {
    fetchCalls = [];
    fetchReply = () => ({ status: 200, body: { sale: {} } });
    await mount(<SaleStatusActions saleId="s1" orderNumber={42} status="pending" reservedCount={2} inUse={[{ code: "P7D441", label: "Ativa" }]} />);
    await click(byText("button", "Cancelar e manter placas em uso com o revendedor"));
    const input = q('[role="dialog"] input');
    await type(input, "41");
    check(confirmButton()?.disabled, "M4 aceitou número errado");
    await click(byText("button", "Voltar"));
    check(fetchCalls.length === 0, "M4 Voltar executou a ação");
    await click(byText("button", "Cancelar e manter placas em uso com o revendedor"));
    await type(q('[role="dialog"] input'), "42");
    await click(confirmButton());
    check(fetchCalls.length === 1 && (fetchCalls[0]!.body as { keep_plates_in_use: boolean }).keep_plates_in_use === true, "M4 envio", fetchCalls);
    ok("M4: cancelar mantendo placas em uso exige digitar o número da venda no modal");
  }

  // ---------------- V1: venda do revendedor: cliente primeiro + cadastro rápido ----------------
  {
    fetchCalls = [];
    pushed.length = 0;
    const NEW_ID = "0b6f1d2e-3c4a-4e5f-8a9b-1c2d3e4f5a6b";
    fetchReply = (url) =>
      url === "/api/reseller/customers"
        ? { status: 201, body: { customer: { id: NEW_ID, name: "Zeca Novo" } } }
        : { status: 201, body: { sale_id: "5a4b3c2d-1e0f-4a9b-8c7d-6e5f4a3b2c1d" } };
    const plates = [
      { plate_id: "p-1", public_code: "JKJ4NN", status: "assigned", batch_name: "Lote A", created_at: "" },
      { plate_id: "p-2", public_code: "SPR34S", status: "assigned", batch_name: "Lote A", created_at: "" },
    ];
    await mount(<NewResellerSaleForm plates={plates as never} customers={[{ id: "c-joao", name: "João" }]} />);

    const sections = [...container.querySelectorAll("section h2")].map((h) => h.textContent);
    check(sections.join("|") === "1. Cliente|2. Placas|3. Valor e detalhes", "V1 ordem das etapas", sections);
    const options = [...container.querySelectorAll("select")[0]!.querySelectorAll("option")].map((o) => o.textContent);
    check(options[1] === "+ Novo cliente" && options[3] === "Sem cliente", "V1 opções do cliente", options);
    check((q<HTMLFieldSetElement>("fieldset")!).disabled, "V1 placas habilitadas antes de escolher o cliente");

    await type(q('input[inputmode="decimal"]'), "150,00"); // valor preenchido antes do cadastro
    await choose(container.querySelector("select"), NEW_CUSTOMER);
    check((dialog()?.textContent ?? "").includes("Novo cliente"), "V1 modal Novo cliente");
    check(pushed.length === 0, "V1 redirecionou para outra página");
    await click(byText("button", "Cancelar"));
    check(!dialog() && (q<HTMLSelectElement>("select")!).value === "", "V1 cancelar o cadastro mudou a escolha");

    await choose(container.querySelector("select"), NEW_CUSTOMER);
    await type(q('[role="dialog"] input'), "Zeca Novo");
    await click(byText("button", "Cadastrar cliente"));
    check(!dialog(), "V1 modal não fechou após cadastrar");
    check((q<HTMLSelectElement>("select")!).value === NEW_ID, "V1 cliente novo não ficou selecionado");
    check((q<HTMLInputElement>('input[inputmode="decimal"]')!).value === "150,00", "V1 formulário perdeu o valor");
    check(!(q<HTMLFieldSetElement>("fieldset")!).disabled, "V1 placas continuaram desabilitadas");

    await click(q('input[aria-label="Selecionar placa JKJ4NN"]'));
    await click(byText("button", "Salvar venda"));
    const sale = fetchCalls.find((c) => c.url === "/api/reseller/sales");
    check(sale && (sale.body as { customer_id: string }).customer_id === NEW_ID, "V1 venda sem o cliente novo", sale);
    check(pushed[0] === "/reseller/plates/p-1?venda=5a4b3c2d-1e0f-4a9b-8c7d-6e5f4a3b2c1d", "V1 venda com 1 placa não abriu a configuração", pushed);
    ok("V1: cliente primeiro; + Novo cliente abre modal, cria, seleciona e preserva o formulário; 1 placa abre a configuração");
  }

  // ---------------- V2: sem cliente + várias placas ----------------
  {
    fetchCalls = [];
    pushed.length = 0;
    fetchReply = () => ({ status: 201, body: { sale_id: "9f8e7d6c-5b4a-4392-8a1b-0c9d8e7f6a5b" } });
    const plates = [
      { plate_id: "p-1", public_code: "JKJ4NN", status: "assigned", batch_name: null, created_at: "" },
      { plate_id: "p-2", public_code: "SPR34S", status: "assigned", batch_name: null, created_at: "" },
    ];
    await mount(<NewResellerSaleForm plates={plates as never} customers={[]} />);
    await choose(container.querySelector("select"), NO_CUSTOMER);
    await click(q('input[aria-label="Selecionar placa JKJ4NN"]'));
    await click(q('input[aria-label="Selecionar placa SPR34S"]'));
    await type(q('input[inputmode="decimal"]'), "90");
    await click(byText("button", "Salvar venda"));
    const body = fetchCalls[0]?.body as { customer_id: unknown; plate_ids: string[] };
    check(body && body.customer_id === null && body.plate_ids.length === 2, "V2 corpo", body);
    check(pushed[0] === "/reseller/sales/9f8e7d6c-5b4a-4392-8a1b-0c9d8e7f6a5b", "V2 várias placas não abriu a venda", pushed);
    ok("V2: 'Sem cliente' envia customer_id nulo; várias placas abrem o detalhe da venda");
  }

  await act(async () => root.unmount());

  // ---------------- D: gráficos (ADMIN e revendedor) ----------------
  check(seriesShape([0, 0, 0]).kind === "empty" && seriesShape([0, 5, 0]).kind === "single" && seriesShape([1, 0, 2]).kind === "trend", "D0 classificação");
  const adminPoints = (values: number[]) => values.map((revenue, i) => ({ bucket_start: `2026-0${i + 1}-01 00:00:00`, revenue, sales: revenue ? 1 : 0 }));
  const resellerPoints = (values: number[]) => values.map((revenue, i) => ({ month: `2026-0${i + 4}-01`, revenue, sales: revenue ? 2 : 0 }));
  const cases: [string, string, string[]][] = [
    ["ADMIN zero", renderToString(<RevenueChart points={adminPoints([0, 0, 0, 0])} bucket="month" />), ['data-chart-state="empty"', "Ainda não há faturamento no período.", "jan", "abr"]],
    ["ADMIN um mês", renderToString(<RevenueChart points={adminPoints([0, 0, 1500, 0])} bucket="month" />), ['data-chart-state="single"', "1.500,00", "mar/2026", "Ainda há poucos dados para formar uma tendência."]],
    ["ADMIN vários", renderToString(<RevenueChart points={adminPoints([100, 0, 1500, 300])} bucket="month" />), ['data-chart-state="trend"', "<rect"]],
    ["Revendedor zero", renderToString(<SalesRevenueChart points={resellerPoints([0, 0, 0, 0, 0, 0])} />), ['data-chart-state="empty"', "Ainda não há faturamento no período.", "abr", "set"]],
    ["Revendedor um mês", renderToString(<SalesRevenueChart points={resellerPoints([0, 0, 0, 0, 0, 890])} />), ['data-chart-state="single"', "890,00", "set/2026", "Ainda há poucos dados para formar uma tendência."]],
    ["Revendedor vários", renderToString(<SalesRevenueChart points={resellerPoints([0, 120, 0, 0, 300, 890])} />), ['data-chart-state="trend"', 'aria-label="Faturamento por mês"']],
  ];
  for (const [label, html, expected] of cases) {
    const missing = expected.filter((text) => !html.includes(text));
    check(missing.length === 0, `D ${label}`, missing);
    if (label.includes("vários")) check(!html.includes("poucos dados"), `D ${label} mostrou aviso de poucos dados`);
  }
  ok("D: gráficos de ADMIN e revendedor com zero, um e vários períodos");

  // ---------------- S: nenhum popup nativo no código ----------------
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(tsx?|jsx?)$/.test(name)) {
        readFileSync(path, "utf8")
          .split("\n")
          .forEach((line, i) => {
            const code = line.replace(/\/\/.*$/, "").replace(/^\s*\*.*$/, "");
            if (/window\.(confirm|prompt|alert)\s*\(|(^|[^\w.])(alert|confirm|prompt)\s*\(/.test(code)) offenders.push(`${path}:${i + 1}`);
          });
      }
    }
  };
  walk(join(process.cwd(), "src"));
  check(offenders.length === 0, "S popups nativos encontrados", offenders);
  ok("S: nenhum window.confirm, window.prompt ou alert no código da aplicação");

  if (failures) {
    console.log(`${failures} falha(s)`);
    process.exit(1);
  }
  console.log("Interações OK");
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
