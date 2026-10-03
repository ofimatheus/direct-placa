import type { Metadata } from "next";
import Link from "next/link";
import { PlateList } from "@/components/reseller/PlateList";
import { SalesRevenueChart } from "@/components/reseller/SalesRevenueChart";
import { QrAccessChart } from "@/components/dashboard/QrAccessChart";
import { Icon } from "@/components/ui/icons";
import { EmptyNote, InfoNote, KpiGrid, PageTitle, Panel, SearchForm, Segmented, StatCard } from "@/components/ui/kit";
import { requireResellerContext } from "@/lib/auth/session";
import { countQrAccesses, listResellerHighlights } from "@/lib/db/operations";
import { qrDailySeries } from "@/lib/db/qr-series";
import { httpErrorFromDb } from "@/lib/http";
import type { ResellerRevenuePoint, ResellerSaleListRow, ResellerSalesMetrics } from "@/lib/db/types";
import { RESELLER_SALE_STATUS_LABEL, RESELLER_SALE_STATUS_STYLE } from "@/lib/reseller-sales";
import { formatBRL, formatInt } from "@/lib/utils/money";
import { formatDate } from "@/lib/utils/text";
import { resolvePeriod } from "@/lib/utils/period";

export const metadata: Metadata = { title: "Início" };

const FILTERS = [
  { key: "all", label: "Todas", href: "/reseller/plates" },
  { key: "available", label: "Disponíveis", href: "/reseller/plates?filter=available" },
  { key: "active", label: "Ativas", href: "/reseller/plates?filter=active" },
  { key: "inactive", label: "Inativas", href: "/reseller/plates?filter=inactive" },
];

export default async function ResellerDashboard() {
  const { supabase, companyName } = await requireResellerContext();
  const last30 = resolvePeriod("30d");
  // Os indicadores financeiros vêm de RPCs amarradas a current_reseller_id():
  // são dados do revendedor, e o ADMIN da aplicação não tem como lê-los.
  const [metricsResult, highlights, accesses, salesResult, seriesResult, recentResult, qrSeries] = await Promise.all([
    supabase.rpc("reseller_dashboard_metrics"),
    listResellerHighlights(supabase, 5),
    countQrAccesses(supabase, { from: last30.from, to: last30.to }),
    supabase.rpc("reseller_sales_metrics", { p_month: null }),
    supabase.rpc("reseller_sales_revenue_series", { p_months: 6 }),
    supabase.rpc("reseller_sales_list", { p_status: null, p_limit: 5, p_offset: 0 }),
    qrDailySeries(supabase, 30),
  ]);
  if (metricsResult.error) throw httpErrorFromDb(metricsResult.error);
  if (salesResult.error) throw httpErrorFromDb(salesResult.error);
  if (seriesResult.error) throw httpErrorFromDb(seriesResult.error);
  if (recentResult.error) throw httpErrorFromDb(recentResult.error);

  const sales = salesResult.data as ResellerSalesMetrics;
  const series = (seriesResult.data ?? []) as ResellerRevenuePoint[];
  const recentSales = (recentResult.data ?? []) as ResellerSaleListRow[];
  const raw = metricsResult.data as Record<string, number | string>;
  const n = (key: string) => Number(raw[key] ?? 0);

  const firstAvailable = highlights.find((p) => p.status === "assigned" && !p.destination_url);
  const configureHref = firstAvailable ? `/reseller/plates/${firstAvailable.id}` : "/reseller/plates";

  return (
    <div className="space-y-[var(--ds-section-gap)]">
      <PageTitle
        title={`Olá, ${companyName}`}
        subtitle="Gerencie suas placas e clientes em um só lugar."
        action={
          <Link href="/reseller/sales/new" className="btn btn-primary min-h-12 w-full px-7 text-base sm:w-auto">
            + Vender
          </Link>
        }
      />

      <KpiGrid>
        <StatCard label="Minhas placas" value={formatInt(n("plates"))} hint="Atribuídas a você" icon="layers" href="/reseller/plates" />
        <StatCard label="Disponíveis" value={formatInt(n("available"))} hint="Aguardando configuração" icon="box" href="/reseller/plates?filter=available" />
        <StatCard label="Ativas" value={formatInt(n("active"))} hint="Redirecionando agora" icon="active" href="/reseller/plates?filter=active" />
        <StatCard label="Clientes" value={formatInt(n("customers"))} hint="Cadastrados por você" icon="customers" href="/reseller/customers" />
      </KpiGrid>

      <section className="space-y-4" aria-labelledby="vendas-mes">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id="vendas-mes" className="display text-[1.35rem]">
              Minhas vendas no mês
            </h2>
            <p className="mt-1 text-sm text-ink-soft">
              Somente vendas <strong className="text-ink">pagas</strong> entram nestes números. Estes valores são seus: o administrador da
              plataforma não tem acesso a eles.
            </p>
          </div>
          <Link href="/reseller/sales" className="link inline-flex items-center gap-1.5">
            Ver vendas <Icon name="arrow-right" className="size-4" />
          </Link>
        </div>
        <KpiGrid>
          <StatCard label="Faturamento no mês" value={formatBRL(sales.revenue)} hint="Vendas pagas" icon="revenue" href="/reseller/sales?status=paid" />
          <StatCard label="Vendas realizadas" value={formatInt(sales.sales)} hint="Pagas no mês" icon="sales" href="/reseller/sales?status=paid" />
          <StatCard label="Placas vendidas" value={formatInt(sales.plates)} hint="Em vendas pagas" icon="layers" href="/reseller/sales?status=paid" />
          <StatCard label="Ticket médio" value={formatBRL(sales.average_ticket)} hint="Faturamento ÷ vendas" icon="tag" />
        </KpiGrid>
      </section>

      <div className="grid gap-[var(--ds-grid-gap)] xl:grid-cols-[minmax(0,1.65fr)_minmax(300px,1fr)]">
        <Panel
          title="Minhas placas"
          subtitle="Visualize e gerencie suas placas."
          action={
            <Link href={configureHref} className="btn btn-primary">
              <Icon name="plus" className="size-4" strokeWidth={2.2} /> Configurar placa
            </Link>
          }
          footer={
            <Link href="/reseller/plates" className="link inline-flex items-center gap-1.5 text-sm">
              Ver todas as placas <Icon name="arrow-right" className="size-4" />
            </Link>
          }
        >
          <div className="flex flex-col gap-3 px-[var(--ds-panel-px)] pb-[var(--ds-panel-pb)] min-[1440px]:flex-row min-[1440px]:items-center min-[1440px]:justify-between">
            <SearchForm action="/reseller/plates" placeholder="Buscar por código, cliente ou destino..." />
            <Segmented items={FILTERS} active="all" label="Filtrar placas" />
          </div>
          <div className="table-scroll border-t border-line">
            {highlights.length === 0 ? (
              <EmptyNote title="Você ainda não recebeu placas" text="Assim que o administrador atribuir placas a você, elas aparecem aqui." />
            ) : (
              <PlateList plates={highlights} showActions />
            )}
          </div>
        </Panel>

        <Panel
          title="Acessos por QR Code"
          subtitle="Últimos 30 dias"
          action={
            <Link href="/reseller/accesses" className="link text-sm">
              Detalhes
            </Link>
          }
        >
          <div className="panel-body" data-qr-card="">
            <div className="flex items-center gap-4">
              <span className="icon-tile size-14 rounded-xl" aria-hidden>
                <Icon name="chart" className="size-7" strokeWidth={2.2} />
              </span>
              <div className="min-w-0">
                <p className="kpi-value text-[2.1rem]">{formatInt(accesses)}</p>
                <p className="text-sm text-ink-soft">leituras do QR Code das suas placas</p>
              </div>
            </div>
            <div className="mt-5">
              <QrAccessChart points={qrSeries.points} />
            </div>
            <InfoNote className="mt-3 text-xs">
              {accesses === 0
                ? "Ainda não há leituras de QR Code nos últimos 30 dias."
                : qrSeries.partial
                  ? "O gráfico mostra as leituras mais recentes; o total acima considera todas as leituras dos últimos 30 dias."
                  : "Este gráfico mostra o total de leituras dos QR Codes das suas placas nos últimos 30 dias."}
            </InfoNote>
          </div>
        </Panel>
      </div>

      <div className="grid gap-[var(--ds-grid-gap)] xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Panel title="Faturamento" subtitle="Últimos 6 meses">
          <SalesRevenueChart points={series} />
        </Panel>
        <Panel
          title="Vendas recentes"
          action={
            <Link href="/reseller/sales" className="link text-sm">
              Ver todas
            </Link>
          }
        >
          {recentSales.length === 0 ? (
            <EmptyNote icon="sales" title="Nenhuma venda ainda" text="Registre sua primeira venda para acompanhar os números." />
          ) : (
            <ul className="divide-y divide-line border-t border-line">
              {recentSales.map((sale) => (
                <li key={sale.sale_id}>
                  <Link href={`/reseller/sales/${sale.sale_id}`} className="flex items-center justify-between gap-3 px-5 py-3.5 hover:bg-[#f8fbff] sm:px-6">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold">{sale.customer_name ?? "Sem cliente"}</span>
                      <span className="text-xs text-ink-soft">
                        {formatDate(sale.sold_at)} · {formatInt(sale.plate_count)} placa(s)
                      </span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1">
                      <span className="font-semibold tabular-nums">{formatBRL(sale.total)}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${RESELLER_SALE_STATUS_STYLE[sale.status]}`}>
                        {RESELLER_SALE_STATUS_LABEL[sale.status]}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
