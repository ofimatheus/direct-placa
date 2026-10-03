import type { Metadata } from "next";
import Link from "next/link";
import { EmptyNote, PageTitle, Panel, Segmented, StatCard } from "@/components/ui/kit";
import { Pagination, parsePage } from "@/components/ui/primitives";
import { requireResellerContext } from "@/lib/auth/session";
import { countQrAccesses } from "@/lib/db/operations";
import { httpErrorFromDb } from "@/lib/http";
import { formatInt } from "@/lib/utils/money";
import { PERIODS, isPeriodKey, resolvePeriod, type PeriodKey } from "@/lib/utils/period";

export const metadata: Metadata = { title: "Acessos" };

const PAGE = 15;

interface PlateQrRow {
  plate_id: string;
  public_code: string;
  customer_name: string | null;
  qr_accesses: number;
  total_count: number;
}

/**
 * Acessos oficiais do revendedor: somente QR Code, agregados no banco
 * (reseller_qr_access_by_plate, amarrada a current_reseller_id()).
 */
export default async function ResellerAccessesPage({ searchParams }: { searchParams: Promise<{ period?: string; page?: string }> }) {
  const { supabase } = await requireResellerContext();
  const params = await searchParams;
  const periodKey: PeriodKey = isPeriodKey(params.period) ? params.period : "30d";
  const { from, to } = resolvePeriod(periodKey);
  const page = parsePage(params.page);

  const [total, byPlateResult] = await Promise.all([
    countQrAccesses(supabase, { from, to }),
    supabase.rpc("reseller_qr_access_by_plate", {
      p_from: from.toISOString(),
      p_to: to.toISOString(),
      p_limit: PAGE,
      p_offset: (page - 1) * PAGE,
    }),
  ]);
  if (byPlateResult.error) throw httpErrorFromDb(byPlateResult.error);
  const rows = (byPlateResult.data ?? []) as PlateQrRow[];
  const plateCount = rows.length ? Number(rows[0]!.total_count) : 0;

  return (
    <div className="space-y-6">
      <PageTitle
        title="Acessos"
        subtitle="Leituras das suas placas por QR Code."
        action={
          <Segmented
            label="Período"
            active={periodKey}
            items={PERIODS.map((p) => ({ key: p.key, label: p.label, href: `/reseller/accesses?period=${p.key}` }))}
          />
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
        <StatCard label="Acessos por QR Code" value={formatInt(total)} hint={PERIODS.find((p) => p.key === periodKey)!.label} icon="qr" />
      </div>

      <Panel title="Por placa" subtitle="Acessos por QR Code no período selecionado.">
        {rows.length === 0 ? (
          <div className="border-t border-line">
            <EmptyNote icon="accesses" title="Sem acessos" text="Ainda não há acessos por QR Code neste período." />
          </div>
        ) : (
          <table className="data-table border-t border-line">
            <thead>
              <tr>
                <th className="pl-5">Placa</th>
                <th>Cliente</th>
                <th className="pr-5 text-right">QR Code</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.plate_id}>
                  <td className="pl-5">
                    <Link href={`/reseller/plates/${p.plate_id}`} className="plate-code text-ink hover:text-mat">
                      {p.public_code}
                    </Link>
                  </td>
                  <td className="max-w-48 truncate">{p.customer_name ?? <span className="text-ink-soft">—</span>}</td>
                  <td className="pr-5 text-right font-bold tabular-nums">{formatInt(Number(p.qr_accesses))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
      {plateCount > PAGE && (
        <Pagination page={page} total={plateCount} pageSize={PAGE} basePath="/reseller/accesses" params={{ period: periodKey }} />
      )}
    </div>
  );
}
