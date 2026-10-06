import "server-only";
import { strToU8, zipSync, type Zippable } from "fflate";
import { buildNfcUrl, buildQrUrl } from "@/lib/plates/urls";
import { OUTPUTS_BUCKET, putGeneratedObject } from "@/lib/storage";
import { toCsv } from "@/lib/utils/csv";
import type { ExportFile } from "@/lib/db/types";
import type { ExportContext, ExportPlate } from "./context";
import type { ExportState, StepLimits } from "./types";

export interface ZipEntry {
  name: string;
  data: Uint8Array;
  /** PNG já é comprimido: guardar sem recompressão (level 0) economiza CPU. */
  compress?: boolean;
}

export interface ZipPartSpec {
  baseName: string;
  entriesFor(plate: ExportPlate): Promise<ZipEntry[]>;
  /**
   * Inclui manifest.csv dentro de cada ZIP e, com várias partes, o manifesto
   * completo à parte. Padrão: sim. O pacote de ARTES desliga (só PNGs de impressão;
   * os dados ficam no "Exportar CSV").
   */
  manifest?: boolean;
  manifestHeader: string[];
  manifestRow(plate: ExportPlate): (string | number | null)[];
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Monta UMA parte do ZIP a partir de state.nextOffset e envia ao Storage.
 * A parte fecha quando atinge o limite de bytes (compatível com o limite de
 * arquivo do Supabase) ou o limite de tempo da etapa. Se a primeira parte
 * contiver todas as placas, o arquivo recebe o nome simples: {Lote}.zip
 */
export async function writeZipPart(
  ctx: ExportContext,
  state: ExportState,
  limits: StepLimits,
  spec: ZipPartSpec,
): Promise<ExportState> {
  const total = ctx.plates.length;
  const start = state.nextOffset;
  const partNumber = state.partCount + 1;
  const files: Zippable = {};
  const manifest: (string | number | null)[][] = [];
  let bytes = 0;
  let index = start;

  while (index < total) {
    const plate = ctx.plates[index]!;
    const entries = await spec.entriesFor(plate);
    const size = entries.reduce((sum, e) => sum + e.data.length, 0);
    if (index > start && bytes + size > limits.maxPartBytes) break;

    for (const entry of entries) files[entry.name] = [entry.data, { level: entry.compress ? 6 : 0 }];
    manifest.push(spec.manifestRow(plate));
    bytes += size;
    index += 1;
    if (Date.now() >= limits.deadline) break;
  }

  const single = partNumber === 1 && index >= total;
  const name = single ? `${spec.baseName}.zip` : `${spec.baseName}-parte-${pad(partNumber)}.zip`;
  if (spec.manifest !== false) files["manifest.csv"] = [strToU8(toCsv(spec.manifestHeader, manifest)), { level: 6 }];

  const zipped = zipSync(files);
  const path = `${ctx.storagePrefix}/${name}`;
  await putGeneratedObject(ctx.admin, OUTPUTS_BUCKET, path, zipped, "application/zip");

  const file: ExportFile = {
    name,
    path,
    size_bytes: zipped.length,
    content_type: "application/zip",
    offset_start: start,
    offset_end: index,
  };
  return { nextOffset: index, partCount: partNumber, files: [...state.files, file] };
}

/** Se houve mais de uma parte, grava também um manifest.csv completo indicando o ZIP de cada placa. */
export async function finalizeZipExport(
  ctx: ExportContext,
  state: ExportState,
  spec: Pick<ZipPartSpec, "baseName" | "manifestHeader" | "manifestRow" | "manifest">,
): Promise<{ files: ExportFile[]; filePath: string | null }> {
  if (state.files.length <= 1) {
    return { files: state.files, filePath: state.files[0]?.path ?? null };
  }
  // Pacote sem manifesto (artes) em várias partes: só os ZIPs; sem arquivo único (file_path nulo, como antes).
  if (spec.manifest === false) return { files: state.files, filePath: null };
  const zipFor = (offset: number) =>
    state.files.find((f) => (f.offset_start ?? 0) <= offset && offset < (f.offset_end ?? 0))?.name ?? null;
  const rows = ctx.plates.map((plate, offset) => [...spec.manifestRow(plate), zipFor(offset)]);
  const csv = toCsv([...spec.manifestHeader, "zip_file"], rows);
  const name = `${spec.baseName}-manifest.csv`;
  const path = `${ctx.storagePrefix}/${name}`;
  const data = strToU8(csv);
  await putGeneratedObject(ctx.admin, OUTPUTS_BUCKET, path, data, "text/csv");
  return {
    files: [...state.files, { name, path, size_bytes: data.length, content_type: "text/csv" }],
    filePath: null,
  };
}

export const urlsFor = (plate: ExportPlate) => ({ qr: buildQrUrl(plate.public_code), nfc: buildNfcUrl(plate.public_code) });
