import "server-only";
import { strToU8 } from "fflate";
import { PLATE_STATUS_LABEL } from "@/lib/plates/labels";
import { OUTPUTS_BUCKET, putGeneratedObject } from "@/lib/storage";
import { toCsv } from "@/lib/utils/csv";
import { urlsFor } from "../zip-parts";
import type { Exporter } from "../types";

/** Planilha do lote: uma linha por placa. Pequena o bastante para uma única etapa. */
export const csvExporter: Exporter = {
  async step(ctx, state) {
    const header = ["public_code", "qr_url", "nfc_url", "status", "revendedor", "lote"];
    const rows = ctx.plates.map((plate) => {
      const urls = urlsFor(plate);
      return [
        plate.public_code,
        urls.qr,
        urls.nfc,
        PLATE_STATUS_LABEL[plate.status],
        plate.reseller_name,
        ctx.batch.name,
      ];
    });
    const name = `${ctx.slug}.csv`;
    const path = `${ctx.storagePrefix}/${name}`;
    const data = strToU8(toCsv(header, rows));
    await putGeneratedObject(ctx.admin, OUTPUTS_BUCKET, path, data, "text/csv");
    return {
      nextOffset: ctx.plates.length,
      partCount: 1,
      files: [{ name, path, size_bytes: data.length, content_type: "text/csv" }],
    };
  },
  async finalize(_ctx, state) {
    return { files: state.files, filePath: state.files[0]?.path ?? null };
  },
};
