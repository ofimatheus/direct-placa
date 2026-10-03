"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/ui/icons";
import { GOOGLE_KEY_FORMAT, PLACES_FORMAT_MESSAGE, PLACES_TEST_NOTE, maskedKey } from "@/lib/integrations/google-places/messages";
import { formatDateTime } from "@/lib/utils/text";

/** Só metadados (nunca a chave). */
export interface GooglePlacesView {
  available: boolean;
  customConfigured: boolean;
  last4: string | null;
  configuredAt: string | null;
  lastTestStatus: string | null;
  lastTestSource: string | null;
  lastTestAt: string | null;
  envAvailable: boolean;
  serverCanReadCustom: boolean;
}

const LAST_TEST_LABEL: Record<string, string> = {
  ok: "✓ Conexão válida",
  invalid_key: "Chave inválida (API key not valid)",
  permission_denied: "PERMISSION_DENIED",
  quota_exceeded: "Cota esgotada (RESOURCE_EXHAUSTED)",
  unavailable: "Google indisponível ou falha de rede",
  unexpected: "Resposta inesperada do Google",
};

type Feedback = { ok: boolean; text: string } | null;

/** Card da integração Google Places (Configurações > Integrações). */
export function GooglePlacesCard({ initial }: { initial: GooglePlacesView }) {
  const router = useRouter();
  const [view, setView] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [reveal, setReveal] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [busy, setBusy] = useState<null | "test" | "save" | "remove">(null);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const source = view.customConfigured ? "admin" : view.envAvailable ? "env" : "none";
  const configured = source !== "none";
  const formatOk = GOOGLE_KEY_FORMAT.test(newKey.trim());

  async function call(method: "POST" | "PUT" | "DELETE", url: string, body?: unknown) {
    const res = await fetch(url, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string; error?: string; kind?: string; last4?: string; source?: string | null };
    return { res, json };
  }

  async function testConnection() {
    setBusy("test");
    setFeedback(null);
    try {
      const { json } = await call("POST", "/api/admin/integrations/google-places/test");
      setFeedback({ ok: Boolean(json.ok), text: json.message ?? json.error ?? "Não foi possível testar agora." });
      if (json.kind && json.kind in LAST_TEST_LABEL) setView((v) => ({ ...v, lastTestStatus: json.kind ?? null, lastTestSource: json.source ?? null, lastTestAt: new Date().toISOString() }));
    } catch {
      setFeedback({ ok: false, text: "Sem conexão com o servidor. Tente novamente." });
    } finally {
      setBusy(null);
    }
  }

  async function testAndSave(event: React.FormEvent) {
    event.preventDefault();
    if (!formatOk) {
      setFeedback({ ok: false, text: PLACES_FORMAT_MESSAGE });
      return;
    }
    setBusy("save");
    setFeedback(null);
    try {
      const { json } = await call("PUT", "/api/admin/integrations/google-places", { apiKey: newKey.trim() });
      if (json.ok) {
        setView((v) => ({ ...v, customConfigured: true, last4: json.last4 ?? v.last4, configuredAt: new Date().toISOString(), lastTestStatus: "ok", lastTestSource: "admin", lastTestAt: new Date().toISOString() }));
        setNewKey("");
        setReveal(false);
        setEditing(false);
        router.refresh();
      }
      setFeedback({ ok: Boolean(json.ok), text: json.message ?? json.error ?? "Não foi possível salvar a chave. A chave atual foi mantida." });
    } catch {
      setFeedback({ ok: false, text: "Sem conexão com o servidor. A chave atual foi mantida." });
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    setBusy("remove");
    setFeedback(null);
    try {
      const { res, json } = await call("DELETE", "/api/admin/integrations/google-places");
      if (res.ok) {
        setView((v) => ({ ...v, customConfigured: false, last4: null, configuredAt: null, lastTestStatus: null, lastTestSource: null, lastTestAt: null }));
        setFeedback({ ok: true, text: view.envAvailable ? "Configuração personalizada removida. Usando a variável de ambiente." : "Configuração personalizada removida. Google Places não está configurado." });
        router.refresh();
      } else {
        setFeedback({ ok: false, text: json.error ?? "Não foi possível remover a configuração." });
      }
    } catch {
      setFeedback({ ok: false, text: "Sem conexão com o servidor. Tente novamente." });
    } finally {
      setBusy(null);
      setConfirmRemove(false);
    }
  }

  const cancelEdit = () => {
    setEditing(false);
    setNewKey("");
    setReveal(false);
  };

  return (
    <section className="card p-5 sm:p-6" aria-labelledby="gp-title" data-integration="google-places">
      <div className="flex flex-wrap items-start gap-3.5">
        <span className="icon-tile size-11" aria-hidden>
          <Icon name="star" className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="gp-title" className="display text-lg">
            Google Places
          </h2>
          <p className="mt-0.5 text-sm text-ink-soft">Utilizado pelo DirectLab para gerar links diretos de avaliação no Google.</p>
        </div>
        <span className={`badge ${configured ? "badge-green" : "badge-gray"}`} data-gp-status={configured ? "configured" : "not_configured"}>
          {configured ? "● Configurada" : "Não configurada"}
        </span>
      </div>

      {!view.available && (
        <p className="mt-4 rounded-lg border border-line bg-paper px-4 py-3 text-sm" role="status">
          Para salvar uma chave pela interface, aplique a migration <code className="font-mono text-[0.85em]">20261006120000_google_places_integration.sql</code> no Supabase.
        </p>
      )}
      {view.customConfigured && !view.serverCanReadCustom && (
        <p className="mt-4 rounded-lg border border-warn/40 bg-surface px-4 py-3 text-sm" role="status">
          A chave está salva, mas o servidor não tem SUPABASE_SERVICE_ROLE_KEY para lê-la. Enquanto isso, a Avaliação Google usa a variável de ambiente (se houver).
        </p>
      )}

      <dl className="mt-5 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[auto_minmax(0,1fr)]">
        <dt className="text-ink-soft">Origem atual</dt>
        <dd className="font-semibold" data-gp-source={source}>
          {source === "admin" ? "Configuração do administrador" : source === "env" ? "Variável de ambiente" : "Não configurada pela interface nem pelo ambiente"}
        </dd>
        {view.customConfigured && (
          <>
            <dt className="text-ink-soft">Chave</dt>
            <dd className="font-mono tabular-nums" data-gp-masked="">
              {maskedKey(view.last4)}
            </dd>
          </>
        )}
        <dt className="text-ink-soft">Chave de fallback do ambiente</dt>
        <dd data-gp-env={view.envAvailable ? "available" : "missing"}>{view.envAvailable ? "Disponível" : "Não definida"}</dd>
        {view.lastTestStatus && (
          <>
            <dt className="text-ink-soft">Último teste</dt>
            <dd data-gp-last-test={view.lastTestStatus}>
              <span className={view.lastTestStatus === "ok" ? "font-semibold text-ok" : "font-semibold text-danger"}>{LAST_TEST_LABEL[view.lastTestStatus] ?? view.lastTestStatus}</span>
              {view.lastTestAt ? <span className="text-ink-soft"> · {formatDateTime(view.lastTestAt)}</span> : null}
            </dd>
          </>
        )}
      </dl>

      {feedback && (
        <p role="status" className={`mt-5 rounded-lg border px-4 py-3 text-sm ${feedback.ok ? "border-ok/30 bg-ok-soft" : "border-danger/25 bg-danger-soft"}`} data-gp-feedback={feedback.ok ? "ok" : "error"}>
          {feedback.text}
        </p>
      )}

      {editing ? (
        <form onSubmit={testAndSave} className="mt-5 grid gap-3 border-t border-line pt-5" data-gp-form="" autoComplete="off">
          <label className="field-label" htmlFor="gp-new-key">
            Nova chave da Google Places API
          </label>
          <div className="flex flex-wrap gap-2">
            <input
              id="gp-new-key"
              name="new-google-places-key"
              className="input min-w-0 flex-1 basis-64 font-mono"
              type={reveal ? "text" : "password"}
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              data-1p-ignore=""
              data-lpignore="true"
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              placeholder="AIza…"
              aria-describedby="gp-new-key-help"
            />
            <button type="button" className="btn" onClick={() => setReveal((r) => !r)} aria-pressed={reveal} disabled={!newKey}>
              {reveal ? "Ocultar" : "Mostrar"}
            </button>
          </div>
          <p id="gp-new-key-help" className="text-xs text-ink-soft">
            A chave é testada no Google antes de ser salva; se o teste falhar, a chave atual continua. Depois de salva, ela não pode ser exibida de novo. {PLACES_TEST_NOTE}
          </p>
          {newKey && !formatOk && <p className="text-sm text-danger">{PLACES_FORMAT_MESSAGE}</p>}
          <div className="flex flex-wrap gap-2">
            <button type="submit" className="btn btn-primary" disabled={busy !== null || !formatOk || !view.available}>
              {busy === "save" ? "Testando…" : "Testar e salvar"}
            </button>
            <button type="button" className="btn" onClick={cancelEdit} disabled={busy !== null}>
              Cancelar
            </button>
          </div>
        </form>
      ) : (
        <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-line pt-5">
          <button type="button" className="btn" onClick={testConnection} disabled={busy !== null || !configured} data-gp-test="">
            {busy === "test" ? "Testando…" : "Testar conexão"}
          </button>
          <button type="button" className="btn btn-primary" onClick={() => setEditing(true)} disabled={busy !== null || !view.available} data-gp-edit="">
            {view.customConfigured ? "Alterar chave" : view.envAvailable ? "Configurar chave personalizada" : "Configurar chave"}
          </button>
          <span className="basis-full text-xs text-ink-soft">{PLACES_TEST_NOTE}</span>
        </div>
      )}

      {view.customConfigured && !editing && (
        <div className="mt-4" data-gp-remove-area="">
          {confirmRemove ? (
            <div className="rounded-lg border border-danger/25 bg-danger-soft px-4 py-3 text-sm" role="alertdialog" aria-labelledby="gp-remove-q">
              <p id="gp-remove-q" className="font-semibold">
                Remover a chave personalizada?
              </p>
              <p className="mt-0.5 text-ink-soft">
                {view.envAvailable ? "A Avaliação Google volta a usar a variável de ambiente." : "Não há chave no ambiente: o Google Places ficará não configurado."} A variável de ambiente não é alterada.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" className="btn btn-primary" onClick={remove} disabled={busy !== null} data-gp-remove-confirm="">
                  {busy === "remove" ? "Removendo…" : "Confirmar remoção"}
                </button>
                <button type="button" className="btn" onClick={() => setConfirmRemove(false)} disabled={busy !== null}>
                  Cancelar
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className="text-sm font-semibold text-danger hover:underline" onClick={() => setConfirmRemove(true)} data-gp-remove="">
              Remover configuração personalizada
            </button>
          )}
        </div>
      )}
    </section>
  );
}
