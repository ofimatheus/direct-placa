"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import type { SellablePlateRow } from "@/lib/db/types";
import { compareCustomersByDisplayName, getCustomerDisplayName, getCustomerOptionLabel } from "@/lib/customers";
import { computeSaleTotals, formatCents, parseMoneyToCents } from "@/lib/reseller-sales";

interface CustomerOption {
  id: string;
  name: string;
  company_name?: string | null;
}

interface Props {
  plates: SellablePlateRow[];
  customers: CustomerOption[];
}

export const NEW_CUSTOMER = "__new__";
export const NO_CUSTOMER = "__none__";

type NewCustomerDraft = { name: string; phone: string; email: string; company_name: string };
const EMPTY_DRAFT: NewCustomerDraft = { name: "", phone: "", email: "", company_name: "" };

/**
 * Nova venda final, na ordem do atendimento: 1. cliente, 2. placas, 3. valor.
 *
 * O formulário só monta o pedido: quem decide é create_reseller_sale, que numa
 * única transação cria a venda, os itens e vincula as placas ao cliente
 * (sem ativar). Depois de salvar:
 *   · 1 placa  → abre direto a configuração dessa placa
 *   · N placas → abre a venda, com a lista "Configurar placas da venda"
 *
 * A idempotency_key nasce com o formulário: clique duplo ou reenvio após falha
 * de rede devolvem a MESMA venda. Só uma recusa do servidor (4xx) gera outra.
 */
export function NewResellerSaleForm({ plates, customers: initialCustomers }: Props) {
  const router = useRouter();
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [customers, setCustomers] = useState<CustomerOption[]>(initialCustomers);
  const [customerChoice, setCustomerChoice] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [unitPrice, setUnitPrice] = useState("");
  const [discount, setDiscount] = useState("0,00");
  const [status, setStatus] = useState<"pending" | "paid">("pending");
  const [soldAt, setSoldAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [state, setState] = useState<{ busy: boolean; error?: string }>({ busy: false });

  const [modalOpen, setModalOpen] = useState(false);
  const [draft, setDraft] = useState<NewCustomerDraft>(EMPTY_DRAFT);
  const [modalState, setModalState] = useState<{ busy: boolean; error?: string }>({ busy: false });

  const customerReady = customerChoice !== "";
  const customerId = customerChoice && customerChoice !== NO_CUSTOMER ? customerChoice : null;
  const selectedCustomer = customers.find((c) => c.id === customerId);
  const customerName = selectedCustomer ? getCustomerDisplayName(selectedCustomer) : null;

  const visible = useMemo(() => {
    const term = search.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!term) return plates;
    return plates.filter((p) => p.public_code.includes(term));
  }, [plates, search]);

  // Total derivado (quantidade × unitário − desconto), recalculado a cada mudança.
  // É só exibição: o servidor recalcula tudo a partir das placas vendidas.
  const unitCents = unitPrice.trim() ? parseMoneyToCents(unitPrice) : null;
  const discountCents = discount.trim() ? parseMoneyToCents(discount) : 0;
  const totals = computeSaleTotals(selected.length, unitCents, discountCents);
  const pricingError = unitPrice.trim() && totals.error ? totals.error : null;

  function toggle(plateId: string) {
    setSelected((current) => (current.includes(plateId) ? current.filter((id) => id !== plateId) : [...current, plateId]));
  }

  function chooseCustomer(value: string) {
    if (value === NEW_CUSTOMER) {
      // Não troca a escolha atual: se o cadastro for cancelado, nada muda.
      setDraft(EMPTY_DRAFT);
      setModalState({ busy: false });
      setModalOpen(true);
      return;
    }
    setCustomerChoice(value);
  }

  async function createCustomer(event: React.FormEvent) {
    event.preventDefault();
    if (!draft.name.trim() || modalState.busy) return;
    setModalState({ busy: true });
    const response = await fetch("/api/reseller/customers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: draft.name,
        phone: draft.phone || null,
        email: draft.email || null,
        company_name: draft.company_name || null,
      }),
    }).catch(() => null);
    const json = response
      ? ((await response.json().catch(() => ({}))) as { customer?: CustomerOption; error?: string; details?: { message: string }[] })
      : {};
    if (!response?.ok || !json.customer) {
      const details = Array.isArray(json.details) ? json.details.map((d) => d.message).join(" ") : "";
      setModalState({ busy: false, error: [json.error ?? "Falha de conexão. Tente de novo.", details].filter(Boolean).join(" ") });
      return;
    }
    const created = { id: json.customer.id, name: json.customer.name, company_name: json.customer.company_name ?? null };
    setCustomers((current) => [...current, created].sort(compareCustomersByDisplayName));
    setCustomerChoice(created.id);
    setModalOpen(false);
    setModalState({ busy: false });
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!customerReady) {
      setState({ busy: false, error: "Escolha um cliente ou selecione “Sem cliente”." });
      return;
    }
    if (selected.length === 0) {
      setState({ busy: false, error: "Selecione ao menos uma placa." });
      return;
    }
    if (totals.error || unitCents === null) {
      setState({ busy: false, error: totals.error ?? "Informe um valor unitário válido." });
      return;
    }

    setState({ busy: true });
    const response = await fetch("/api/reseller/sales", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        plate_ids: selected,
        unit_price_cents: unitCents,
        discount_cents: discountCents ?? 0,
        customer_id: customerId,
        status,
        sold_at: soldAt,
        notes: notes.trim() || null,
        idempotency_key: idempotencyKey,
      }),
    }).catch(() => null);

    if (!response) {
      setState({ busy: false, error: "Falha de conexão. Tente de novo." });
      return;
    }
    const json = (await response.json().catch(() => ({}))) as { sale_id?: string; error?: string };
    if (!response.ok || !json.sale_id) {
      if (response.status >= 400 && response.status < 500) setIdempotencyKey(crypto.randomUUID());
      setState({ busy: false, error: json.error ?? "Não foi possível registrar a venda." });
      return;
    }
    // Uma placa: segue direto para configurá-la. Várias: a venda lista o que falta configurar.
    router.push(selected.length === 1 ? `/reseller/plates/${selected[0]}?venda=${json.sale_id}` : `/reseller/sales/${json.sale_id}`);
    router.refresh();
  }

  if (plates.length === 0) {
    return (
      <div className="card p-6">
        <h2 className="display text-lg">Nenhuma placa disponível para venda</h2>
        <p className="mt-2 text-sm text-ink-soft">
          Só entram aqui as placas que estão com você e ainda não foram ativadas nem vendidas. Assim que o administrador
          reservar novas placas para a sua revenda, elas aparecem nesta lista.
        </p>
      </div>
    );
  }

  return (
    <>
      <form onSubmit={submit} className="space-y-6">
        <section className="card p-5" aria-labelledby="sale-step-customer">
          <h2 id="sale-step-customer" className="display text-lg">
            1. Cliente
          </h2>
          <p className="text-sm text-ink-soft">As placas da venda ficam vinculadas a este cliente automaticamente.</p>
          <label className="mt-4 block max-w-md">
            <span className="field-label">Cliente</span>
            <select value={customerChoice} onChange={(e) => chooseCustomer(e.target.value)} className="input" aria-required>
              <option value="" disabled>
                Selecione o cliente
              </option>
              <option value={NEW_CUSTOMER}>+ Novo cliente</option>
              <option disabled>──────────</option>
              <option value={NO_CUSTOMER}>Sem cliente</option>
              {customers.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {getCustomerOptionLabel(customer)}
                </option>
              ))}
            </select>
          </label>
        </section>

        <section className="card p-5" aria-labelledby="sale-step-plates">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 id="sale-step-plates" className="display text-lg">
                2. Placas
              </h2>
              <p className="text-sm text-ink-soft" data-plates-hint="">
                {!customerReady
                  ? "Escolha um cliente ou selecione “Sem cliente” para continuar."
                  : selected.length === 0
                    ? "Nenhuma placa selecionada"
                    : `${selected.length} placa(s) selecionada(s)${customerName ? ` para ${customerName}` : ""}`}
              </p>
            </div>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por código..."
              className="input max-w-[220px]"
              aria-label="Buscar placa por código"
              disabled={!customerReady}
            />
          </div>

          <fieldset disabled={!customerReady} className={`mt-4 ${customerReady ? "" : "opacity-50"}`}>
            <legend className="sr-only">Placas disponíveis para venda</legend>
            <div className="max-h-80 overflow-y-auto rounded-md border border-line">
              <table className="w-full border-collapse text-left text-sm">
                <thead className="sticky top-0 bg-paper">
                  <tr className="border-b border-line text-ink-soft">
                    <th className="w-10 px-3 py-2" />
                    <th className="px-3 py-2 font-semibold">Código</th>
                    <th className="px-3 py-2 font-semibold">Situação</th>
                    <th className="px-3 py-2 font-semibold">Lote</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((plate) => (
                    <tr key={plate.plate_id} className="border-b border-line last:border-0">
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={selected.includes(plate.plate_id)}
                          onChange={() => toggle(plate.plate_id)}
                          aria-label={`Selecionar placa ${plate.public_code}`}
                        />
                      </td>
                      <td className="px-3 py-2 font-mono font-semibold">{plate.public_code}</td>
                      <td className="px-3 py-2 text-ink-soft">Recebida, aguardando configuração</td>
                      <td className="px-3 py-2 text-ink-soft">{plate.batch_name ?? "—"}</td>
                    </tr>
                  ))}
                  {visible.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-3 py-6 text-center text-ink-soft">
                        Nenhuma placa encontrada para “{search}”.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </fieldset>

          <p className="mt-3 text-xs text-ink-soft">
            Registrar a venda <strong>não ativa</strong> a placa: em seguida você configura o destino e a placa passa a
            funcionar.
          </p>
        </section>

        <section className="card grid gap-4 p-5 sm:grid-cols-2" aria-labelledby="sale-step-values">
          <h2 id="sale-step-values" className="display text-lg sm:col-span-2">
            3. Valor e detalhes
          </h2>
          <label className="block">
            <span className="field-label">Valor unitário</span>
            <input
              value={unitPrice}
              onChange={(e) => setUnitPrice(e.target.value)}
              inputMode="decimal"
              placeholder="0,00"
              className="input"
              required
              aria-invalid={unitPrice.trim() !== "" && unitCents === null}
              data-sale-unit=""
            />
            <span className="mt-1 block text-xs text-ink-soft">Por placa.</span>
          </label>

          <label className="block">
            <span className="field-label">Desconto (R$)</span>
            <input
              value={discount}
              onChange={(e) => setDiscount(e.target.value)}
              inputMode="decimal"
              placeholder="0,00"
              className="input"
              aria-invalid={pricingError !== null && discountCents !== 0}
              data-sale-discount=""
            />
          </label>

          <div className="rounded-xl border border-line bg-paper px-4 py-3 sm:col-span-2" aria-live="polite" data-sale-summary="">
            <dl className="grid gap-1.5 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-ink-soft">
                  Subtotal ({totals.quantity} placa{totals.quantity === 1 ? "" : "s"} × {unitCents !== null ? formatCents(unitCents) : "R$ 0,00"})
                </dt>
                <dd className="tabular-nums" data-sale-subtotal="">
                  {formatCents(totals.subtotalCents)}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-ink-soft">Desconto</dt>
                <dd className="tabular-nums">− {formatCents(discountCents ?? 0)}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-3 border-t border-line pt-1.5">
                <dt className="font-semibold">Valor total</dt>
                <dd>
                  <output className="kpi-value text-xl tabular-nums" data-sale-total="" aria-label="Valor total calculado">
                    {formatCents(totals.totalCents)}
                  </output>
                </dd>
              </div>
            </dl>
            {pricingError && (
              <p role="alert" className="mt-2 text-sm font-semibold text-danger">
                {pricingError}
              </p>
            )}
            <p className="mt-1 text-xs text-ink-soft">Calculado automaticamente: quantidade × valor unitário − desconto.</p>
          </div>

          <label className="block">
            <span className="field-label">Status</span>
            <select value={status} onChange={(e) => setStatus(e.target.value as "pending" | "paid")} className="input">
              <option value="pending">Pendente</option>
              <option value="paid">Pago</option>
            </select>
            <span className="mt-1 block text-xs text-ink-soft">Só vendas pagas entram nos indicadores.</span>
          </label>

          <label className="block">
            <span className="field-label">Data</span>
            <input type="date" value={soldAt} onChange={(e) => setSoldAt(e.target.value)} className="input" required />
          </label>

          <label className="block sm:col-span-2">
            <span className="field-label">Observação (opcional)</span>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={1000} className="input" />
          </label>
        </section>

        {state.error && (
          <p role="alert" className="rounded-md bg-[#fdecea] px-4 py-3 text-sm text-danger">
            {state.error}
          </p>
        )}

        <div className="flex justify-end gap-3">
          <button type="submit" disabled={state.busy || !customerReady || selected.length === 0 || totals.error !== null} className="btn btn-primary">
            {state.busy ? "Salvando..." : "Salvar venda"}
          </button>
        </div>
      </form>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        busy={modalState.busy}
        title="Novo cliente"
        description="O cliente é cadastrado na sua lista e já fica selecionado nesta venda."
        footer={
          <>
            <button type="button" className="btn" onClick={() => setModalOpen(false)} disabled={modalState.busy}>
              Cancelar
            </button>
            <button type="submit" form="new-customer-form" className="btn btn-primary" disabled={modalState.busy || !draft.name.trim()}>
              {modalState.busy ? "Cadastrando..." : "Cadastrar cliente"}
            </button>
          </>
        }
      >
        <form id="new-customer-form" onSubmit={createCustomer} className="grid gap-3 sm:grid-cols-2">
          <label className="block sm:col-span-2">
            <span className="field-label">Nome / responsável</span>
            <input className="input" required maxLength={120} data-autofocus="" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </label>
          <label className="block">
            <span className="field-label">Telefone</span>
            <input className="input" inputMode="tel" maxLength={40} value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} />
          </label>
          <label className="block">
            <span className="field-label">E-mail</span>
            <input className="input" type="email" maxLength={160} value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} />
          </label>
          <label className="block sm:col-span-2">
            <span className="field-label">Empresa / comércio (opcional)</span>
            <input className="input" maxLength={120} value={draft.company_name} onChange={(e) => setDraft({ ...draft, company_name: e.target.value })} />
          </label>
          {modalState.error && (
            <p role="alert" className="rounded-md bg-[#fdecea] px-3 py-2 text-sm text-danger sm:col-span-2">
              {modalState.error}
            </p>
          )}
        </form>
      </Modal>
    </>
  );
}
