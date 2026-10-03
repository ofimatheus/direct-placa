"use client";

import { useMemo, useState } from "react";
import type { BatchPlate } from "@/lib/db/queries";
import { PLATE_STATUS_LABEL } from "@/lib/plates/labels";
import { buildNfcUrl } from "@/lib/plates/urls";

export function PlatesTable({ plates, hasTemplate }: { plates: BatchPlate[]; hasTemplate: boolean }) {
  const [filter, setFilter] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const visible = useMemo(() => {
    const term = filter.trim().toUpperCase();
    return term ? plates.filter((p) => p.public_code.includes(term) || p.reseller_name?.toUpperCase().includes(term)) : plates;
  }, [plates, filter]);

  async function copyNfcUrl(plate: BatchPlate) {
    const url = buildNfcUrl(plate.public_code);
    try {
      await navigator.clipboard.writeText(url);
      setMessage(`URL NFC de ${plate.public_code} copiada: ${url}`);
    } catch {
      setMessage(url);
    }
  }

  return (
    <section aria-labelledby="plates-title">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <h2 id="plates-title" className="display text-base">
          Placas do lote
        </h2>
        <label className="block w-full sm:w-64">
          <span className="sr-only">Filtrar por código ou revendedor</span>
          <input className="input" placeholder="Filtrar por código ou revendedor" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </label>
      </div>
      {message && (
        <p role="status" className="mb-3 break-all text-sm text-ink-soft">
          {message}
        </p>
      )}
      <div className="overflow-x-auto rounded-md border border-line bg-surface">
        <table className="w-full min-w-[620px] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-line text-ink-soft">
              <th className="px-4 py-2 font-semibold">Código</th>
              <th className="px-4 py-2 font-semibold">QR</th>
              <th className="px-4 py-2 font-semibold">Status</th>
              <th className="px-4 py-2 font-semibold">Revendedor</th>
              <th className="px-4 py-2 font-semibold">
                <span className="sr-only">Ações</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {visible.map((plate) => (
              <tr key={plate.id} className="border-b border-line last:border-0">
                <td className="px-4 py-2">
                  <a href={`/admin/plates/${plate.id}`} className="plate-code text-base text-ink hover:text-cyan hover:underline">
                    {plate.public_code}
                  </a>
                </td>
                <td className="px-4 py-2 text-ok">OK</td>
                <td className="px-4 py-2">{PLATE_STATUS_LABEL[plate.status]}</td>
                <td className="px-4 py-2">{plate.reseller_name ?? "—"}</td>
                <td className="px-4 py-2">
                  <div className="flex justify-end gap-3 whitespace-nowrap">
                    <button type="button" className="font-semibold text-cyan hover:underline" onClick={() => copyNfcUrl(plate)}>
                      Copiar URL NFC
                    </button>
                    {hasTemplate && (
                      <a href={`/api/admin/plates/${plate.id}/art`} target="_blank" rel="noreferrer" className="font-semibold text-cyan hover:underline">
                        Ver arte
                      </a>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-ink-soft">
                  Nenhuma placa corresponde ao filtro.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
