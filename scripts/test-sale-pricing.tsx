/**
 * Venda do revendedor com unitário + desconto: centavos exatos, regras do
 * total, esquema que descarta "total" e formulário (happy-dom).
 *   npm run test:sale-pricing
 */
import { Window } from "happy-dom";

const win = new Window({ url: "http://localhost/" });
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLSelectElement", "HTMLTextAreaElement", "Node", "Event", "MouseEvent", "KeyboardEvent", "getComputedStyle"]) {
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

async function main() {
  const { computeSaleTotals, formatCents, parseMoneyToCents, pricedSaleRequestSchema } = await import("@/lib/reseller-sales");

  // P1: centavos exatos, sem ponto flutuante
  const cases: [string, number | null][] = [
    ["25", 2500], ["25,5", 2550], ["25,50", 2550], ["1.234,56", 123456], ["R$ 10,00", 1000], ["10.50", 1050], ["0,1", 10], ["0,29", 29], ["1234567,89", 123456789],
    ["abc", null], ["1,234", null], ["-5", null], ["1,2,3", null], ["10,999", null], ["", null], ["12.34.56", null],
  ];
  for (const [input, expected] of cases) check(parseMoneyToCents(input) === expected, `P1 "${input}"`, parseMoneyToCents(input));
  check(formatCents(9000) === "R$ 90,00" && formatCents(123456789) === "R$ 1.234.567,89" && formatCents(30) === "R$ 0,30", "P1 formatação");
  ok("P1: valores digitados viram centavos inteiros exatos (0,29 → 29; 1.234,56 → 123456); formatos inválidos são recusados");

  // P2: regras do total (as mesmas do banco)
  const t = computeSaleTotals(4, 2500, 1000);
  check(t.subtotalCents === 10000 && t.totalCents === 9000 && t.error === null, "P2 exemplo", t);
  check(computeSaleTotals(1, 2500, 0).totalCents === 2500, "P2 uma placa");
  check(computeSaleTotals(2, 2500, 5001).error === "O desconto não pode ser maior que o subtotal.", "P2 desconto > subtotal");
  check(computeSaleTotals(2, 2500, 5000).error === null && computeSaleTotals(2, 2500, 5000).totalCents === 0, "P2 desconto = subtotal");
  check(computeSaleTotals(2, 2500, null).error !== null && computeSaleTotals(2, null, 0).error !== null, "P2 inválidos");
  ok("P2: quantidade × unitário − desconto (4 × R$ 25 − R$ 10 = R$ 90); desconto maior que o subtotal é recusado");

  // P3: o esquema da API descarta qualquer total enviado
  const parsed = pricedSaleRequestSchema.parse({
    plate_ids: ["3f1b8f3e-8c5a-4a8b-9d3c-2f6e1a7b9c01"],
    unit_price_cents: 2500,
    discount_cents: 0,
    total: 0.01,
    idempotency_key: "4a1b8f3e-8c5a-4a8b-9d3c-2f6e1a7b9c02",
  });
  check(!("total" in parsed) && parsed.unit_price_cents === 2500, "P3 total descartado", parsed);
  for (const bad of [{ unit_price_cents: 12.5 }, { unit_price_cents: -1 }, { discount_cents: -1 }, { unit_price_cents: "2500" }]) {
    const r = pricedSaleRequestSchema.safeParse({ plate_ids: ["3f1b8f3e-8c5a-4a8b-9d3c-2f6e1a7b9c01"], unit_price_cents: 2500, idempotency_key: "4a1b8f3e-8c5a-4a8b-9d3c-2f6e1a7b9c02", ...bad });
    check(!r.success, `P3 recusa ${JSON.stringify(bad)}`);
  }
  ok("P3: a API aceita só unitário e desconto em centavos inteiros; um 'total' adulterado é descartado antes de chegar ao banco");

  // P4: formulário real
  const React = await import("react");
  const { act } = React;
  const { createRoot } = await import("react-dom/client");
  const { AppRouterContext } = await import("next/dist/shared/lib/app-router-context.shared-runtime");
  const { NewResellerSaleForm } = await import("@/components/reseller/NewResellerSaleForm");
  let sent: Record<string, unknown> | null = null;
  (globalThis as Record<string, unknown>).fetch = async (_url: string, init?: { body?: string }) => {
    sent = init?.body ? JSON.parse(init.body) : null;
    return new Response(JSON.stringify({ sale_id: "5a4b3c2d-1e0f-4a9b-8c7d-6e5f4a3b2c1d" }), { status: 201, headers: { "Content-Type": "application/json" } });
  };
  const router = { push() {}, replace() {}, refresh() {}, back() {}, forward() {}, prefetch() {} };
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container as unknown as Element);
  const plates = [1, 2, 3].map((i) => ({ plate_id: `p-${i}`, public_code: `PLC00${i}`, status: "assigned", batch_name: null, created_at: "" }));
  await act(async () => root.render(<AppRouterContext.Provider value={router as never}><NewResellerSaleForm plates={plates as never} customers={[]} /></AppRouterContext.Provider>));
  const q = <T,>(s: string) => container.querySelector(s) as unknown as T;
  const total = () => q<HTMLElement>("[data-sale-total]").textContent;
  const subtotal = () => q<HTMLElement>("[data-sale-subtotal]").textContent;
  const type = async (el: unknown, v: string) =>
    act(async () => {
      Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, "value")!.set!.call(el, v);
      (el as HTMLElement).dispatchEvent(new win.Event("input", { bubbles: true }) as unknown as Event);
    });
  const click = async (el: unknown) => act(async () => void (el as HTMLElement).dispatchEvent(new win.MouseEvent("click", { bubbles: true }) as unknown as Event));
  await act(async () => {
    const select = container.querySelector("select")!;
    Object.getOwnPropertyDescriptor(win.HTMLSelectElement.prototype, "value")!.set!.call(select, "__none__");
    select.dispatchEvent(new win.Event("change", { bubbles: true }) as unknown as Event);
  });

  check(!container.textContent?.includes("Valor total") || q<HTMLElement>("[data-sale-total]").tagName === "OUTPUT", "P4 total é saída (não campo)");
  check(!q("input[data-sale-total]") && container.querySelectorAll("input").length > 0, "P4 sem input de total");
  await type(q("[data-sale-unit]"), "25,00");
  check(total() === "R$ 0,00", "P4 sem placas", total());
  await click(q('input[aria-label="Selecionar placa PLC001"]'));
  check(total() === "R$ 25,00", "P4 1 placa", total());
  await click(q('input[aria-label="Selecionar placa PLC002"]'));
  await click(q('input[aria-label="Selecionar placa PLC003"]'));
  check(subtotal() === "R$ 75,00" && total() === "R$ 75,00", "P4 3 placas", [subtotal(), total()]);
  await click(q('input[aria-label="Selecionar placa PLC003"]'));
  check(total() === "R$ 50,00", "P4 removeu placa", total());
  await type(q("[data-sale-unit]"), "30");
  check(total() === "R$ 60,00", "P4 mudou unitário", total());
  await type(q("[data-sale-discount]"), "10,00");
  check(total() === "R$ 50,00", "P4 desconto", total());
  ok("P4: o total recalcula na hora ao adicionar placa, remover placa, mudar o unitário e mudar o desconto; o total é só leitura");

  await type(q("[data-sale-discount]"), "61");
  const alert = container.querySelector('[data-sale-summary] [role="alert"]');
  const submit = [...container.querySelectorAll("button")].find((b) => b.textContent?.includes("Salvar venda")) as unknown as HTMLButtonElement;
  check(alert?.textContent === "O desconto não pode ser maior que o subtotal." && submit.disabled, "P5 desconto > subtotal", alert?.textContent);
  ok("P5: desconto maior que o subtotal mostra o erro e bloqueia o envio");

  await type(q("[data-sale-discount]"), "5");
  await act(async () => void container.querySelector("form")!.dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }) as unknown as Event));
  const body = sent as Record<string, unknown> | null;
  check(body && body.unit_price_cents === 3000 && body.discount_cents === 500 && !("total" in body) && (body.plate_ids as string[]).length === 2, "P6 corpo enviado", body);
  ok("P6: a venda é enviada com unitário (3000) e desconto (500) em centavos, sem total — o servidor calcula R$ 55,00");

  await act(async () => root.unmount());
  if (failures) {
    console.log(`${failures} falha(s)`);
    process.exit(1);
  }
  console.log("Preço da venda OK");
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
