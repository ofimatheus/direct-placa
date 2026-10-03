import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, PageHeader, Pagination, Tone, parsePage } from "@/components/ui/primitives";
import { requireAdminPage } from "@/lib/auth/session";
import { PAGE_SIZE, listBatchOptions, listPlates, listResellerOptions, type PlateFilters } from "@/lib/db/operations";
import type { PlateStatus } from "@/lib/db/types";
import { DESTINATION_LABEL } from "@/lib/plates/destinations";
import { PLATE_STATUS_LABEL, PLATE_STATUS_TONE } from "@/lib/plates/labels";
import { formatInt } from "@/lib/utils/money";

export const metadata: Metadata = { title: "Placas" };

type Search = { code?: string; reseller?: string; status?: string; batch?: string; configured?: string; page?: string };
const STATUSES = Object.keys(PLATE_STATUS_LABEL) as PlateStatus[];

export default async function PlatesPage({ searchParams }: { searchParams: Promise<Search> }) {
  const { supabase } = await requireAdminPage();
  const params = await searchParams;
  const filters: PlateFilters = {
    code: params.code || undefined,
    reseller: params.reseller || undefined,
    status: STATUSES.includes(params.status as PlateStatus) ? (params.status as PlateStatus) : undefined,
    batch: params.batch || undefined,
    configured: params.configured === "yes" || params.configured === "no" ? params.configured : undefined,
  };
  const page = parsePage(params.page);
  const [{ rows, total }, resellers, batches] = await Promise.all([
    listPlates(supabase, filters, page),
    listResellerOptions(supabase),
    listBatchOptions(supabase),
  ]);
  const hasFilters = Object.values(filters).some(Boolean);

  return (
    <div>
      <PageHeader title="Placas" description="Todas as placas produzidas, com revendedor, cliente e destino atual." />

      <form method="get" className="card mb-4 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_1fr_1fr_auto]">
        <label className="block">
          <span className="field-label">Código</span>
          <input className="input" name="code" defaultValue={params.code} placeholder="A7K482" />
        </label>
        <label className="block">
          <span className="field-label">Revendedor</span>
          <select className="input" name="reseller" defaultValue={params.reseller ?? ""}>
            <option value="">Todos</option>
            <option value="none">Sem revendedor</option>
            {resellers.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="field-label">Status</span>
          <select className="input" name="status" defaultValue={params.status ?? ""}>
            <option value="">Todos</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {PLATE_STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="field-label">Lote</span>
          <select className="input" name="batch" defaultValue={params.batch ?? ""}>
            <option value="">Todos</option>
            {batches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="field-label">Configuração</span>
          <select className="input" name="configured" defaultValue={params.configured ?? ""}>
            <option value="">Todas</option>
            <option value="yes">Configuradas</option>
            <option value="no">Não configuradas</option>
          </select>
        </label>
        <div className="flex items-end gap-2">
          <button type="submit" className="btn btn-primary">
            Filtrar
          </button>
          {hasFilters && (
            <Link href="/admin/plates" className="btn">
              Limpar
            </Link>
          )}
        </div>
      </form>

      {rows.length === 0 ? (
        <EmptyState title={hasFilters ? "Nenhuma placa com esses filtros" : "Nenhuma placa ainda"}>
          {!hasFilters && (
            <>
              As placas nascem nos{" "}
              <Link href="/admin/batches" className="link">
                lotes
              </Link>
              .
            </>
          )}
        </EmptyState>
      ) : (
        <div className="card overflow-x-auto">
          <table className="data-table min-w-[860px]">
            <thead>
              <tr>
                <th>Código</th>
                <th>Revendedor</th>
                <th>Cliente</th>
                <th>Destino</th>
                <th>Status</th>
                <th>Lote</th>
                <th className="text-right">Acessos QR</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <td>
                    <Link href={`/admin/plates/${p.id}`} className="plate-code text-base text-ink hover:text-cyan hover:underline">
                      {p.public_code}
                    </Link>
                  </td>
                  <td>{p.reseller_name ?? <span className="text-ink-soft">—</span>}</td>
                  <td>{p.customer_name ?? <span className="text-ink-soft">—</span>}</td>
                  <td className="max-w-56">
                    {p.destination_url ? (
                      <span className="block truncate" title={p.destination_url}>
                        <span className="font-semibold">{p.destination_type ? DESTINATION_LABEL[p.destination_type] : "Link"}</span>{" "}
                        <span className="text-ink-soft">{p.destination_url.replace(/^https?:\/\//, "")}</span>
                      </span>
                    ) : (
                      <span className="text-ink-soft">Não configurado</span>
                    )}
                  </td>
                  <td>
                    <Tone tone={PLATE_STATUS_TONE[p.status]}>{PLATE_STATUS_LABEL[p.status]}</Tone>
                  </td>
                  <td className="text-ink-soft">{p.batch_name ?? "—"}</td>
                  <td className="text-right">{formatInt(p.qr_access_count)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination
        page={page}
        total={total}
        pageSize={PAGE_SIZE}
        basePath="/admin/plates"
        params={{ code: params.code, reseller: params.reseller, status: params.status, batch: params.batch, configured: params.configured }}
      />
    </div>
  );
}
