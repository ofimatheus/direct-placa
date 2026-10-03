import "server-only";
import { strToU8 } from "fflate";
import { renderQrPng, renderQrSvg } from "@/lib/renderer/server";
import type { ExportContext } from "../context";
import { finalizeZipExport, urlsFor, writeZipPart, type ZipPartSpec } from "../zip-parts";
import type { Exporter } from "../types";

const QR_PNG_SIZE = 1024;

/** QR avulso por placa (PNG 1024 px + SVG vetorial), com as mesmas opções da versão do lote. */
function spec(ctx: ExportContext): ZipPartSpec {
  const options = {
    errorCorrection: ctx.layout?.qr_error_correction ?? "M",
    quietZone: ctx.layout?.qr_quiet_zone ?? 4,
    color: ctx.layout?.qr_color ?? "#000000",
    background: ctx.layout?.qr_background_color ?? "#FFFFFF",
  } as const;

  return {
    baseName: `${ctx.slug}-QR-Codes`,
    manifestHeader: ["public_code", "qr_url", "nfc_url", "filename", "svg_filename"],
    manifestRow: (plate) => {
      const urls = urlsFor(plate);
      return [plate.public_code, urls.qr, urls.nfc, `${plate.public_code}.png`, `${plate.public_code}.svg`];
    },
    async entriesFor(plate) {
      const { qr } = urlsFor(plate);
      const png = await renderQrPng(qr, { ...options, sizePx: QR_PNG_SIZE });
      const svg = renderQrSvg(qr, options);
      return [
        { name: `${plate.public_code}.png`, data: png },
        { name: `${plate.public_code}.svg`, data: strToU8(svg), compress: true },
      ];
    },
  };
}

export const qrZipExporter: Exporter = {
  step: (ctx, state, limits) => writeZipPart(ctx, state, limits, spec(ctx)),
  finalize: (ctx, state) => finalizeZipExport(ctx, state, spec(ctx)),
};
