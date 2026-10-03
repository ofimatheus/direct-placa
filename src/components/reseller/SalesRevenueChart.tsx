import type { ResellerRevenuePoint } from "@/lib/db/types";
import { EMPTY_REVENUE_NOTE, FEW_DATA_NOTE, seriesShape } from "@/lib/utils/chart";
import { formatBRL, formatInt } from "@/lib/utils/money";

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

function label(month: string): string {
  const [, m = "1"] = month.split("-");
  return MONTHS[Number(m) - 1] ?? m;
}

function longLabel(month: string): string {
  const [y = "", m = "1"] = month.split("-");
  return `${MONTHS[Number(m) - 1] ?? m}/${y}`;
}

/** Linha de meses: mantém o contexto do período mesmo com pouco ou nenhum dado. */
function MonthStrip({ points, highlight }: { points: ResellerRevenuePoint[]; highlight?: number }) {
  return (
    <ol className="flex items-start justify-between gap-1" aria-hidden>
      {points.map((point, i) => {
        const active = i === highlight;
        return (
          <li key={point.month} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
            <span className={`rounded-full ${active ? "size-3 bg-mat ring-4 ring-mat/15" : "size-1.5 bg-line-strong"}`} />
            <span className={`text-xs ${active ? "font-bold text-ink" : "text-ink-soft"}`}>{label(point.month)}</span>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Faturamento por mês. SVG/HTML puro, sem biblioteca de gráfico e sem
 * JavaScript no cliente. Três apresentações: sem dados, um mês, tendência.
 */
export function SalesRevenueChart({ points }: { points: ResellerRevenuePoint[] }) {
  const values = points.map((p) => Number(p.revenue));
  const shape = seriesShape(values);

  if (shape.kind === "empty") {
    return (
      <div data-chart-state="empty" className="mx-5 mb-5 rounded-lg border border-dashed border-line px-4 pt-6 pb-4 text-center">
        <p className="text-sm font-semibold text-ink">{EMPTY_REVENUE_NOTE}</p>
        <p className="mt-1 text-xs text-ink-soft">Assim que você marcar uma venda como paga, ela aparece aqui.</p>
        <div className="mt-5">
          <MonthStrip points={points} />
        </div>
      </div>
    );
  }

  if (shape.kind === "single") {
    const point = points[shape.index]!;
    return (
      <div data-chart-state="single" className="px-5 pb-5">
        <p className="text-[2rem] leading-none font-extrabold tracking-tight tabular-nums">{formatBRL(Number(point.revenue))}</p>
        <p className="mt-1.5 text-sm text-ink-soft">
          em {longLabel(point.month)}, {formatInt(Number(point.sales))} venda(s) paga(s)
        </p>
        <div className="mt-5">
          <MonthStrip points={points} highlight={shape.index} />
        </div>
        <p className="mt-4 text-xs text-ink-soft">{FEW_DATA_NOTE}</p>
      </div>
    );
  }

  const max = Math.max(...values, 0);
  return (
    <div data-chart-state="trend" className="px-5 pb-5">
      <div className="flex h-40 items-end gap-2" role="img" aria-label="Faturamento por mês">
        {points.map((point) => {
          const value = Number(point.revenue);
          const height = Math.max(2, Math.round((value / max) * 100));
          return (
            <div key={point.month} className="flex min-w-0 flex-1 flex-col items-center gap-1">
              <span className="text-[10px] font-semibold text-ink-soft tabular-nums">
                {value > 0 ? formatBRL(value).replace("R$", "").trim() : ""}
              </span>
              <div
                className="w-full rounded-t bg-gradient-to-t from-mat to-[#3d8bff]"
                style={{ height: `${height}%` }}
                title={`${label(point.month)}: ${formatBRL(value)} em ${point.sales} venda(s)`}
              />
              <span className="text-xs text-ink-soft">{label(point.month)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
