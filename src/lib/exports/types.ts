import type { ExportFile } from "@/lib/db/types";
import type { ExportContext } from "./context";

/** Estado persistido entre etapas (colunas next_offset, part_count e files). */
export interface ExportState {
  nextOffset: number;
  partCount: number;
  files: ExportFile[];
}

export interface StepLimits {
  /** Instante (Date.now) em que a etapa atual deve fechar a parte e parar. */
  deadline: number;
  maxPartBytes: number;
}

/**
 * Um exportador processa o lote em etapas curtas e retomáveis.
 * step() deve SEMPRE avançar nextOffset e deixar tudo o que produziu no Storage
 * antes de retornar — assim um worker interrompido pode ser substituído por outro.
 */
export interface Exporter {
  step(ctx: ExportContext, state: ExportState, limits: StepLimits): Promise<ExportState>;
  finalize(ctx: ExportContext, state: ExportState): Promise<{ files: ExportFile[]; filePath: string | null }>;
}
