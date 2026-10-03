import "server-only";
import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { EXPORT_COLUMNS } from "@/lib/db/queries";
import type { BatchExportRow, ExportKind, PlateBatchRow } from "@/lib/db/types";
import { limits } from "@/lib/env.server";
import { HttpError, httpErrorFromDb } from "@/lib/http";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadExportContext } from "./context";
import { AVAILABLE_EXPORT_KINDS, EXPORTERS } from "./exporters";
import type { ExportState } from "./types";

/**
 * ESTRATÉGIA DE PROCESSAMENTO
 *
 * A tabela batch_exports é a fila. Cada job é processado em ETAPAS curtas por
 * runExportJob(), que:
 *   1. reivindica o job de forma atômica (claim_batch_export → lease_token);
 *   2. processa partes (ex.: um ZIP de até ~45 MB) até esgotar o orçamento de tempo;
 *   3. após CADA parte, grava o progresso (next_offset, files) e renova o lease;
 *   4. se o tempo acabar, libera o lease e para — a próxima execução continua de onde parou.
 *
 * Quem dispara runExportJob():
 *   · a própria requisição que cria o export, via after() (roda depois da resposta);
 *   · o polling da tela do lote (GET /api/admin/batches/[id]/exports), que reagenda jobs parados;
 *   · opcionalmente, um cron (GET /api/cron/exports) para concluir mesmo sem a tela aberta.
 *
 * Nenhuma requisição do usuário fica presa esperando a geração inteira.
 */

const LEASE_SECONDS = 90;
const MAX_ATTEMPTS = 3;

type RunResult = "done" | "paused" | "failed" | "retrying" | "skipped" | "lost-lease";

async function claim(admin: SupabaseClient, exportId: string): Promise<BatchExportRow | null> {
  const { data, error } = await admin.rpc("claim_batch_export", {
    p_export_id: exportId,
    p_lease_seconds: LEASE_SECONDS,
  });
  if (error) throw new Error(`claim_batch_export: ${error.message}`);
  const rows = (data ?? []) as BatchExportRow[];
  return rows[0] ?? null;
}

async function updateWithLease(
  admin: SupabaseClient,
  job: BatchExportRow,
  leaseToken: string,
  patch: Record<string, unknown>,
): Promise<boolean> {
  const { data, error } = await admin
    .from("batch_exports")
    .update(patch)
    .eq("id", job.id)
    .eq("lease_token", leaseToken)
    .select("id");
  if (error) throw new Error(`Falha ao salvar progresso do export: ${error.message}`);
  return (data ?? []).length === 1;
}

const leaseUntil = () => new Date(Date.now() + LEASE_SECONDS * 1000).toISOString();

export async function runExportJob(exportId: string, budgetMs = limits.exportTimeBudgetMs): Promise<RunResult> {
  const admin = createAdminClient();
  const startedAt = Date.now();
  const job = await claim(admin, exportId);
  if (!job) return "skipped";
  const lease = job.lease_token!;

  try {
    const exporter = EXPORTERS[job.kind];
    const ctx = await loadExportContext(admin, job);
    const total = ctx.plates.length;
    let state: ExportState = { nextOffset: job.next_offset, partCount: job.part_count, files: job.files ?? [] };

    if (job.progress_total !== total) {
      if (!(await updateWithLease(admin, job, lease, { progress_total: total }))) return "lost-lease";
    }

    while (state.nextOffset < total) {
      const elapsed = Date.now() - startedAt;
      if (elapsed >= budgetMs) {
        // Libera o lease imediatamente: a próxima chamada continua deste ponto.
        await updateWithLease(admin, job, lease, { lease_expires_at: new Date().toISOString() });
        return "paused";
      }
      const deadline = Date.now() + Math.min(limits.exportPartTimeLimitMs, budgetMs - elapsed);
      const next = await exporter.step(ctx, state, { deadline, maxPartBytes: limits.exportPartMaxBytes });
      if (next.nextOffset <= state.nextOffset) throw new Error("A etapa do export não avançou.");
      state = next;

      const saved = await updateWithLease(admin, job, lease, {
        next_offset: state.nextOffset,
        part_count: state.partCount,
        files: state.files,
        progress_done: state.nextOffset,
        lease_expires_at: leaseUntil(),
      });
      if (!saved) return "lost-lease";
    }

    const result = await exporter.finalize(ctx, state);
    await updateWithLease(admin, job, lease, {
      status: "done",
      files: result.files,
      file_path: result.filePath,
      progress_done: total,
      finished_at: new Date().toISOString(),
      error_message: null,
      lease_token: null,
      lease_expires_at: null,
    });
    return "done";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[export ${job.id}] ${message}`);
    const attempts = job.attempts + 1;
    const failed = attempts >= MAX_ATTEMPTS;
    await updateWithLease(admin, job, lease, {
      attempts,
      status: failed ? "failed" : "pending",
      error_message: message.slice(0, 1000),
      finished_at: failed ? new Date().toISOString() : null,
      lease_token: null,
      lease_expires_at: null,
    });
    return failed ? "failed" : "retrying";
  }
}

/** Agenda a execução para DEPOIS da resposta HTTP (Next.js after / waitUntil na Vercel). */
export function scheduleExportJobs(exportIds: string[]): void {
  if (exportIds.length === 0) return;
  after(async () => {
    for (const id of exportIds) {
      try {
        await runExportJob(id);
      } catch (error) {
        console.error(`[export ${id}] falha ao executar:`, error);
      }
    }
  });
}

/** Jobs prontos para rodar: pendentes ou em processamento com lease vencido. */
export function isRunnable(job: Pick<BatchExportRow, "status" | "lease_expires_at">, now = Date.now()): boolean {
  if (job.status === "pending") return true;
  if (job.status !== "processing") return false;
  return !job.lease_expires_at || new Date(job.lease_expires_at).getTime() < now;
}

export async function findRunnableExports(admin: SupabaseClient, limit = 10): Promise<string[]> {
  const { data, error } = await admin
    .from("batch_exports")
    .select("id, status, lease_expires_at")
    .in("status", ["pending", "processing"])
    .order("created_at")
    .limit(100);
  if (error) throw new Error(error.message);
  return ((data ?? []) as Pick<BatchExportRow, "id" | "status" | "lease_expires_at">[])
    .filter((job) => isRunnable(job))
    .slice(0, limit)
    .map((job) => job.id);
}

/**
 * Cria o pedido de exportação com o cliente do usuário (RLS de ADMIN).
 * Clique duplo: o índice único de "um job ativo por (lote, tipo)" devolve o job existente.
 */
export async function requestExport(
  sb: SupabaseClient,
  batch: PlateBatchRow,
  kind: ExportKind,
  userId: string,
): Promise<{ job: BatchExportRow; created: boolean }> {
  if (!AVAILABLE_EXPORT_KINDS.includes(kind)) {
    throw new HttpError(501, "Este tipo de exportação ainda não está disponível.");
  }
  if (kind === "art_png_zip" && !batch.template_version_id) {
    throw new HttpError(409, "Este lote não tem template vinculado: não é possível gerar artes.");
  }

  const { data, error } = await sb
    .from("batch_exports")
    .insert({ batch_id: batch.id, kind, template_version_id: batch.template_version_id, requested_by: userId })
    .select(EXPORT_COLUMNS)
    .single<BatchExportRow>();

  if (!error && data) return { job: data, created: true };
  if (error?.code !== "23505") throw httpErrorFromDb(error ?? { message: "Falha ao criar exportação." });

  const { data: active, error: activeError } = await sb
    .from("batch_exports")
    .select(EXPORT_COLUMNS)
    .eq("batch_id", batch.id)
    .eq("kind", kind)
    .in("status", ["pending", "processing"])
    .maybeSingle<BatchExportRow>();
  if (activeError || !active) throw httpErrorFromDb(activeError ?? { message: "Exportação em andamento não encontrada." });
  return { job: active, created: false };
}
