"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog, type ConfirmValues } from "@/components/ui/Modal";
import type { BatchLifecycleStatus } from "@/lib/db/types";

interface Props {
  batchId: string;
  batchName: string;
  status: BatchLifecycleStatus;
  /** Placas com qualquer compromisso atual (reserva, revendedor, cliente, destino, ativação). */
  committed: number;
  /** Placas ainda disponíveis em estoque. */
  availableStock: number;
}

type Result = { ok: boolean; error?: string };
type Dialog = "quarantine" | "restore" | "archive" | "unarchive" | null;

async function post(url: string, body: unknown): Promise<Result> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => null);
  if (!response) return { ok: false, error: "Falha de conexão. Tente de novo." };
  if (response.ok) return { ok: true };
  const json = (await response.json().catch(() => ({}))) as { error?: string };
  return { ok: false, error: json.error ?? "Não foi possível alterar o lote." };
}

/**
 * Ações de ciclo do lote. Os botões só espelham o que o banco permite — quem
 * valida é set_batch_lifecycle_status, inclusive contra uma venda concorrente.
 * Por isso o erro do servidor é exibido como veio: ele explica o motivo real.
 * Toda confirmação acontece num modal do sistema; nada é enviado sem ele.
 */
export function BatchLifecycleActions({ batchId, batchName, status, committed, availableStock }: Props) {
  const router = useRouter();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [state, setState] = useState<{ busy: boolean; error?: string }>({ busy: false });

  const open = (next: Exclude<Dialog, null>) => {
    setState({ busy: false });
    setDialog(next);
  };
  const close = () => {
    if (state.busy) return;
    setDialog(null);
    setState({ busy: false });
  };

  async function applyChange(next: BatchLifecycleStatus, values: ConfirmValues) {
    setState({ busy: true });
    const result = await post(`/api/admin/batches/${batchId}/lifecycle`, { status: next, reason: values.reason ?? null });
    if (!result.ok) {
      setState({ busy: false, error: result.error });
      return;
    }
    setState({ busy: false });
    setDialog(null);
    router.refresh();
  }

  const canQuarantine = status === "active" && committed === 0;
  const canArchive = (status === "active" || status === "quarantine") && availableStock === 0;
  const dialogError = state.error ?? null;

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap justify-end gap-2">
        {status === "active" && (
          <button
            type="button"
            onClick={() => open("quarantine")}
            disabled={state.busy || !canQuarantine}
            className="btn btn-small disabled:cursor-not-allowed disabled:opacity-40"
            title={
              canQuarantine
                ? "Retirar o lote de circulação"
                : `${committed} placa(s) já em uso ou reservada(s): a quarentena exige o lote inteiro livre`
            }
          >
            Colocar em quarentena
          </button>
        )}

        {status === "quarantine" && (
          <button type="button" onClick={() => open("restore")} disabled={state.busy} className="btn btn-small btn-primary">
            Restaurar lote
          </button>
        )}

        {status === "archived" ? (
          <button type="button" onClick={() => open("unarchive")} disabled={state.busy} className="btn btn-small">
            Desarquivar
          </button>
        ) : (
          <button
            type="button"
            onClick={() => open("archive")}
            disabled={state.busy || !canArchive}
            className="btn btn-small disabled:cursor-not-allowed disabled:opacity-40"
            title={
              canArchive
                ? "Guardar como histórico"
                : `${availableStock} placa(s) ainda disponível(is): o arquivamento exige estoque zerado`
            }
          >
            Arquivar
          </button>
        )}
      </div>

      <ConfirmDialog
        open={dialog === "quarantine"}
        title="Colocar lote em quarentena"
        description={
          <>
            O lote <strong className="text-ink">{batchName}</strong> deixará de participar do estoque disponível e de novas
            vendas. Nenhum QR ou código será apagado.
          </>
        }
        reason={{ label: "Motivo", placeholder: "Ex.: falha de impressão no QR", minLength: 3, maxLength: 500 }}
        confirmLabel="Colocar em quarentena"
        tone="danger"
        busy={state.busy}
        error={dialogError}
        onCancel={close}
        onConfirm={(values) => applyChange("quarantine", values)}
      />

      <ConfirmDialog
        open={dialog === "restore"}
        title="Restaurar lote"
        description={
          <>
            O lote <strong className="text-ink">{batchName}</strong> volta a ficar ativo. As placas livres voltam ao estoque
            utilizável e podem entrar em novas vendas.
          </>
        }
        confirmLabel="Restaurar lote"
        busy={state.busy}
        error={dialogError}
        onCancel={close}
        onConfirm={(values) => applyChange("active", values)}
      />

      <ConfirmDialog
        open={dialog === "archive"}
        title="Arquivar lote"
        description={
          <>
            Arquivar <strong className="text-ink">{batchName}</strong> é apenas organização histórica. Nada muda para as
            placas já entregues: QR, destino, revendedor, cliente e o painel do revendedor seguem iguais.
          </>
        }
        confirmLabel="Arquivar lote"
        busy={state.busy}
        error={dialogError}
        onCancel={close}
        onConfirm={(values) => applyChange("archived", values)}
      />

      <ConfirmDialog
        open={dialog === "unarchive"}
        title="Desarquivar lote"
        description={
          <>
            O lote <strong className="text-ink">{batchName}</strong> volta para a lista de lotes ativos. Nenhuma placa é
            alterada.
          </>
        }
        confirmLabel="Desarquivar"
        busy={state.busy}
        error={dialogError}
        onCancel={close}
        onConfirm={(values) => applyChange("active", values)}
      />
    </div>
  );
}
