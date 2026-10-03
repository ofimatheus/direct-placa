"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export interface DirectLabLimitsView {
  googleReviewDaily: number;
  directlinkPages: number;
  customized: boolean;
  googleUsedToday: number;
  directlinkCount: number;
}

/**
 * ADMIN: limites do DirectLab de um revendedor. A regra vale no banco
 * (admin_set_directlab_limits); aqui só se edita o valor atual.
 */
export function DirectLabLimitsForm({ resellerId, initial }: { resellerId: string; initial: DirectLabLimitsView }) {
  const router = useRouter();
  const [google, setGoogle] = useState(String(initial.googleReviewDaily));
  const [pages, setPages] = useState(String(initial.directlinkPages));
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  const parse = (v: string) => (/^\d{1,4}$/.test(v.trim()) ? Number(v.trim()) : NaN);
  const g = parse(google);
  const p = parse(pages);
  const valid = g >= 0 && g <= 1000 && p >= 0 && p <= 1000;

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setFeedback(null);
    try {
      const res = await fetch(`/api/admin/resellers/${resellerId}/directlab-limits`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ googleReviewDaily: g, directlinkPages: p }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setFeedback({ ok: false, text: json.error ?? "Não foi possível salvar os limites." });
      } else {
        setFeedback({ ok: true, text: "Limites salvos. Já valem para o revendedor." });
        router.refresh();
      }
    } catch {
      setFeedback({ ok: false, text: "Sem conexão. Tente novamente." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="mt-4 grid gap-4" data-directlab-limits-form="">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="field-label" htmlFor="limit-google">
            Avaliação Google
          </label>
          <div className="mt-1 flex items-center gap-2">
            <input id="limit-google" className="input w-28 tabular-nums" inputMode="numeric" value={google} onChange={(e) => setGoogle(e.target.value)} aria-describedby="limit-google-help" />
            <span className="text-sm text-ink-soft">utilizações por dia</span>
          </div>
          <p id="limit-google-help" className="mt-1 text-xs text-ink-soft">
            Hoje: {initial.googleUsedToday} de {initial.googleReviewDaily}. Recomeça à meia-noite (Brasília).
          </p>
        </div>
        <div>
          <label className="field-label" htmlFor="limit-pages">
            DirectLink
          </label>
          <div className="mt-1 flex items-center gap-2">
            <input id="limit-pages" className="input w-28 tabular-nums" inputMode="numeric" value={pages} onChange={(e) => setPages(e.target.value)} aria-describedby="limit-pages-help" />
            <span className="text-sm text-ink-soft">páginas permitidas</span>
          </div>
          <p id="limit-pages-help" className="mt-1 text-xs text-ink-soft">
            Em uso: {initial.directlinkCount} de {initial.directlinkPages}. Reduzir não apaga nem desativa páginas existentes.
          </p>
        </div>
      </div>
      {!valid && <p className="text-sm text-danger">Use números inteiros de 0 a 1000.</p>}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="btn btn-primary" disabled={!valid || busy}>
          {busy ? "Salvando…" : "Salvar limites"}
        </button>
        {!initial.customized && <span className="badge badge-gray">Usando os padrões (10/dia e 3 páginas)</span>}
        {feedback && (
          <p role="status" className={`text-sm font-semibold ${feedback.ok ? "text-ok" : "text-danger"}`} data-directlab-limits-feedback="">
            {feedback.text}
          </p>
        )}
      </div>
    </form>
  );
}
