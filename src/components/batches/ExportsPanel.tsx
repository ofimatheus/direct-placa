"use client";

import { useEffect, useRef, useState } from "react";
import type { BatchExportView, ExportKind } from "@/lib/db/types";
import { EXPORT_KIND_LABEL, EXPORT_STATUS_LABEL } from "@/lib/plates/labels";
import { formatBytes, formatDateTime } from "@/lib/utils/text";

const POLL_MS = 2500;

interface Props {
  batchId: string;
  initial: BatchExportView[];
  canGenerateArt: boolean;
}

const isActive = (e: BatchExportView) => e.status === "pending" || e.status === "processing";
const downloadUrl = (exportId: string, index: number) => `/api/admin/exports/${exportId}/download?file=${index}`;

/**
 * Ações de exportação + acompanhamento. O polling (a cada 2,5 s enquanto há
 * job ativo) também serve de "motor": o servidor retoma jobs parados a cada consulta.
 */
export function ExportsPanel({ batchId, initial, canGenerateArt }: Props) {
  const [exports, setExports] = useState(initial);
  const [requesting, setRequesting] = useState<ExportKind | null>(null);
  const [error, setError] = useState<string | null>(null);
  const autoDownload = useRef(new Set<string>());
  const anyActive = exports.some(isActive);

  useEffect(() => {
    if (!anyActive) return;
    let stopped = false;
    const timer = setInterval(async () => {
      try {
        const response = await fetch(`/api/admin/batches/${batchId}/exports`, { cache: "no-store" });
        if (!response.ok || stopped) return;
        const body = (await response.json()) as { exports: BatchExportView[] };
        setExports(body.exports);
      } catch {
        // Rede instável: tenta de novo no próximo ciclo.
      }
    }, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [anyActive, batchId]);

  // Todos os pedidos baixam o arquivo sozinhos quando ficam prontos (artes em várias partes: um botão por parte).
  useEffect(() => {
    for (const job of exports) {
      if (job.status === "done" && autoDownload.current.has(job.id)) {
        autoDownload.current.delete(job.id);
        if (job.files.length === 1) window.location.assign(downloadUrl(job.id, 0));
      }
    }
  }, [exports]);

  async function request(kind: ExportKind) {
    setRequesting(kind);
    setError(null);
    try {
      const response = await fetch(`/api/admin/batches/${batchId}/exports`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind }),
      });
      const body = (await response.json().catch(() => ({}))) as { export?: BatchExportView; error?: string };
      if (!response.ok || !body.export) throw new Error(body.error ?? "Não foi possível iniciar a exportação.");
      const job = body.export;
      autoDownload.current.add(job.id);
      setExports((current) => [job, ...current.filter((e) => e.id !== job.id)]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível iniciar a exportação.");
    } finally {
      setRequesting(null);
    }
  }

  const activeOf = (kind: ExportKind) => exports.find((e) => e.kind === kind && isActive(e));
  const latestArt = exports.find((e) => e.kind === "art_png_zip");

  function actionButton(kind: ExportKind, label: string, primary = false) {
    const active = activeOf(kind);
    const disabled = !!active || requesting !== null || (kind === "art_png_zip" && !canGenerateArt);
    return (
      <button type="button" className={`btn ${primary ? "btn-primary" : ""}`} disabled={disabled} onClick={() => request(kind)}>
        {active ? EXPORT_STATUS_LABEL[active.status] : requesting === kind ? "Enviando pedido..." : label}
      </button>
    );
  }

  return (
    <section aria-labelledby="exports-title" className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        {/* Download em massa = ARTE FINAL de cada placa (1 placa = 1 PNG), pelo renderizador oficial. */}
        {actionButton("art_png_zip", latestArt?.status === "done" ? "Gerar e baixar artes novamente" : "Baixar artes das placas (PNG)", latestArt?.status !== "done")}
        {latestArt?.status === "done" &&
          latestArt.files.map((file, index) => (
            <a key={file.path} href={downloadUrl(latestArt.id, index)} className="btn btn-primary" data-art-download="">
              {latestArt.files.length === 1 ? "Baixar artes" : `Baixar ${file.name}`}
            </a>
          ))}
        {actionButton("csv", "Exportar CSV")}
        {actionButton("qr_zip", "QR Codes avulsos (PNG + SVG)")}
      </div>
      {!canGenerateArt && <p className="text-sm text-ink-soft">Este lote não tem template vinculado, então não gera artes.</p>}
      <p className="text-xs text-ink-soft" data-qr-pack-note="">
        "QR Codes avulsos" traz só o QR de cada placa, para montar em outra arte: um PNG e o mesmo QR em vetor (.svg). O Windows pode mostrar o .svg
        como &quot;Chrome HTML Document&quot;, mas ele é uma imagem. Para imprimir as placas, use &quot;Baixar artes das placas&quot;.
      </p>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}

      {exports.length > 0 && (
        <div>
          <h2 id="exports-title" className="display mb-2 text-base">
            Arquivos gerados
          </h2>
          <ul className="divide-y divide-line rounded-md border border-line bg-surface">
            {exports.map((job) => (
              <ExportRow key={job.id} job={job} />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function ExportRow({ job }: { job: BatchExportView }) {
  const active = isActive(job);
  const percent = job.progress_total > 0 ? Math.round((job.progress_done / job.progress_total) * 100) : 0;
  const tone = job.status === "done" ? "text-ok" : job.status === "failed" ? "text-danger" : "text-warn";

  return (
    <li className="grid gap-2 px-4 py-3 sm:grid-cols-[12rem_1fr_auto] sm:items-center">
      <div>
        <p className="font-semibold">{EXPORT_KIND_LABEL[job.kind]}</p>
        <p className="text-xs text-ink-soft">{formatDateTime(job.created_at)}</p>
      </div>
      <div className="min-w-0 text-sm" aria-live="polite">
        <p className={`font-semibold ${tone}`}>
          {EXPORT_STATUS_LABEL[job.status]}
          {active && job.progress_total > 0 && (
            <span className="font-normal text-ink-soft">
              {" "}
              {job.progress_done} de {job.progress_total} placas
            </span>
          )}
        </p>
        {active && (
          <div className="mt-1 h-1.5 overflow-hidden rounded bg-paper" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full bg-mat transition-[width]" style={{ width: `${Math.max(percent, 3)}%` }} />
          </div>
        )}
        {job.status === "failed" && job.error_message && <p className="mt-1 text-danger">{job.error_message}</p>}
        {job.status === "pending" && job.error_message && (
          <p className="mt-1 text-ink-soft">Nova tentativa após erro: {job.error_message}</p>
        )}
      </div>
      {job.status === "done" && (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {job.files.map((file, index) => (
            <li key={file.path}>
              <a href={downloadUrl(job.id, index)} className="font-semibold text-cyan hover:underline">
                {file.name}
              </a>{" "}
              <span className="text-ink-soft">{formatBytes(file.size_bytes)}</span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
