import { z } from "zod";
import type { ResellerSaleStatus } from "@/lib/db/types";

/**
 * Venda final do revendedor. Só o que é comum a formulário, API e telas —
 * as regras de verdade (elegibilidade da placa, dono do cliente, placa em
 * duas vendas) vivem nas RPCs, porque interface não é barreira.
 */

export const RESELLER_SALE_STATUS_LABEL: Record<ResellerSaleStatus, string> = {
  pending: "Pendente",
  paid: "Pago",
  cancelled: "Cancelado",
};

export const RESELLER_SALE_STATUS_STYLE: Record<ResellerSaleStatus, string> = {
  pending: "bg-[#fff4e0] text-[#8a5a00]",
  paid: "bg-[#e7f4ec] text-ok",
  cancelled: "bg-paper text-ink-soft",
};

export const RESELLER_SALE_FILTERS = [
  { key: "all", label: "Todos", href: "/reseller/sales" },
  { key: "pending", label: "Pendentes", href: "/reseller/sales?status=pending" },
  { key: "paid", label: "Pagos", href: "/reseller/sales?status=paid" },
  { key: "cancelled", label: "Cancelados", href: "/reseller/sales?status=cancelled" },
];

export function parseSaleStatusFilter(value: string | undefined): ResellerSaleStatus | null {
  return value === "pending" || value === "paid" || value === "cancelled" ? value : null;
}

/** Aceita "1.234,56" e "1234.56"; devolve número em reais com 2 casas. */
export function parseMoneyInput(value: string): number | null {
  const cleaned = value.trim().replace(/\s/g, "").replace(/R\$/gi, "");
  if (!cleaned) return null;
  const normalized = cleaned.includes(",") ? cleaned.replace(/\./g, "").replace(",", ".") : cleaned;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed * 100) / 100;
}

export const newSaleSchema = z.object({
  plate_ids: z.array(z.string().uuid()).min(1, "Selecione ao menos uma placa"),
  total: z.number().min(0).max(99_999_999.99),
  customer_id: z.string().uuid().nullable(),
  status: z.enum(["pending", "paid"]),
  sold_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes: z.string().trim().max(1000).nullable(),
});

/* ---------------------------------------------------------------------
   Preço itemizado (migration 022): unitário e desconto em CENTAVOS
   inteiros. O total é sempre derivado — no servidor/banco ele é
   recalculado a partir das placas realmente vendidas.
   --------------------------------------------------------------------- */

export const MAX_UNIT_PRICE_CENTS = 99_999_999; // R$ 999.999,99
export const MAX_TOTAL_CENTS = 9_999_999_999; // R$ 99.999.999,99

/**
 * "25", "25,5", "1.234,56", "R$ 10,00", "10.50" → centavos (inteiro), sem
 * ponto flutuante. Aceita no máximo 2 casas decimais. null = inválido.
 */
export function parseMoneyToCents(value: string): number | null {
  const cleaned = value.trim().replace(/\s/g, "").replace(/^R\$/i, "");
  if (!cleaned) return null;
  let intPart: string;
  let decPart = "";
  if (cleaned.includes(",")) {
    if (!/^\d{1,3}(\.\d{3})*(,\d{0,2})?$|^\d+(,\d{0,2})?$/.test(cleaned)) return null;
    [intPart, decPart = ""] = cleaned.replace(/\./g, "").split(",") as [string, string?];
  } else {
    if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return null;
    [intPart, decPart = ""] = cleaned.split(".") as [string, string?];
  }
  if (!intPart || intPart.length > 12) return null;
  const cents = Number(intPart) * 100 + Number((decPart + "00").slice(0, 2));
  return Number.isSafeInteger(cents) ? cents : null;
}

export function formatCents(cents: number): string {
  return formatBRLCents(cents);
}

function formatBRLCents(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const reais = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${negative ? "-" : ""}R$ ${reais},${String(abs % 100).padStart(2, "0")}`;
}

export interface SaleTotals {
  quantity: number;
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  /** Mensagem quando os valores não formam uma venda válida. */
  error: string | null;
}

/** quantidade × unitário − desconto, com as mesmas regras do banco. */
export function computeSaleTotals(quantity: number, unitCents: number | null, discountCents: number | null): SaleTotals {
  const unit = unitCents ?? 0;
  const discount = discountCents ?? 0;
  const subtotal = quantity * unit;
  const base = { quantity, subtotalCents: subtotal, discountCents: discount, totalCents: Math.max(0, subtotal - discount) };
  if (unitCents === null) return { ...base, error: "Informe um valor unitário válido." };
  if (unitCents < 0 || unitCents > MAX_UNIT_PRICE_CENTS) return { ...base, error: "Informe um valor unitário válido." };
  if (discountCents === null || discount < 0) return { ...base, error: "Informe um desconto válido (R$ 0,00 ou mais)." };
  if (discount > subtotal) return { ...base, error: "O desconto não pode ser maior que o subtotal." };
  if (subtotal - discount > MAX_TOTAL_CENTS) return { ...base, error: "O valor total ultrapassa o limite permitido." };
  return { ...base, error: null };
}

/**
 * Corpo aceito por POST /api/reseller/sales. NÃO existe campo de total:
 * qualquer "total" enviado é descartado (zod remove chaves desconhecidas).
 */
export const pricedSaleRequestSchema = z.object({
  plate_ids: z.array(z.string().uuid()).min(1).max(500),
  unit_price_cents: z.number().int().min(0).max(MAX_UNIT_PRICE_CENTS),
  discount_cents: z.number().int().min(0).max(MAX_TOTAL_CENTS).default(0),
  customer_id: z.string().uuid().nullable().optional(),
  status: z.enum(["pending", "paid"]).default("pending"),
  sold_at: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
  idempotency_key: z.string().uuid(),
});
