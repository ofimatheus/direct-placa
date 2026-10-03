import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ResellerSaleStatusActions } from "@/components/reseller/ResellerSaleStatusActions";
import { PageTitle, Panel } from "@/components/ui/kit";
import { UUID_RE } from "@/components/ui/primitives";
import { requireResellerContext } from "@/lib/auth/session";
import type { ResellerSaleStatus } from "@/lib/db/types";
import { getCustomerDisplayName, getCustomerSecondaryName } from "@/lib/customers";
import { httpErrorFromDb } from "@/lib/http";
import { RESELLER_SALE_STATUS_LABEL, RESELLER_SALE_STATUS_STYLE } from "@/lib/reseller-sales";
import { formatCents } from "@/lib/reseller-sales";
import { formatBRL } from "@/lib/utils/money";
import { formatDate, formatDateTime } from "@/lib/utils/text";

export const metadata: Metadata = { title: "Venda" };

interface SaleRow {
  id: string;
  status: ResellerSaleStatus;
  total: number;
  sold_at: string;
  notes: string | null;
  customer_id: string | null;
  created_at: string;
}

interface SetupRow {
  plate_id: string;
  public_code: string;
  status: string;
  customer_name: string | null;
  configured: boolean;
}

function setupLabel(plate: SetupRow): { text: string; style: string } {
  if (plate.status === "blocked") return { text: "Bloqueada", style: "bg-[#fdecea] text-danger" };
  if (plate.configured) return { text: plate.status === "inactive" ? "Configurada (pausada)" : "Configurada", style: "bg-[#e7f4ec] text-ok" };
  return { text: "Pendente", style: "bg-[#fff4e0] text-[#8a5a00]" };
}

export default async function ResellerSaleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const { supabase } = await requireResellerContext();

  // A RLS já garante que só a própria venda é legível: um id de outro
  // revendedor simplesmente não retorna linha.
  const { data: sale, error } = await supabase
    .from("reseller_sales")
    .select("id, status, total, sold_at, notes, customer_id, created_at")
    .eq("id", id)
    .maybeSingle<SaleRow>();
  if (error) throw httpErrorFromDb(error);
  if (!sale) notFound();

  const [platesResult, customerResult, pricingResult] = await Promise.all([
    supabase.rpc("reseller_sale_plate_setup", { p_sale_id: id }),
    sale.customer_id
      ? supabase.from("customers").select("id, name, company_name").eq("id", sale.customer_id).maybeSingle<{ id: string; name: string; company_name: string | null }>()
      : Promise.resolve({ data: null, error: null }),
    // Detalhamento (vendas novas). Vendas antigas não têm: mostram só o valor.
    supabase
      .from("reseller_sale_pricing")
      .select("quantity, unit_price_cents, subtotal_cents, discount_cents, total_cents")
      .eq("sale_id", id)
      .maybeSingle<{ quantity: number; unit_price_cents: number; subtotal_cents: number; discount_cents: number; total_cents: number }>(),
  ]);
  if (platesResult.error) throw httpErrorFromDb(platesResult.error);
  const pricing = pricingResult.error ? null : pricingResult.data;
  const plates = (platesResult.data ?? []) as SetupRow[];

  // Pendente = ainda sem destino. Configurada = destino salvo (ativa ou pausada).
  const configuredCount = plates.filter((p) => p.configured).length;
  const reservedCount = plates.filter((p) => p.status === "assigned" && !p.configured).length;
  const inUseCount = plates.length - reservedCount;
  const cancelled = sale.status === "cancelled";

  return (
    <div className="space-y-6">
      <PageTitle
        title={`Venda de ${formatDate(sale.sold_at)}`}
        subtitle={
          customerResult.data
            ? [getCustomerDisplayName(customerResult.data), getCustomerSecondaryName(customerResult.data)].filter(Boolean).join(" · ")
            : "Sem cliente vinculado"
        }
        action={
          <Link href="/reseller/sales" className="btn btn-ghost">
            Voltar
          </Link>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Panel
          title={cancelled ? "Placas da venda" : "Configurar placas da venda"}
          subtitle={
            cancelled
              ? `${plates.length} placa(s)`
              : `${configuredCount} de ${plates.length} configurada${plates.length === 1 ? "" : "s"}`
          }
        >
          {!cancelled && plates.length > 0 && (
            <div className="px-5 pb-3">
              <div className="h-2 overflow-hidden rounded-full bg-paper" aria-hidden>
                <div className="h-full rounded-full bg-ok" style={{ width: `${(configuredCount / plates.length) * 100}%` }} />
              </div>
              {configuredCount < plates.length && (
                <p className="mt-2 text-xs text-ink-soft">
                  Configure o destino de cada placa para ativá-la. O cliente da venda já vem preenchido.
                </p>
              )}
            </div>
          )}
          <ul className="divide-y divide-line border-t border-line">
            {plates.map((plate) => {
              const label = setupLabel(plate);
              return (
                <li key={plate.plate_id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <Link href={`/reseller/plates/${plate.plate_id}`} className="font-mono font-semibold hover:underline">
                    {plate.public_code}
                  </Link>
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${label.style}`}>{label.text}</span>
                  {plate.customer_name && <span className="truncate text-sm text-ink-soft">{plate.customer_name}</span>}
                  <Link
                    href={`/reseller/plates/${plate.plate_id}`}
                    className={`btn btn-small ml-auto ${!plate.configured && !cancelled && plate.status === "assigned" ? "btn-primary" : ""}`}
                  >
                    {!plate.configured && plate.status === "assigned" ? "Configurar" : "Ver placa"}
                  </Link>
                </li>
              );
            })}
            {plates.length === 0 && <li className="px-5 py-4 text-sm text-ink-soft">Nenhuma placa desta venda está mais com você.</li>}
          </ul>
        </Panel>

        <div className="space-y-4">
          <Panel title="Resumo">
            <dl className="space-y-3 px-5 pb-5 text-sm">
              {pricing && (
                <>
                  <div className="flex items-center justify-between gap-3" data-sale-pricing="">
                    <dt className="text-ink-soft">
                      {pricing.quantity} placa{pricing.quantity === 1 ? "" : "s"} × {formatCents(Number(pricing.unit_price_cents))}
                    </dt>
                    <dd className="tabular-nums">{formatCents(Number(pricing.subtotal_cents))}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-ink-soft">Desconto</dt>
                    <dd className="tabular-nums">− {formatCents(Number(pricing.discount_cents))}</dd>
                  </div>
                </>
              )}
              <div className="flex items-center justify-between">
                <dt className="text-ink-soft">{pricing ? "Valor total" : "Valor"}</dt>
                <dd className="text-lg font-extrabold tabular-nums">{formatBRL(sale.total)}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-ink-soft">Status</dt>
                <dd>
                  <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-bold ${RESELLER_SALE_STATUS_STYLE[sale.status]}`}>
                    {RESELLER_SALE_STATUS_LABEL[sale.status]}
                  </span>
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-ink-soft">Registrada em</dt>
                <dd className="text-ink-soft">{formatDateTime(sale.created_at)}</dd>
              </div>
              {sale.notes && (
                <div>
                  <dt className="text-ink-soft">Observação</dt>
                  <dd className="mt-1">{sale.notes}</dd>
                </div>
              )}
            </dl>
          </Panel>

          <Panel title="Ações">
            <div className="px-5 pb-5">
              <ResellerSaleStatusActions
                saleId={sale.id}
                status={sale.status}
                reservedCount={reservedCount}
                inUseCount={inUseCount}
              />
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
