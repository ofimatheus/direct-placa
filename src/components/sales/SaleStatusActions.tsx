"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/ui/Modal";
import type { OrderStatus } from "@/lib/db/types";

interface Props {
  saleId: string;
  orderNumber: number;
  status: OrderStatus;
  /** Placas vinculadas ainda só RESERVADAS (voltam ao estoque se a venda for cancelada). */
  reservedCount: number;
  /** Placas vinculadas ativas, inativas ou bloqueadas (bloqueiam o cancelamento automático). */
  inUse: { code: string; label: string }[];
}

type Result = { ok: boolean; error?: string; details?: unknown };

async function post(url: string, body: unknown): Promise<Result> {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
  if (!response) return { ok: false, error: "Falha de conexão. Tente de novo." };
  if (response.ok) return { ok: true };
  const json = (await response.json().catch(() => ({}))) as { error?: string; details?: unknown };
  return { ok: false, error: json.error ?? "Não foi possível alterar a venda.", details: json.details };
}

export function SaleStatusActions({ saleId, orderNumber, status, reservedCount, inUse }: Props) {
  const router = useRouter();
  const [state, setState] = useState<{ busy: boolean; error?: string }>({ busy: false });

  async function run(action: () => Promise<Result>) {
    setState({ busy: true });
    const result = await action();
    setState({ busy: false, error: result.ok ? undefined : result.error });
    // "plates_in_use": uma placa foi ativada depois que a página abriu; recarrega para mostrar a ação específica.
    if (result.ok || result.details === "plates_in_use") router.refresh();
  }

  const markPaid = () => run(() => post(`/api/admin/sales/${saleId}/status`, { status: "paid" }));

  const [dialog, setDialog] = useState<"cancel" | "keep" | null>(null);

  async function confirmCancel(keep: boolean) {
    setState({ busy: true });
    const result = await post(`/api/admin/sales/${saleId}/cancel`, { keep_plates_in_use: keep });
    if (!result.ok) {
      setState({ busy: false, error: result.error });
      if (result.details === "plates_in_use") {
        setDialog(null);
        router.refresh();
      }
      return;
    }
    setState({ busy: false });
    setDialog(null);
    router.refresh();
  }

  const openDialog = (next: "cancel" | "keep") => {
    setState({ busy: false });
    setDialog(next);
  };
  const closeDialog = () => {
    if (state.busy) return;
    setDialog(null);
    setState({ busy: false });
  };

  if (status === "cancelled") return <p className="text-sm text-ink-soft">Venda cancelada. Não há ações disponíveis.</p>;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        {(status === "pending" || status === "draft") && (
          <button type="button" className="btn btn-primary" disabled={state.busy} onClick={markPaid}>
            Marcar como pago
          </button>
        )}
        {inUse.length === 0 && (
          <button type="button" className="btn" disabled={state.busy} onClick={() => openDialog("cancel")}>
            Cancelar venda
          </button>
        )}
      </div>

      {inUse.length > 0 && (
        <div className="rounded-md border border-warn/40 bg-warn/5 p-3 text-sm">
          <p className="font-semibold text-warn">Cancelamento automático bloqueado</p>
          <p className="mt-1 text-ink-soft">
            {inUse.length === 1 ? "1 placa desta venda está" : `${inUse.length} placas desta venda estão`} ativa(s) ou em uso:{" "}
            <span className="plate-code text-ink">
              {inUse
                .slice(0, 8)
                .map((p) => `${p.code} (${p.label})`)
                .join(", ")}
            </span>
            {inUse.length > 8 && ` e mais ${inUse.length - 8}`}. Elas não voltam ao estoque automaticamente.
          </p>
          <button type="button" className="btn btn-small mt-3" disabled={state.busy} onClick={() => openDialog("keep")}>
            Cancelar e manter placas em uso com o revendedor
          </button>
        </div>
      )}

      {state.error && !dialog && (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      )}

      <ConfirmDialog
        open={dialog === "cancel"}
        title={`Cancelar a venda #${orderNumber}`}
        description={
          <>
            {reservedCount > 0
              ? `As ${reservedCount} placa(s) reservadas voltam ao estoque como disponíveis e deixam de pertencer ao revendedor.`
              : "A venda não tem placas reservadas."}{" "}
            Ela deixa de contar no faturamento.
          </>
        }
        confirmLabel="Cancelar venda"
        cancelLabel="Voltar"
        tone="danger"
        busy={state.busy}
        error={dialog === "cancel" ? state.error : null}
        onCancel={closeDialog}
        onConfirm={() => confirmCancel(false)}
      />

      <ConfirmDialog
        open={dialog === "keep"}
        title={`Cancelar a venda #${orderNumber} mantendo placas em uso`}
        description={
          <>
            As {inUse.length} placa(s) em uso continuam com o revendedor, configuradas, e deixam de pertencer à venda.
            {reservedCount > 0 ? ` As ${reservedCount} placa(s) só reservadas voltam ao estoque.` : ""}
          </>
        }
        typedConfirmation={{ label: `Para confirmar, digite o número da venda (${orderNumber})`, expected: String(orderNumber) }}
        confirmLabel="Cancelar e manter placas em uso"
        cancelLabel="Voltar"
        tone="danger"
        busy={state.busy}
        error={dialog === "keep" ? state.error : null}
        onCancel={closeDialog}
        onConfirm={() => confirmCancel(true)}
      />
    </div>
  );
}
