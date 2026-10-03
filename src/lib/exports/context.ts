import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllPlates } from "@/lib/db/queries";
import type { BatchExportRow, PlateBatchRow, PlateStatus, PlateTemplateVersionRow } from "@/lib/db/types";
import { createPlateRenderer, type PlateRenderer } from "@/lib/renderer/server";
import type { PlateLayout } from "@/lib/renderer/types";
import { layoutFromVersion } from "@/lib/templates/layout";
import { getVersion, loadVersionImage } from "@/lib/templates/service";
import { fileSlug } from "@/lib/utils/text";

export interface ExportPlate {
  id: string;
  public_code: string;
  status: PlateStatus;
  reseller_name: string | null;
}

export interface ExportContext {
  admin: SupabaseClient;
  job: BatchExportRow;
  batch: PlateBatchRow;
  /** Ordenadas por public_code: a ordem define as partes e precisa ser estável entre retomadas. */
  plates: ExportPlate[];
  version: PlateTemplateVersionRow | null;
  layout: PlateLayout | null;
  slug: string;
  storagePrefix: string;
  getRenderer(): Promise<PlateRenderer>;
}

export async function loadExportContext(admin: SupabaseClient, job: BatchExportRow): Promise<ExportContext> {
  const { data: batch, error } = await admin
    .from("plate_batches")
    .select("id, name, description, quantity, template_id, template_version_id, idempotency_key, created_by, created_at")
    .eq("id", job.batch_id)
    .single<PlateBatchRow>();
  if (error || !batch) throw new Error("Lote do export não encontrado.");

  // O export usa a versão registrada nele (que é a do lote): reimpressão idêntica.
  const versionId = job.template_version_id ?? batch.template_version_id;
  const version = versionId ? await getVersion(admin, versionId) : null;
  const layout = version ? layoutFromVersion(version) : null;

  const rows = await fetchAllPlates(admin, batch.id, "id, public_code, status, reseller_id");
  const resellerIds = [...new Set(rows.map((r) => r.reseller_id).filter((id): id is string => !!id))];
  const resellers = new Map<string, string>();
  if (resellerIds.length) {
    const { data } = await admin.from("reseller_profiles").select("id, company_name").in("id", resellerIds);
    for (const r of (data ?? []) as { id: string; company_name: string }[]) resellers.set(r.id, r.company_name);
  }

  let rendererPromise: Promise<PlateRenderer> | null = null;

  return {
    admin,
    job,
    batch,
    plates: rows.map((r) => ({
      id: r.id,
      public_code: r.public_code,
      status: r.status,
      reseller_name: r.reseller_id ? (resellers.get(r.reseller_id) ?? null) : null,
    })),
    version,
    layout,
    slug: fileSlug(batch.name),
    storagePrefix: `exports/${batch.id}/${job.id}`,
    getRenderer() {
      if (!version || !layout) throw new Error("Este lote não tem template: não é possível gerar artes.");
      rendererPromise ??= loadVersionImage(admin, version).then((bytes) => createPlateRenderer(layout, bytes));
      return rendererPromise;
    },
  };
}
