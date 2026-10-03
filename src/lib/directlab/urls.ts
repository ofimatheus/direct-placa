/**
 * Validação de links do Google e extração de pistas do estabelecimento a
 * partir da PRÓPRIA URL (sem baixar nem ler HTML). Puro e seguro para o
 * navegador: a interface usa as mesmas regras para avisar antes de enviar.
 */
import { DirectLabError } from "./errors";

/** Hosts aceitos como ENTRADA do usuário. */
export const INPUT_HOSTS = new Set([
  "share.google",
  "maps.app.goo.gl",
  "goo.gl",
  "g.page",
  "google.com",
  "www.google.com",
  "maps.google.com",
  "google.com.br",
  "www.google.com.br",
  "maps.google.com.br",
]);

/** Hosts aceitos como DESTINO de redirecionamento (a consent.google.com nunca é baixada: só lemos o parâmetro continue). */
export const REDIRECT_HOSTS = new Set([...INPUT_HOSTS, "consent.google.com"]);

/** Encurtadores/compartilhamento: o único tipo de link que precisa ser resolvido pela rede. */
export const SHORTENER_HOSTS = new Set(["share.google", "maps.app.goo.gl", "goo.gl", "g.page"]);

type HostList = ReadonlySet<string>;

/**
 * Valida uma URL do ecossistema Google: só HTTPS, host exato da allowlist
 * (sem subdomínios curinga, sem IP), sem usuário/senha, sem porta explícita.
 * goo.gl só vale para /maps (o encurtador genérico goo.gl não é aceito).
 */
export function assertGoogleUrl(url: URL, hosts: HostList): URL {
  if (url.protocol !== "https:") throw new DirectLabError("domain_not_allowed", `protocolo ${url.protocol}`);
  if (url.username || url.password) throw new DirectLabError("domain_not_allowed", "credenciais na URL");
  if (url.port && url.port !== "443") throw new DirectLabError("domain_not_allowed", `porta ${url.port}`);
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!hosts.has(host)) throw new DirectLabError("domain_not_allowed", `host ${host}`);
  if (host === "goo.gl" && !url.pathname.startsWith("/maps")) throw new DirectLabError("domain_not_allowed", "goo.gl fora de /maps");
  return url;
}

/** Entrada do usuário → URL validada. Erros: invalid_url | domain_not_allowed. */
export function parseUserGoogleUrl(input: string): URL {
  const raw = (input ?? "").trim();
  if (!raw || raw.length > 2048 || /\s/.test(raw)) throw new DirectLabError("invalid_url", "vazia, longa ou com espaços");
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`);
  } catch {
    throw new DirectLabError("invalid_url", "URL malformada");
  }
  if (!url.hostname.includes(".")) throw new DirectLabError("invalid_url", "sem domínio");
  return assertGoogleUrl(url, INPUT_HOSTS);
}

export interface PlaceHints {
  /** Place ID explícito no link (ex.: query_place_id=ChIJ..., !1sChIJ...). */
  placeId?: string;
  /**
   * CID do local (identificador numérico do Google Maps), de ?cid=, ftid= ou
   * !1s0x…:0x… (a parte depois de ":" em hexadecimal). A Places API devolve o
   * mesmo CID em googleMapsUri — permite CONFIRMAR um resultado da busca.
   */
  cid?: string;
  /** Identificador do Knowledge Graph (/g/…), quando o link traz. Só informativo. */
  kgmid?: string;
  /** Nome do local no caminho /maps/place/<nome>. */
  name?: string;
  /** Texto de busca (q=, query=, /maps/search/<texto>) — só em URLs finais. */
  query?: string;
  lat?: number;
  lng?: number;
}

const PLACE_ID_RE = /^[A-Za-z0-9_-]{10,512}$/;
const decodeSegment = (value: string) => {
  try {
    return decodeURIComponent(value.replace(/\+/g, " ")).trim();
  } catch {
    return "";
  }
};
const clean = (value: string | null | undefined) => {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  return text && text.length <= 300 ? text : undefined;
};
const validCoords = (lat: number, lng: number) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
const COORDS_ONLY = /^-?\d+(\.\d+)?,\s*-?\d+(\.\d+)?$/;

/** Hexadecimal do Maps (0x…) → CID decimal. */
function cidFromHex(hex: string): string | undefined {
  if (!/^[0-9a-f]{1,16}$/i.test(hex)) return undefined;
  const value = BigInt(`0x${hex}`);
  return value > BigInt(0) ? value.toString() : undefined;
}

/** Tem algo para identificar o local? */
export function hasHints(hints: PlaceHints): boolean {
  return Boolean(hints.placeId || hints.cid || hints.name || hints.query);
}

const hostOf = (url: URL) => url.hostname.toLowerCase().replace(/\.$/, "");

/**
 * URL FINAL do Google (Maps ou Busca), que já descreve o local. Qualquer
 * outra URL do Google (ex.: www.google.com/share.google?q=<código>) é
 * INTERMEDIÁRIA: precisa ser seguida, e seus parâmetros não são lidos como
 * nome do local (um código opaco em q= não é texto de busca).
 */
export function isFinalGoogleUrl(url: URL): boolean {
  const host = hostOf(url);
  if (SHORTENER_HOSTS.has(host) || host === "consent.google.com") return false;
  if (host.startsWith("maps.google.")) return true;
  const path = url.pathname;
  return path === "/maps" || path.startsWith("/maps/") || path === "/search" || url.searchParams.has("cid");
}

/**
 * Embrulhos de redirecionamento do Google cujo destino está na própria URL
 * (lido, nunca baixado): consent.google.com/?continue=… e /url?q=… (ou url=).
 * O destino é revalidado pela allowlist; null = não é embrulho ou destino inválido.
 */
export function unwrapGoogleUrl(url: URL): URL | null {
  const host = hostOf(url);
  let target: string | null = null;
  if (host === "consent.google.com") target = url.searchParams.get("continue");
  else if (!SHORTENER_HOSTS.has(host) && url.pathname === "/url") target = url.searchParams.get("q") ?? url.searchParams.get("url");
  if (!target) return null;
  try {
    // Destino pode ser outro embrulho (ex.: /url?q=consent…?continue=…): vale a lista de saltos.
    return assertGoogleUrl(new URL(target), REDIRECT_HOSTS);
  } catch {
    return null;
  }
}

/**
 * Lê o que uma URL FINAL do Google já diz sobre o local (sem rede, sem HTML):
 *   /maps/place/<nome>/@lat,lng,…/data=…!1sChIJ… | !1s0x…:0x<cid> …!3d<lat>!4d<lng>…!16s/g/<kgmid>
 *   /maps/search/<texto>   /maps?q=<texto>   /maps?cid=<n>   /maps?ftid=0x…:0x…
 *   /maps/search/?api=1&query=…&query_place_id=ChIJ…   ?q=place_id:ChIJ…
 *   /search?q=<nome e endereço>&kgmid=/g/…   maps.google.com/?cid=<n>
 *   consent.google.com/?continue=…  e  /url?q=…  (desembrulhados, nunca baixados)
 * URLs intermediárias devolvem {} (precisam ser seguidas).
 */
export function extractPlaceHints(url: URL, depth = 0): PlaceHints {
  const wrapped = unwrapGoogleUrl(url);
  if (wrapped) return depth > 2 ? {} : extractPlaceHints(wrapped, depth + 1);
  if (!isFinalGoogleUrl(url)) return {};

  const hints: PlaceHints = {};
  const params = url.searchParams;
  const path = url.pathname;

  for (const key of ["query_place_id", "place_id"]) {
    const value = params.get(key);
    if (value && PLACE_ID_RE.test(value)) hints.placeId = value;
  }
  const q = clean(params.get("q") ?? params.get("query"));
  if (q?.toLowerCase().startsWith("place_id:")) {
    const id = q.slice("place_id:".length).trim();
    if (PLACE_ID_RE.test(id)) hints.placeId = id;
  } else if (q && !COORDS_ONLY.test(q)) {
    hints.query = q;
  }

  const place = /\/maps\/place\/([^/]+)/.exec(path);
  if (place) {
    const name = clean(decodeSegment(place[1]!));
    if (name && !COORDS_ONLY.test(name)) hints.name = name;
  }
  const search = /\/maps\/search\/([^/]+)/.exec(path);
  if (search && !hints.query) {
    const text = clean(decodeSegment(search[1]!));
    if (text && !COORDS_ONLY.test(text)) hints.query = text;
  }

  const dataPlaceId = /!1s(ChIJ[A-Za-z0-9_-]{10,500})/.exec(path);
  if (dataPlaceId && !hints.placeId) hints.placeId = dataPlaceId[1];

  const cidParam = params.get("cid");
  if (cidParam && /^\d{1,22}$/.test(cidParam) && cidParam !== "0") hints.cid = cidParam;
  const ftid = /^0x[0-9a-f]{1,16}:0x([0-9a-f]{1,16})$/i.exec(params.get("ftid") ?? "") ?? /!1s0x[0-9a-f]{1,16}:0x([0-9a-f]{1,16})/i.exec(path);
  if (ftid && !hints.cid) hints.cid = cidFromHex(ftid[1]!);
  if (!hints.cid) delete hints.cid;

  const kg = params.get("kgmid") ?? (/!16s((?:%2F|\/)[gm](?:%2F|\/)[A-Za-z0-9_]{2,40})/i.exec(path)?.[1] ?? null);
  const kgmid = kg ? decodeSegment(kg) : "";
  if (/^\/[gm]\/[A-Za-z0-9_]{2,40}$/.test(kgmid)) hints.kgmid = kgmid;

  const pin = /!3d(-?\d{1,3}\.\d+)!4d(-?\d{1,3}\.\d+)/.exec(path);
  const at = /@(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/.exec(path);
  const ll = /^(-?\d{1,3}\.\d+),\s*(-?\d{1,3}\.\d+)$/.exec(params.get("ll") ?? "");
  const coords = pin ?? at ?? ll;
  if (coords) {
    const lat = Number(coords[1]);
    const lng = Number(coords[2]);
    if (validCoords(lat, lng)) {
      hints.lat = lat;
      hints.lng = lng;
    }
  }
  return hints;
}

/**
 * Forma de uma URL para diagnóstico (log): host, caminho com trechos
 * variáveis trocados por ":x" e só os NOMES dos parâmetros — nunca valores.
 */
export function urlShape(url: URL): string {
  const path = url.pathname
    .split("/")
    .map((seg, i) => (i === 0 || /^(maps|place|search|url|dir|share\.google)$/.test(seg) ? seg : seg ? ":x" : ""))
    .join("/");
  const names = [...new Set([...url.searchParams.keys()])].sort().join(",");
  return `${hostOf(url)}${path}${names ? `?${names}` : ""}`;
}
