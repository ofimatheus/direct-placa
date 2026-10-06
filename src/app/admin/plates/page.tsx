import type { Metadata } from "next";
import Link from "next/link";
import { PlatesTable } from "@/components/plates/PlatesTable";
import { Segmented } from "@/components/ui/kit";
import { EmptyState, PageHeader, Pagination, parsePage } from "@/components/ui/primitives";
import { requireAdminPage } from "@/lib/auth/session";
import { PAGE_SIZE, countPlateViews, listBatchOptions, listPlates, listResellerOptions, type PlateFilters, type PlateView } from "@/lib/db/operations";
import type { PlateStatus } from "@/lib/db/types";
import { PLATE_STATUS_LABEL } from "@/lib/plates/labels";
import { formatInt } from "@/lib/utils/money";

export const metadata: Metadata = { title: "Placas" };

type Search = { code?: string; reseller?: string; status?: string; batch?: string; configured?: string; page?: string; estado?: string };
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
  // Aba: operacionais (padrão) · quarentena (da placa OU do lote) · todas.
  const view: PlateView = params.estado === "quarantine" || params.estado === "all" ? params.estado : "operational";
  const page = parsePage(params.page);
  const [{ rows, total, quarantineInstalled }, counts, resellers, batches] = await Promise.all([
    listPlates(supabase, { ...filters, view }, page),
    countPlateViews(supabase, filters),
    listResellerOptions(supabase),
    listBatchOptions(supabase),
  ]);
  const hasFilters = Object.values(filters).some(Boolean);
  const keep = { code: params.code, reseller: params.reseller, status: params.status, batch: params.batch, configured: params.configured };
  const query = (extra: Record<string, string | undefined>) =>
    new URLSearchParams(Object.entries({ ...keep, ...extra }).filter((e): e is [string, string] => !!e[1])).toString();
  const tabs = counts
    ? [
        { key: "operational", label: `Operacionais (${formatInt(counts.operational)})`, href: `/admin/plates?${query({})}` },
        { key: "quarantine", label: `Quarentena (${formatInt(counts.quarantine)})`, href: `/admin/plates?${query({ estado: "quarantine" })}` },
        { key: "all", label: `Todas (${formatInt(counts.all)})`, href: `/admin/plates?${query({ estado: "all" })}` },
      ]
    : null;
  const estado = view === "operational" ? undefined : view;

  return (
    <div>
      <PageHeader title="Placas" description="Todas as placas produzidas, com revendedor, cliente e destino atual." />

      {tabs && (
        <div className="mb-4">
          <Segmented items={tabs} active={view} label="Filtrar placas por situação" />
        </div>
      )}

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
        {estado && <input type="hidden" name="estado" value={estado} />}
        <div className="flex items-end gap-2">
          <button type="submit" className="btn btn-primary">
            Filtrar
          </button>
          {hasFilters && (
            <Link href={estado ? `/admin/plates?estado=${estado}` : "/admin/plates"} className="btn">
              Limpar
            </Link>
          )}
        </div>
      </form>

      {rows.length === 0 ? (
        <EmptyState title={view === "quarantine" ? "Nenhuma placa em quarentena" + (hasFilters ? " com esses filtros" : "") : hasFilters ? "Nenhuma placa com esses filtros" : "Nenhuma placa ainda"}>
          {!hasFilters && view !== "quarantine" && (
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
        <PlatesTable rows={rows} total={total} view={view} filterQuery={query({ estado: view })} bulkEnabled={quarantineInstalled} />
      )}
      <Pagination
        page={page}
        total={total}
        pageSize={PAGE_SIZE}
        basePath="/admin/plates"
        params={{ ...keep, estado }}
      />
    </div>
  );
}
