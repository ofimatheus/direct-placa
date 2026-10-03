import type { QrDayPoint } from "@/lib/db/qr-series";

function niceTop(value: number): number {
  if (value <= 4) return 4;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].find((s) => s * magnitude >= value) ?? 10;
  return step * magnitude;
}

/** Leituras de QR Code por dia (barras simples; dias sem leitura aparecem como pontos na base). */
export function QrAccessChart({ points }: { points: QrDayPoint[] }) {
  const width = 360;
  const height = 150;
  const pad = { top: 8, right: 8, bottom: 24, left: 26 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const top = niceTop(Math.max(0, ...points.map((p) => p.count)));
  const slot = innerW / Math.max(points.length, 1);
  const barW = Math.max(3, Math.min(10, slot * 0.6));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(top * f));
  const labelEvery = Math.max(1, Math.ceil(points.length / 5));
  const label = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}`;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" role="img" aria-label="Leituras do QR Code por dia nos últimos 30 dias" data-qr-chart="">
      {ticks.map((t, i) => {
        const y = pad.top + innerH * (1 - t / top);
        return (
          <g key={`${t}-${i}`}>
            <line x1={pad.left} x2={width - pad.right} y1={y} y2={y} stroke="var(--color-line)" strokeDasharray={t === 0 ? undefined : "2 3"} />
            <text x={pad.left - 6} y={y + 3.5} textAnchor="end" fontSize="9" fill="var(--color-ink-soft)">
              {t}
            </text>
          </g>
        );
      })}
      {points.map((p, i) => {
        const cx = pad.left + slot * i + slot / 2;
        const h = (p.count / top) * innerH;
        return (
          <g key={p.day}>
            {p.count > 0 ? (
              <rect x={cx - barW / 2} y={pad.top + innerH - h} width={barW} height={Math.max(h, 2)} rx={Math.min(2.5, barW / 2)} fill="var(--color-mat)">
                <title>{`${label(p.day)}: ${p.count} leitura(s)`}</title>
              </rect>
            ) : (
              <circle cx={cx} cy={pad.top + innerH} r="1.6" fill="var(--color-mat)" opacity="0.55" />
            )}
            {(i % labelEvery === 0 || i === points.length - 1) && (
              <text x={cx} y={height - 6} textAnchor="middle" fontSize="9" fill="var(--color-ink-soft)">
                {label(p.day)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
