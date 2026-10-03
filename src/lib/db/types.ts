/**
 * Tipos das linhas do banco (espelham as migrations em supabase/migrations).
 * Quando o projeto estiver ligado ao Supabase, estes tipos podem ser
 * substituídos por `supabase gen types typescript`.
 */
import type { PlateFontKey } from "@/lib/renderer/fonts";
import type { CodeAlign, QrErrorCorrection } from "@/lib/renderer/types";

export type UserRole = "admin" | "reseller";
export type PlateStatus = "in_stock" | "assigned" | "active" | "inactive" | "blocked";
export type ExportKind = "qr_zip" | "csv" | "art_png_zip" | "art_pdf";
export type OrderStatus = "draft" | "pending" | "paid" | "cancelled";
/** Ciclo OPERACIONAL do lote — não confundir com ExportStatus (geração de arquivos). */
export type BatchLifecycleStatus = "active" | "quarantine" | "archived";
/** Venda final do revendedor para o cliente dele. */
export type ResellerSaleStatus = "pending" | "paid" | "cancelled";
export type DestinationType = "google_review" | "whatsapp" | "instagram" | "menu" | "pix" | "website" | "custom";
export type ExportStatus = "pending" | "processing" | "done" | "failed";

export interface ProfileRow {
  id: string;
  name: string | null;
  email: string;
  role: UserRole;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ResellerProfileRow {
  id: string;
  user_id: string;
  company_name: string;
  document: string | null;
  phone: string | null;
}

export interface PlateTemplateRow {
  id: string;
  name: string;
  internal_key: string;
  description: string | null;
  active: boolean;
  current_version_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface PlateTemplateVersionRow {
  id: string;
  template_id: string;
  version_number: number;
  base_image_path: string;
  base_image_mime_type: "image/png" | "image/jpeg";
  base_image_sha256: string;
  base_image_size_bytes: number;
  canvas_width: number;
  canvas_height: number;
  print_width_mm: number | null;
  print_height_mm: number | null;
  qr_x: number;
  qr_y: number;
  qr_width: number;
  qr_height: number;
  qr_error_correction: QrErrorCorrection;
  qr_quiet_zone: number;
  qr_color: string;
  qr_background_color: string;
  show_public_code: boolean;
  code_x: number;
  code_y: number;
  code_font_family: PlateFontKey;
  code_font_size: number;
  code_color: string;
  code_align: CodeAlign;
  code_max_width: number | null;
  safe_margin: number | null;
  renderer_version: number;
  locked_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface PlateBatchRow {
  id: string;
  name: string;
  description: string | null;
  quantity: number;
  template_id: string | null;
  template_version_id: string | null;
  idempotency_key: string | null;
  created_by: string | null;
  created_at: string;
  lifecycle_status: BatchLifecycleStatus;
  lifecycle_reason: string | null;
  lifecycle_changed_at: string | null;
  lifecycle_changed_by: string | null;
}

export interface PlateRow {
  id: string;
  public_code: string;
  reseller_id: string | null;
  customer_id: string | null;
  batch_id: string | null;
  destination_type: DestinationType | null;
  destination_url: string | null;
  status: PlateStatus;
  /** Acessos por QR Code (métrica oficial). O NFC funciona, mas não entra nas métricas. */
  qr_access_count: number;
  last_qr_access_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ExportFile {
  name: string;
  path: string;
  size_bytes: number;
  content_type: string;
  /** Intervalo de placas (posição na lista ordenada por código) contido neste arquivo. */
  offset_start?: number;
  offset_end?: number;
}

export interface BatchExportRow {
  id: string;
  batch_id: string;
  kind: ExportKind;
  status: ExportStatus;
  template_version_id: string | null;
  file_path: string | null;
  files: ExportFile[];
  progress_total: number;
  progress_done: number;
  next_offset: number;
  part_count: number;
  attempts: number;
  lease_token: string | null;
  lease_expires_at: string | null;
  error_message: string | null;
  requested_by: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  updated_at: string;
}

/** Versão pública de um export (sem campos internos do worker). */
export type BatchExportView = Pick<
  BatchExportRow,
  | "id"
  | "batch_id"
  | "kind"
  | "status"
  | "files"
  | "progress_total"
  | "progress_done"
  | "error_message"
  | "created_at"
  | "finished_at"
>;

export function toExportView(row: BatchExportRow): BatchExportView {
  return {
    id: row.id,
    batch_id: row.batch_id,
    kind: row.kind,
    status: row.status,
    files: row.files ?? [],
    progress_total: row.progress_total,
    progress_done: row.progress_done,
    error_message: row.error_message,
    created_at: row.created_at,
    finished_at: row.finished_at,
  };
}

export interface CustomerRow {
  id: string;
  reseller_id: string;
  name: string;
  company_name: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  /** Quarentena: preenchido = fora das listas e das novas vendas. Clientes nunca são excluídos. */
  archived_at: string | null;
  archive_reason: string | null;
}

export interface PlateAssignmentRow {
  id: string;
  plate_id: string;
  reseller_id: string;
  assigned_by: string | null;
  assigned_at: string;
  unassigned_at: string | null;
  /** Venda que originou a atribuição (null = atribuição avulsa ou anterior à migration 012). */
  order_id: string | null;
  /** Motivo do encerramento, quando conhecido. */
  ended_reason: "order_cancelled" | null;
}

export type SaleSelectionMode = "automatic" | "manual";
/** Motivo do encerramento do vínculo placa ↔ venda (order_plates.release_reason). */
export type OrderPlateReleaseReason = "returned_to_stock" | "kept_with_reseller";

/** Linha de admin_order_plates(): placa da venda com o status ATUAL. */
export interface SalePlateRow {
  plate_id: string;
  public_code: string;
  status: PlateStatus;
  batch_id: string | null;
  batch_name: string | null;
  template_name: string | null;
  reseller_id: string | null;
  reserved_at: string;
  released_at: string | null;
  release_reason: OrderPlateReleaseReason | null;
}

/** Linha de admin_available_plates(): placa realmente disponível para venda. */
export interface AvailablePlateRow {
  plate_id: string;
  public_code: string;
  status: PlateStatus;
  batch_id: string | null;
  batch_name: string | null;
  template_name: string | null;
  template_version: number | null;
}

/** Linha de admin_available_stock(): estoque disponível por lote. */
export interface AvailableStockRow {
  batch_id: string;
  batch_name: string;
  template_name: string | null;
  available: number;
}

/** Venda (tabela orders). Na interface: "Vendas". */
export interface OrderRow {
  id: string;
  order_number: number;
  reseller_id: string;
  status: OrderStatus;
  subtotal: number;
  discount: number;
  total: number;
  notes: string | null;
  paid_at: string | null;
  cancelled_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface OrderItemRow {
  id: string;
  order_id: string;
  kind: "plates" | "other";
  description: string;
  quantity: number;
  unit_price: number;
  total: number;
}

/** Linha de admin_reseller_stats(). */
export interface ResellerStatsRow {
  reseller_id: string;
  user_id: string;
  company_name: string;
  contact_name: string | null;
  email: string;
  document: string | null;
  phone: string | null;
  active: boolean;
  created_at: string;
  plates_total: number;
  plates_available: number;
  plates_configured: number;
  plates_active: number;
  customers: number;
  accesses: number;
}

export interface BatchLifecycleEventRow {
  id: number;
  batch_id: string;
  previous_status: BatchLifecycleStatus;
  new_status: BatchLifecycleStatus;
  reason: string | null;
  changed_by: string | null;
  created_at: string;
}

export interface BatchLifecycleSummaryRow {
  batch_id: string;
  total_plates: number;
  free_plates: number;
  available_stock: number;
  committed: number;
}

export interface ResellerSaleListRow {
  sale_id: string;
  status: ResellerSaleStatus;
  total: number;
  sold_at: string;
  notes: string | null;
  customer_id: string | null;
  customer_name: string | null;
  plate_count: number;
  created_at: string;
  total_count: number;
}

export interface ResellerSalePlateRow {
  plate_id: string;
  public_code: string;
  status: PlateStatus;
  cancelled_at: string | null;
}

export interface SellablePlateRow {
  plate_id: string;
  public_code: string;
  status: PlateStatus;
  batch_name: string | null;
  created_at: string;
}

export interface ResellerSalesMetrics {
  month: string;
  revenue: number;
  sales: number;
  plates: number;
  average_ticket: number;
}

export interface ResellerRevenuePoint {
  month: string;
  revenue: number;
  sales: number;
}
