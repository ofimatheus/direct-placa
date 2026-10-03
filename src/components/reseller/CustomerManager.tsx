"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/ui/Modal";
import { EmptyNote, Feedback, PageTitle, Panel } from "@/components/ui/kit";
import { CUSTOMER_TABS, customerMatchesSearch, getCustomerDisplayName, getCustomerSecondaryName, type CustomerTab } from "@/lib/customers";
import { formatDateTime } from "@/lib/utils/text";
import { Icon } from "./icons";

export interface ManagedCustomer {
  id: string;
  name: string;
  company_name: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  plates: number;
  archived_at: string | null;
  archive_reason: string | null;
}


type Draft = { name: string; company_name: string; phone: string; email: string; notes: string };
const EMPTY: Draft = { name: "", company_name: "", phone: "", email: "", notes: "" };

async function request(url: string, method: string, body?: unknown) {
  const response = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  }).catch(() => null);
  if (response?.ok) return;
  const json = response ? ((await response.json().catch(() => ({}))) as { error?: string; details?: { message: string }[] }) : {};
  const details = Array.isArray(json.details) ? json.details.map((d) => d.message).join(" ") : "";
  throw new Error([json.error ?? "Não foi possível salvar.", details].filter(Boolean).join(" "));
}

function CustomerName({ customer }: { customer: ManagedCustomer }) {
  const secondary = getCustomerSecondaryName(customer);
  return (
    <span className="block min-w-0">
      <span className="block truncate font-semibold">{getCustomerDisplayName(customer)}</span>
      {secondary && <span className="block truncate text-xs text-ink-soft">{secondary}</span>}
    </span>
  );
}

/**
 * Clientes do revendedor. Clientes nunca são excluídos: "Excluir" move para a
 * Quarentena (quarantine_customer), que tira o cliente das listas e das novas
 * vendas sem tocar em vendas, placas e histórico. "Restaurar" devolve.
 */
export function CustomerManager({ customers, tab }: { customers: ManagedCustomer[]; tab: CustomerTab }) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [search, setSearch] = useState("");
  const [state, setState] = useState<{ busy: boolean; error?: string; ok?: string }>({ busy: false });
  const [pendingQuarantine, setPendingQuarantine] = useState<ManagedCustomer | null>(null);
  const [pendingRestore, setPendingRestore] = useState<ManagedCustomer | null>(null);

  const counts = {
    active: customers.filter((c) => !c.archived_at).length,
    quarantine: customers.filter((c) => c.archived_at).length,
    all: customers.length,
  };
  const inTab = customers.filter((c) => (tab === "active" ? !c.archived_at : tab === "quarantine" ? !!c.archived_at : true));
  const visible = inTab.filter((c) => customerMatchesSearch(c, search));
  const editingCustomer = editing && editing !== "new" ? customers.find((c) => c.id === editing) : null;

  function open(target: ManagedCustomer | "new") {
    setState({ busy: false });
    if (target === "new") {
      setDraft(EMPTY);
      setEditing("new");
    } else {
      setDraft({
        name: target.name,
        company_name: target.company_name ?? "",
        phone: target.phone ?? "",
        email: target.email ?? "",
        notes: target.notes ?? "",
      });
      setEditing(target.id);
    }
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setState({ busy: true });
    try {
      const body = {
        name: draft.name,
        company_name: draft.company_name || null,
        phone: draft.phone || null,
        email: draft.email || null,
        notes: draft.notes || null,
      };
      if (editing === "new") await request("/api/reseller/customers", "POST", body);
      else await request(`/api/reseller/customers/${editing}`, "PATCH", body);
      setEditing(null);
      setState({ busy: false });
      router.refresh();
    } catch (error) {
      setState({ busy: false, error: error instanceof Error ? error.message : "Erro ao salvar." });
    }
  }

  async function quarantine(customer: ManagedCustomer, reason: string | undefined) {
    setState({ busy: true });
    try {
      await request(`/api/reseller/customers/${customer.id}/quarantine`, "POST", { reason: reason || null });
      setPendingQuarantine(null);
      setEditing(null);
      setState({ busy: false, ok: `${getCustomerDisplayName(customer)} foi movido para a Quarentena.` });
      router.refresh();
    } catch (error) {
      setState({ busy: false, error: error instanceof Error ? error.message : "Erro ao mover para a quarentena." });
    }
  }

  async function restore(customer: ManagedCustomer) {
    setState({ busy: true });
    try {
      await request(`/api/reseller/customers/${customer.id}/restore`, "POST", {});
      setPendingRestore(null);
      setState({ busy: false, ok: `${getCustomerDisplayName(customer)} voltou para a lista de clientes.` });
      router.refresh();
    } catch (error) {
      setState({ busy: false, error: error instanceof Error ? error.message : "Erro ao restaurar." });
    }
  }

  const actionsFor = (c: ManagedCustomer) =>
    c.archived_at ? (
      <button type="button" className="btn btn-small" disabled={state.busy} onClick={() => setPendingRestore(c)}>
        Restaurar
      </button>
    ) : (
      <>
        <button type="button" className="btn btn-small" onClick={() => open(c)}>
          Editar
        </button>
        <button
          type="button"
          className="ml-2 px-2 text-sm font-semibold text-ink-soft hover:text-danger"
          disabled={state.busy}
          onClick={() => setPendingQuarantine(c)}
        >
          Excluir
        </button>
      </>
    );

  return (
    <div>
      <PageTitle
        title="Clientes"
        subtitle="Gerencie os clientes vinculados às suas placas."
        action={
          <button type="button" className="btn btn-primary" onClick={() => open("new")}>
            + Novo cliente
          </button>
        }
      />

      {editing && (
        <form onSubmit={save} className="card mt-6 grid gap-3 p-5 sm:grid-cols-2">
          <h2 className="text-base font-bold sm:col-span-2">
            {editing === "new" ? "Novo cliente" : `Editar ${editingCustomer ? getCustomerDisplayName(editingCustomer) : "cliente"}`}
          </h2>
          <label className="block">
            <span className="field-label">Nome / responsável</span>
            <input className="input" required maxLength={120} autoFocus value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </label>
          <label className="block">
            <span className="field-label">Empresa / comércio</span>
            <input className="input" maxLength={120} value={draft.company_name} onChange={(e) => setDraft({ ...draft, company_name: e.target.value })} />
            <span className="mt-1 block text-xs text-ink-soft">Quando preenchida, é o nome que aparece nas listas.</span>
          </label>
          <label className="block">
            <span className="field-label">Telefone</span>
            <input className="input" maxLength={40} value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} />
          </label>
          <label className="block">
            <span className="field-label">E-mail</span>
            <input className="input" type="email" maxLength={160} value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} />
          </label>
          <label className="block sm:col-span-2">
            <span className="field-label">Observações</span>
            <textarea className="input min-h-20" maxLength={1000} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
          </label>
          <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
            <button type="submit" className="btn btn-primary" disabled={state.busy}>
              {editing === "new" ? "Cadastrar cliente" : "Salvar alterações"}
            </button>
            <button type="button" className="btn" onClick={() => setEditing(null)}>
              Cancelar
            </button>
            {editingCustomer && !editingCustomer.archived_at && (
              <button
                type="button"
                className="ml-auto px-2 text-sm font-semibold text-ink-soft hover:text-danger"
                disabled={state.busy}
                onClick={() => setPendingQuarantine(editingCustomer)}
              >
                Excluir cliente
              </button>
            )}
          </div>
          {state.error && (
            <div className="sm:col-span-2">
              <Feedback kind="error" title="Não foi possível salvar as alterações." detail={state.error} />
            </div>
          )}
        </form>
      )}

      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <nav className="flex w-fit gap-1 rounded-lg border border-line bg-surface p-1" aria-label="Filtrar clientes">
          {CUSTOMER_TABS.map((t) => (
            <Link
              key={t.key}
              href={`/reseller/customers?status=${t.key}`}
              aria-current={t.key === tab ? "page" : undefined}
              className={`rounded-md px-3 py-1.5 text-sm font-semibold ${t.key === tab ? "bg-mat text-white" : "text-ink-soft hover:text-ink"}`}
            >
              {t.label} <span className="tabular-nums opacity-75">{counts[t.key]}</span>
            </Link>
          ))}
        </nav>
        <div className="relative w-full sm:max-w-sm" role="search">
          <Icon name="search" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-soft" />
          <input className="input pl-9" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por empresa ou responsável..." aria-label="Buscar clientes" />
        </div>
      </div>
      {!editing && state.error && (
        <div className="mt-3">
          <Feedback kind="error" title="Não foi possível concluir a ação." detail={state.error} />
        </div>
      )}
      {state.ok && !state.error && (
        <p role="status" className="mt-3 text-sm font-semibold text-ok">
          {state.ok}
        </p>
      )}

      <Panel className="mt-4">
        {visible.length === 0 ? (
          search.trim() ? (
            <EmptyNote icon="search" title="Nenhum cliente encontrado" text={`Nada corresponde a "${search}".`} />
          ) : tab === "quarantine" ? (
            <EmptyNote icon="customers" title="Quarentena vazia" text="Clientes excluídos ficam aqui e podem ser restaurados a qualquer momento." />
          ) : (
            <EmptyNote
              icon="customers"
              title="Nenhum cliente ainda"
              text="Você ainda não cadastrou nenhum cliente."
              action={
                <button type="button" className="btn btn-primary" onClick={() => open("new")}>
                  + Novo cliente
                </button>
              }
            />
          )
        ) : tab === "quarantine" ? (
          <table className="data-table">
            <thead>
              <tr>
                <th className="pl-5">Comércio</th>
                <th className="hidden sm:table-cell">Responsável</th>
                <th>Em quarentena desde</th>
                <th className="pr-5 text-right">Ação</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((c) => (
                <tr key={c.id}>
                  <td className="pl-5 font-semibold">{getCustomerDisplayName(c)}</td>
                  <td className="hidden sm:table-cell">{c.company_name?.trim() ? c.name : <span className="text-ink-soft">—</span>}</td>
                  <td className="whitespace-nowrap text-ink-soft">
                    {formatDateTime(c.archived_at!)}
                    {c.archive_reason && <span className="block max-w-56 truncate text-xs">{c.archive_reason}</span>}
                  </td>
                  <td className="pr-5 text-right">{actionsFor(c)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <>
            <table className="data-table hidden md:table">
              <thead>
                <tr>
                  <th className="pl-5">Cliente</th>
                  <th className="text-right">Placas</th>
                  <th>Telefone</th>
                  <th className="pr-5 text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((c) => (
                  <tr key={c.id}>
                    <td className="max-w-80 pl-5">
                      <CustomerName customer={c} />
                      {c.archived_at && <span className="mt-0.5 inline-block rounded-full bg-paper px-2 py-0.5 text-[10px] font-bold text-ink-soft">Quarentena</span>}
                    </td>
                    <td className="text-right tabular-nums">{c.plates}</td>
                    <td>{c.phone ?? <span className="text-ink-soft">—</span>}</td>
                    <td className="pr-5 text-right whitespace-nowrap">{actionsFor(c)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <ul className="divide-y divide-line md:hidden">
              {visible.map((c) => (
                <li key={c.id} className="flex min-h-16 items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <CustomerName customer={c} />
                    <p className="truncate text-xs text-ink-soft">
                      {c.archived_at ? "Em quarentena" : `${c.phone ?? "Sem telefone"} | ${c.plates} placa(s)`}
                    </p>
                  </div>
                  {c.archived_at ? (
                    <button type="button" className="btn btn-small" disabled={state.busy} onClick={() => setPendingRestore(c)}>
                      Restaurar
                    </button>
                  ) : (
                    <button type="button" className="btn btn-small" onClick={() => open(c)}>
                      Editar
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </Panel>

      <ConfirmDialog
        open={pendingQuarantine !== null}
        title={`Excluir ${pendingQuarantine ? getCustomerDisplayName(pendingQuarantine) : "cliente"}`}
        description={
          <>
            O cliente não será apagado: ele vai para a <strong className="text-ink">Quarentena</strong>. Sai da lista de
            clientes e das novas vendas, mas as vendas, placas e o histórico em que já aparece continuam intactos.
            {pendingQuarantine && pendingQuarantine.plates > 0 && ` As ${pendingQuarantine.plates} placa(s) dele continuam funcionando.`}{" "}
            Você pode restaurá-lo a qualquer momento.
          </>
        }
        reason={{ label: "Motivo (opcional)", placeholder: "Ex.: encerrou as atividades", minLength: 0, maxLength: 500 }}
        confirmLabel="Mover para a quarentena"
        tone="danger"
        busy={state.busy}
        error={pendingQuarantine ? state.error : null}
        onCancel={() => {
          setPendingQuarantine(null);
          setState({ busy: false });
        }}
        onConfirm={({ reason }) => {
          if (pendingQuarantine) void quarantine(pendingQuarantine, reason);
        }}
      />

      <ConfirmDialog
        open={pendingRestore !== null}
        title={`Restaurar ${pendingRestore ? getCustomerDisplayName(pendingRestore) : "cliente"}`}
        description="O cliente volta para a lista de clientes e para as novas vendas."
        confirmLabel="Restaurar cliente"
        busy={state.busy}
        error={pendingRestore ? state.error : null}
        onCancel={() => {
          setPendingRestore(null);
          setState({ busy: false });
        }}
        onConfirm={() => {
          if (pendingRestore) void restore(pendingRestore);
        }}
      />
    </div>
  );
}
