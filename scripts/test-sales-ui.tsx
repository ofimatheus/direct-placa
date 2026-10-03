/**
 * Teste de renderização dos componentes do fluxo de venda (sem navegador e sem Supabase):
 * formulário Nova Venda (modos, estoque por lote, bloqueio por estoque insuficiente) e
 * ações da venda (cancelamento comum x ação administrativa com placa em uso).
 *   npm run test:sales-ui
 */
import { renderToString as rawRender } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
const router = { push() {}, replace() {}, refresh() {}, back() {}, forward() {}, prefetch() {} };
const renderToString = (node: React.ReactNode) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rawRender(<AppRouterContext.Provider value={router as any}>{node}</AppRouterContext.Provider>);
import { NewSaleForm } from "@/components/sales/NewSaleForm";
import { SaleStatusActions } from "@/components/sales/SaleStatusActions";

let failures = 0;
function expect(html: string, text: string, label: string) {
  if (!html.includes(text)) { failures++; console.error(`FALHA ${label}: não encontrou "${text}"`); }
  else console.log(`OK ${label}: "${text}"`);
}

const form = renderToString(
  <NewSaleForm
    resellers={[{ id: "r1", name: "XP Comunicação" }]}
    availableTotal={7}
    stock={[{ batch_id: "b1", batch_name: "Lote Setembro", template_name: "Google Preto", available: 7 }]}
  />,
);
expect(form, "Placas da venda", "form");
expect(form, "Automática", "form");
expect(form, "Manual", "form");
expect(form, "Lote Setembro, Google Preto (7 disponíveis)", "form");
expect(form, "Existem apenas 7 placas disponíveis.", "form (10 pedidas, 7 no estoque)");
expect(form, "disabled", "form (botão bloqueado sem estoque)");

const blocked = renderToString(
  <SaleStatusActions saleId="s1" orderNumber={42} status="pending" reservedCount={2} inUse={[{ code: "P7D441", label: "Ativa" }]} />,
);
expect(blocked, "Cancelamento automático bloqueado", "ações com placa ativa");
expect(blocked, "P7D441 (Ativa)", "ações com placa ativa");
expect(blocked, "Cancelar e manter placas em uso com o revendedor", "ações com placa ativa");
if (blocked.includes(">Cancelar venda<")) { failures++; console.error("FALHA: cancelamento comum não deveria aparecer"); }

const normal = renderToString(<SaleStatusActions saleId="s1" orderNumber={42} status="paid" reservedCount={10} inUse={[]} />);
expect(normal, "Cancelar venda", "ações só com reservadas");
if (normal.includes("Marcar como pago")) { failures++; console.error("FALHA: venda paga mostrou Marcar como pago"); }

const cancelled = renderToString(<SaleStatusActions saleId="s1" orderNumber={42} status="cancelled" reservedCount={0} inUse={[]} />);
expect(cancelled, "Venda cancelada", "venda cancelada");

if (failures) { console.error(`${failures} falha(s)`); process.exit(1); }
console.log("Componentes OK");
