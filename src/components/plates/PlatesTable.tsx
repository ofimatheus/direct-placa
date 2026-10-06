"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Tone } from "@/components/ui/primitives";
import { ConfirmDialog } from "@/components/ui/Modal";
import type { DestinationType, PlateStatus } from "@/lib/db/types";
import { DESTINATION_LABEL } from "@/lib/plates/destinations";
import { PLATE_STATUS_LABEL, PLATE_STATUS_TONE } from "@/lib/plates/labels";
import { formatInt } from "@/lib/utils/money";

export interface PlateRowView {
  id: string;
  public_code: string;
  status: PlateStatus;
  destination_type: DestinationType | null;
  destination_url: string | null;
  qr_access_count: number;
  reseller_name: string | null;
  customer_name: string | null;
  batch_name: string | null;
  quarantine_state: "plate" | "batch" | null;
  quarantined_at: string | null;
  quarantine_reason: string | null;
}

type View = "operational" | "quarantine" | "all";
type Action = "quarantine" | "restore" | "delete";

const KEPT_LABEL: Record<string, string> = {
  sale: "venda de revendedor",
  order: "pedido/venda do ADMIN",
  customer: "cliente vinculado",
  reseller: "revendedor",
  activation: "ativação ou destino",
  accesses: "acessos registrados",
};
const n = (v: number, one: string, many: string) => `${formatInt(v)} ${v === 1 ? one : many}`;
const fmtDate = (iso: string | null) => (iso ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(iso)) : "");

/**
 * Tabela de Admin › Placas com seleção múltipla e ações em massa (só ADMIN).
 * A seleção é só um pedido: o servidor trava e reconfere cada placa.
 */
export function PlatesTable({
  rows,
  total,
  view,
  filterQuery,
  bulkEnabled,
}: {
  rows: PlateRowView[];
  /** Total de placas com estes filtros (todas as páginas). */
  total: number;
  view: View;
  /** Filtros atuais (querystring), para "selecionar todas do filtro". */
  filterQuery: string;
  /** false se a migration da quarentena ainda não foi aplicada. */
  bulkEnabled: boolean;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [wholeFilter, setWholeFilter] = useState(false);
  const [loadingAll, setLoadingAll] = useState(false);
  const [dialog, setDialog] = useState<Action | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [feedback, setFeedback] = useState<{ ok: boolean; title: string; detail?: string } | null>(null);

  // Mudou a página, a aba ou os filtros: começa sem seleção (nada fica selecionado "escondido").
  const pageKey = rows.map((r) => r.id).join(",") + "|" + filterQuery;
  useEffect(() => {
    setSelected(new Set());
    setWholeFilter(false);
  }, [pageKey]);

  const pageIds = useMemo(() => rows.map((r) => r.id), [rows]);
  const pageAllSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const count = selected.size;

  const toggle = (id: string) => {
    setWholeFilter(false);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const togglePage = () => {
    setWholeFilter(false);
    setSelected(pageAllSelected ? new Set() : new Set(pageIds));
  };
  const clear = () => {
    setSelected(new Set());
    setWholeFilter(false);
  };

  async function selectWholeFilter() {
    setLoadingAll(true);
    setFeedback(null);
    try {
      const res = await fetch(`/api/admin/plates/ids?${filterQuery}`, { cache: "no-store" });
      const data = (await res.json().catch(() => ({}))) as { ids?: string[]; total?: number; truncated?: boolean; error?: string };
      if (!res.ok || !data.ids) throw new Error(data.error ?? "Não foi possível selecionar todas.");
      setSelected(new Set(data.ids));
      setWholeFilter(true);
      if (data.truncated) setFeedback({ ok: false, title: `Selecionadas as primeiras ${formatInt(data.ids.length)} de ${formatInt(data.total ?? 0)} placas (limite por ação).` });
    } catch (e) {
      setFeedback({ ok: false, title: e instanceof Error ? e.message : "Não foi possível selecionar todas." });
    } finally {
      setLoadingAll(false);
    }
  }

  function open(action: Action) {
    setError(null);
    setPassword("");
    setDialog(action);
  }

  async function run(action: Action, reason?: string) {
    if (action === "delete" && !password) {
      setError("Digite sua senha de ADMIN para confirmar.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/plates/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ids: [...selected], ...(reason ? { reason } : {}), ...(action === "delete" ? { password } : {}) }),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        // Erro mostrado no próprio diálogo (ex.: senha inválida): nada foi alterado.
        setError(String(data.error ?? "Não foi possível concluir. Nada foi alterado."));
        return;
      }
      setPassword("");
      setDialog(null);
      clear();
      setFeedback(summary(action, data));
      router.refresh();
    } catch {
      setError("Sem conexão com o servidor. Nada foi alterado.");
    } finally {
      setBusy(false);
    }
  }

  const quarantineView = view === "quarantine";

  return (
    <div data-plates-table="">
      {feedback && (
        <div role="status" className={`mb-3 rounded-lg border px-4 py-3 text-sm ${feedback.ok ? "border-ok/30 bg-ok-soft" : "border-warn/30 bg-warn-soft"}`} data-bulk-feedback={feedback.ok ? "ok" : "warn"}>
          <p className="font-semibold">{feedback.title}</p>
          {feedback.detail && <p className="mt-1 text-ink-soft">{feedback.detail}</p>}
        </div>
      )}

      {bulkEnabled && pageAllSelected && total > pageIds.length && (
        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-line bg-paper px-4 py-2.5 text-sm" data-select-filter="">
          {wholeFilter ? (
            <>
              <span>
                <strong>Todas as {formatInt(count)} placas deste filtro</strong> estão selecionadas.
              </span>
              <button type="button" className="link" onClick={clear}>
                Limpar seleção
              </button>
            </>
          ) : (
            <>
              <span>{n(pageIds.length, "placa desta página selecionada.", "placas desta página selecionadas.")}</span>
              <button type="button" className="link font-semibold" onClick={selectWholeFilter} disabled={loadingAll} data-select-all-filter="">
                {loadingAll ? "Selecionando…" : `Selecionar todas as ${formatInt(total)} placas deste filtro`}
              </button>
            </>
          )}
        </div>
      )}

      <div className="card overflow-x-auto">
        <table className="data-table min-w-[860px]">
          <thead>
            <tr>
              {bulkEnabled && (
                <th className="w-10">
                  <input type="checkbox" className="size-4 accent-[var(--color-mat)]" aria-label="Selecionar todas desta página" checked={pageAllSelected} onChange={togglePage} data-select-page="" />
                </th>
              )}
              <th>Código</th>
              <th>Revendedor</th>
              <th>Cliente</th>
              <th>Destino</th>
              <th>Status</th>
              <th>Lote</th>
              {view !== "operational" && <th>Quarentena</th>}
              <th className="text-right">Acessos QR</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id} className={selected.has(p.id) ? "bg-[#eef4fd]" : undefined} data-plate-row={p.public_code}>
                {bulkEnabled && (
                  <td>
                    <input type="checkbox" className="size-4 accent-[var(--color-mat)]" aria-label={`Selecionar ${p.public_code}`} checked={selected.has(p.id)} onChange={() => toggle(p.id)} />
                  </td>
                )}
                <td>
                  <Link href={`/admin/plates/${p.id}`} className="plate-code text-base text-ink hover:text-cyan hover:underline">
                    {p.public_code}
                  </Link>
                </td>
                <td>{p.reseller_name ?? <span className="text-ink-soft">—</span>}</td>
                <td>{p.customer_name ?? <span className="text-ink-soft">—</span>}</td>
                <td className="max-w-56">
                  {p.destination_url ? (
                    <span className="block truncate" title={p.destination_url}>
                      <span className="font-semibold">{p.destination_type ? DESTINATION_LABEL[p.destination_type] : "Link"}</span>{" "}
                      <span className="text-ink-soft">{p.destination_url.replace(/^https?:\/\//, "")}</span>
                    </span>
                  ) : (
                    <span className="text-ink-soft">Não configurado</span>
                  )}
                </td>
                <td>
                  <Tone tone={PLATE_STATUS_TONE[p.status]}>{PLATE_STATUS_LABEL[p.status]}</Tone>
                </td>
                <td className="text-ink-soft">{p.batch_name ?? "—"}</td>
                {view !== "operational" && (
                  <td className="max-w-56" data-quarantine-cell="">
                    {p.quarantine_state === "plate" ? (
                      <>
                        <Tone tone="text-warn">Placa · {fmtDate(p.quarantined_at)}</Tone>
                        {p.quarantine_reason && (
                          <span className="mt-0.5 block truncate text-xs text-ink-soft" title={p.quarantine_reason}>
                            {p.quarantine_reason}
                          </span>
                        )}
                      </>
                    ) : p.quarantine_state === "batch" ? (
                      <Tone tone="text-warn">Lote em quarentena</Tone>
                    ) : (
                      <span className="text-ink-soft">—</span>
                    )}
                  </td>
                )}
                <td className="text-right">{formatInt(p.qr_access_count)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {bulkEnabled && count > 0 && (
        <>
          {/* Celular: a barra fica fixa no rodapé da tela; este espaço evita que ela cubra a paginação. */}
          <div className="h-36 sm:hidden" aria-hidden />
          <div
            className="fixed inset-x-3 bottom-3 z-30 flex flex-col gap-2 rounded-xl border border-line bg-surface p-3 shadow-[0_10px_30px_rgb(16_24_40/0.18)] sm:sticky sm:inset-x-auto sm:z-20 sm:mt-3 sm:flex-row sm:items-center sm:justify-between"
            data-bulk-bar=""
            role="region"
            aria-label="Ações para as placas selecionadas"
          >
          <p className="text-sm font-semibold" data-bulk-count={count}>
            {n(count, "placa selecionada", "placas selecionadas")}
            {wholeFilter && <span className="font-normal text-ink-soft"> (todas deste filtro)</span>}
          </p>
          <div className="flex flex-wrap gap-2 [&>button]:flex-1 sm:flex-nowrap sm:[&>button]:flex-none">
            {quarantineView ? (
              <button type="button" className="btn btn-primary" onClick={() => open("restore")} data-bulk-action="restore">
                Restaurar
              </button>
            ) : (
              <button type="button" className="btn btn-primary" onClick={() => open("quarantine")} data-bulk-action="quarantine">
                Colocar em quarentena
              </button>
            )}
            <button type="button" className="btn text-danger" onClick={() => open("delete")} data-bulk-action="delete">
              Excluir definitivamente
            </button>
            <button type="button" className="btn" onClick={clear}>
              Limpar seleção
            </button>
          </div>
          </div>
        </>
      )}

      <ConfirmDialog
        open={dialog === "quarantine"}
        title={`Colocar ${n(count, "placa", "placas")} em quarentena?`}
        description="Essas placas deixarão de aparecer na lista operacional e não poderão ser atribuídas, reservadas ou vendidas. Você poderá restaurá-las depois. Placas com revendedor, ativas ou reservadas não entram em quarentena."
        confirmLabel="Colocar em quarentena"
        busy={busy}
        error={error}
        reason={{ label: "Motivo (opcional)", placeholder: "Ex.: lote com defeito de impressão", minLength: 0, maxLength: 300 }}
        onConfirm={(values) => run("quarantine", values.reason)}
        onCancel={() => setDialog(null)}
      />
      <ConfirmDialog
        open={dialog === "restore"}
        title={`Restaurar ${n(count, "placa", "placas")}?`}
        description="As placas voltam à operação exatamente como estavam (status, lote e código). Placas de um lote em quarentena só voltam quando o lote for restaurado em Admin › Lotes."
        confirmLabel="Restaurar"
        busy={busy}
        error={error}
        onConfirm={() => run("restore")}
        onCancel={() => setDialog(null)}
      />
      <ConfirmDialog
        open={dialog === "delete"}
        tone="danger"
        title={`Excluir definitivamente ${n(count, "placa", "placas")}?`}
        description="Esta ação não pode ser desfeita. Só placas que nunca foram usadas são excluídas; as que têm histórico (venda, revendedor, cliente, ativação, acessos) são mantidas."
        confirmLabel="Excluir definitivamente"
        busy={busy}
        error={error}
        onConfirm={() => run("delete")}
        onCancel={() => {
          setPassword("");
          setDialog(null);
        }}
      >
        <label className="mt-3 block">
          <span className="field-label">Para confirmar, digite sua senha de ADMIN</span>
          <input
            type="password"
            className="input"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
            data-autofocus=""
            data-delete-password=""
          />
        </label>
      </ConfirmDialog>
    </div>
  );
}

function summary(action: Action, data: Record<string, unknown>): { ok: boolean; title: string; detail?: string } {
  const num = (k: string) => Number(data[k] ?? 0);
  if (action === "quarantine") {
    const extra = [
      num("already") > 0 ? `${n(num("already"), "já estava", "já estavam")} em quarentena` : "",
      num("skipped") > 0 ? `${n(num("skipped"), "não entrou", "não entraram")} por estar com revendedor, ativa ou reservada${(data.skipped_codes as string[] | undefined)?.length ? ` (${(data.skipped_codes as string[]).slice(0, 10).join(", ")}${num("skipped") > 10 ? "…" : ""})` : ""}` : "",
    ].filter(Boolean);
    return { ok: num("skipped") === 0, title: `✓ ${n(num("quarantined"), "placa colocada", "placas colocadas")} em quarentena.`, detail: extra.join(" · ") || undefined };
  }
  if (action === "restore") {
    const still = num("still_batch_quarantine");
    return {
      ok: still === 0,
      title: `✓ ${n(num("restored"), "placa restaurada", "placas restauradas")}.`,
      detail: still > 0 ? `${n(still, "continua", "continuam")} fora da operação porque o lote está em quarentena — restaure o lote em Admin › Lotes.` : undefined,
    };
  }
  const kept = num("kept");
  const reasons = Object.entries((data.kept_by_reason as Record<string, number>) ?? {})
    .map(([k, v]) => `${KEPT_LABEL[k] ?? k}: ${formatInt(v)}`)
    .join(", ");
  return {
    ok: kept === 0,
    title: `✓ ${n(num("deleted"), "placa excluída", "placas excluídas")}.`,
    detail: kept > 0 ? `${n(kept, "placa não pôde ser excluída", "placas não puderam ser excluídas")} por possuírem histórico (${reasons}) e foram mantidas.` : undefined,
  };
}
