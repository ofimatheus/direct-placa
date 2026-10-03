"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

interface StockPlate {
  id: string;
  public_code: string;
  batch_id: string | null;
  batch_name: string | null;
}

interface Props {
  resellerId: string;
  resellerName: string;
  stockCount: number;
  stockPlates: StockPlate[];
  batches: { id: string; name: string }[];
  disabled?: boolean;
}

/** Atribuição em dois modos: "atribuir N disponíveis" ou seleção manual. A operação é transacional no banco. */
export function AssignPlatesForm({ resellerId, resellerName, stockCount, stockPlates, batches, disabled }: Props) {
  const router = useRouter();
  const [mode, setMode] = useState<"quantity" | "manual">("quantity");
  const [quantity, setQuantity] = useState("10");
  const [batchId, setBatchId] = useState("");
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [state, setState] = useState<{ busy: boolean; error?: string; ok?: string }>({ busy: false });

  const visible = useMemo(() => {
    const term = filter.trim().toUpperCase();
    return stockPlates.filter((p) => (!term || p.public_code.includes(term)) && (!batchId || p.batch_id === batchId));
  }, [stockPlates, filter, batchId]);

  const qty = Number.parseInt(quantity, 10);
  const qtyValid = Number.isInteger(qty) && qty >= 1 && qty <= Math.min(1000, stockCount);

  async function submit() {
    const body =
      mode === "quantity" ? { mode, quantity: qty, batch_id: batchId || null } : { mode, plate_ids: [...selected] };
    setState({ busy: true });
    const response = await fetch(`/api/admin/resellers/${resellerId}/assign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    const json = response ? ((await response.json().catch(() => ({}))) as { assigned?: number; error?: string }) : {};
    if (!response?.ok) {
      setState({ busy: false, error: json.error ?? "Não foi possível atribuir as placas." });
      return;
    }
    setSelected(new Set());
    setState({ busy: false, ok: `${json.assigned} placa(s) atribuída(s) a ${resellerName}.` });
    router.refresh();
  }

  if (disabled) return <p className="text-sm text-ink-soft">Ative o revendedor para atribuir placas.</p>;
  if (stockCount === 0) return <p className="text-sm text-ink-soft">Não há placas em estoque. Gere um lote para ter placas disponíveis.</p>;

  return (
    <div>
      <div className="mb-4 inline-flex rounded-lg border border-line bg-paper p-1" role="tablist">
        {(["quantity", "manual"] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            onClick={() => setMode(m)}
            className={`rounded-md px-3 py-1.5 text-sm font-semibold ${mode === m ? "bg-surface text-ink shadow-sm" : "text-ink-soft"}`}
          >
            {m === "quantity" ? "Quantidade automática" : "Seleção manual"}
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-[160px_minmax(0,1fr)]">
        {mode === "quantity" ? (
          <label className="block">
            <span className="field-label">Quantidade</span>
            <input className="input" type="number" min={1} max={Math.min(1000, stockCount)} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          </label>
        ) : (
          <label className="block">
            <span className="field-label">Filtrar código</span>
            <input className="input" value={filter} onChange={(e) => setFilter(e.target.value)} />
          </label>
        )}
        <label className="block">
          <span className="field-label">Lote (opcional)</span>
          <select className="input" value={batchId} onChange={(e) => setBatchId(e.target.value)}>
            <option value="">Qualquer lote</option>
            {batches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {mode === "manual" && (
        <div className="mt-3">
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="text-ink-soft">
              {selected.size} selecionada(s) de {visible.length} exibida(s)
              {stockPlates.length < stockCount && ` (mostrando as ${stockPlates.length} mais antigas do estoque)`}
            </span>
            <button
              type="button"
              className="link"
              onClick={() =>
                setSelected((current) => {
                  const next = new Set(current);
                  const allSelected = visible.every((p) => next.has(p.id));
                  visible.forEach((p) => (allSelected ? next.delete(p.id) : next.add(p.id)));
                  return next;
                })
              }
            >
              {visible.length > 0 && visible.every((p) => selected.has(p.id)) ? "Desmarcar exibidas" : "Marcar exibidas"}
            </button>
          </div>
          <div className="grid max-h-64 grid-cols-2 gap-1 overflow-y-auto rounded-md border border-line p-2 sm:grid-cols-4 lg:grid-cols-6">
            {visible.map((p) => (
              <label key={p.id} className="flex items-center gap-2 rounded px-2 py-1 hover:bg-paper" title={p.batch_name ?? undefined}>
                <input
                  type="checkbox"
                  className="accent-mat"
                  checked={selected.has(p.id)}
                  onChange={(e) =>
                    setSelected((current) => {
                      const next = new Set(current);
                      if (e.target.checked) next.add(p.id);
                      else next.delete(p.id);
                      return next;
                    })
                  }
                />
                <span className="plate-code text-sm">{p.public_code}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="btn btn-primary"
          disabled={state.busy || (mode === "quantity" ? !qtyValid : selected.size === 0)}
          onClick={submit}
        >
          {state.busy
            ? "Atribuindo..."
            : mode === "quantity"
              ? `Atribuir ${qtyValid ? qty : ""} placas disponíveis`
              : `Atribuir ${selected.size} placas selecionadas`}
        </button>
        <span className="text-sm text-ink-soft">{stockCount} em estoque</span>
        {state.error && (
          <span role="alert" className="text-sm text-danger">
            {state.error}
          </span>
        )}
        {state.ok && (
          <span role="status" className="text-sm text-ok">
            {state.ok}
          </span>
        )}
      </div>
    </div>
  );
}
