import type { Metadata } from "next";
import Link from "next/link";
import { RevenueChart, type RevenuePoint } from "@/components/dashboard/RevenueChart";
import { Icon } from "@/components/ui/icons";
import { KpiGrid, Panel, Segmented, StatCard } from "@/components/ui/kit";
import { PageHeader, Tone } from "@/components/ui/primitives";
import { requireAdminPage } from "@/lib/auth/session";
import { listSales } from "@/lib/db/operations";
import { httpErrorFromDb } from "@/lib/http";
import { ORDER_STATUS_LABEL, ORDER_STATUS_TONE } from "@/lib/plates/labels";
import { formatBRL, formatInt } from "@/lib/utils/money";
import { PERIODS, isPeriodKey, resolvePeriod, type PeriodKey } from "@/lib/utils/period";
import { formatDateTime } from "@/lib/utils/text";

export const metadata: Metadata = { title: "Dashboard" };

interface Metrics {
  revenue: number;
  sales: number;
  plates_sold: number;
  plates_produced: number;
  plates_in_stock: number;
  plates_with_resellers: number;
  plates_configured: number;
  plates_active: number;
}

interface TopReseller {
  reseller_id: string;
  company_name: string;
  revenue: number;
  sales: number;
  plates: number;
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const { supabase } = await requireAdminPage();
  const params = await searchParams;
  const periodKey: PeriodKey = isPeriodKey(params.period) ? params.period : "30d";
  const { from, to, bucket } = resolvePeriod(periodKey);
  const range = { p_from: from.toISOString(), p_to: to.toISOString() };

  const [metricsResult, seriesResult, topResult, recent] = await Promise.all([
    supabase.rpc("admin_dashboard_metrics", range),
    supabase.rpc("admin_revenue_series", { ...range, p_bucket: bucket }),
    supabase.rpc("admin_top_resellers", { ...range, p_limit: 5 }),
    listSales(supabase, { page: 1, limit: 5 }),
  ]);
  for (const r of [metricsResult, seriesResult, topResult]) if (r.error) throw httpErrorFromDb(r.error);

  const raw = metricsResult.data as Record<string, number | string>;
  const m = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Number(v)])) as unknown as Metrics;
  const points = ((seriesResult.data ?? []) as RevenuePoint[]).map((p) => ({ ...p, revenue: Number(p.revenue), sales: Number(p.sales) }));
  const top = ((topResult.data ?? []) as TopReseller[]).map((t) => ({ ...t, revenue: Number(t.revenue), sales: Number(t.sales), plates: Number(t.plates) }));
  const ticket = m.sales > 0 ? m.revenue / m.sales : 0;

  const cards = [
    { label: "Faturamento", value: formatBRL(m.revenue), icon: "chart" as const },
    { label: "Vendas realizadas", value: formatInt(m.sales), icon: "sales" as const },
    { label: "Placas vendidas", value: formatInt(m.plates_sold), icon: "layers" as const },
    { label: "Ticket médio", value: m.sales > 0 ? formatBRL(ticket) : "—", icon: "tag" as const },
  ];
  const summary = [
    { label: "Placas produzidas", value: m.plates_produced, icon: "layers" as const },
    { label: "Disponíveis", value: m.plates_in_stock, icon: "box" as const },
    { label: "Com revendedores", value: m.plates_with_resellers, icon: "customers" as const },
    { label: "Configuradas", value: m.plates_configured, icon: "settings" as const },
    { label: "Ativas", value: m.plates_active, icon: "active" as const },
  ];

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description="Visão geral do seu negócio no DirectPlaca."
        actions={
          <Segmented
            label="Período"
            active={periodKey}
            items={PERIODS.map((p) => ({ key: p.key, label: p.label, href: `/admin/dashboard?period=${p.key}` }))}
          />
        }
      />

      <KpiGrid label="Indicadores de vendas">
        {cards.map((card) => (
          <StatCard key={card.label} label={card.label} value={card.value} icon={card.icon} />
        ))}
      </KpiGrid>
      <p className="mt-3 flex items-center gap-2 text-sm text-ink-soft">
        <Icon name="info" className="size-4 shrink-0" />
        Considera apenas vendas marcadas como pagas no período.
      </p>

      <section className="mt-[var(--ds-section-gap)] grid gap-[var(--ds-grid-gap)] xl:grid-cols-[minmax(0,1fr)_minmax(300px,380px)] min-[1440px]:grid-cols-[minmax(0,1fr)_minmax(320px,400px)]">
        <Panel title="Faturamento">
          <div className="panel-body">
            <RevenueChart points={points} bucket={bucket} />
          </div>
        </Panel>
        <Panel
          title="Resumo operacional"
          subtitle="Situação atual, independente do período."
          footer={
            <Link href="/admin/plates" className="link inline-flex items-center gap-1.5 text-sm">
              Ver placas <Icon name="arrow-right" className="size-4" />
            </Link>
          }
        >
          <dl className="divide-y divide-line border-t border-line">
            {summary.map((row) => (
              <div key={row.label} className="flex items-center gap-3.5 px-[var(--ds-panel-px)] py-[calc(var(--ds-cell-py)*1.15)]">
                <span className="icon-tile size-10" aria-hidden>
                  <Icon name={row.icon} className="size-5" />
                </span>
                <dt className="min-w-0 flex-1 truncate font-medium">{row.label}</dt>
                <dd className="kpi-value text-xl">{formatInt(row.value)}</dd>
              </div>
            ))}
          </dl>
        </Panel>
      </section>

      <section className="mt-[var(--ds-section-gap)] grid gap-[var(--ds-grid-gap)] xl:grid-cols-2">
        <div className="card overflow-hidden">
          <div className="flex items-center justify-between px-5 pt-5 pb-3">
            <h2 className="display text-lg">Vendas recentes</h2>
            <Link href="/admin/sales" className="link text-sm">
              Ver todas
            </Link>
          </div>
          {recent.rows.length === 0 ? (
            <p className="px-5 pb-6 text-sm text-ink-soft">Nenhuma venda registrada ainda.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table min-w-[520px]">
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Revendedor</th>
                    <th className="text-right">Placas</th>
                    <th className="text-right">Valor</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.rows.map((sale) => (
                    <tr key={sale.id}>
                      <td className="whitespace-nowrap text-ink-soft">{formatDateTime(sale.created_at)}</td>
                      <td>
                        <Link href={`/admin/sales/${sale.id}`} className="font-semibold hover:text-cyan hover:underline">
                          {sale.reseller_name ?? "—"}
                        </Link>
                      </td>
                      <td className="text-right">{formatInt(sale.plates)}</td>
                      <td className="text-right font-semibold">{formatBRL(sale.total)}</td>
                      <td>
                        <Tone tone={ORDER_STATUS_TONE[sale.status]}>{ORDER_STATUS_LABEL[sale.status]}</Tone>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="card overflow-hidden">
          <div className="flex items-center justify-between px-5 pt-5 pb-3">
            <h2 className="display text-lg">Top revendedores</h2>
            <Link href="/admin/resellers" className="link text-sm">
              Ver todos
            </Link>
          </div>
          {top.length === 0 ? (
            <p className="px-5 pb-6 text-sm text-ink-soft">Sem vendas pagas neste período.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table min-w-[480px]">
                <thead>
                  <tr>
                    <th>Revendedor</th>
                    <th className="text-right">Vendas</th>
                    <th className="text-right">Placas compradas</th>
                    <th className="text-right">Faturamento</th>
                  </tr>
                </thead>
                <tbody>
                  {top.map((row) => (
                    <tr key={row.reseller_id}>
                      <td>
                        <Link href={`/admin/resellers/${row.reseller_id}`} className="font-semibold hover:text-cyan hover:underline">
                          {row.company_name}
                        </Link>
                      </td>
                      <td className="text-right">{formatInt(row.sales)}</td>
                      <td className="text-right">{formatInt(row.plates)}</td>
                      <td className="text-right font-semibold">{formatBRL(row.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
