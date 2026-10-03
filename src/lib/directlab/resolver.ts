import "server-only";
import { DirectLabError } from "./errors";
import { withTimeout } from "./timeout";
import { assertPublicHost, defaultLookup, type LookupFn } from "./network";
import { REDIRECT_HOSTS, assertGoogleUrl, extractPlaceHints, hasHints, isFinalGoogleUrl, unwrapGoogleUrl, urlShape, type PlaceHints } from "./urls";

export interface ResolveOptions {
  fetch?: typeof fetch;
  lookup?: LookupFn;
  /** Tempo máximo de cada requisição. */
  requestTimeoutMs?: number;
  /** Tempo máximo da resolução inteira. */
  totalTimeoutMs?: number;
  maxRedirects?: number;
}

export interface ResolvedLink {
  finalUrl: string;
  hints: PlaceHints;
  /** Hosts percorridos (para log). */
  hops: string[];
}

/** Só o começo do HTML é lido, e só para achar um redirecionamento declarado. */
const META_REFRESH_MAX_BYTES = 32 * 1024;

/**
 * Resolve um link do Google (share.google, maps.app.goo.gl, goo.gl/maps,
 * g.page, URLs intermediárias e embrulhos) até a URL FINAL do Maps/Busca,
 * de onde saem as pistas do local. Proteção contra SSRF:
 *   · só HTTPS e só hosts da allowlist, revalidados a CADA salto ANTES de
 *     qualquer acesso à rede (inclusive destinos de embrulhos e meta refresh);
 *   · DNS conferido: host que resolve para IP privado/loopback/metadados é
 *     recusado; IP literal é recusado;
 *   · redirect manual (o fetch nunca segue sozinho), no máximo N saltos, e
 *     laço (a mesma URL de novo) é recusado;
 *   · timeout por requisição e total;
 *   · corpo: só em resposta 200 de HTML, no máximo 32 KB, e só para achar
 *     <meta http-equiv="refresh"> (um redirecionamento declarado, tratado
 *     como mais um salto). Nenhum dado do local é lido do HTML.
 * URLs que já são finais (ex.: google.com/maps/place/...) não geram nenhuma
 * requisição.
 */
export async function resolveGoogleLink(start: URL, options: ResolveOptions = {}): Promise<ResolvedLink> {
  const doFetch = options.fetch ?? fetch;
  const lookup = options.lookup ?? defaultLookup;
  const requestTimeoutMs = options.requestTimeoutMs ?? 4000;
  const deadline = Date.now() + (options.totalTimeoutMs ?? 8000);
  const maxRedirects = options.maxRedirects ?? 5;

  let current = assertGoogleUrl(start, REDIRECT_HOSTS);
  const hops: string[] = [current.hostname];
  const seen = new Set<string>();
  let redirects = 0;

  const advance = (next: URL) => {
    current = assertRedirect(next);
    hops.push(current.hostname);
    redirects++;
    if (redirects > maxRedirects) throw new DirectLabError("redirect_blocked", `mais de ${maxRedirects} redirecionamentos`);
  };

  for (;;) {
    const key = current.toString();
    if (seen.has(key)) throw new DirectLabError("redirect_blocked", `laço de redirecionamento em ${current.hostname}`);
    seen.add(key);

    // Embrulho (consent/continue, /url?q=): destino lido da própria URL, sem rede.
    const wrapped = unwrapGoogleUrl(current);
    if (wrapped) {
      advance(wrapped);
      continue;
    }
    // consent.google.com NUNCA é baixada: sem continue válido, não há o que resolver.
    if (current.hostname.toLowerCase() === "consent.google.com") {
      logUnrecognized(current, hops);
      return { finalUrl: current.toString(), hints: {}, hops };
    }
    // URL final do Maps/Busca: as pistas saem da própria URL.
    if (isFinalGoogleUrl(current)) {
      const hints = extractPlaceHints(current);
      if (!hasHints(hints)) logUnrecognized(current, hops);
      return { finalUrl: current.toString(), hints, hops };
    }

    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new DirectLabError("google_unavailable", "tempo total esgotado");
    await assertPublicHost(current.hostname, lookup);

    let outcome: { status: number; location: string | null; refresh: string | null };
    try {
      const target = current.toString();
      outcome = await withTimeout(Math.min(requestTimeoutMs, remaining), async (signal) => {
        const res = await doFetch(target, {
          method: "GET",
          redirect: "manual",
          cache: "no-store",
          headers: { "User-Agent": "DirectPlaca-DirectLab/1.0 (+link resolver)", Accept: "text/html" },
          signal,
        });
        let refresh: string | null = null;
        if (res.ok && /text\/html/i.test(res.headers.get("content-type") ?? "")) {
          refresh = findMetaRefresh(await readHead(res, META_REFRESH_MAX_BYTES));
        } else {
          await res.body?.cancel().catch(() => undefined);
        }
        return { status: res.status, location: res.headers.get("location"), refresh };
      });
    } catch (error) {
      if (error instanceof DirectLabError) throw error;
      throw new DirectLabError("google_unavailable", `falha ao acessar ${current.hostname}: ${(error as Error).message}`);
    }

    if (outcome.status >= 300 && outcome.status < 400) {
      if (!outcome.location) throw new DirectLabError("google_unavailable", `redirect sem Location em ${current.hostname}`);
      advance(parseNext(outcome.location, current));
      continue;
    }
    if (outcome.status >= 200 && outcome.status < 300) {
      if (outcome.refresh) {
        advance(parseNext(outcome.refresh, current));
        continue;
      }
      logUnrecognized(current, hops);
      return { finalUrl: current.toString(), hints: {}, hops };
    }
    if (outcome.status === 404) throw new DirectLabError("not_found", `${current.hostname} respondeu 404`);
    throw new DirectLabError("google_unavailable", `${current.hostname} respondeu ${outcome.status}`);
  }
}

function parseNext(location: string, base: URL): URL {
  try {
    return new URL(location, base);
  } catch {
    throw new DirectLabError("redirect_blocked", "destino de redirecionamento malformado");
  }
}

function assertRedirect(next: URL): URL {
  try {
    return assertGoogleUrl(next, REDIRECT_HOSTS);
  } catch (error) {
    // Destino fora do Google (ou protocolo/porta/credenciais indevidos) no meio da cadeia.
    throw new DirectLabError("redirect_blocked", (error as DirectLabError).detail ?? "destino não permitido");
  }
}

/** Lê no máximo `max` bytes do corpo e descarta o resto. */
async function readHead(res: Response, max: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < max) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      chunks.push(value);
      total += value.length;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const all = new Uint8Array(Math.min(total, max));
  let offset = 0;
  for (const c of chunks) {
    const part = c.subarray(0, Math.max(0, all.length - offset));
    all.set(part, offset);
    offset += part.length;
    if (offset >= all.length) break;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(all);
}

/** <meta http-equiv="refresh" content="0; url=…"> → URL (ou null). Nada mais é lido do HTML. */
export function findMetaRefresh(html: string): string | null {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    if (!/http-equiv\s*=\s*["']?refresh["']?/i.test(tag)) continue;
    const content = /content\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
    const value = content?.[2] ?? content?.[3] ?? content?.[4] ?? "";
    const url = /^\s*\d*\s*;?\s*url\s*=\s*['"]?([^'"\s]+)/i.exec(value)?.[1];
    if (url) return url.replace(/&amp;/g, "&");
  }
  return null;
}

/** Diagnóstico seguro: só a forma da URL (sem valores), para mapear formatos novos do Google. */
function logUnrecognized(url: URL, hops: string[]) {
  console.warn("directlab_link_unrecognized", { shape: urlShape(url), hops: hops.join(">") });
}
