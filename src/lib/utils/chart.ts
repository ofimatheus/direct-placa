/**
 * Como exibir uma série de faturamento. Só muda a apresentação: os valores
 * vêm do banco exatamente como antes.
 *   empty  → nenhum período com faturamento: estado vazio, mantendo os períodos
 *   single → um único período com faturamento: destaque do valor, sem "tendência"
 *   trend  → dois ou mais períodos: gráfico normal
 */
export type SeriesShape = { kind: "empty" } | { kind: "single"; index: number } | { kind: "trend" };

export function seriesShape(values: number[]): SeriesShape {
  const withValue = values.flatMap((value, index) => (Number(value) > 0 ? [index] : []));
  if (withValue.length === 0) return { kind: "empty" };
  if (withValue.length === 1) return { kind: "single", index: withValue[0]! };
  return { kind: "trend" };
}

export const FEW_DATA_NOTE = "Ainda há poucos dados para formar uma tendência.";
export const EMPTY_REVENUE_NOTE = "Ainda não há faturamento no período.";
