/**
 * Períodos do dashboard, no fuso de São Paulo (UTC−3 fixo desde 2019).
 * O intervalo é [from, to): "to" é sempre o início de amanhã.
 */
export const PERIODS = [
  { key: "today", label: "Hoje" },
  { key: "7d", label: "7 dias" },
  { key: "30d", label: "30 dias" },
  { key: "month", label: "Este mês" },
  { key: "year", label: "Este ano" },
] as const;

export type PeriodKey = (typeof PERIODS)[number]["key"];
export type Bucket = "hour" | "day" | "month";

const OFFSET = "-03:00";
const DAY = 86_400_000;

function spToday(now: Date): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  return { y: get("year"), m: get("month"), d: get("day") };
}

const at = (y: number, m: number, d: number) =>
  new Date(`${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}T00:00:00${OFFSET}`);

export function isPeriodKey(value: string | undefined): value is PeriodKey {
  return PERIODS.some((p) => p.key === value);
}

export function resolvePeriod(key: PeriodKey, now = new Date()): { from: Date; to: Date; bucket: Bucket } {
  const { y, m, d } = spToday(now);
  const today = at(y, m, d);
  const to = new Date(today.getTime() + DAY);
  switch (key) {
    case "today":
      return { from: today, to, bucket: "hour" };
    case "7d":
      return { from: new Date(today.getTime() - 6 * DAY), to, bucket: "day" };
    case "30d":
      return { from: new Date(today.getTime() - 29 * DAY), to, bucket: "day" };
    case "month":
      return { from: at(y, m, 1), to, bucket: "day" };
    case "year":
      return { from: at(y, 1, 1), to, bucket: "month" };
  }
}
