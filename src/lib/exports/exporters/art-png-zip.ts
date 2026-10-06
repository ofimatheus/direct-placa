import "server-only";
import type { ExportContext } from "../context";
import { finalizeZipExport, urlsFor, writeZipPart, type ZipPartSpec } from "../zip-parts";
import type { Exporter } from "../types";

/**
 * Artes finais para impressão: arte base + QR individual + public_code, pelo
 * renderizador OFICIAL (o mesmo da prévia) e na versão EXATA de template
 * registrada no lote. Resultado: {Lote}.zip com SOMENTE {public_code}.png —
 * 1 placa = 1 PNG, sem manifesto nem outros arquivos (os dados ficam no "Exportar CSV").
 */
function spec(ctx: ExportContext): ZipPartSpec {
  return {
    baseName: ctx.slug,
    manifest: false,
    manifestHeader: ["public_code", "qr_url", "nfc_url", "filename"],
    manifestRow: (plate) => {
      const urls = urlsFor(plate);
      return [plate.public_code, urls.qr, urls.nfc, `${plate.public_code}.png`];
    },
    async entriesFor(plate) {
      const renderer = await ctx.getRenderer();
      const { png } = await renderer.render(plate.public_code, urlsFor(plate).qr);
      return [{ name: `${plate.public_code}.png`, data: png }];
    },
  };
}

export const artPngZipExporter: Exporter = {
  step: (ctx, state, limits) => writeZipPart(ctx, state, limits, spec(ctx)),
  finalize: (ctx, state) => finalizeZipExport(ctx, state, spec(ctx)),
};
