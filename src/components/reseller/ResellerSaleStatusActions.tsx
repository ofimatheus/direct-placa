"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/ui/Modal";
import type { ResellerSaleStatus } from "@/lib/db/types";

interface Props {
  saleId: string;
  status: ResellerSaleStatus;
  /** Placas da venda que ainda estão apenas recebidas (não ativadas). */
  reservedCount: number;
  /** Placas da venda já ativas ou em uso. */
  inUseCount: number;
}

export function ResellerSaleStatusActions({ saleId, status, reservedCount, inUseCount }: Props) {
  const router = useRouter();
  const [state, setState] = useState<{ busy: boolean; error?: string }>({ busy: false });

  async function change(next: ResellerSaleStatus) {
    setState({ busy: true });
    const response = await fetch(`/api/reseller/sales/${saleId}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    }).catch(() => null);
    if (!response) {
      setState({ busy: false, error: "Falha de conexão. Tente de novo." });
      return;
    }
    if (!response.ok) {
      const json = (await response.json().catch(() => ({}))) as { error?: string };
      setState({ busy: false, error: json.error ?? "Não foi possível alterar a venda." });
      return;
    }
    setState({ busy: false });
    router.refresh();
  }

  const [confirming, setConfirming] = useState(false);

  // A mensagem precisa ser honesta sobre o que NÃO acontece: o revendedor
  // não pode achar que cancelar desliga a placa do cliente dele.
  const impact =
    inUseCount > 0
      ? `As ${inUseCount} placa(s) já configurada(s) ou em uso continuam funcionando normalmente, com o mesmo cliente: cancelar encerra apenas o registro financeiro.`
      : reservedCount > 0
        ? `As ${reservedCount} placa(s) ainda não configurada(s) voltam a ficar disponíveis para uma nova venda sua, e o vínculo com o cliente desta venda é desfeito.`
        : "";

  if (status === "cancelled") {
    return <p className="text-sm text-ink-soft">Venda cancelada. Não entra nos indicadores.</p>;
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <div className="flex flex-wrap gap-2">
        {status === "pending" && (
          <button type="button" onClick={() => void change("paid")} disabled={state.busy} className="btn btn-primary text-sm">
            Marcar como pago
          </button>
        )}
        {status === "paid" && (
          <button type="button" onClick={() => void change("pending")} disabled={state.busy} className="btn btn-ghost text-sm">
            Voltar para pendente
          </button>
        )}
        <button type="button" onClick={() => setConfirming(true)} disabled={state.busy} className="btn btn-ghost text-sm text-danger">
          Cancelar venda
        </button>
      </div>
      {state.error && <p className="text-sm text-danger">{state.error}</p>}

      <ConfirmDialog
        open={confirming}
        title="Cancelar esta venda"
        description={<>Ela sai dos seus indicadores. {impact}</>}
        confirmLabel="Cancelar venda"
        cancelLabel="Voltar"
        tone="danger"
        busy={state.busy}
        onCancel={() => setConfirming(false)}
        onConfirm={async () => {
          setConfirming(false);
          await change("cancelled");
        }}
      />
    </div>
  );
}
