import type { Metadata } from "next";
import Link from "next/link";
import { EmptyNote, PageTitle, Panel, Segmented } from "@/components/ui/kit";
import { requireResellerContext } from "@/lib/auth/session";
import type { ResellerSaleListRow } from "@/lib/db/types";
import { httpErrorFromDb } from "@/lib/http";
import {
  RESELLER_SALE_FILTERS,
  RESELLER_SALE_STATUS_LABEL,
  RESELLER_SALE_STATUS_STYLE,
  parseSaleStatusFilter,
} from "@/lib/reseller-sales";
import { formatBRL, formatInt } from "@/lib/utils/money";
import { formatDate } from "@/lib/utils/text";

export const metadata: Metadata = { title: "Vendas" };

export default async function ResellerSalesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { supabase } = await requireResellerContext();
  const { status } = await searchParams;
  const filter = parseSaleStatusFilter(status);

  // RPC ligada a current_reseller_id(): nunca há como listar venda de outro.
  const { data, error } = await supabase.rpc("reseller_sales_list", {
    p_status: filter,
    p_limit: 100,
    p_offset: 0,
  });
  if (error) throw httpErrorFromDb(error);
  const sales = (data ?? []) as ResellerSaleListRow[];

  return (
    <div className="space-y-6">
      <PageTitle
        title="Vendas"
        subtitle="As vendas que você faz para os seus clientes. Estes valores são seus: o administrador da plataforma não tem acesso a eles."
        action={
          <Link href="/reseller/sales/new" className="btn btn-primary">
            + Nova venda
          </Link>
        }
      />

      <Panel title="Minhas vendas" subtitle={`${formatInt(sales.length)} registro(s)`}>
        <div className="px-5 pb-4">
          <Segmented items={RESELLER_SALE_FILTERS} active={filter ?? "all"} label="Filtrar vendas" />
        </div>

        <div className="border-t border-line">
          {sales.length === 0 ? (
            <EmptyNote
              title="Nenhuma venda registrada"
              text="Registre suas vendas para acompanhar faturamento, ticket médio e placas vendidas."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-line text-ink-soft">
                    <th className="px-5 py-2 font-semibold">Cliente</th>
                    <th className="px-5 py-2 text-right font-semibold">Qtd.</th>
                    <th className="px-5 py-2 text-right font-semibold">Valor</th>
                    <th className="px-5 py-2 font-semibold">Status</th>
                    <th className="px-5 py-2 font-semibold">Data</th>
                  </tr>
                </thead>
                <tbody>
                  {sales.map((sale) => (
                    <tr key={sale.sale_id} className="border-b border-line last:border-0">
                      <td className="px-5 py-3">
                        <Link href={`/reseller/sales/${sale.sale_id}`} className="font-semibold hover:underline">
                          {sale.customer_name ?? <span className="text-ink-soft">Sem cliente</span>}
                        </Link>
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums">{formatInt(sale.plate_count)}</td>
                      <td className="px-5 py-3 text-right font-semibold tabular-nums">{formatBRL(sale.total)}</td>
                      <td className="px-5 py-3">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-bold ${RESELLER_SALE_STATUS_STYLE[sale.status]}`}
                        >
                          {RESELLER_SALE_STATUS_LABEL[sale.status]}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-ink-soft">{formatDate(sale.sold_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Panel>
    </div>
  );
}
