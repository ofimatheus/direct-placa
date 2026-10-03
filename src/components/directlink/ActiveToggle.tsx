"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** Ativar/desativar um DirectLink (sem exclusão). */
export function ActiveToggle({ id, active }: { id: string; active: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col">
      <button
        type="button"
        className={`btn btn-small ${active ? "" : "btn-primary"}`}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          const response = await fetch(`/api/directlab/directlinks/${id}/active`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ active: !active }),
          }).catch(() => null);
          setBusy(false);
          if (!response?.ok) {
            setError("Não foi possível alterar.");
            return;
          }
          router.refresh();
        }}
      >
        {busy ? "..." : active ? "Desativar" : "Ativar"}
      </button>
      {error && (
        <span role="alert" className="mt-1 text-xs text-danger">
          {error}
        </span>
      )}
    </span>
  );
}
