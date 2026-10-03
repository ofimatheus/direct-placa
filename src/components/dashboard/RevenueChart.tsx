import type { Bucket } from "@/lib/utils/period";
import { EMPTY_REVENUE_NOTE, FEW_DATA_NOTE, seriesShape } from "@/lib/utils/chart";
import { formatBRL, formatInt } from "@/lib/utils/money";
import { Icon } from "@/components/ui/icons";

export interface RevenuePoint {
  bucket_start: string;
  revenue: number;
  sales: number;
}

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const BUCKET_LABEL: Record<Bucket, string> = { hour: "Por hora", day: "Diário", month: "Mensal" };

/** bucket_start vem do banco como horário local de São Paulo (timestamp sem fuso). */
function parts(value: string) {
  const [date = "", time = "00"] = value.replace("T", " ").split(" ");
  const [year = "", month = "1", day = "1"] = date.split("-");
  return { year, month, day, hour: time.slice(0, 2) };
}

function labelFor(value: string, bucket: Bucket): string {
  const { month, day, hour } = parts(value);
  if (bucket === "hour") return `${hour}h`;
  if (bucket === "month") return MONTHS[Number(month) - 1] ?? month;
  return `${day}/${month}`;
}

/** Rótulo completo para o destaque de um único período. */
function longLabelFor(value: string, bucket: Bucket): string {
  const { year, month, day, hour } = parts(value);
  if (bucket === "hour") return `${day}/${month} às ${hour}h`;
  if (bucket === "month") return `${MONTHS[Number(month) - 1] ?? month}/${year}`;
  return `${day}/${month}/${year}`;
}

function niceMax(value: number): number {
  if (value <= 0) return 100;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const steps = [1, 2, 2.5, 5, 10];
  const step = steps.find((s) => s * magnitude >= value) ?? 10;
  return step * magnitude;
}

const compact = new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 });

/** Linha suave (controles no meio de cada segmento: nunca ultrapassa os pontos na vertical). */
function smoothPath(points: { x: number; y: number }[]): string {
  if (points.length === 0) return "";
  let d = `M${points[0]!.x},${points[0]!.y}`;
  for (let i = 1; i < points.length; i++) {
    const p0 = points[i - 1]!;
    const p1 = points[i]!;
    const mx = (p0.x + p1.x) / 2;
    d += ` C${mx},${p0.y} ${mx},${p1.y} ${p1.x},${p1.y}`;
  }
  return d;
}

/** Gráfico de linha/área em SVG renderizado no servidor (sem biblioteca e sem JavaScript no cliente). */
function LineChart({ points, bucket, highlight }: { points: RevenuePoint[]; bucket: Bucket; highlight?: number }) {
  const width = 900;
  const height = 250;
  const pad = { top: 16, right: 18, bottom: 30, left: 62 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const max = niceMax(Math.max(0, ...points.map((p) => p.revenue)));
  const step = points.length > 1 ? innerW / (points.length - 1) : 0;
  const coords = points.map((p, i) => ({
    x: pad.left + (points.length > 1 ? step * i : innerW / 2),
    y: pad.top + innerH - (p.revenue / max) * innerH,
  }));
  const line = smoothPath(coords);
  const baseline = pad.top + innerH;
  const area = coords.length ? `${line} L${coords.at(-1)!.x},${baseline} L${coords[0]!.x},${baseline} Z` : "";
  const labelEvery = Math.max(1, Math.ceil(points.length / 10));
  const peak = highlight ?? points.reduce((best, p, i) => (p.revenue > (points[best]?.revenue ?? -1) ? i : best), 0);
  const hit = Math.max(step, 8);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" role="img" aria-label="Faturamento ao longo do período">
      <defs>
        <linearGradient id="revenue-area" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--color-mat)" stopOpacity="0.22" />
          <stop offset="1" stopColor="var(--color-mat)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0, 0.25, 0.5, 0.75, 1].map((f) => {
        const y = pad.top + innerH * (1 - f);
        return (
          <g key={f}>
            <line x1={pad.left} x2={width - pad.right} y1={y} y2={y} stroke="var(--color-line)" />
            <text x={pad.left - 10} y={y + 4} textAnchor="end" fontSize="11" fill="var(--color-ink-soft)">
              {f === 0 ? "R$ 0" : `R$ ${compact.format(max * f)}`}
            </text>
          </g>
        );
      })}
      {points.map((p, i) =>
        i % labelEvery === 0 || i === points.length - 1 ? (
          <text key={`l-${p.bucket_start}`} x={coords[i]!.x} y={height - 8} textAnchor="middle" fontSize="11" fontWeight={i === peak && p.revenue > 0 ? 700 : 400} fill={i === peak && p.revenue > 0 ? "var(--color-ink)" : "var(--color-ink-soft)"}>
            {labelFor(p.bucket_start, bucket)}
          </text>
        ) : null,
      )}
      <path d={area} fill="url(#revenue-area)" />
      <path d={line} fill="none" stroke="var(--color-mat)" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" />
      {points.map((p, i) => (
        <g key={p.bucket_start}>
          <circle cx={coords[i]!.x} cy={coords[i]!.y} r={i === peak && p.revenue > 0 ? 5.5 : 2.6} fill={i === peak && p.revenue > 0 ? "#fff" : "var(--color-mat)"} stroke="var(--color-mat)" strokeWidth={i === peak && p.revenue > 0 ? 2.5 : 0} />
          {/* Área de passagem do mouse: dica nativa com o valor do período. */}
          <rect x={coords[i]!.x - hit / 2} y={pad.top} width={hit} height={innerH} fill="transparent">
            <title>{`${longLabelFor(p.bucket_start, bucket)}: ${formatBRL(p.revenue)} em ${p.sales} venda(s)`}</title>
          </rect>
        </g>
      ))}
    </svg>
  );
}

function BucketChip({ bucket }: { bucket: Bucket }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-ink-soft" title="A granularidade acompanha o período escolhido">
      {BUCKET_LABEL[bucket]}
    </span>
  );
}

/** Faturamento do ADMIN: três apresentações (sem dados, um período, tendência) sem mudar nenhum cálculo. */
export function RevenueChart({ points, bucket }: { points: RevenuePoint[]; bucket: Bucket }) {
  const shape = seriesShape(points.map((p) => p.revenue));
  const total = points.reduce((sum, p) => sum + p.revenue, 0);
  const sales = points.reduce((sum, p) => sum + p.sales, 0);

  if (shape.kind === "empty") {
    return (
      <div data-chart-state="empty">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="kpi-value text-[2rem] text-ink-soft">{formatBRL(0)}</p>
            <p className="mt-1 text-sm text-ink-soft">Somente vendas marcadas como pagas entram aqui.</p>
          </div>
          <BucketChip bucket={bucket} />
        </div>
        <div className="mt-4 opacity-80">
          <LineChart points={points} bucket={bucket} />
        </div>
        <p className="mt-2 flex items-center gap-2.5 rounded-xl bg-paper px-4 py-3 text-sm font-semibold text-ink">
          <Icon name="info" className="size-[18px] shrink-0 text-ink-soft" />
          {EMPTY_REVENUE_NOTE}
        </p>
      </div>
    );
  }

  if (shape.kind === "single") {
    const point = points[shape.index]!;
    return (
      <div data-chart-state="single">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="kpi-value text-[2rem] sm:text-[2.25rem]">{formatBRL(point.revenue)}</p>
            <p className="mt-1 text-sm text-ink-soft">
              em {longLabelFor(point.bucket_start, bucket)}, {formatInt(point.sales)} venda(s) paga(s)
            </p>
          </div>
          <BucketChip bucket={bucket} />
        </div>
        <div className="mt-4">
          <LineChart points={points} bucket={bucket} highlight={shape.index} />
        </div>
        <p className="mt-2 flex items-center gap-2.5 rounded-xl bg-brand-soft/70 px-4 py-3 text-sm text-[#24466f]">
          <Icon name="info" className="size-[18px] shrink-0 text-mat" />
          {FEW_DATA_NOTE}
        </p>
      </div>
    );
  }

  return (
    <div data-chart-state="trend">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="kpi-value text-[2rem] sm:text-[2.25rem]">{formatBRL(total)}</p>
          <p className="mt-1 text-sm text-ink-soft">no período, {formatInt(sales)} venda(s) paga(s)</p>
        </div>
        <BucketChip bucket={bucket} />
      </div>
      <div className="mt-4">
        <LineChart points={points} bucket={bucket} />
      </div>
    </div>
  );
}
