"use client";

import { useState } from "react";
import { Modal } from "./Modal";

/**
 * Copia para a área de transferência. Se o navegador bloquear o acesso
 * (contexto sem HTTPS, permissão negada), mostra o texto num modal do sistema,
 * já selecionado, para copiar manualmente.
 */
export function CopyButton({
  value,
  label = "Copiar",
  copiedLabel = "Copiado",
  className = "btn btn-small",
}: {
  value: string;
  label?: string;
  copiedLabel?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const [manual, setManual] = useState(false);
  return (
    <>
      <button
        type="button"
        className={className}
        aria-live="polite"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1800);
          } catch {
            setManual(true);
          }
        }}
      >
        {copied ? copiedLabel : label}
      </button>
      <Modal
        open={manual}
        onClose={() => setManual(false)}
        size="sm"
        title="Copiar texto"
        description="O navegador não permitiu copiar automaticamente. Selecione o texto abaixo e copie."
        footer={
          <button type="button" className="btn btn-primary" onClick={() => setManual(false)}>
            Fechar
          </button>
        }
      >
        <input
          className="input font-mono text-sm"
          readOnly
          value={value}
          data-autofocus=""
          onFocus={(event) => event.currentTarget.select()}
          aria-label="Texto para copiar"
        />
      </Modal>
    </>
  );
}
