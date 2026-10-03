"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { AvailablePlateRow, AvailableStockRow, SaleSelectionMode } from "@/lib/db/types";
import { PLATE_STATUS_LABEL } from "@/lib/plates/labels";
import { SALE_MAX_PLATES, insufficientStockMessage } from "@/lib/sales";
import { formatBRL, formatInt, toCents } from "@/lib/utils/money";

interface Props {
  resellers: { id: string; name: string }[];
  defaultResellerId?: string;
  /** Total de placas disponíveis no estoque (todas as origens). */
  availableTotal: number;
  /** Estoque disponível por lote. */
  stock: AvailableStockRow[];
}

const PAGE = 100;

function parseMoney(value: string): number {
  const normalized = value.replace(/\./g, "").replace(",", ".");
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

type ApiError = { error?: string; details?: unknown };

function errorText(body: ApiError, fallback: string): string {
  const details = Array.isArray(body.details)
    ? body.details.map((d) => (d as { message?: string }).message).filter(Boolean).join(" ")
    : "";
  return [body.error ?? fallback, details].filter(Boolean).join(" ");
}

/**
 * Registrar venda = reservar as placas. Os valores exibidos são prévia; o banco
 * recalcula os totais e reserva as placas numa única transação ao salvar.
 *
 * A idempotency_key nasce com o formulário: clique duplo ou reenvio após falha de
 * rede devolvem a mesma venda. Só quando o servidor recusa o pedido (4xx) uma
 * chave nova é gerada.
 */
export function NewSaleForm({ resellers, defaultResellerId, availableTotal, stock }: Props) {
  const router = useRouter();
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [form, setForm] = useState({
    resellerId: defaultResellerId ?? resellers[0]?.id ?? "",
    quantity: "10",
    unitPrice: "25,00",
    discount: "0,00",
    notes: "",
    status: "pending" as "pending" | "paid",
  });
  const [selection, setSelection] = useState<SaleSelectionMode>("automatic");
  const [autoBatch, setAutoBatch] = useState("");
  const [state, setState] = useState<{ busy: boolean; error?: string }>({ busy: false });

  // Seleção manual: lista paginada vinda do servidor + placas escolhidas (sobrevivem aos filtros).
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [manualBatch, setManualBatch] = useState("");
  const [list, setList] = useState<{ rows: AvailablePlateRow[]; total: number; loading: boolean; error?: string }>({
    rows: [],
    total: 0,
    loading: false,
  });
  const [selected, setSelected] = useState<Map<string, AvailablePlateRow>>(new Map());

  const quantity = Number.parseInt(form.quantity, 10);
  const quantityValid = Number.isInteger(quantity) && quantity >= 1 && quantity <= SALE_MAX_PLATES;
  const unit = parseMoney(form.unitPrice);
  const discount = parseMoney(form.discount);
  const subtotalCents = quantityValid ? quantity * toCents(unit) : 0;
  const discountCents = toCents(discount);
  const discountValid = discountCents <= subtotalCents;
  const totalCents = Math.max(0, subtotalCents - discountCents);

  const autoAvailable = autoBatch ? (stock.find((s) => s.batch_id === autoBatch)?.available ?? 0) : availableTotal;
  const stockProblem =
    selection === "automatic" && quantityValid && quantity > autoAvailable ? insufficientStockMessage(autoAvailable, Boolean(autoBatch)) : null;
  const manualProblem =
    selection === "manual" && quantityValid && selected.size !== quantity
      ? selected.size < quantity
        ? `Selecione mais ${quantity - selected.size} placa(s) para completar ${quantity}.`
        : `Você selecionou ${selected.size} placas, mas a venda tem ${quantity}. Desmarque ${selected.size - quantity}.`
      : null;
  const canSubmit = !state.busy && quantityValid && discountValid && Boolean(form.resellerId) && !stockProblem && !manualProblem;

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);

  const load = useCallback(
    async (offset: number) => {
      setList((current) => ({ ...current, loading: true, error: undefined }));
      const params = new URLSearchParams({ limit: String(PAGE), offset: String(offset) });
      if (debounced) params.set("q", debounced);
      if (manualBatch) params.set("batch", manualBatch);
      const response = await fetch(`/api/admin/plates/available?${params.toString()}`, { cache: "no-store" }).catch(() => null);
      const body = response ? ((await response.json().catch(() => ({}))) as { rows?: AvailablePlateRow[]; total?: number } & ApiError) : {};
      if (!response?.ok || !body.rows) {
        setList((current) => ({ ...current, loading: false, error: errorText(body, "Não foi possível carregar as placas disponíveis.") }));
        return;
      }
      const rows = body.rows;
      setList((current) => ({ rows: offset === 0 ? rows : [...current.rows, ...rows], total: body.total ?? 0, loading: false }));
    },
    [debounced, manualBatch],
  );

  useEffect(() => {
    if (selection === "manual") void load(0);
  }, [selection, load]);

  const limitReached = quantityValid && selected.size >= quantity;

  function toggle(plate: AvailablePlateRow, checked: boolean) {
    setSelected((current) => {
      const next = new Map(current);
      if (checked) next.set(plate.plate_id, plate);
      else next.delete(plate.plate_id);
      return next;
    });
  }

  const selectedCodes = useMemo(() => [...selected.values()].map((p) => p.public_code).sort(), [selected]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    setState({ busy: true });
    const response = await fetch("/api/admin/sales", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reseller_id: form.resellerId,
        quantity,
        unit_price: unit,
        discount,
        notes: form.notes || null,
        status: form.status,
        selection,
        plate_ids: selection === "manual" ? [...selected.keys()] : null,
        batch_id: selection === "automatic" ? autoBatch || null : null,
        idempotency_key: idempotencyKey,
      }),
    }).catch(() => null);
    const body = response ? ((await response.json().catch(() => ({}))) as { saleId?: string } & ApiError) : {};
    if (!response?.ok || !body.saleId) {
      if (response && response.status >= 400 && response.status < 500) setIdempotencyKey(crypto.randomUUID());
      const message = errorText(body, response ? "Não foi possível registrar a venda." : "Falha de conexão. Tente de novo.");
      if (selection === "manual" && response?.status === 409) {
        // Placas que outra operação acabou de reservar saem da seleção; a lista é recarregada.
        setSelected((current) => new Map([...current].filter(([, p]) => !message.includes(p.public_code))));
        void load(0);
      }
      setState({ busy: false, error: message });
      return;
    }
    router.push(`/admin/sales/${body.saleId}`);
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-6">
        <div className="card grid gap-4 p-5 sm:grid-cols-2">
          <label className="block sm:col-span-2">
            <span className="field-label">Revendedor</span>
            <select className="input" value={form.resellerId} onChange={(e) => setForm({ ...form, resellerId: e.target.value })} required>
              {resellers.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="field-label">Quantidade de placas</span>
            <input
              className="input"
              type="number"
              min={1}
              max={SALE_MAX_PLATES}
              value={form.quantity}
              onChange={(e) => setForm({ ...form, quantity: e.target.value })}
            />
          </label>
          <label className="block">
            <span className="field-label">Preço unitário (R$)</span>
            <input className="input" inputMode="decimal" value={form.unitPrice} onChange={(e) => setForm({ ...form, unitPrice: e.target.value })} />
          </label>
          <label className="block">
            <span className="field-label">Desconto (R$)</span>
            <input className="input" inputMode="decimal" value={form.discount} onChange={(e) => setForm({ ...form, discount: e.target.value })} />
          </label>
          <label className="block">
            <span className="field-label">Status</span>
            <select className="input" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as "pending" | "paid" })}>
              <option value="pending">Pendente</option>
              <option value="paid">Pago</option>
            </select>
          </label>
          <label className="block sm:col-span-2">
            <span className="field-label">Observação (opcional)</span>
            <textarea className="input min-h-24" maxLength={1000} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </label>
        </div>

        <section className="card p-5" aria-labelledby="sale-plates-title">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="sale-plates-title" className="display text-lg">
              Placas da venda
            </h2>
            <span className="text-sm text-ink-soft">{formatInt(availableTotal)} disponíveis no estoque</span>
          </div>
          <p className="mt-1 text-sm text-ink-soft">
            Ao registrar, as placas ficam reservadas para o revendedor. Não é preciso atribuí-las em outra tela.
          </p>

          <div className="mt-4 inline-flex rounded-lg border border-line bg-paper p-1" role="radiogroup" aria-label="Forma de seleção das placas">
            {(["automatic", "manual"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={selection === mode}
                onClick={() => setSelection(mode)}
                className={`rounded-md px-3 py-1.5 text-sm font-semibold ${selection === mode ? "bg-surface text-ink shadow-sm" : "text-ink-soft"}`}
              >
                {mode === "automatic" ? "Automática" : "Manual"}
              </button>
            ))}
          </div>

          {selection === "automatic" ? (
            <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
              <label className="block">
                <span className="field-label">Lote (opcional)</span>
                <select className="input" value={autoBatch} onChange={(e) => setAutoBatch(e.target.value)}>
                  <option value="">{`Qualquer lote (${formatInt(availableTotal)} disponíveis)`}</option>
                  {stock.map((s) => (
                    <option key={s.batch_id} value={s.batch_id}>
                      {`${s.batch_name}${s.template_name ? `, ${s.template_name}` : ""} (${formatInt(s.available)} disponíveis)`}
                    </option>
                  ))}
                </select>
              </label>
              <p className="text-sm text-ink-soft sm:pb-2">
                {quantityValid ? `Reserva as ${formatInt(quantity)} placas disponíveis mais antigas.` : "Informe a quantidade."}
              </p>
              {stockProblem && (
                <p role="alert" className="text-sm font-semibold text-danger sm:col-span-2">
                  {stockProblem}
                </p>
              )}
            </div>
          ) : (
            <div className="mt-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="field-label">Buscar código</span>
                  <input className="input" value={search} placeholder="A7K482" onChange={(e) => setSearch(e.target.value)} />
                </label>
                <label className="block">
                  <span className="field-label">Lote</span>
                  <select className="input" value={manualBatch} onChange={(e) => setManualBatch(e.target.value)}>
                    <option value="">Todos os lotes</option>
                    {stock.map((s) => (
                      <option key={s.batch_id} value={s.batch_id}>
                        {`${s.batch_name} (${formatInt(s.available)})`}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className={selected.size === quantity ? "font-semibold text-ok" : "text-ink-soft"}>
                  {formatInt(selected.size)} de {quantityValid ? formatInt(quantity) : "?"} selecionadas
                </span>
                {selected.size > 0 && (
                  <button type="button" className="link" onClick={() => setSelected(new Map())}>
                    Limpar seleção
                  </button>
                )}
              </div>

              <div className="mt-2 max-h-80 overflow-auto rounded-md border border-line">
                <table className="data-table min-w-[520px]">
                  <thead>
                    <tr>
                      <th className="w-10">
                        <span className="sr-only">Selecionar</span>
                      </th>
                      <th>Código</th>
                      <th>Lote</th>
                      <th>Template</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.rows.map((plate) => {
                      const checked = selected.has(plate.plate_id);
                      const disabled = !checked && limitReached;
                      return (
                        <tr key={plate.plate_id} className={disabled ? "opacity-50" : undefined}>
                          <td>
                            <input
                              type="checkbox"
                              className="accent-mat"
                              aria-label={`Selecionar ${plate.public_code}`}
                              checked={checked}
                              disabled={disabled}
                              onChange={(e) => toggle(plate, e.target.checked)}
                            />
                          </td>
                          <td className="plate-code">{plate.public_code}</td>
                          <td>{plate.batch_name ?? <span className="text-ink-soft">—</span>}</td>
                          <td>
                            {plate.template_name ? (
                              `${plate.template_name}${plate.template_version ? ` v${plate.template_version}` : ""}`
                            ) : (
                              <span className="text-ink-soft">—</span>
                            )}
                          </td>
                          <td className="text-ink-soft">{PLATE_STATUS_LABEL[plate.status]}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {!list.loading && list.rows.length === 0 && !list.error && (
                  <p className="px-4 py-6 text-center text-sm text-ink-soft">Nenhuma placa disponível com esses filtros.</p>
                )}
                {list.loading && <p className="px-4 py-3 text-sm text-ink-soft">Carregando placas...</p>}
                {list.error && (
                  <p role="alert" className="px-4 py-3 text-sm text-danger">
                    {list.error}
                  </p>
                )}
              </div>
              <div className="mt-2 flex items-center justify-between text-sm text-ink-soft">
                <span>
                  Mostrando {formatInt(list.rows.length)} de {formatInt(list.total)}
                </span>
                {list.rows.length < list.total && (
                  <button type="button" className="btn btn-small" disabled={list.loading} onClick={() => load(list.rows.length)}>
                    Carregar mais
                  </button>
                )}
              </div>
              {selectedCodes.length > 0 && (
                <p className="mt-3 text-sm">
                  <span className="text-ink-soft">Selecionadas: </span>
                  <span className="plate-code break-words">{selectedCodes.slice(0, 40).join(", ")}</span>
                  {selectedCodes.length > 40 && <span className="text-ink-soft"> e mais {selectedCodes.length - 40}</span>}
                </p>
              )}
              {manualProblem && <p className="mt-2 text-sm text-warn">{manualProblem}</p>}
            </div>
          )}
        </section>
      </div>

      <aside className="card h-fit p-5 lg:sticky lg:top-6">
        <h2 className="display text-lg">Resumo</h2>
        <dl className="mt-4 space-y-2 text-sm">
          <div className="flex justify-between">
            <dt className="text-ink-soft">Placas</dt>
            <dd>
              {quantityValid ? formatInt(quantity) : "—"} ({selection === "automatic" ? "automática" : "manual"})
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-ink-soft">Subtotal</dt>
            <dd>{formatBRL(subtotalCents / 100)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-ink-soft">Desconto</dt>
            <dd>{discountCents > 0 ? `− ${formatBRL(discountCents / 100)}` : formatBRL(0)}</dd>
          </div>
          <div className="flex justify-between border-t border-line pt-3 text-base font-bold">
            <dt>Total</dt>
            <dd>{formatBRL(totalCents / 100)}</dd>
          </div>
        </dl>
        {!quantityValid && <p className="mt-3 text-sm text-danger">Informe uma quantidade entre 1 e {formatInt(SALE_MAX_PLATES)}.</p>}
        {!discountValid && <p className="mt-3 text-sm text-danger">O desconto não pode ser maior que o subtotal.</p>}
        {state.error && (
          <p role="alert" className="mt-3 text-sm text-danger">
            {state.error}
          </p>
        )}
        <button type="submit" className="btn btn-primary mt-5 w-full" disabled={!canSubmit}>
          {state.busy ? "Registrando..." : quantityValid ? `Registrar venda e reservar ${formatInt(quantity)} placas` : "Registrar venda"}
        </button>
        <p className="mt-3 text-xs text-ink-soft">
          Controle interno: nenhuma cobrança é feita. Vendas marcadas como pagas entram no faturamento.
        </p>
      </aside>
    </form>
  );
}
