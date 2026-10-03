"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import type { DirectLabPlateOption } from "@/lib/directlab/types";
import { buildApplyRequest, type DirectLabRole } from "@/lib/directlab/apply";
import type { PlateStatus } from "@/lib/db/types";
import { DESTINATION_LABEL } from "@/lib/plates/destinations";
import { PLATE_STATUS_LABEL, RESELLER_STATUS_LABEL } from "@/lib/plates/labels";

export interface AppliedPlate {
  id: string;
  public_code: string;
  status: PlateStatus;
}

interface Props {
  open: boolean;
  role: DirectLabRole;
  /** URL que a placa vai abrir. */
  reviewUrl: string;
  /** Tipo de destino gravado na placa (padrão: Avaliação no Google). */
  destinationType?: "google_review" | "website";
  /** Rótulo do novo destino na confirmação. */
  destinationLabel?: string;
  /** Frase da seleção: "…que vai abrir <purpose>". */
  purpose?: string;
  placeName: string;
  onClose: () => void;
  onApplied: (plate: AppliedPlate) => void;
}

/**
 * Selecionar placa → confirmar → salvar pelo fluxo EXISTENTE da placa.
 * A lista vem de /api/directlab/plates (só o que o usuário pode configurar);
 * mesmo assim, quem decide é a rota da placa e o banco.
 */
export function UseInPlateDialog({
  open,
  role,
  reviewUrl,
  placeName,
  onClose,
  onApplied,
  destinationType = "google_review",
  destinationLabel = "Avaliação no Google",
  purpose,
}: Props) {
  const [search, setSearch] = useState("");
  const [plates, setPlates] = useState<DirectLabPlateOption[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<DirectLabPlateOption | null>(null);
  const [step, setStep] = useState<"select" | "confirm">("select");
  const [state, setState] = useState<{ busy: boolean; error?: string }>({ busy: false });
  const statusLabel = role === "admin" ? PLATE_STATUS_LABEL : RESELLER_STATUS_LABEL;

  useEffect(() => {
    if (!open) return;
    setStep("select");
    setSelected(null);
    setState({ busy: false });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoadError(null);
      const response = await fetch(`/api/directlab/plates?q=${encodeURIComponent(search)}`, { signal: controller.signal }).catch(() => null);
      if (controller.signal.aborted) return;
      const json = response ? ((await response.json().catch(() => ({}))) as { plates?: DirectLabPlateOption[]; error?: string }) : {};
      if (!response?.ok || !json.plates) {
        setPlates([]);
        setLoadError(json.error ?? "Não foi possível carregar as placas.");
        return;
      }
      setPlates(json.plates);
    }, 250);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [open, search]);

  async function applyDestination() {
    if (!selected) return;
    setState({ busy: true });
    const request = buildApplyRequest(role, selected, reviewUrl, destinationType);
    const response = await fetch(request.url, {
      method: request.method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request.body),
    }).catch(() => null);
    const json = response
      ? ((await response.json().catch(() => ({}))) as { plate?: { status: PlateStatus }; error?: string; details?: { message: string }[] })
      : {};
    if (!response?.ok) {
      const details = Array.isArray(json.details) ? json.details.map((d) => d.message).join(" ") : "";
      setState({ busy: false, error: [json.error ?? "Falha de conexão. Tente de novo.", details].filter(Boolean).join(" ") });
      return;
    }
    setState({ busy: false });
    onApplied({ id: selected.id, public_code: selected.public_code, status: json.plate?.status ?? selected.status });
  }

  const footer =
    step === "select" ? (
      <>
        <button type="button" className="btn" onClick={onClose}>
          Cancelar
        </button>
        <button type="button" className="btn btn-primary" disabled={!selected} onClick={() => setStep("confirm")}>
          Continuar
        </button>
      </>
    ) : (
      <>
        <button type="button" className="btn" disabled={state.busy} onClick={() => setStep("select")}>
          Voltar
        </button>
        <button type="button" className="btn btn-primary" disabled={state.busy} onClick={applyDestination} data-confirm="">
          {state.busy ? "Salvando..." : "Confirmar e salvar destino"}
        </button>
      </>
    );

  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={state.busy}
      size="lg"
      title={step === "select" ? "Usar em uma placa" : "Confirmar novo destino"}
      description={step === "select" ? `Escolha a placa que vai abrir ${purpose ?? `a avaliação de ${placeName}`}.` : undefined}
      footer={footer}
    >
      {step === "select" ? (
        <div className="space-y-3">
          <input
            type="search"
            className="input"
            placeholder="Buscar pelo código da placa..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Buscar placa pelo código"
            data-autofocus=""
          />
          {loadError && (
            <p role="alert" className="text-sm text-danger">
              {loadError}
            </p>
          )}
          <ul className="max-h-[50vh] divide-y divide-line overflow-y-auto rounded-md border border-line" data-plate-list="">
            {plates === null && <li className="px-4 py-6 text-center text-sm text-ink-soft">Carregando placas...</li>}
            {plates?.length === 0 && !loadError && (
              <li className="px-4 py-6 text-center text-sm text-ink-soft">
                {search ? `Nenhuma placa encontrada para “${search}”.` : "Nenhuma placa disponível para configurar."}
              </li>
            )}
            {plates?.map((plate) => {
              const active = selected?.id === plate.id;
              return (
                <li key={plate.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(plate)}
                    aria-pressed={active}
                    className={`flex w-full min-w-0 flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-left ${active ? "bg-mat/10" : "hover:bg-paper"}`}
                  >
                    <span className={`grid size-4 shrink-0 place-items-center rounded-full border ${active ? "border-mat bg-mat" : "border-line-strong"}`} aria-hidden>
                      {active && <span className="size-1.5 rounded-full bg-white" />}
                    </span>
                    <span className="font-mono font-semibold">{plate.public_code}</span>
                    <span className="rounded-full bg-paper px-2 py-0.5 text-xs font-semibold text-ink-soft">{statusLabel[plate.status]}</span>
                    <span className="min-w-0 flex-1 truncate text-sm text-ink-soft">
                      {[plate.customer_name, role === "admin" ? plate.reseller_name : null].filter(Boolean).join(" · ") || "Sem cliente"}
                    </span>
                    {plate.destination_type && (
                      <span className="w-full truncate pl-7 text-xs text-ink-soft">
                        Destino atual: {DESTINATION_LABEL[plate.destination_type]}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
        selected && (
          <div className="space-y-4 text-sm">
            <dl className="grid gap-3 rounded-md border border-line p-4 sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-x-4">
              <dt className="text-ink-soft">Placa</dt>
              <dd className="font-mono font-semibold">
                {selected.public_code} <span className="font-sans font-normal text-ink-soft">· {statusLabel[selected.status]}</span>
              </dd>
              <dt className="text-ink-soft">Destino atual</dt>
              <dd className="min-w-0 break-all">
                {selected.destination_url ? `${DESTINATION_LABEL[selected.destination_type ?? "custom"]} — ${selected.destination_url}` : "Nenhum"}
              </dd>
              <dt className="text-ink-soft">Novo destino</dt>
              <dd className="min-w-0 break-all font-semibold">
                {destinationLabel} — {reviewUrl}
              </dd>
            </dl>
            <p className="text-ink-soft">
              O destino é salvo pela mesma rotina da tela da placa, com as mesmas regras de sempre: uma placa só reservada passa a
              funcionar ao receber o destino, e o cliente vinculado continua o mesmo.
              {selected.status === "blocked" && " Esta placa está bloqueada e continuará bloqueada."}
            </p>
            {state.error && (
              <p role="alert" className="rounded-md bg-[#fdecea] px-3 py-2 text-danger">
                {state.error}
              </p>
            )}
          </div>
        )
      )}
    </Modal>
  );
}
