import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AssignPlatesForm } from "@/components/resellers/AssignPlatesForm";
import { ResellerForm } from "@/components/resellers/ResellerForm";
import { DirectLabLimitsForm, type DirectLabLimitsView } from "@/components/resellers/DirectLabLimitsForm";
import { ResellerPasswordReset } from "@/components/resellers/ResellerPasswordReset";
import { PageHeader, Pagination, Tone, UUID_RE, parsePage } from "@/components/ui/primitives";
import { requireAdminPage } from "@/lib/auth/session";
import {
  PAGE_SIZE,
  countStockPlates,
  getResellerStats,
  listBatchOptions,
  listPlates,
  listStockPlates,
  paidSalesByReseller,
} from "@/lib/db/operations";
import { DESTINATION_LABEL } from "@/lib/plates/destinations";
import { PLATE_STATUS_LABEL, PLATE_STATUS_TONE } from "@/lib/plates/labels";
import { formatBRL, formatInt } from "@/lib/utils/money";
import { formatDateTime } from "@/lib/utils/text";

export const metadata: Metadata = { title: "Revendedor" };

export default async function ResellerPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ page?: string }> }) {
  const { supabase } = await requireAdminPage();
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const page = parsePage((await searchParams).page);

  const [[stats], sales, plates, stockCount, stockPlates, batches] = await Promise.all([
    getResellerStats(supabase, id),
    paidSalesByReseller(supabase, id),
    listPlates(supabase, { reseller: id }, page),
    countStockPlates(supabase),
    listStockPlates(supabase),
    listBatchOptions(supabase),
  ]);
  if (!stats) notFound();
  const paid = sales.get(id) ?? { revenue: 0, sales: 0 };

  // Trilha de auditoria: só quem, quando e sobre quem. O valor da senha nunca existe no banco.
  const [resetEventsResult, securityResult] = await Promise.all([
    supabase
      .from("admin_audit_events")
      .select("id, actor_id, created_at")
      .eq("target_reseller_id", id)
      .eq("event_type", "reseller_password_reset")
      .order("created_at", { ascending: false })
      .limit(5),
    supabase.from("profiles").select("must_change_password").eq("id", stats.user_id).maybeSingle<{ must_change_password: boolean }>(),
  ]);
  const resetEvents = (resetEventsResult.data ?? []) as { id: number; actor_id: string | null; created_at: string }[];
  const actorIds = [...new Set(resetEvents.map((e) => e.actor_id).filter((v): v is string => !!v))];
  const { data: actors } = actorIds.length
    ? await supabase.from("profiles").select("id, name, email").in("id", actorIds)
    : { data: [] as { id: string; name: string | null; email: string }[] };
  const actorName = new Map(((actors ?? []) as { id: string; name: string | null; email: string }[]).map((a) => [a.id, a.name || a.email]));

  // Limites do DirectLab (migration 024). null = migration ainda não aplicada.
  const { data: limitRows } = await supabase.rpc("admin_directlab_limits", { p_reseller_id: id });
  const limitRow = (Array.isArray(limitRows) ? limitRows[0] : limitRows) as
    | { google_review_daily: number; directlink_pages: number; customized: boolean; google_used_today: number; directlink_count: number }
    | undefined;
  const directLabLimits: DirectLabLimitsView | null = limitRow
    ? {
        googleReviewDaily: limitRow.google_review_daily,
        directlinkPages: limitRow.directlink_pages,
        customized: limitRow.customized,
        googleUsedToday: limitRow.google_used_today,
        directlinkCount: limitRow.directlink_count,
      }
    : null;

  const figures = [
    { label: "Total de placas", value: formatInt(stats.plates_total) },
    { label: "Disponíveis", value: formatInt(stats.plates_available) },
    { label: "Configuradas", value: formatInt(stats.plates_configured) },
    { label: "Ativas", value: formatInt(stats.plates_active) },
    { label: "Clientes", value: formatInt(stats.customers) },
    { label: "Vendas pagas", value: formatInt(paid.sales) },
    { label: "Faturamento", value: formatBRL(paid.revenue) },
  ];

  return (
    <div className="space-y-8">
      <PageHeader
        back={{ href: "/admin/resellers", label: "Revendedores" }}
        title={stats.company_name}
        description={
          <>
            {stats.contact_name ?? stats.email} <span className="mx-1 text-line-strong">|</span> {formatInt(stats.accesses)} acessos por QR Code
          </>
        }
        actions={
          <>
            <Tone tone={stats.active ? "text-ok" : "text-ink-soft"}>{stats.active ? "Ativo" : "Inativo"}</Tone>
            <Link href={`/admin/sales/new?reseller=${id}`} className="btn btn-primary">
              Registrar venda
            </Link>
          </>
        }
      />

      <dl className="card grid grid-cols-2 divide-line sm:grid-cols-4 lg:grid-cols-7 lg:divide-x">
        {figures.map((f) => (
          <div key={f.label} className="px-5 py-4">
            <dt className="text-sm text-ink-soft">{f.label}</dt>
            <dd className="mt-1 text-xl font-bold">{f.value}</dd>
          </div>
        ))}
      </dl>

      <section className="card p-5">
        <h2 className="display text-lg">Atribuição avulsa</h2>
        <p className="mb-4 mt-1 text-sm text-ink-soft">
          Para casos sem venda: reposição, cortesia ou ajuste administrativo. Em uma venda, as placas já são reservadas ao{" "}
          <Link href={`/admin/sales/new?reseller=${id}`} className="link">
            registrar a venda
          </Link>
          .
        </p>
        <AssignPlatesForm
          resellerId={id}
          resellerName={stats.company_name}
          stockCount={stockCount}
          stockPlates={stockPlates}
          batches={batches}
          disabled={!stats.active}
        />
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="display text-lg">Placas do revendedor</h2>
          <Link href={`/admin/customers?reseller=${id}`} className="link text-sm">
            Ver clientes
          </Link>
        </div>
        {plates.rows.length === 0 ? (
          <p className="card px-5 py-6 text-sm text-ink-soft">Nenhuma placa atribuída ainda.</p>
        ) : (
          <div className="card overflow-x-auto">
            <table className="data-table min-w-[680px]">
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Cliente</th>
                  <th>Destino</th>
                  <th>Status</th>
                  <th className="text-right">Acessos QR</th>
                </tr>
              </thead>
              <tbody>
                {plates.rows.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <Link href={`/admin/plates/${p.id}`} className="plate-code text-ink hover:text-cyan hover:underline">
                        {p.public_code}
                      </Link>
                    </td>
                    <td>{p.customer_name ?? <span className="text-ink-soft">—</span>}</td>
                    <td>{p.destination_type ? DESTINATION_LABEL[p.destination_type] : <span className="text-ink-soft">Não configurado</span>}</td>
                    <td>
                      <Tone tone={PLATE_STATUS_TONE[p.status]}>{PLATE_STATUS_LABEL[p.status]}</Tone>
                    </td>
                    <td className="text-right">{formatInt(p.qr_access_count)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} total={plates.total} pageSize={PAGE_SIZE} basePath={`/admin/resellers/${id}`} params={{}} />
      </section>

      <section className="card p-5">
        <h2 className="display mb-4 text-lg">Dados do revendedor</h2>
        <ResellerForm
          mode="edit"
          resellerId={id}
          email={stats.email}
          initial={{
            company_name: stats.company_name,
            contact_name: stats.contact_name ?? "",
            document: stats.document,
            phone: stats.phone,
            active: stats.active,
          }}
        />
      </section>

      <section className="card p-5" aria-labelledby="security-title">
        <h2 id="security-title" className="display text-lg">
          Acesso e segurança
        </h2>
        <p className="mb-4 mt-1 text-sm text-ink-soft">
          Login: <span className="font-semibold text-ink">{stats.email}</span>. Se o revendedor esqueceu a senha, defina uma nova
          aqui. A troca é feita no servidor de autenticação; a senha não é gravada nem registrada pelo sistema.
        </p>
        <ResellerPasswordReset resellerId={id} resellerName={stats.company_name} disabled={!stats.active} />
        <div className="mt-5 border-t border-line pt-4">
          <h3 className="text-sm font-semibold">Histórico de acesso</h3>
          {resetEvents.length === 0 ? (
            <p className="mt-1 text-sm text-ink-soft">Nenhuma senha redefinida pelo administrador.</p>
          ) : (
            <ul className="mt-2 space-y-1 text-sm">
              {resetEvents.map((event) => (
                <li key={event.id}>
                  <span className="text-ink-soft">{formatDateTime(event.created_at)}</span>{" "}
                  Senha redefinida pelo administrador
                  {event.actor_id && actorName.get(event.actor_id) ? ` (${actorName.get(event.actor_id)})` : ""}
                </li>
              ))}
            </ul>
          )}
          {securityResult.data?.must_change_password && (
            <p className="mt-2 text-xs text-ink-soft">A senha atual é temporária (marcada para troca futura).</p>
          )}
        </div>
      </section>

      <section className="card p-5" aria-labelledby="directlab-limits-title" data-directlab-limits="">
        <h2 id="directlab-limits-title" className="display text-lg">
          Limites do DirectLab
        </h2>
        <p className="mt-1 text-sm text-ink-soft">Valem imediatamente. O ADMIN não tem limite.</p>
        {directLabLimits ? (
          <DirectLabLimitsForm resellerId={id} initial={directLabLimits} />
        ) : (
          <p className="mt-3 text-sm text-ink-soft">
            Limites indisponíveis: aplique a migration <code className="font-mono text-[0.85em]">20261005120000_directlab_reseller_limits.sql</code> no Supabase.
          </p>
        )}
      </section>
    </div>
  );
}
