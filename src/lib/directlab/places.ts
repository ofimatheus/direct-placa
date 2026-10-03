import "server-only";
import { DirectLabError } from "./errors";
import { withTimeout } from "./timeout";

/**
 * Cliente mínimo da Google Places API (New) — documentação oficial:
 *   Place Details: GET  https://places.googleapis.com/v1/places/{placeId}
 *   Text Search:   POST https://places.googleapis.com/v1/places:searchText
 * A chave vai no cabeçalho X-Goog-Api-Key (nunca na URL) e cada chamada
 * declara um FieldMask com só o necessário (o custo depende dos campos).
 */
const BASE = "https://places.googleapis.com/v1";
const DETAILS_FIELDS = "id,displayName,formattedAddress,googleMapsLinks";
// googleMapsUri traz o CID oficial do local (confirma o local de um link do Maps).
const SEARCH_FIELDS = "places.id,places.displayName,places.formattedAddress,places.location,places.googleMapsLinks,places.googleMapsUri";

export interface PlaceSummary {
  placeId: string;
  name: string;
  address: string | null;
  lat?: number;
  lng?: number;
  /** googleMapsLinks.writeAReviewUri, quando a API fornece. */
  reviewUrl: string | null;
  /** CID oficial (de googleMapsUri ...?cid=<n>), quando a API fornece. */
  cid?: string;
}

interface ApiPlace {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
  googleMapsLinks?: { writeAReviewUri?: string };
  googleMapsUri?: string;
}

export interface PlacesClientOptions {
  apiKey: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  /** Executado antes de CADA chamada à Places API (o DirectLab consome aqui a cota diária). */
  beforeRequest?: () => Promise<void>;
}

function cidOf(uri: string | undefined): string | undefined {
  const cid = typeof uri === "string" ? /[?&]cid=(\d{1,22})(?:&|$)/.exec(uri)?.[1] : undefined;
  return cid && cid !== "0" ? cid : undefined;
}

function toSummary(place: ApiPlace): PlaceSummary | null {
  if (!place.id) return null;
  const review = place.googleMapsLinks?.writeAReviewUri;
  return {
    placeId: place.id,
    name: place.displayName?.text?.trim() || "Estabelecimento sem nome",
    address: place.formattedAddress?.trim() || null,
    lat: place.location?.latitude,
    lng: place.location?.longitude,
    reviewUrl: typeof review === "string" && review.startsWith("https://") ? review : null,
    ...(cidOf(place.googleMapsUri) ? { cid: cidOf(place.googleMapsUri) } : {}),
  };
}

async function call(options: PlacesClientOptions, path: string, init: RequestInit & { fieldMask: string }): Promise<unknown> {
  const doFetch = options.fetch ?? fetch;
  await options.beforeRequest?.();
  let response: Response;
  let json: { error?: { status?: string; message?: string } };
  try {
    [response, json] = await withTimeout(options.timeoutMs ?? 6000, async (signal) => {
      const res = await doFetch(`${BASE}${path}`, {
        method: init.method,
        body: init.body,
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": options.apiKey,
          "X-Goog-FieldMask": init.fieldMask,
        },
        signal,
      });
      // Resposta da Places API é JSON pequeno; limite defensivo de 256 KB.
      const text = await res.text();
      if (text.length > 256 * 1024) throw new Error("resposta grande demais");
      let parsed: { error?: { status?: string; message?: string } } = {};
      try {
        parsed = text ? JSON.parse(text) : {};
      } catch {
        parsed = {};
      }
      return [res, parsed] as const;
    });
  } catch (error) {
    throw new DirectLabError("google_unavailable", `Places API inacessível: ${(error as Error).message}`);
  }
  if (response.ok) return json;
  const status = json.error?.status ?? "";
  const detail = `Places API ${response.status} ${status}: ${json.error?.message ?? ""}`.slice(0, 400);
  if (response.status === 429 || status === "RESOURCE_EXHAUSTED") throw new DirectLabError("quota_exceeded", detail);
  if (response.status === 404 || status === "NOT_FOUND") throw new DirectLabError("not_found", detail);
  if (response.status === 400 && path.startsWith("/places/")) throw new DirectLabError("not_found", detail); // Place ID inválido
  if (response.status === 401 || response.status === 403 || status === "PERMISSION_DENIED" || status === "UNAUTHENTICATED") {
    throw new DirectLabError("google_denied", detail);
  }
  throw new DirectLabError("google_unavailable", detail);
}

export async function getPlaceDetails(options: PlacesClientOptions, placeId: string): Promise<PlaceSummary> {
  if (!/^[A-Za-z0-9_-]{10,512}$/.test(placeId)) throw new DirectLabError("not_found", "Place ID com formato inválido");
  const json = (await call(options, `/places/${encodeURIComponent(placeId)}?languageCode=pt-BR&regionCode=BR`, {
    method: "GET",
    fieldMask: DETAILS_FIELDS,
  })) as ApiPlace;
  const summary = toSummary(json);
  if (!summary) throw new DirectLabError("not_found", "Place Details sem id");
  return summary;
}

export async function searchPlaces(
  options: PlacesClientOptions,
  textQuery: string,
  near?: { lat: number; lng: number },
): Promise<PlaceSummary[]> {
  const body: Record<string, unknown> = { textQuery, languageCode: "pt-BR", regionCode: "BR", pageSize: 5 };
  if (near) body.locationBias = { circle: { center: { latitude: near.lat, longitude: near.lng }, radius: 1000 } };
  const json = (await call(options, "/places:searchText", {
    method: "POST",
    body: JSON.stringify(body),
    fieldMask: SEARCH_FIELDS,
  })) as { places?: ApiPlace[] };
  return (json.places ?? []).map(toSummary).filter((p): p is PlaceSummary => p !== null);
}
