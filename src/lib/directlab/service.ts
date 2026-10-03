import "server-only";
import { DirectLabError } from "./errors";
import { getPlaceDetails, searchPlaces, type PlaceSummary, type PlacesClientOptions } from "./places";
import { resolveGoogleLink, type ResolveOptions } from "./resolver";
import type { QuotaSnapshot } from "./types";
import { parseUserGoogleUrl, type PlaceHints } from "./urls";

export interface ReviewPlace {
  placeId: string;
  name: string;
  address: string | null;
  reviewUrl: string;
}

export interface Candidate {
  placeId: string;
  name: string;
  address: string | null;
  /** Comprovante assinado pelo servidor (reaproveita o link oficial já obtido na busca). */
  token?: string;
}

export type ReviewLinkResult =
  | { status: "found"; place: ReviewPlace; originalUrl: string | null }
  | { status: "choose"; candidates: Candidate[]; originalUrl: string | null }
  | { status: "not_identified"; originalUrl: string };

export interface ServiceDeps {
  places: PlacesClientOptions;
  resolve?: ResolveOptions;
}

const fold = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Os nomes batem? (igual, ou um contém o outro com pelo menos 4 caracteres). */
export function namesMatch(a: string, b: string): boolean {
  const x = fold(a);
  const y = fold(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.length >= 4 && ` ${long} `.includes(` ${short} `);
}

export function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

/** Raio para aceitar automaticamente um resultado quando o link traz o ponto no mapa. */
export const AUTO_SELECT_RADIUS_M = 150;

/**
 * Regra de escolha automática — só quando NÃO há ambiguidade:
 *   · com coordenadas no link: exatamente UM resultado com o mesmo nome a até 150 m;
 *   · sem coordenadas: a busca devolveu exatamente UM resultado e o nome bate.
 * Qualquer outra situação devolve a lista para o usuário escolher.
 */
export function pickUnambiguous(hints: PlaceHints, results: PlaceSummary[]): PlaceSummary | null {
  const label = hints.name ?? hints.query ?? "";
  const named = results.filter((r) => namesMatch(r.name, label));
  if (hints.lat !== undefined && hints.lng !== undefined) {
    const here = { lat: hints.lat, lng: hints.lng };
    const close = named.filter((r) => r.lat !== undefined && r.lng !== undefined && distanceMeters(here, { lat: r.lat, lng: r.lng }) <= AUTO_SELECT_RADIUS_M);
    return close.length === 1 ? close[0]! : null;
  }
  return results.length === 1 && named.length === 1 ? named[0]! : null;
}

/** Hosts aceitos para o link OFICIAL de avaliação (googleMapsLinks.writeAReviewUri). */
const REVIEW_HOSTS = new Set(["www.google.com", "google.com", "search.google.com", "maps.google.com", "g.page"]);

/** O link de avaliação veio do Google e aponta para o Google (HTTPS)? Nunca é montado à mão. */
export function isValidReviewUrl(value: string | null | undefined): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && REVIEW_HOSTS.has(url.hostname.toLowerCase()) && !url.username && !url.password;
  } catch {
    return false;
  }
}

/**
 * Cobrança da Avaliação Google (injetada pela rota; a regra vale no banco):
 *   check  → consulta SEM consumir, antes da chamada final ao Google;
 *   charge → cobrança atômica, SÓ depois que o link oficial foi obtido e validado.
 * Ambas lançam DirectLabError("daily_limit") quando não há cota.
 */
export interface GenerationGate {
  check: (placeId: string) => Promise<void>;
  charge: (placeId: string) => Promise<QuotaSnapshot | null>;
}

/**
 * Gera o link oficial de avaliação de um local JÁ identificado/escolhido:
 *   1. consulta a cota (sem consumir);
 *   2. obtém o writeAReviewUri (reaproveita o que a busca já trouxe; senão,
 *      Place Details);
 *   3. valida o link;
 *   4. SÓ ENTÃO cobra 1 utilização (atômico). Se a cobrança for recusada, o
 *      link não é entregue.
 * Qualquer erro antes do passo 4 não consome nada.
 */
export async function generateReviewLink(place: PlaceSummary | { placeId: string }, deps: ServiceDeps, gate?: GenerationGate): Promise<{ place: ReviewPlace; quota: QuotaSnapshot | null }> {
  await gate?.check(place.placeId);
  const known = "reviewUrl" in place && isValidReviewUrl(place.reviewUrl) ? place : null;
  const full = known ?? (await getPlaceDetails(deps.places, place.placeId));
  if (!isValidReviewUrl(full.reviewUrl)) throw new DirectLabError("review_link_unavailable", `sem writeAReviewUri válido para ${full.placeId}`);
  const quota = gate ? await gate.charge(full.placeId) : null;
  return { place: { placeId: full.placeId, name: full.name, address: full.address, reviewUrl: full.reviewUrl }, quota };
}

export type Identified =
  | { kind: "place"; place: PlaceSummary; by: "place_id" | "cid" | "match" }
  | { kind: "choose"; results: PlaceSummary[] }
  | { kind: "not_identified" };

/**
 * Link colado → qual estabelecimento? NUNCA cobra. Ordem:
 *   1. Place ID no link → Place Details (1 chamada; já traz o link oficial);
 *   2. CID no link (ex.: !1s0x…:0x…) → busca (nome + ponto do mapa) e o
 *      resultado cujo CID OFICIAL (googleMapsUri) é o mesmo é o local;
 *   3. sem identificador: mesma regra de antes (um único resultado com o
 *      mesmo nome perto do ponto, ou o único resultado com o nome igual);
 *   4. senão, lista de candidatos para o usuário escolher.
 */
export async function identifyFromLink(input: string, deps: ServiceDeps): Promise<{ identified: Identified; originalUrl: string }> {
  const url = parseUserGoogleUrl(input);
  const originalUrl = url.toString();
  const { hints } = await resolveGoogleLink(url, deps.resolve);

  if (hints.placeId) return { identified: { kind: "place", place: await getPlaceDetails(deps.places, hints.placeId), by: "place_id" }, originalUrl };
  const text = hints.name ?? hints.query;
  if (!text) return { identified: { kind: "not_identified" }, originalUrl };

  const near = hints.lat !== undefined && hints.lng !== undefined ? { lat: hints.lat, lng: hints.lng } : undefined;
  const results = await searchPlaces(deps.places, text, near);
  if (results.length === 0) return { identified: { kind: "not_identified" }, originalUrl };
  if (hints.cid) {
    const byCid = results.filter((r) => r.cid === hints.cid);
    if (byCid.length === 1) return { identified: { kind: "place", place: byCid[0]!, by: "cid" }, originalUrl };
  }
  const chosen = pickUnambiguous(hints, results);
  if (chosen) return { identified: { kind: "place", place: chosen, by: "match" }, originalUrl };
  return { identified: { kind: "choose", results: results.slice(0, 5) }, originalUrl };
}

export const toCandidates = (results: PlaceSummary[]): Candidate[] =>
  results.slice(0, 5).map((r) => ({ placeId: r.placeId, name: r.name, address: r.address }));

/** Link colado pelo usuário → link oficial de avaliação (ou lista para escolher). Sem cobrança (use o gate). */
export async function resolveReviewLink(input: string, deps: ServiceDeps, gate?: GenerationGate): Promise<ReviewLinkResult> {
  const { identified, originalUrl } = await identifyFromLink(input, deps);
  if (identified.kind === "place") return { status: "found", place: (await generateReviewLink(identified.place, deps, gate)).place, originalUrl };
  if (identified.kind === "choose") return { status: "choose", candidates: toCandidates(identified.results), originalUrl };
  return { status: "not_identified", originalUrl };
}

/** Pesquisa (nome e/ou endereço): SEMPRE devolve a lista para escolher (mesmo com 1 resultado). Nunca cobra. */
export async function searchPlacesForReview(query: string, deps: ServiceDeps): Promise<PlaceSummary[]> {
  const text = (query ?? "").replace(/\s+/g, " ").trim();
  if (text.length < 3 || text.length > 200) throw new DirectLabError("invalid_query");
  const results = await searchPlaces(deps.places, text);
  if (results.length === 0) throw new DirectLabError("not_found", `sem resultados para a pesquisa`);
  return results.slice(0, 5);
}

/** Compatível com a versão anterior: lista de candidatos. */
export async function searchReviewCandidates(query: string, deps: ServiceDeps): Promise<Candidate[]> {
  return toCandidates(await searchPlacesForReview(query, deps));
}

/** Local escolhido → link oficial de avaliação (consultado no Google, nunca aceito do navegador). */
export async function reviewLinkForPlace(placeId: string, deps: ServiceDeps, gate?: GenerationGate): Promise<ReviewPlace> {
  return (await generateReviewLink({ placeId }, deps, gate)).place;
}
