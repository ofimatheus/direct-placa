import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/primitives";
import { requireAdminPage } from "@/lib/auth/session";
import { countQrAccesses } from "@/lib/db/operations";
import { httpErrorFromDb } from "@/lib/http";
import { formatInt } from "@/lib/utils/money";
import { PERIODS, isPeriodKey, resolvePeriod, type PeriodKey } from "@/lib/utils/period";
import { formatDateTime } from "@/lib/utils/text";

export const metadata: Metadata = { title: "Acessos" };

interface PlateQrRow {
  plate_id: string;
  public_code: string;
  reseller_name: string | null;
  customer_name: string | null;
  qr_accesses: number;
}

/**
 * Acessos oficiais: somente QR Code. O NFC continua redirecionando e sendo
 * registrado em redirects.source, mas não entra nas métricas.
 */
export default async function AccessesPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const { supabase } = await requireAdminPage();
  const params = await searchParams;
  const periodKey: PeriodKey = isPeriodKey(params.period) ? params.period : "30d";
  const { from, to } = resolvePeriod(periodKey);

  const [total, byPlateResult, recentResult] = await Promise.all([
    countQrAccesses(supabase, { from, to }),
    supabase.rpc("admin_qr_access_by_plate", { p_from: from.toISOString(), p_to: to.toISOString(), p_limit: 10 }),
    supabase
      .from("redirects")
      .select("id, plate_id, created_at")
      .eq("source", "qr")
      .order("id", { ascending: false })
      .limit(15),
  ]);
  if (byPlateResult.error) throw httpErrorFromDb(byPlateResult.error);
  if (recentResult.error) throw httpErrorFromDb(recentResult.error);

  const byPlate = ((byPlateResult.data ?? []) as PlateQrRow[]).map((r) => ({ ...r, qr_accesses: Number(r.qr_accesses) }));
  const recent = (recentResult.data ?? []) as { id: number; plate_id: string; created_at: string }[];
  const plateIds = [...new Set(recent.map((r) => r.plate_id))];
  const { data: codes } = plateIds.length
    ? await supabase.from("plates").select("id, public_code").in("id", plateIds)
    : { data: [] as { id: string; public_code: string }[] };
  const codeOf = new Map(((codes ?? []) as { id: string; public_code: string }[]).map((p) => [p.id, p.public_code]));
  const periodLabel = PERIODS.find((p) => p.key === periodKey)!.label;

  return (
    <div>
      <PageHeader
        title="Acessos"
        description="Leituras das placas por QR Code."
        actions={
          <nav className="flex flex-wrap gap-1 rounded-lg border border-line bg-surface p-1" aria-label="Período">
            {PERIODS.map((p) => (
              <Link
                key={p.key}
                href={`/admin/accesses?period=${p.key}`}
                aria-current={p.key === periodKey ? "true" : undefined}
                className={`rounded-md px-3 py-1.5 text-sm font-semibold ${p.key === periodKey ? "bg-ink text-white" : "text-ink-soft hover:text-ink"}`}
              >
                {p.label}
              </Link>
            ))}
          </nav>
        }
      />

      <section className="card p-5">
        <p className="text-sm text-ink-soft">Acessos por QR Code</p>
        <p className="display mt-1 text-4xl">{formatInt(total)}</p>
        <p className="mt-1 text-sm text-ink-soft">{periodLabel}</p>
      </section>

      <section className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="card overflow-x-auto">
          <h2 className="display px-5 pt-5 pb-2 text-lg">Por placa</h2>
          {byPlate.length === 0 ? (
            <p className="px-5 pb-5 text-sm text-ink-soft">Nenhum acesso por QR Code neste período.</p>
          ) : (
            <table className="data-table min-w-[520px]">
              <thead>
                <tr>
                  <th>Placa</th>
                  <th>Revendedor</th>
                  <th>Cliente</th>
                  <th className="text-right">QR Code</th>
                </tr>
              </thead>
              <tbody>
                {byPlate.map((p) => (
                  <tr key={p.plate_id}>
                    <td>
                      <Link href={`/admin/plates/${p.plate_id}`} className="plate-code hover:text-cyan hover:underline">
                        {p.public_code}
                      </Link>
                    </td>
                    <td>{p.reseller_name ?? <span className="text-ink-soft">Em estoque</span>}</td>
                    <td>{p.customer_name ?? <span className="text-ink-soft">—</span>}</td>
                    <td className="text-right font-semibold tabular-nums">{formatInt(p.qr_accesses)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="card overflow-x-auto">
          <h2 className="display px-5 pt-5 pb-2 text-lg">Últimos acessos por QR Code</h2>
          {recent.length === 0 ? (
            <p className="px-5 pb-5 text-sm text-ink-soft">Nenhum acesso por QR Code registrado ainda.</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Placa</th>
                  <th>Quando</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((r) => (
                  <tr key={r.id}>
                    <td className="plate-code">{codeOf.get(r.plate_id) ?? "—"}</td>
                    <td className="whitespace-nowrap text-ink-soft">{formatDateTime(r.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}
