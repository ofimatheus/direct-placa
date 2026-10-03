import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, PageHeader, Pagination, Tone, parsePage } from "@/components/ui/primitives";
import { requireAdminPage } from "@/lib/auth/session";
import { PAGE_SIZE, listSales } from "@/lib/db/operations";
import type { OrderStatus } from "@/lib/db/types";
import { ORDER_STATUS_LABEL, ORDER_STATUS_TONE } from "@/lib/plates/labels";
import { formatBRL, formatInt } from "@/lib/utils/money";
import { formatDateTime } from "@/lib/utils/text";

export const metadata: Metadata = { title: "Vendas" };

const FILTERS: { key: string; label: string; status?: OrderStatus }[] = [
  { key: "", label: "Todas" },
  { key: "pending", label: "Pendentes", status: "pending" },
  { key: "paid", label: "Pagas", status: "paid" },
  { key: "cancelled", label: "Canceladas", status: "cancelled" },
];

export default async function SalesPage({ searchParams }: { searchParams: Promise<{ status?: string; page?: string }> }) {
  const { supabase } = await requireAdminPage();
  const params = await searchParams;
  const filter = FILTERS.find((f) => f.key === (params.status ?? "")) ?? FILTERS[0]!;
  const page = parsePage(params.page);
  const { rows, total } = await listSales(supabase, { page, status: filter.status });

  return (
    <div>
      <PageHeader
        title="Vendas"
        description="Registro interno das vendas de placas para revendedores. Nenhuma cobrança é feita pelo sistema."
        actions={
          <Link href="/admin/sales/new" className="btn btn-primary">
            Nova venda
          </Link>
        }
      />
      <nav className="mb-4 flex flex-wrap gap-2" aria-label="Filtrar por status">
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            href={f.key ? `/admin/sales?status=${f.key}` : "/admin/sales"}
            aria-current={f.key === filter.key ? "true" : undefined}
            className={`rounded-full border px-3 py-1 text-sm font-semibold ${f.key === filter.key ? "border-ink bg-ink text-white" : "border-line bg-surface text-ink-soft"}`}
          >
            {f.label}
          </Link>
        ))}
      </nav>
      {rows.length === 0 ? (
        <EmptyState title="Nenhuma venda encontrada">Registre uma venda com o botão Nova venda.</EmptyState>
      ) : (
        <div className="card overflow-x-auto">
          <table className="data-table min-w-[720px]">
            <thead>
              <tr>
                <th>Venda</th>
                <th>Revendedor</th>
                <th className="text-right">Quantidade</th>
                <th className="text-right">Valor</th>
                <th>Status</th>
                <th>Data</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((sale) => (
                <tr key={sale.id}>
                  <td>
                    <Link href={`/admin/sales/${sale.id}`} className="link">
                      #{sale.order_number}
                    </Link>
                  </td>
                  <td>{sale.reseller_name ?? "—"}</td>
                  <td className="text-right">{formatInt(sale.plates)} placas</td>
                  <td className="text-right font-semibold">{formatBRL(sale.total)}</td>
                  <td>
                    <Tone tone={ORDER_STATUS_TONE[sale.status]}>{ORDER_STATUS_LABEL[sale.status]}</Tone>
                  </td>
                  <td className="whitespace-nowrap text-ink-soft">{formatDateTime(sale.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination page={page} total={total} pageSize={PAGE_SIZE} basePath="/admin/sales" params={{ status: filter.key || undefined }} />
    </div>
  );
}
