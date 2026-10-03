import "server-only";
import type { ExportKind } from "@/lib/db/types";
import type { Exporter } from "../types";
import { artPdfExporter } from "./art-pdf";
import { artPngZipExporter } from "./art-png-zip";
import { csvExporter } from "./csv";
import { qrZipExporter } from "./qr-zip";

export const EXPORTERS: Record<ExportKind, Exporter> = {
  csv: csvExporter,
  qr_zip: qrZipExporter,
  art_png_zip: artPngZipExporter,
  art_pdf: artPdfExporter,
};

/** Tipos que já podem ser solicitados pela interface/API. */
export const AVAILABLE_EXPORT_KINDS: readonly ExportKind[] = ["csv", "qr_zip", "art_png_zip"];
