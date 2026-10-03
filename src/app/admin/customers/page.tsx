import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, PageHeader, Pagination, parsePage } from "@/components/ui/primitives";
import { requireAdminPage } from "@/lib/auth/session";
import { PAGE_SIZE, listCustomers, listResellerOptions } from "@/lib/db/operations";
import { formatInt } from "@/lib/utils/money";
import { formatDateTime } from "@/lib/utils/text";
import { getCustomerDisplayName, getCustomerSecondaryName } from "@/lib/customers";

export const metadata: Metadata = { title: "Clientes" };

/** Visão administrativa: todos os clientes de todos os revendedores (o cadastro é feito pelo revendedor). */
export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string; reseller?: string; page?: string }> }) {
  const { supabase } = await requireAdminPage();
  const params = await searchParams;
  const page = parsePage(params.page);
  const [{ rows, total }, resellers] = await Promise.all([
    listCustomers(supabase, { page, q: params.q, resellerId: params.reseller || undefined }),
    listResellerOptions(supabase),
  ]);
  const hasFilters = Boolean(params.q || params.reseller);

  return (
    <div>
      <PageHeader title="Clientes" description="Clientes finais cadastrados pelos revendedores. Eles não têm acesso ao sistema." />
      <form method="get" className="card mb-4 grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
        <label className="block">
          <span className="field-label">Buscar</span>
          <input className="input" name="q" defaultValue={params.q} placeholder="Empresa ou responsável" />
        </label>
        <label className="block">
          <span className="field-label">Revendedor</span>
          <select className="input" name="reseller" defaultValue={params.reseller ?? ""}>
            <option value="">Todos</option>
            {resellers.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-end gap-2">
          <button className="btn btn-primary">Filtrar</button>
          {hasFilters && (
            <Link href="/admin/customers" className="btn">
              Limpar
            </Link>
          )}
        </div>
      </form>
      {rows.length === 0 ? (
        <EmptyState title={hasFilters ? "Nenhum cliente com esses filtros" : "Nenhum cliente cadastrado ainda"} />
      ) : (
        <div className="card overflow-x-auto">
          <table className="data-table min-w-[720px]">
            <thead>
              <tr>
                <th>Cliente</th>
                <th>Responsável</th>
                <th>Revendedor</th>
                <th className="text-right">Placas vinculadas</th>
                <th>Cadastro</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td>
                    <p className="font-semibold">
                      {getCustomerDisplayName(c)}
                      {c.archived_at && <span className="ml-2 rounded-full bg-paper px-2 py-0.5 text-[10px] font-bold text-ink-soft">Quarentena</span>}
                    </p>
                    {(c.phone || c.email) && <p className="text-xs text-ink-soft">{[c.phone, c.email].filter(Boolean).join(" | ")}</p>}
                  </td>
                  <td>{getCustomerSecondaryName(c) ?? <span className="text-ink-soft">—</span>}</td>
                  <td>
                    <Link href={`/admin/resellers/${c.reseller_id}`} className="hover:text-cyan hover:underline">
                      {c.reseller_name ?? "—"}
                    </Link>
                  </td>
                  <td className="text-right">
                    {c.plates > 0 ? (
                      <Link href={`/admin/plates?reseller=${c.reseller_id}`} className="link">
                        {formatInt(c.plates)}
                      </Link>
                    ) : (
                      0
                    )}
                  </td>
                  <td className="whitespace-nowrap text-ink-soft">{formatDateTime(c.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination page={page} total={total} pageSize={PAGE_SIZE} basePath="/admin/customers" params={{ q: params.q, reseller: params.reseller }} />
    </div>
  );
}
