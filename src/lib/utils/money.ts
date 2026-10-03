const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const integer = new Intl.NumberFormat("pt-BR");

export function formatBRL(value: number | string | null | undefined): string {
  return brl.format(Number(value ?? 0));
}

export function formatInt(value: number | string | null | undefined): string {
  return integer.format(Number(value ?? 0));
}

/** Arredonda para centavos evitando erros de ponto flutuante. */
export function toCents(value: number): number {
  return Math.round(value * 100);
}
