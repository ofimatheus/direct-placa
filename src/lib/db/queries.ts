import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { HttpError, httpErrorFromDb } from "@/lib/http";
import { VERSION_COLUMNS } from "@/lib/templates/service";
import type {
  BatchExportRow,
  BatchLifecycleEventRow,
  BatchLifecycleStatus,
  BatchLifecycleSummaryRow,
  PlateBatchRow,
  PlateRow,
  PlateStatus,
  PlateTemplateRow,
  PlateTemplateVersionRow,
  ResellerProfileRow,
} from "./types";

/**
 * Consultas simples + junção em TypeScript (em vez de embeds do PostgREST):
 * previsível, fácil de depurar e suficiente para o volume do módulo ADMIN.
 * Todas rodam com o cliente do usuário, então a RLS continua valendo.
 */

const TEMPLATE_COLUMNS = "id, name, internal_key, description, active, current_version_id, created_by, created_at, updated_at";
const BATCH_COLUMNS =
  "id, name, description, quantity, template_id, template_version_id, idempotency_key, created_by, created_at, " +
  "lifecycle_status, lifecycle_reason, lifecycle_changed_at, lifecycle_changed_by";
const EXPORT_COLUMNS =
  "id, batch_id, kind, status, template_version_id, file_path, files, progress_total, progress_done, next_offset, part_count, attempts, lease_token, lease_expires_at, error_message, requested_by, created_at, started_at, finished_at, updated_at";

type DbResult = { data: unknown; error: { code?: string; message: string; details?: string | null } | null };

function unwrap<T>(result: DbResult): T {
  if (result.error) throw httpErrorFromDb(result.error);
  return (result.data ?? []) as T;
}

function unwrapOne<T>(result: DbResult): T | null {
  if (result.error) throw httpErrorFromDb(result.error);
  return (result.data ?? null) as T | null;
}

export interface VersionSummary {
  id: string;
  template_id: string;
  version_number: number;
  locked_at: string | null;
  canvas_width: number;
  canvas_height: number;
  created_at: string;
}

export interface TemplateListItem {
  template: PlateTemplateRow;
  current: VersionSummary | null;
  versionCount: number;
  batchCount: number;
}

export async function listTemplates(sb: SupabaseClient): Promise<TemplateListItem[]> {
  const [templates, versions, batches] = await Promise.all([
    sb.from("plate_templates").select(TEMPLATE_COLUMNS).order("name").then(unwrap<PlateTemplateRow[]>),
    sb
      .from("plate_template_versions")
      .select("id, template_id, version_number, locked_at, canvas_width, canvas_height, created_at")
      .then(unwrap<VersionSummary[]>),
    sb.from("plate_batches").select("id, template_id").then(unwrap<{ id: string; template_id: string | null }[]>),
  ]);

  return templates.map((template) => ({
    template,
    current: versions.find((v) => v.id === template.current_version_id) ?? null,
    versionCount: versions.filter((v) => v.template_id === template.id).length,
    batchCount: batches.filter((b) => b.template_id === template.id).length,
  }));
}

export interface TemplateDetail {
  template: PlateTemplateRow;
  versions: PlateTemplateVersionRow[];
  batchesByVersion: Record<string, number>;
}

export async function getTemplateDetail(sb: SupabaseClient, templateId: string): Promise<TemplateDetail | null> {
  const template = unwrapOne<PlateTemplateRow>(
    await sb.from("plate_templates").select(TEMPLATE_COLUMNS).eq("id", templateId).maybeSingle(),
  );
  if (!template) return null;

  const [versions, batches] = await Promise.all([
    sb
      .from("plate_template_versions")
      .select(VERSION_COLUMNS)
      .eq("template_id", templateId)
      .order("version_number", { ascending: false })
      .then(unwrap<PlateTemplateVersionRow[]>),
    sb
      .from("plate_batches")
      .select("id, template_version_id")
      .eq("template_id", templateId)
      .then(unwrap<{ id: string; template_version_id: string }[]>),
  ]);

  const batchesByVersion: Record<string, number> = {};
  for (const batch of batches) {
    batchesByVersion[batch.template_version_id] = (batchesByVersion[batch.template_version_id] ?? 0) + 1;
  }
  return { template, versions, batchesByVersion };
}

export interface TemplateOption {
  id: string;
  name: string;
  versionNumber: number;
}

export async function listTemplateOptions(sb: SupabaseClient): Promise<TemplateOption[]> {
  const items = await listTemplates(sb);
  return items
    .filter((item) => item.template.active && item.current)
    .map((item) => ({ id: item.template.id, name: item.template.name, versionNumber: item.current!.version_number }));
}

export interface BatchListItem {
  batch: PlateBatchRow;
  templateName: string | null;
  versionNumber: number | null;
  summary: BatchLifecycleSummaryRow | null;
}

/**
 * Lotes por estado do ciclo operacional. O padrão da tela é "active": lote em
 * quarentena ou arquivado não deve aparecer por acidente numa listagem de
 * trabalho — ele precisa ser procurado.
 */
export async function listBatches(
  sb: SupabaseClient,
  lifecycle: BatchLifecycleStatus | "all" = "active",
): Promise<BatchListItem[]> {
  let query = sb.from("plate_batches").select(BATCH_COLUMNS).order("created_at", { ascending: false }).limit(200);
  if (lifecycle !== "all") query = query.eq("lifecycle_status", lifecycle);
  const batches = unwrap(await query) as PlateBatchRow[];
  const versionIds = [...new Set(batches.map((b) => b.template_version_id).filter((id): id is string => !!id))];
  const templateIds = [...new Set(batches.map((b) => b.template_id).filter((id): id is string => !!id))];

  const [versions, templates] = await Promise.all([
    versionIds.length
      ? sb.from("plate_template_versions").select("id, version_number").in("id", versionIds).then(unwrap<{ id: string; version_number: number }[]>)
      : Promise.resolve([]),
    templateIds.length
      ? sb.from("plate_templates").select("id, name").in("id", templateIds).then(unwrap<{ id: string; name: string }[]>)
      : Promise.resolve([]),
  ]);

  // Um resumo por lote (livres / em estoque / comprometidas) para a tela poder
  // dizer POR QUE uma ação está indisponível, em vez de só desabilitar o botão.
  const summaries = batches.length
    ? ((await sb.rpc("admin_batch_lifecycle_summary", { p_batch_id: null })).data as BatchLifecycleSummaryRow[] | null) ?? []
    : [];

  return batches.map((batch) => ({
    batch,
    templateName: templates.find((t) => t.id === batch.template_id)?.name ?? null,
    versionNumber: versions.find((v) => v.id === batch.template_version_id)?.version_number ?? null,
    summary: summaries.find((s) => s.batch_id === batch.id) ?? null,
  }));
}

export async function countBatchesByLifecycle(sb: SupabaseClient): Promise<Record<BatchLifecycleStatus | "all", number>> {
  const rows = ((await sb.from("plate_batches").select("lifecycle_status")).data ?? []) as {
    lifecycle_status: BatchLifecycleStatus;
  }[];
  const counts = { active: 0, quarantine: 0, archived: 0, all: rows.length };
  for (const row of rows) counts[row.lifecycle_status] += 1;
  return counts;
}

export async function listBatchLifecycleEvents(sb: SupabaseClient, batchId: string): Promise<BatchLifecycleEventRow[]> {
  return unwrap(
    await sb
      .from("batch_lifecycle_events")
      .select("id, batch_id, previous_status, new_status, reason, changed_by, created_at")
      .eq("batch_id", batchId)
      .order("created_at", { ascending: false })
      .limit(50),
  ) as BatchLifecycleEventRow[];
}

export interface BatchPlate {
  id: string;
  public_code: string;
  status: PlateStatus;
  reseller_id: string | null;
  reseller_name: string | null;
}

export interface BatchStats {
  total: number;
  qr: number;
  withReseller: number;
  active: number;
}

export type ProductionStatus = "not_started" | "in_progress" | "done";

export interface BatchDetail {
  batch: PlateBatchRow;
  template: PlateTemplateRow | null;
  version: PlateTemplateVersionRow | null;
  plates: BatchPlate[];
  stats: BatchStats;
  production: ProductionStatus;
  exports: BatchExportRow[];
}

/** Lê todas as linhas respeitando o limite de linhas por requisição do PostgREST. */
export async function fetchAllPlates(sb: SupabaseClient, batchId: string, columns: string): Promise<PlateRow[]> {
  const pageSize = 1000;
  const rows: PlateRow[] = [];
  for (let from = 0; ; from += pageSize) {
    const page = unwrap(
      await sb
        .from("plates")
        .select(columns)
        .eq("batch_id", batchId)
        .order("public_code")
        .range(from, from + pageSize - 1),
    ) as unknown as PlateRow[];
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

export async function listExports(sb: SupabaseClient, batchId: string): Promise<BatchExportRow[]> {
  return unwrap(
    await sb.from("batch_exports").select(EXPORT_COLUMNS).eq("batch_id", batchId).order("created_at", { ascending: false }).limit(30),
  ) as BatchExportRow[];
}

export async function getBatchDetail(sb: SupabaseClient, batchId: string): Promise<BatchDetail | null> {
  const batch = unwrapOne<PlateBatchRow>(await sb.from("plate_batches").select(BATCH_COLUMNS).eq("id", batchId).maybeSingle());
  if (!batch) return null;

  const [template, version, plates, exports] = await Promise.all([
    batch.template_id
      ? sb.from("plate_templates").select(TEMPLATE_COLUMNS).eq("id", batch.template_id).maybeSingle().then(unwrapOne<PlateTemplateRow>)
      : Promise.resolve(null),
    batch.template_version_id
      ? sb
          .from("plate_template_versions")
          .select(VERSION_COLUMNS)
          .eq("id", batch.template_version_id)
          .maybeSingle()
          .then(unwrapOne<PlateTemplateVersionRow>)
      : Promise.resolve(null),
    fetchAllPlates(sb, batchId, "id, public_code, status, reseller_id"),
    listExports(sb, batchId),
  ]);

  const resellerIds = [...new Set(plates.map((p) => p.reseller_id).filter((id): id is string => !!id))];
  const resellers = resellerIds.length
    ? (unwrap(await sb.from("reseller_profiles").select("id, company_name").in("id", resellerIds)) as Pick<
        ResellerProfileRow,
        "id" | "company_name"
      >[])
    : [];

  const batchPlates: BatchPlate[] = plates.map((plate) => ({
    id: plate.id,
    public_code: plate.public_code,
    status: plate.status,
    reseller_id: plate.reseller_id,
    reseller_name: resellers.find((r) => r.id === plate.reseller_id)?.company_name ?? null,
  }));

  const stats: BatchStats = {
    total: batchPlates.length,
    qr: batchPlates.length,
    withReseller: batchPlates.filter((p) => p.reseller_id !== null).length,
    active: batchPlates.filter((p) => p.status === "active").length,
  };

  // Produção = geração das artes finais do lote (o controle físico de NFC foi removido).
  const artJobs = exports.filter((e) => e.kind === "art_png_zip");
  const production: ProductionStatus = artJobs.some((e) => e.status === "done")
    ? "done"
    : artJobs.some((e) => e.status === "pending" || e.status === "processing")
      ? "in_progress"
      : "not_started";

  return {
    batch,
    template,
    version,
    plates: batchPlates,
    stats,
    production,
    exports,
  };
}

export async function requireBatch(sb: SupabaseClient, batchId: string): Promise<PlateBatchRow> {
  const batch = unwrapOne<PlateBatchRow>(await sb.from("plate_batches").select(BATCH_COLUMNS).eq("id", batchId).maybeSingle());
  if (!batch) throw new HttpError(404, "Lote não encontrado.");
  return batch;
}

export { EXPORT_COLUMNS };
