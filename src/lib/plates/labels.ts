import type { ExportKind, ExportStatus, OrderPlateReleaseReason, OrderStatus, PlateStatus } from "@/lib/db/types";

/**
 * Rótulos do ADMIN. Fluxo principal: DISPONÍVEL → RESERVADA → ATIVA.
 * Os valores internos do banco (in_stock, assigned, ...) não mudam.
 */
export const PLATE_STATUS_LABEL: Record<PlateStatus, string> = {
  in_stock: "Disponível",
  assigned: "Reservada",
  active: "Ativa",
  inactive: "Inativa",
  blocked: "Bloqueada",
};

export const EXPORT_KIND_LABEL: Record<ExportKind, string> = {
  csv: "Planilha CSV",
  qr_zip: "QR Codes (ZIP)",
  art_png_zip: "Artes do lote (ZIP)",
  art_pdf: "Artes em PDF",
};

export const EXPORT_STATUS_LABEL: Record<ExportStatus, string> = {
  pending: "Gerando...",
  processing: "Processando...",
  done: "Concluído",
  failed: "Erro",
};

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  draft: "Rascunho",
  pending: "Pendente",
  paid: "Pago",
  cancelled: "Cancelado",
};

/** Tom visual por status (classes de texto do tema). */
export const PLATE_STATUS_TONE: Record<PlateStatus, string> = {
  in_stock: "text-cyan",
  assigned: "text-warn",
  active: "text-ok",
  inactive: "text-ink-soft",
  blocked: "text-danger",
};

export const ORDER_STATUS_TONE: Record<OrderStatus, string> = {
  draft: "text-ink-soft",
  pending: "text-warn",
  paid: "text-ok",
  cancelled: "text-ink-soft",
};

/** Rótulos na visão do revendedor: "assigned" é uma placa disponível para configurar. */
export const RESELLER_STATUS_LABEL: Record<PlateStatus, string> = {
  in_stock: "Em estoque",
  assigned: "Disponível",
  active: "Ativa",
  inactive: "Inativa",
  blocked: "Bloqueada",
};

export const RESELLER_STATUS_TONE: Record<PlateStatus, string> = {
  in_stock: "text-ink-soft",
  assigned: "text-cyan",
  active: "text-ok",
  inactive: "text-ink-soft",
  blocked: "text-danger",
};

/** Situação de uma placa em relação à venda (order_plates). */
export const SALE_PLATE_RELEASE_LABEL: Record<OrderPlateReleaseReason, string> = {
  returned_to_stock: "Devolvida ao estoque (venda cancelada)",
  kept_with_reseller: "Mantida com o revendedor (venda cancelada)",
};
