"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { DestinationType, PlateStatus } from "@/lib/db/types";
import { DESTINATION_TYPES, isValidDestinationUrl } from "@/lib/plates/destinations";
import { Feedback } from "@/components/ui/kit";
import { Icon } from "./icons";
import { getCustomerOptionLabel } from "@/lib/customers";

interface Customer {
  id: string;
  name: string;
}

interface Props {
  plateId: string;
  status: PlateStatus;
  customers: Customer[];
  initial: { customer_id: string | null; destination_type: DestinationType | null; destination_url: string | null };
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
  const json: unknown = response ? await response.json().catch(() => ({})) : {};
  if (!response?.ok) {
    const error = json as { error?: string; details?: { message: string }[] };
    const details = Array.isArray(error.details) ? error.details.map((d) => d.message).join(" ") : "";
    throw new Error([error.error ?? "Não foi possível salvar.", details].filter(Boolean).join(" "));
  }
  return json as T;
}

/**
 * Configuração da placa pelo revendedor. Um único "Salvar": na primeira
 * configuração válida a placa já fica ativa. Depois, ativar/desativar.
 */
export function ResellerPlateForm({ plateId, status: initialStatus, customers: initialCustomers, initial }: Props) {
  const router = useRouter();
  const [status, setStatus] = useState(initialStatus);
  const [customers, setCustomers] = useState(initialCustomers);
  const [form, setForm] = useState({
    customer_id: initial.customer_id ?? "",
    destination_type: initial.destination_type ?? ("" as DestinationType | ""),
    destination_url: initial.destination_url ?? "",
  });
  const [saved, setSaved] = useState(Boolean(initial.destination_url));
  const [newCustomer, setNewCustomer] = useState<{ open: boolean; name: string; company_name: string; phone: string }>({
    open: false,
    name: "",
    company_name: "",
    phone: "",
  });
  const [state, setState] = useState<{ busy: boolean; error?: string; ok?: string; okTitle?: string }>({ busy: false });

  const blocked = status === "blocked";
  const url = form.destination_url.trim();
  const urlInvalid = url !== "" && !isValidDestinationUrl(url);
  const canSave = !blocked && !state.busy && !urlInvalid && (url === "" || form.destination_type !== "");
  const placeholder = DESTINATION_TYPES.find((d) => d.value === form.destination_type)?.placeholder ?? "https://...";

  async function save(nextStatus: "active" | "inactive" | null) {
    setState({ busy: true });
    try {
      const result = await postJson<{ plate: { status: PlateStatus } }>(`/api/reseller/plates/${plateId}`, {
        customer_id: form.customer_id || null,
        destination_type: form.destination_type || null,
        destination_url: url || null,
        status: nextStatus,
      });
      const next = result.plate.status;
      const message =
        nextStatus === "inactive"
          ? "A placa foi desativada e não redireciona até ser ativada."
          : nextStatus === "active"
            ? "A placa foi ativada e já está redirecionando."
            : status === "assigned" && next === "active"
              ? "A placa foi configurada e ativada automaticamente."
              : next === "assigned"
                ? "Sem destino, a placa não redireciona até ser configurada."
                : undefined;
      setStatus(next);
      setSaved(Boolean(url));
      setState({ busy: false, ok: message ?? "" });
      router.refresh();
    } catch (error) {
      setState({ busy: false, error: error instanceof Error ? error.message : "Erro ao salvar." });
    }
  }

  async function createCustomer() {
    if (!newCustomer.name.trim()) return;
    setState({ busy: true });
    try {
      const { customer } = await postJson<{ customer: Customer }>("/api/reseller/customers", {
        name: newCustomer.name,
        company_name: newCustomer.company_name || null,
        phone: newCustomer.phone || null,
      });
      const label = { id: customer.id, name: getCustomerOptionLabel({ name: customer.name, company_name: newCustomer.company_name || null }) };
      setCustomers((list) => [...list, label].sort((a, b) => a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" })));
      setForm((f) => ({ ...f, customer_id: customer.id }));
      setNewCustomer({ open: false, name: "", company_name: "", phone: "" });
      setState({ busy: false, okTitle: "Cliente cadastrado.", ok: `${label.name} foi selecionado. Salve para vincular à placa.` });
    } catch (error) {
      setState({ busy: false, error: error instanceof Error ? error.message : "Não foi possível cadastrar o cliente." });
    }
  }

  return (
    <form
      className="card space-y-5 p-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (canSave) void save(null);
      }}
    >
      {blocked && (
        <p className="flex items-center gap-2 rounded-lg bg-paper px-3 py-2.5 text-sm text-ink-soft">
          <Icon name="lock" className="size-4 text-danger" />
          Esta placa foi bloqueada pelo administrador.
        </p>
      )}
      <fieldset disabled={blocked} className="space-y-5 disabled:opacity-60">
      <div>
        <label className="block">
          <span className="field-label">Cliente</span>
          <select className="input" value={form.customer_id} onChange={(e) => setForm({ ...form, customer_id: e.target.value })}>
            <option value="">Sem cliente</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        {blocked ? null : !newCustomer.open ? (
          <button type="button" className="link mt-2 text-sm" onClick={() => setNewCustomer((n) => ({ ...n, open: true }))}>
            Cadastrar novo cliente
          </button>
        ) : (
          <div className="mt-3 grid gap-3 rounded-md border border-line bg-paper/60 p-3 sm:grid-cols-3">
            <input className="input" placeholder="Nome *" value={newCustomer.name} onChange={(e) => setNewCustomer({ ...newCustomer, name: e.target.value })} />
            <input className="input" placeholder="Empresa" value={newCustomer.company_name} onChange={(e) => setNewCustomer({ ...newCustomer, company_name: e.target.value })} />
            <input className="input" placeholder="Telefone" value={newCustomer.phone} onChange={(e) => setNewCustomer({ ...newCustomer, phone: e.target.value })} />
            <div className="flex gap-2 sm:col-span-3">
              <button type="button" className="btn btn-small" disabled={state.busy || !newCustomer.name.trim()} onClick={createCustomer}>
                Cadastrar cliente
              </button>
              <button type="button" className="btn btn-small" onClick={() => setNewCustomer({ open: false, name: "", company_name: "", phone: "" })}>
                Cancelar
              </button>
            </div>
          </div>
        )}
      </div>

      <label className="block">
        <span className="field-label">Tipo de destino</span>
        <select className="input" value={form.destination_type} onChange={(e) => setForm({ ...form, destination_type: e.target.value as DestinationType | "" })}>
          <option value="">Selecione</option>
          {DESTINATION_TYPES.map((d) => (
            <option key={d.value} value={d.value}>
              {d.label}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="field-label">URL de destino</span>
        <input
          className="input"
          type="url"
          inputMode="url"
          placeholder={placeholder}
          value={form.destination_url}
          aria-invalid={urlInvalid}
          onChange={(e) => setForm({ ...form, destination_url: e.target.value })}
        />
        {urlInvalid && <span className="mt-1 block text-sm text-danger">Use o link completo, começando com https://</span>}
      </label>

      {status === "assigned" && <p className="text-sm text-ink-soft">Ao salvar um destino válido, a placa é ativada automaticamente.</p>}
      </fieldset>

      {!blocked && (
      <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
        <button type="submit" className="btn btn-primary" disabled={!canSave}>
          {state.busy ? "Salvando..." : "Salvar alterações"}
        </button>
        {saved && status === "active" && (
          <button type="button" className="btn" disabled={state.busy || !canSave} onClick={() => save("inactive")}>
            Desativar
          </button>
        )}
        {saved && status === "inactive" && (
          <button type="button" className="btn" disabled={state.busy || !canSave} onClick={() => save("active")}>
            Ativar
          </button>
        )}
      </div>
      )}
      {state.error && <Feedback kind="error" title="Não foi possível salvar as alterações." detail={state.error} />}
      {state.ok !== undefined && !state.error && <Feedback kind="success" title={state.okTitle ?? "Alterações salvas."} detail={state.ok || undefined} />}
    </form>
  );
}
