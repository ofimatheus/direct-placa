"use client";

import { useEffect, useId, useRef, useState } from "react";

/**
 * Modal do sistema (substitui window.confirm / window.prompt / alert).
 *
 * Renderiza no próprio lugar da árvore (sem portal) para herdar o tema da área
 * — o painel ADMIN e o painel do revendedor usam variáveis de cor diferentes.
 * Fecha com Esc e clique fora (exceto enquanto `busy`), prende o foco de Tab
 * dentro do diálogo e devolve o foco a quem o abriu.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  busy = false,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  busy?: boolean;
  size?: "sm" | "md" | "lg";
}) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const busyRef = useRef(busy);
  busyRef.current = busy;

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const focusable = () =>
      panel
        ? [...panel.querySelectorAll<HTMLElement>("input, select, textarea, button, a[href], [tabindex]:not([tabindex='-1'])")].filter(
            (el) => !el.hasAttribute("disabled"),
          )
        : [];
    (panel?.querySelector<HTMLElement>("[data-autofocus]") ?? focusable()[0] ?? panel)?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busyRef.current) {
        event.stopPropagation();
        closeRef.current();
      }
      if (event.key === "Tab") {
        const items = focusable();
        if (items.length === 0) return;
        const first = items[0]!;
        const last = items[items.length - 1]!;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  const width = size === "sm" ? "max-w-sm" : size === "lg" ? "max-w-2xl" : "max-w-md";

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-[rgba(19,30,43,0.45)] p-3 sm:items-center sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
      data-modal-backdrop=""
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={`card flex max-h-[calc(100dvh-1.5rem)] w-full ${width} flex-col overflow-hidden text-left shadow-[0_20px_50px_rgba(19,30,43,0.25)] outline-none`}
      >
        <div className="overflow-y-auto px-5 pt-5 pb-4 sm:px-6 sm:pt-6">
          <h2 id={titleId} className="display text-lg leading-snug">
            {title}
          </h2>
          {description && (
            <div id={descriptionId} className="mt-2 text-sm leading-relaxed text-ink-soft">
              {description}
            </div>
          )}
          {children && <div className="mt-4">{children}</div>}
        </div>
        {footer && (
          <div className="flex flex-col-reverse gap-2 border-t border-line bg-paper/60 px-5 py-3 sm:flex-row sm:justify-end sm:px-6">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

export interface ConfirmValues {
  reason?: string;
}

/**
 * Confirmação de ação administrativa. Opcionalmente exige um motivo (com
 * tamanho mínimo) ou que o usuário digite um texto de confirmação. O botão
 * de confirmar só habilita quando o que foi pedido está preenchido; Cancelar
 * nunca chama onConfirm.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancelar",
  tone = "primary",
  busy = false,
  error,
  reason,
  typedConfirmation,
  children,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description?: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: "primary" | "danger";
  busy?: boolean;
  error?: string | null;
  reason?: { label: string; placeholder?: string; minLength?: number; maxLength?: number };
  typedConfirmation?: { label: React.ReactNode; expected: string };
  children?: React.ReactNode;
  onConfirm: (values: ConfirmValues) => void | Promise<void>;
  onCancel: () => void;
}) {
  const [reasonText, setReasonText] = useState("");
  const [typed, setTyped] = useState("");
  const reasonId = useId();
  const typedId = useId();

  useEffect(() => {
    if (open) {
      setReasonText("");
      setTyped("");
    }
  }, [open]);

  const minLength = reason?.minLength ?? 1;
  const reasonOk = !reason || reasonText.trim().length >= minLength;
  const typedOk = !typedConfirmation || typed.trim() === typedConfirmation.expected;
  const canConfirm = reasonOk && typedOk && !busy;

  const submit = (event?: React.FormEvent) => {
    event?.preventDefault();
    if (!canConfirm) return;
    void onConfirm({ reason: reason ? reasonText.trim() : undefined });
  };

  return (
    <Modal
      open={open}
      onClose={onCancel}
      busy={busy}
      title={title}
      description={description}
      footer={
        <>
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </button>
          <button
            type="submit"
            form={`${reasonId}-form`}
            className={`btn ${tone === "danger" ? "btn-danger" : "btn-primary"}`}
            disabled={!canConfirm}
            data-confirm=""
          >
            {busy ? "Aguarde..." : confirmLabel}
          </button>
        </>
      }
    >
      <form id={`${reasonId}-form`} onSubmit={submit} className="space-y-4">
        {children}
        {reason && (
          <label className="block" htmlFor={reasonId}>
            <span className="field-label">{reason.label}</span>
            <textarea
              id={reasonId}
              className="input min-h-20"
              data-autofocus=""
              placeholder={reason.placeholder}
              maxLength={reason.maxLength ?? 500}
              value={reasonText}
              onChange={(event) => setReasonText(event.target.value)}
              required={minLength > 0}
            />
            {reasonText.length > 0 && !reasonOk && (
              <span className="mt-1 block text-xs text-ink-soft">Informe ao menos {minLength} caracteres.</span>
            )}
          </label>
        )}
        {typedConfirmation && (
          <label className="block" htmlFor={typedId}>
            <span className="field-label">{typedConfirmation.label}</span>
            <input
              id={typedId}
              className="input"
              data-autofocus={reason ? undefined : ""}
              autoComplete="off"
              inputMode="numeric"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
            />
          </label>
        )}
        {error && (
          <p role="alert" className="rounded-md bg-[#fdecea] px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}
