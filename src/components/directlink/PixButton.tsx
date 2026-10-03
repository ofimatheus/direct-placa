"use client";

import { useEffect, useRef, useState } from "react";
import type { PublicItem } from "@/lib/directlink/items";
import { ItemIcon } from "./icons";

/**
 * Botão PIX: abre um painel com a chave e "Copiar chave" (Clipboard API).
 * Não gera cobrança nem transação: só exibe a chave cadastrada.
 */
export function PixButton({ item, className }: { item: PublicItem; className: string }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<"idle" | "copied" | "manual">("idle");
  const closeRef = useRef<HTMLButtonElement>(null);
  const keyRef = useRef<HTMLParagraphElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    const trigger = triggerRef.current;
    return () => {
      document.removeEventListener("keydown", onKey);
      trigger?.focus();
    };
  }, [open]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(item.value);
      setStatus("copied");
    } catch {
      // Sem permissão de área de transferência: deixa a chave selecionada para copiar manualmente.
      const node = keyRef.current;
      if (node) {
        const range = document.createRange();
        range.selectNodeContents(node);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
      setStatus("manual");
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={className}
        onClick={() => {
          setStatus("idle");
          setOpen(true);
        }}
        data-dl-item="pix"
      >
        <span className="dl-btn-icon">
          <ItemIcon type="pix" />
        </span>
        <span className="dl-btn-title">{item.title}</span>
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-labelledby="pix-title" data-pix-sheet="">
          <button type="button" className="absolute inset-0 bg-black/50" aria-label="Fechar" tabIndex={-1} onClick={() => setOpen(false)} />
          <div className="relative w-full max-w-[520px] rounded-t-3xl bg-white px-5 pt-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-2xl sm:rounded-3xl sm:pb-5">
            <div className="flex items-start justify-between gap-3">
              <h2 id="pix-title" className="text-lg font-bold text-[#0f1b2d]">
                Pagamento via PIX
              </h2>
              <button ref={closeRef} type="button" onClick={() => setOpen(false)} className="grid size-10 shrink-0 place-items-center rounded-full text-[#5b6b82] hover:bg-[#f1f4f8]" aria-label="Fechar">
                <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
                  <path d="M6 6l12 12M18 6 6 18" />
                </svg>
              </button>
            </div>
            {item.receiver_name && <p className="mt-1 text-sm text-[#5b6b82]">Recebedor: {item.receiver_name}</p>}
            <p className="mt-4 text-xs font-semibold tracking-wide text-[#5b6b82] uppercase">Chave</p>
            <p ref={keyRef} className="mt-1 rounded-xl border border-[#e4eaf1] bg-[#f5f8fb] px-4 py-3 font-mono text-[0.95rem] break-all text-[#0f1b2d] select-all" data-pix-key="">
              {item.value}
            </p>
            <button type="button" onClick={copy} className="mt-4 flex min-h-[52px] w-full items-center justify-center rounded-2xl bg-[#0b63de] px-4 text-base font-semibold text-white active:bg-[#0850b5]">
              {status === "copied" ? "✓ Chave PIX copiada" : "Copiar chave"}
            </button>
            <p className="mt-2 min-h-5 text-center text-sm text-[#5b6b82]" aria-live="polite" data-pix-status="">
              {status === "copied" ? "Chave PIX copiada" : status === "manual" ? "Chave selecionada: copie com o menu do seu celular." : ""}
            </p>
            <p className="mt-1 text-center text-xs text-[#8a98ab]">Confira o nome do recebedor no app do seu banco antes de pagar.</p>
          </div>
        </div>
      )}
    </>
  );
}
