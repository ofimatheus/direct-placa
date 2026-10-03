"use client";

import { useState } from "react";
import Link from "next/link";
import { CopyButton } from "@/components/ui/CopyButton";
import { platePagePath, type DirectLabRole } from "@/lib/directlab/apply";
import {
  DIRECTLAB_ERRORS,
  DirectLabError,
  type DirectLabErrorCode,
} from "@/lib/directlab/errors";
import type { QuotaSnapshot } from "@/lib/directlab/types";
import { parseUserGoogleUrl } from "@/lib/directlab/urls";
import { PLATE_STATUS_LABEL, RESELLER_STATUS_LABEL } from "@/lib/plates/labels";
import { UseInPlateDialog, type AppliedPlate } from "./UseInPlateDialog";

interface Place {
  placeId: string;
  name: string;
  address: string | null;
  reviewUrl: string;
}
interface Candidate {
  placeId: string;
  name: string;
  address: string | null;
  /** Comprovante assinado pelo servidor (devolvido ao gerar; o navegador não o interpreta). */
  token?: string;
}

type Mode = "link" | "search";

type View =
  | { kind: "idle" }
  | { kind: "processing"; message: string }
  | { kind: "found"; place: Place; originalUrl: string | null }
  | {
      kind: "choose";
      candidates: Candidate[];
      originalUrl: string | null;
      manual: boolean;
    }
  | {
      kind: "selected";
      candidate: Candidate;
      candidates: Candidate[];
      originalUrl: string | null;
      manual: boolean;
    }
  | { kind: "not_identified"; originalUrl: string | null }
  | { kind: "error"; code: DirectLabErrorCode | "unexpected"; message: string };

type ApiReply = (
  | { status: "found"; place: Place; originalUrl: string | null }
  | { status: "choose"; candidates: Candidate[]; originalUrl: string | null }
  | { status: "not_identified"; originalUrl: string }
) & { quota?: QuotaSnapshot };

async function callApi(
  body: Record<string, unknown>,
): Promise<
  | ApiReply
  | {
      error: string;
      code: DirectLabErrorCode | "unexpected";
      retryAfterSeconds?: number;
    }
> {
  const response = await fetch("/api/directlab/google-review", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => null);
  if (!response)
    return {
      error: "Falha de conexão. Verifique a internet e tente de novo.",
      code: "unexpected",
    };
  const json = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  if (!response.ok) {
    return {
      error:
        typeof json.error === "string"
          ? json.error
          : "Não foi possível concluir agora. Tente de novo.",
      code: (json.code as DirectLabErrorCode) ?? "unexpected",
      retryAfterSeconds:
        typeof json.retryAfterSeconds === "number"
          ? json.retryAfterSeconds
          : undefined,
    };
  }
  return json as ApiReply;
}

const ERROR_TITLE: Partial<Record<DirectLabErrorCode | "unexpected", string>> =
  {
    invalid_url: "Link inválido",
    domain_not_allowed: "Domínio não permitido",
    redirect_blocked: "Link bloqueado por segurança",
    not_found: "Estabelecimento não encontrado",
    review_link_unavailable: "Link de avaliação indisponível",
    google_unavailable: "Google indisponível",
    google_denied: "Consulta recusada pelo Google",
    quota_exceeded: "Limite do Google atingido",
    rate_limited: "Muitas consultas seguidas",
    daily_limit: "Limite diário atingido",
    not_configured: "DirectLab não configurado",
    invalid_query: "Pesquisa muito curta",
  };

/**
 * Avaliação Google: localizar o estabelecimento (colando o link do Google OU
 * pesquisando por nome/endereço) → selecionar → gerar o link oficial.
 * `quota` (só revendedor): uso da cota diária. 1 utilização = 1 link GERADO
 * COM SUCESSO (pesquisar, resolver e selecionar não descontam). A trava é do
 * servidor/banco; aqui ela só é exibida e evita cliques inúteis.
 */
export function GoogleReviewTool({
  role,
  quota = null,
}: {
  role: DirectLabRole;
  quota?: QuotaSnapshot | null;
}) {
  const [usage, setUsage] = useState<QuotaSnapshot | null>(quota);
  const exhausted = usage !== null && usage.used >= usage.limit;

  /** Única porta de saída para a API: mantém o contador em dia com o servidor. */
  async function request(body: Record<string, unknown>) {
    const reply = await callApi(body);
    if ("error" in reply) {
      if (reply.code === "daily_limit")
        setUsage((u) => ({ used: u?.limit ?? 10, limit: u?.limit ?? 10 }));
    } else if (reply.quota) {
      setUsage(reply.quota);
    }
    return reply;
  }
  const [mode, setMode] = useState<Mode>("link");
  const [link, setLink] = useState("");
  const [query, setQuery] = useState("");
  const [view, setView] = useState<View>({ kind: "idle" });
  const [picking, setPicking] = useState(false);
  const [applied, setApplied] = useState<AppliedPlate | null>(null);
  const statusLabel =
    role === "admin" ? PLATE_STATUS_LABEL : RESELLER_STATUS_LABEL;
  const busy = view.kind === "processing";

  function handleReply(
    reply: Awaited<ReturnType<typeof callApi>>,
    manual = false,
  ) {
    setApplied(null);
    if ("error" in reply) {
      const wait = reply.retryAfterSeconds
        ? ` Tente de novo em ${reply.retryAfterSeconds} s.`
        : "";
      setView({
        kind: "error",
        code: reply.code,
        message: reply.error + (reply.code === "rate_limited" ? wait : ""),
      });
      return;
    }
    if (reply.status === "found")
      setView({
        kind: "found",
        place: reply.place,
        originalUrl: reply.originalUrl,
      });
    else if (reply.status === "choose")
      setView({
        kind: "choose",
        candidates: reply.candidates,
        originalUrl: reply.originalUrl,
        manual,
      });
    else setView({ kind: "not_identified", originalUrl: reply.originalUrl });
  }

  async function generate(event: React.FormEvent) {
    event.preventDefault();
    try {
      parseUserGoogleUrl(link); // mesmo critério do servidor: avisa antes de enviar
    } catch (error) {
      const code = error instanceof DirectLabError ? error.code : "invalid_url";
      setView({ kind: "error", code, message: DIRECTLAB_ERRORS[code].message });
      return;
    }
    setView({ kind: "processing", message: "Consultando o Google..." });
    handleReply(await request({ action: "resolve", url: link.trim() }));
  }

  async function searchManually(event: React.FormEvent) {
    event.preventDefault();
    if (query.replace(/\s+/g, " ").trim().length < 3) return;
    const originalUrl =
      mode === "link" &&
      (view.kind === "not_identified" ||
        view.kind === "choose" ||
        view.kind === "selected")
        ? view.originalUrl
        : null;
    setView({ kind: "processing", message: "Pesquisando estabelecimentos..." });
    const reply = await request({ action: "search", query });
    if (!("error" in reply) && reply.status === "choose") {
      setView({
        kind: "choose",
        candidates: reply.candidates,
        originalUrl,
        manual: true,
      });
      return;
    }
    handleReply(reply, true);
  }

  /** Selecionar NÃO chama o servidor (nem desconta nada): só marca o local escolhido. */
  function select(
    candidate: Candidate,
    candidates: Candidate[],
    originalUrl: string | null,
    manual: boolean,
  ) {
    setView({ kind: "selected", candidate, candidates, originalUrl, manual });
  }

  /** Gerar o link do local selecionado: é aqui (e só no sucesso) que 1 utilização é descontada. */
  async function generateSelected(
    candidate: Candidate,
    originalUrl: string | null,
  ) {
    setView({
      kind: "processing",
      message: `Gerando o link de avaliação de ${candidate.name}...`,
    });
    handleReply(
      await request({
        action: "place",
        placeId: candidate.placeId,
        originalUrl,
        ...(candidate.token ? { token: candidate.token } : {}),
      }),
    );
  }

  function switchMode(next: Mode) {
    if (next === mode) return;
    setMode(next);
    setView({ kind: "idle" });
    setApplied(null);
  }

  const manualSearch = (
    <form
      onSubmit={searchManually}
      className="mt-4 flex flex-col gap-2 sm:flex-row"
      aria-label="Pesquisar estabelecimento"
    >
      <label className="sr-only" htmlFor="directlab-search">
        Nome ou endereço do estabelecimento
      </label>
      <input
        id="directlab-search"
        className="input"
        placeholder="Nome ou endereço do estabelecimento"
        value={query}
        maxLength={200}
        onChange={(e) => setQuery(e.target.value)}
      />
      <button
        type="submit"
        className="btn shrink-0"
        disabled={busy || query.trim().length < 3}
      >
        Pesquisar
      </button>
    </form>
  );

  const usageLine = usage ? (
    <p
      className={`font-semibold tabular-nums ${exhausted ? "text-danger" : ""}`}
      data-directlab-quota=""
    >
      {usage.used} de {usage.limit} utilizações hoje
    </p>
  ) : role === "admin" ? (
    <p className="font-semibold" data-directlab-unlimited="">
      Sem limite diário
    </p>
  ) : null;

  return (
    <section
      className="card overflow-hidden"
      aria-labelledby="directlab-google-review"
      data-directlab-tool="google-review"
    >
      <div className="border-b border-line bg-gradient-to-r from-[#1d63ff]/10 via-[#22d3ee]/5 to-transparent px-5 py-4 sm:px-6">
        <div className="flex items-start gap-3">
          <span
            className="grid size-10 shrink-0 place-items-center rounded-lg bg-[#1d63ff] text-white shadow-[0_6px_18px_rgba(29,99,255,0.35)]"
            aria-hidden
          >
            <svg viewBox="0 0 24 24" className="size-5" fill="currentColor">
              <path d="m12 2.8 2.7 5.6 6.1.8-4.5 4.3 1.1 6.1L12 16.7l-5.4 2.9 1.1-6.1-4.5-4.3 6.1-.8z" />
            </svg>
          </span>
          <div className="min-w-0">
            <h2 id="directlab-google-review" className="display text-lg">
              Avaliação Google
            </h2>
            <p className="text-sm text-ink-soft">
              Localize o estabelecimento pelo link do Google ou pesquise pelo
              nome/endereço.
            </p>
          </div>
        </div>
      </div>

      <div className="px-5 py-5 sm:px-6">
        <div
          className="mb-4"
          role="group"
          aria-label="Como deseja localizar o estabelecimento?"
          data-directlab-modes=""
        >
          <p className="mb-2 text-sm font-semibold">
            Como deseja localizar o estabelecimento?
          </p>
          <div className="flex max-w-full flex-wrap gap-1 rounded-xl border border-line bg-surface p-1">
            {(
              [
                ["link", "Colar link do Google"],
                ["search", "Pesquisar estabelecimento"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={`segmented-item rounded-lg font-semibold transition-colors ${mode === key ? "bg-mat text-white" : "text-ink-soft hover:bg-paper hover:text-ink"}`}
                aria-pressed={mode === key}
                onClick={() => switchMode(key)}
                data-directlab-mode={key}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {mode === "search" ? (
          <form
            onSubmit={searchManually}
            noValidate
            aria-label="Pesquisar estabelecimento"
            data-directlab-search-form=""
          >
            <label htmlFor="directlab-search" className="field-label">
              Nome ou endereço
            </label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                id="directlab-search"
                className="input min-w-0"
                placeholder="Ex.: Barbearia do Carvalho Barueri"
                value={query}
                maxLength={200}
                autoComplete="off"
                onChange={(e) => setQuery(e.target.value)}
              />
              <button
                type="submit"
                className="btn btn-primary shrink-0"
                disabled={busy || query.trim().length < 3}
              >
                {busy ? "Pesquisando..." : "Pesquisar"}
              </button>
            </div>
            <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-ink-soft">
              <p>
                Digite pelo menos 3 letras. A pesquisa só acontece ao clicar em
                Pesquisar.
              </p>
              {usageLine}
            </div>
          </form>
        ) : (
          <form onSubmit={generate} noValidate>
            <label htmlFor="directlab-link" className="field-label">
              Cole o link do estabelecimento
            </label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                id="directlab-link"
                className="input min-w-0 font-mono text-sm"
                inputMode="url"
                autoComplete="off"
                spellCheck={false}
                placeholder="https://share.google/xxxxxxxx"
                value={link}
                onChange={(e) => setLink(e.target.value)}
              />
              <button
                type="submit"
                className="btn btn-primary shrink-0"
                disabled={busy || exhausted || !link.trim()}
              >
                {busy ? "Gerando..." : "Gerar link de avaliação"}
              </button>
            </div>
            <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-ink-soft">
              <p>
                Aceita links do Google: share.google, maps.app.goo.gl e
                google.com/maps.
              </p>
              {usageLine}
            </div>
          </form>
        )}
        {usage && (
          <p
            className="mt-1 text-xs text-ink-soft"
            data-directlab-quota-note=""
          >
            Uma utilização é descontada somente quando o link é gerado com
            sucesso.
          </p>
        )}
        {exhausted && view.kind !== "error" && (
          <p
            role="status"
            className="mt-3 rounded-lg border border-danger/25 bg-danger-soft px-4 py-3 text-sm text-ink"
            data-directlab-exhausted=""
          >
            {DIRECTLAB_ERRORS.daily_limit.message}
            {mode === "search" ? " Você ainda pode pesquisar." : ""}
          </p>
        )}

        <div className="mt-5" aria-live="polite">
          {view.kind === "processing" && (
            <p
              className="flex items-center gap-2 text-sm text-ink-soft"
              role="status"
            >
              <span
                className="size-4 animate-spin rounded-full border-2 border-line border-t-mat"
                aria-hidden
              />
              {view.message}
            </p>
          )}

          {view.kind === "error" && (
            <div
              role="alert"
              className="rounded-lg border border-danger/30 bg-[#fdecea] px-4 py-3 text-sm"
              data-directlab-error={view.code}
            >
              <p className="font-semibold text-danger">
                {ERROR_TITLE[view.code] ?? "Algo deu errado"}
              </p>
              <p className="mt-0.5 text-ink">{view.message}</p>
              {(view.code === "not_found" ||
                view.code === "review_link_unavailable") &&
                mode === "link" &&
                manualSearch}
            </div>
          )}

          {view.kind === "not_identified" && (
            <div
              className="rounded-lg border border-line bg-paper px-4 py-4 text-sm"
              data-directlab-state="not_identified"
            >
              <p className="font-semibold">
                Não conseguimos identificar automaticamente este
                estabelecimento.
              </p>
              <p className="mt-0.5 text-ink-soft">
                Pesquise pelo nome ou endereço e escolha o local certo na lista.
              </p>
              {manualSearch}
            </div>
          )}

          {view.kind === "choose" && (
            <div
              className="rounded-lg border border-line px-4 py-4 text-sm"
              data-directlab-state="choose"
            >
              <p className="font-semibold">
                {view.manual
                  ? "Resultados encontrados"
                  : "Encontramos mais de um estabelecimento parecido."}
              </p>
              <p className="mt-0.5 text-ink-soft">
                Selecione o local correto. Nada é escolhido automaticamente
                quando há dúvida.
              </p>
              <ul className="mt-3 divide-y divide-line rounded-md border border-line">
                {view.candidates.map((candidate) => (
                  <li
                    key={candidate.placeId}
                    className="flex flex-wrap items-center gap-3 px-3 py-3"
                  >
                    <div className="min-w-0 flex-1 basis-48">
                      <p className="font-semibold break-words">
                        {candidate.name}
                      </p>
                      {candidate.address && (
                        <p className="text-xs break-words text-ink-soft">
                          {candidate.address}
                        </p>
                      )}
                    </div>
                    <button
                      type="button"
                      className="btn btn-small"
                      disabled={busy}
                      onClick={() =>
                        select(
                          candidate,
                          view.candidates,
                          view.originalUrl,
                          view.manual,
                        )
                      }
                    >
                      Selecionar
                    </button>
                  </li>
                ))}
              </ul>
              {mode === "link" && (
                <>
                  <p className="mt-4 text-xs text-ink-soft">
                    Não está na lista? Pesquise de novo:
                  </p>
                  {manualSearch}
                </>
              )}
            </div>
          )}

          {view.kind === "selected" && (
            <div
              className="rounded-lg border border-mat/30 bg-brand-soft/40 px-4 py-4 text-sm"
              data-directlab-state="selected"
            >
              <p className="text-xs font-semibold tracking-wide text-ink-soft uppercase">
                Estabelecimento selecionado
              </p>
              <p className="display mt-1 text-lg break-words">
                {view.candidate.name}
              </p>
              {view.candidate.address && (
                <p className="break-words text-ink-soft">
                  {view.candidate.address}
                </p>
              )}
              <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy || exhausted}
                  onClick={() =>
                    generateSelected(view.candidate, view.originalUrl)
                  }
                >
                  Gerar link de avaliação
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={busy}
                  onClick={() =>
                    setView({
                      kind: "choose",
                      candidates: view.candidates,
                      originalUrl: view.originalUrl,
                      manual: view.manual,
                    })
                  }
                >
                  Alterar estabelecimento
                </button>
              </div>
            </div>
          )}

          {view.kind === "found" && (
            <div
              className="rounded-xl border border-ok/30 bg-[#f3fbf6] p-4 sm:p-5"
              data-directlab-state="found"
            >
              <p className="flex items-center gap-2 text-sm font-bold text-ok">
                <svg
                  viewBox="0 0 24 24"
                  className="size-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={3}
                  aria-hidden
                >
                  <path d="m5 12 5 5 9-10" />
                </svg>
                Estabelecimento encontrado
              </p>
              <p className="mt-3 text-xs font-semibold tracking-wide text-ink-soft uppercase">
                Estabelecimento
              </p>
              <p className="display text-xl break-words">{view.place.name}</p>
              {view.place.address && (
                <>
                  <p className="mt-3 text-xs font-semibold tracking-wide text-ink-soft uppercase">
                    Endereço
                  </p>
                  <p className="text-sm break-words">{view.place.address}</p>
                </>
              )}

              <label
                htmlFor="directlab-review-url"
                className="mt-4 block text-xs font-semibold tracking-wide text-ink-soft uppercase"
              >
                Link direto para avaliação
              </label>
              <input
                id="directlab-review-url"
                className="input mt-1 font-mono text-sm"
                readOnly
                value={view.place.reviewUrl}
                onFocus={(e) => e.currentTarget.select()}
              />
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <CopyButton
                  value={view.place.reviewUrl}
                  label="Copiar link"
                  copiedLabel="✓ Link copiado"
                  className="btn"
                />
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => setPicking(true)}
                >
                  Usar em uma placa
                </button>
                <button
                  type="button"
                  className="btn sm:ml-auto"
                  onClick={() => {
                    setView({ kind: "idle" });
                    setLink("");
                    setApplied(null);
                  }}
                >
                  Gerar outro link
                </button>
              </div>

              {applied && (
                <p
                  role="status"
                  className="mt-3 rounded-md bg-white px-3 py-2 text-sm"
                >
                  <strong className="text-ok">
                    Destino da placa {applied.public_code} atualizado.
                  </strong>{" "}
                  Situação: {statusLabel[applied.status]}.{" "}
                  <Link href={platePagePath(role, applied.id)} className="link">
                    Ver placa
                  </Link>
                </p>
              )}

              <details className="mt-4 text-xs text-ink-soft">
                <summary className="cursor-pointer font-semibold">
                  Informações técnicas
                </summary>
                <dl className="mt-2 grid gap-1 sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-x-3">
                  {view.originalUrl && (
                    <>
                      <dt>Link original</dt>
                      <dd className="font-mono break-all">
                        {view.originalUrl}
                      </dd>
                    </>
                  )}
                  <dt>Place ID</dt>
                  <dd className="font-mono break-all">{view.place.placeId}</dd>
                </dl>
              </details>

              <UseInPlateDialog
                open={picking}
                role={role}
                reviewUrl={view.place.reviewUrl}
                placeName={view.place.name}
                onClose={() => setPicking(false)}
                onApplied={(plate) => {
                  setPicking(false);
                  setApplied(plate);
                }}
              />
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
