"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/ui/Modal";
import type { DestinationType, PlateStatus } from "@/lib/db/types";
import { DESTINATION_TYPES, isValidDestinationUrl } from "@/lib/plates/destinations";

interface Props {
  plateId: string;
  status: PlateStatus;
  resellerId: string | null;
  /** Venda válida à qual a placa pertence: enquanto existir, o revendedor não muda por aqui. */
  sale: { id: string; order_number: number } | null;
  resellers: { id: string; name: string }[];
  customers: { id: string; name: string }[];
  destination: { customer_id: string | null; destination_type: DestinationType | null; destination_url: string | null };
}

type PendingConfirm = { title: string; description: React.ReactNode; confirmLabel: string; tone?: "primary" | "danger"; run: () => void };

type Feedback = { kind: "ok" | "error"; text: string } | null;

async function send(url: string, method: string, body: unknown): Promise<string | null> {
  const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
  if (!response) return "Falha de conexão.";
  if (response.ok) return null;
  const json = (await response.json().catch(() => ({}))) as { error?: string; details?: { message: string }[] };
  const details = Array.isArray(json.details) ? json.details.map((d) => d.message).join(" ") : "";
  return [json.error ?? "Não foi possível salvar.", details].filter(Boolean).join(" ");
}

/** Ações do ADMIN sobre uma placa: revendedor, destino e status. */
export function AdminPlatePanel({ plateId, status, resellerId, sale, resellers, customers, destination }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [targetReseller, setTargetReseller] = useState(resellerId ?? resellers[0]?.id ?? "");
  const [dest, setDest] = useState({
    customer_id: destination.customer_id ?? "",
    destination_type: destination.destination_type ?? ("" as DestinationType | ""),
    destination_url: destination.destination_url ?? "",
  });

  async function run(action: () => Promise<string | null>, success: string) {
    setBusy(true);
    setFeedback(null);
    const error = await action();
    setBusy(false);
    setFeedback(error ? { kind: "error", text: error } : { kind: "ok", text: success });
    if (!error) router.refresh();
  }

  const changeReseller = (id: string | null) => {
    const apply = () =>
      void run(() => send(`/api/admin/plates/${plateId}/reseller`, "POST", { reseller_id: id }), id ? "Revendedor atualizado." : "Revendedor removido.");
    if (!resellerId) return apply();
    setPending({
      title: id ? "Trocar o revendedor da placa" : "Remover o revendedor da placa",
      description: "A configuração atual (cliente e destino) será apagada, e a placa sai do ar até ser configurada de novo.",
      confirmLabel: id ? "Trocar revendedor" : "Remover revendedor",
      tone: "danger",
      run: apply,
    });
  };

  const statusAction = (action: "activate" | "deactivate" | "block" | "unblock", success: string) =>
    run(() => send(`/api/admin/plates/${plateId}/status`, "POST", { action }), success);

  const urlInvalid = dest.destination_url !== "" && !isValidDestinationUrl(dest.destination_url);
  const placeholder = DESTINATION_TYPES.find((d) => d.value === dest.destination_type)?.placeholder ?? "https://...";

  return (
    <div className="space-y-4">
      {feedback && (
        <p role={feedback.kind === "error" ? "alert" : "status"} className={`text-sm ${feedback.kind === "error" ? "text-danger" : "text-ok"}`}>
          {feedback.text}
        </p>
      )}

      <section className="card p-5">
        <h2 className="display text-base">Revendedor</h2>
        {sale ? (
          <p className="mt-3 text-sm text-ink-soft">
            Esta placa pertence à{" "}
            <Link href={`/admin/sales/${sale.id}`} className="link">
              venda #{sale.order_number}
            </Link>
            . Para devolvê-la ao estoque, cancele a venda.
          </p>
        ) : (
          <>
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <label className="block min-w-56 flex-1">
                <span className="field-label">{resellerId ? "Trocar para" : "Atribuir a"}</span>
                <select className="input" value={targetReseller} onChange={(e) => setTargetReseller(e.target.value)}>
                  {resellers.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="btn"
                disabled={busy || !targetReseller || targetReseller === resellerId}
                onClick={() => changeReseller(targetReseller)}
              >
                {resellerId ? "Trocar revendedor" : "Atribuir revendedor"}
              </button>
              {resellerId && (
                <button type="button" className="btn" disabled={busy} onClick={() => changeReseller(null)}>
                  Remover revendedor
                </button>
              )}
            </div>
            <p className="mt-2 text-xs text-ink-soft">
              Atribuição avulsa, para reposição, cortesia ou ajuste. Em vendas, as placas são reservadas ao registrar a venda.
            </p>
          </>
        )}
      </section>

      <section className="card p-5">
        <h2 className="display text-base">Destino</h2>
        <form
          className="mt-3 grid gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            void run(
              () =>
                send(`/api/admin/plates/${plateId}`, "PATCH", {
                  customer_id: dest.customer_id || null,
                  destination_type: dest.destination_type || null,
                  destination_url: dest.destination_url.trim() || null,
                }),
              "Destino salvo.",
            );
          }}
        >
          <label className="block sm:col-span-2">
            <span className="field-label">Cliente</span>
            <select
              className="input"
              value={dest.customer_id}
              disabled={!resellerId}
              onChange={(e) => setDest({ ...dest, customer_id: e.target.value })}
            >
              <option value="">{resellerId ? "Sem cliente" : "Atribua um revendedor para vincular cliente"}</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="field-label">Tipo de destino</span>
            <select
              className="input"
              value={dest.destination_type}
              onChange={(e) => setDest({ ...dest, destination_type: e.target.value as DestinationType | "" })}
            >
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
              value={dest.destination_url}
              aria-invalid={urlInvalid}
              onChange={(e) => setDest({ ...dest, destination_url: e.target.value })}
            />
          </label>
          {urlInvalid && <p className="text-sm text-danger sm:col-span-2">Use uma URL completa começando com http:// ou https://.</p>}
          <div className="sm:col-span-2">
            <button type="submit" className="btn btn-primary" disabled={busy || urlInvalid || (dest.destination_url !== "" && !dest.destination_type)}>
              Salvar destino
            </button>
          </div>
        </form>
      </section>

      <section className="card p-5">
        <h2 className="display text-base">Status</h2>
        <div className="mt-3 flex flex-wrap gap-3">
          {status !== "active" && status !== "blocked" && (
            <button type="button" className="btn btn-primary" disabled={busy || !destination.destination_url} onClick={() => statusAction("activate", "Placa ativada.")}>
              Ativar
            </button>
          )}
          {status === "active" && (
            <button type="button" className="btn" disabled={busy} onClick={() => statusAction("deactivate", "Placa desativada.")}>
              Desativar
            </button>
          )}
          {status !== "blocked" ? (
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() =>
                setPending({
                  title: "Bloquear a placa",
                  description: "Ela deixa de redirecionar e o revendedor não poderá alterá-la.",
                  confirmLabel: "Bloquear placa",
                  tone: "danger",
                  run: () => void statusAction("block", "Placa bloqueada."),
                })
              }
            >
              Bloquear
            </button>
          ) : (
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => statusAction("unblock", "Placa desbloqueada.")}>
              Desbloquear
            </button>
          )}
        </div>
        {status !== "active" && status !== "blocked" && !destination.destination_url && (
          <p className="mt-2 text-sm text-ink-soft">Defina e salve um destino para poder ativar.</p>
        )}
      </section>
      <ConfirmDialog
        open={pending !== null}
        title={pending?.title ?? ""}
        description={pending?.description}
        confirmLabel={pending?.confirmLabel ?? "Confirmar"}
        tone={pending?.tone}
        onCancel={() => setPending(null)}
        onConfirm={() => {
          const action = pending?.run;
          setPending(null);
          action?.();
        }}
      />
    </div>
  );
}
