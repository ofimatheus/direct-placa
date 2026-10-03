/** Regras compartilhadas entre o formulário de venda e a API (o banco valida de novo). */

/** Máximo de placas reservadas numa única venda (create_sale_with_plates). */
export const SALE_MAX_PLATES = 2000;

/** Mesmo texto do banco para estoque insuficiente. */
export function insufficientStockMessage(available: number, inBatch: boolean): string {
  const scope = inBatch ? " neste lote" : "";
  if (available <= 0) return `Não há placas disponíveis${inBatch ? scope : " no estoque"}.`;
  if (available === 1) return `Existe apenas 1 placa disponível${scope}.`;
  return `Existem apenas ${available} placas disponíveis${scope}.`;
}
