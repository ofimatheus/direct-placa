/**
 * DirectLab · Avaliação Google: validação de links, proteção SSRF,
 * resolução de redirects, Places API (New), regra de escolha e handler.
 * Rede e DNS simulados: nenhum acesso real ao Google.
 *   npm run test:directlab
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildApplyRequest } from "@/lib/directlab/apply";
import { DirectLabError } from "@/lib/directlab/errors";
import { directLabErrorResponse, handleGoogleReviewRequest } from "@/lib/directlab/handler";
import { isForbiddenAddress } from "@/lib/directlab/network";
import { getPlaceDetails, searchPlaces } from "@/lib/directlab/places";
import { resolveGoogleLink } from "@/lib/directlab/resolver";
import { pickUnambiguous, resolveReviewLink, searchReviewCandidates } from "@/lib/directlab/service";
import { extractPlaceHints, parseUserGoogleUrl } from "@/lib/directlab/urls";

let failures = 0;
let finished = false;
const ok = (label: string) => console.log(`OK ${label}`);
const check = (cond: unknown, label: string, detail?: unknown) => {
  if (!cond) {
    failures++;
    console.log(`FALHA ${label}`, detail ?? "");
  }
};
async function code(promise: Promise<unknown> | (() => unknown)): Promise<string> {
  try {
    await (typeof promise === "function" ? promise() : promise);
    return "sem erro";
  } catch (error) {
    return error instanceof DirectLabError ? error.code : `erro inesperado: ${(error as Error).message}`;
  }
}

const KEY = "AIzaSy-TESTE-NAO-REAL-123";
const PUBLIC_LOOKUP = async () => ["142.250.79.46"];
const MAPS_PLACE =
  "https://www.google.com/maps/place/Adega+Monster/@-23.5,-46.8,17z/data=!3m1!4b1!4m6!3m5!1s0x94cf01:0xabc!8m2!3d-23.5012!4d-46.8765!16s%2Fg%2F11abc";
const REVIEW_URL = "https://search.google.com/local/writereview?placeid=ChIJadegaMonster0001";

type Route = (url: URL, init: RequestInit) => Response | Promise<Response>;
function fakeFetch(route: Route, log: { url: string; init: RequestInit }[] = []) {
  return (async (input: string | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    log.push({ url: url.toString(), init });
    return route(url, init);
  }) as typeof fetch;
}
const redirect = (location: string, status = 302) => new Response(null, { status, headers: { location } });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const place = (id: string, name: string, lat: number, lng: number, review: string | null = `https://search.google.com/local/writereview?placeid=${id}`) => ({
  id,
  displayName: { text: name },
  formattedAddress: `${name}, Av. Exemplo, 123 - Barueri`,
  location: { latitude: lat, longitude: lng },
  ...(review ? { googleMapsLinks: { writeAReviewUri: review } } : {}),
});

async function main() {
  // ---------------- U: links aceitos e recusados ----------------
  for (const good of ["https://share.google/UHvh2Pg8JPeIykuoO", "share.google/UHvh2Pg8JPeIykuoO", "https://maps.app.goo.gl/AbC123", MAPS_PLACE, "https://www.google.com.br/maps/place/Padaria", "https://goo.gl/maps/xyz", "https://g.page/r/CabcDEF/review"]) {
    check((await code(() => parseUserGoogleUrl(good))) === "sem erro", `U1 deveria aceitar ${good}`);
  }
  ok("U1: share.google (com ou sem https://), maps.app.goo.gl, google.com/maps, google.com.br, goo.gl/maps e g.page são aceitos");

  const refused: [string, string][] = [
    ["https://evil.com/maps/place/x", "domain_not_allowed"],
    ["https://share.google.evil.com/x", "domain_not_allowed"],
    ["https://evil.com/?u=https://share.google/x", "domain_not_allowed"],
    ["https://notgoogle.com/maps", "domain_not_allowed"],
    ["https://xn--ggle-0nda.com/maps", "domain_not_allowed"],
    ["https://goo.gl/abc123", "domain_not_allowed"],
    ["http://share.google/abc", "domain_not_allowed"],
    ["javascript:alert(1)", "invalid_url"],
    ["https://user:pass@www.google.com/maps", "domain_not_allowed"],
    ["https://www.google.com:8443/maps", "domain_not_allowed"],
    ["https://127.0.0.1/maps", "domain_not_allowed"],
    ["https://[::1]/maps", "invalid_url"],
    ["não é um link", "invalid_url"],
    ["https://", "invalid_url"],
    ["", "invalid_url"],
    ["https://share.google/" + "a".repeat(2100), "invalid_url"],
  ];
  for (const [input, expected] of refused) {
    const got = await code(() => parseUserGoogleUrl(input));
    check(got === expected, `U2 ${input.slice(0, 50)} → ${got}`, expected);
  }
  ok("U2: domínio externo, subdomínio falso, homógrafo, goo.gl genérico, http, javascript:, credenciais, porta, IP e URL malformada são recusados");

  // ---------------- H: pistas lidas da URL ----------------
  const h1 = extractPlaceHints(new URL(MAPS_PLACE));
  check(h1.name === "Adega Monster" && h1.lat === -23.5012 && h1.lng === -46.8765 && !h1.placeId, "H1 maps/place", h1);
  const h2 = extractPlaceHints(new URL("https://www.google.com/maps/search/?api=1&query=Adega%20Monster&query_place_id=ChIJadegaMonster0001"));
  check(h2.placeId === "ChIJadegaMonster0001" && h2.query === "Adega Monster", "H2 query_place_id", h2);
  const h3 = extractPlaceHints(new URL("https://www.google.com/search?q=Adega+Monster+Barueri&kgmid=/g/11x"));
  check(h3.query === "Adega Monster Barueri" && !h3.lat, "H3 search?q", h3);
  const h4 = extractPlaceHints(new URL("https://consent.google.com/ml?continue=https://www.google.com/maps/place/Padaria+Sol/@-23.1,-46.2,15z"));
  check(h4.name === "Padaria Sol" && h4.lat === -23.1, "H4 consent continue", h4);
  const h5 = extractPlaceHints(new URL("https://consent.google.com/ml?continue=https://evil.com/maps/place/X"));
  check(!h5.name && !h5.query, "H5 continue externo ignorado", h5);
  ok("H1–H5: nome, coordenadas, Place ID e busca são lidos da URL (sem baixar HTML); continue externo é ignorado");

  // ---------------- R: resolução de redirects e SSRF ----------------
  {
    const log: { url: string; init: RequestInit }[] = [];
    const r = await resolveGoogleLink(new URL(MAPS_PLACE), { fetch: fakeFetch(() => json({}), log), lookup: PUBLIC_LOOKUP });
    check(log.length === 0 && r.hints.name === "Adega Monster", "R1 link maps não deveria acessar a rede", log);
  }
  {
    let cancelled = false;
    let read = false;
    const body = new ReadableStream({
      pull() {
        read = true;
      },
      cancel() {
        cancelled = true;
      },
    }, { highWaterMark: 0 }); // só puxa dados se alguém realmente ler
    const log: { url: string; init: RequestInit }[] = [];
    const r = await resolveGoogleLink(new URL("https://share.google/UHvh2Pg8JPeIykuoO"), {
      lookup: PUBLIC_LOOKUP,
      fetch: fakeFetch((url) =>
        url.hostname === "share.google"
          ? new Response(body, { status: 302, headers: { location: "https://www.google.com/search?q=Adega+Monster+Barueri&kgmid=/g/11x" } })
          : json({}),
      log),
    });
    check(r.hints.query === "Adega Monster Barueri" && log.length === 1 && log[0]!.init.redirect === "manual", "R2 share.google", { r, log });
    check(cancelled && !read, "R2 o corpo da resposta foi lido", { cancelled, read });
  }
  {
    const r = await resolveGoogleLink(new URL("https://maps.app.goo.gl/AbC123"), {
      lookup: PUBLIC_LOOKUP,
      fetch: fakeFetch((url) => (url.hostname === "maps.app.goo.gl" ? redirect(MAPS_PLACE, 301) : json({}))),
    });
    check(r.hints.name === "Adega Monster", "R3 maps.app.goo.gl", r);
  }
  ok("R1–R3: google.com/maps resolve sem rede; share.google e maps.app.goo.gl seguem redirect manual; o corpo nunca é lido");

  const ssrf: [string, string][] = [
    ["https://evil.com/steal", "redirect_blocked"],
    ["http://www.google.com/maps/place/X", "redirect_blocked"],
    ["https://127.0.0.1/admin", "redirect_blocked"],
    ["https://localhost/admin", "redirect_blocked"],
    ["https://169.254.169.254/latest/meta-data/", "redirect_blocked"],
    ["https://metadata.google.internal/computeMetadata/v1/", "redirect_blocked"],
    ["https://www.google.com:8080/maps", "redirect_blocked"],
    ["https://admin:x@www.google.com/maps/place/X", "redirect_blocked"],
    ["file:///etc/passwd", "redirect_blocked"],
    ["https://www.google.com.evil.com/maps/place/X", "redirect_blocked"],
  ];
  for (const [location, expected] of ssrf) {
    const log: { url: string; init: RequestInit }[] = [];
    const got = await code(
      resolveGoogleLink(new URL("https://share.google/x"), {
        lookup: PUBLIC_LOOKUP,
        fetch: fakeFetch((url) => (url.hostname === "share.google" ? redirect(location) : json({ vazou: true })), log),
      }),
    );
    check(got === expected && log.length === 1, `R4 redirect para ${location} → ${got}`, log.map((l) => l.url));
  }
  ok("R4: redirect para domínio externo, http, localhost, 127.0.0.1, 169.254.169.254, metadata.google.internal, outra porta, credenciais, file: e domínio parecido é bloqueado ANTES de acessar");

  for (const address of ["10.0.0.5", "192.168.1.10", "172.20.0.1", "127.0.0.1", "169.254.169.254", "100.64.0.1", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1"]) {
    const log: { url: string; init: RequestInit }[] = [];
    const got = await code(resolveGoogleLink(new URL("https://share.google/x"), { lookup: async () => [address], fetch: fakeFetch(() => redirect(MAPS_PLACE), log) }));
    check(got === "redirect_blocked" && log.length === 0 && isForbiddenAddress(address), `R5 DNS ${address} → ${got}`);
  }
  check(!isForbiddenAddress("142.250.79.46") && !isForbiddenAddress("2800:3f0:4001:80a::200e"), "R5 IP público do Google recusado");
  ok("R5: host do Google que resolve para IP privado, loopback, link-local/metadados, CGNAT ou IPv6 interno é recusado sem nenhuma requisição");

  {
    const got = await code(resolveGoogleLink(new URL("https://share.google/loop"), { lookup: PUBLIC_LOOKUP, fetch: fakeFetch(() => redirect("https://share.google/loop")) }));
    check(got === "redirect_blocked", "R6 loop", got);
    const started = Date.now();
    const hang = fakeFetch((_url, init) => new Promise<Response>((_, reject) => init.signal?.addEventListener("abort", () => reject(new Error("abortado")))));
    const slow = await code(resolveGoogleLink(new URL("https://share.google/slow"), { lookup: PUBLIC_LOOKUP, fetch: hang, requestTimeoutMs: 300 }));
    check(slow === "google_unavailable" && Date.now() - started < 2000, `R6 timeout (${Date.now() - started} ms)`, slow);
    const plain = await code(resolveGoogleLink(new URL("https://share.google/x"), { lookup: PUBLIC_LOOKUP, fetch: fakeFetch(() => new Response("<html>", { status: 200 })) }));
    check(plain === "sem erro", "R6 página final sem pistas", plain);
  }
  ok("R6: limite de redirecionamentos, timeout e página final sem pistas tratados");

  // ---------------- P: Places API (New) ----------------
  {
    const log: { url: string; init: RequestInit }[] = [];
    const f = fakeFetch(() => json(place("ChIJadegaMonster0001", "Adega Monster", -23.5012, -46.8765, REVIEW_URL)), log);
    const details = await getPlaceDetails({ apiKey: KEY, fetch: f }, "ChIJadegaMonster0001");
    const headers = log[0]!.init.headers as Record<string, string>;
    check(details.reviewUrl === REVIEW_URL && details.name === "Adega Monster", "P1 detalhes", details);
    check(log[0]!.url.startsWith("https://places.googleapis.com/v1/places/ChIJadegaMonster0001") && !log[0]!.url.includes(KEY), "P1 URL oficial e chave fora da URL", log[0]!.url);
    check(headers["X-Goog-Api-Key"] === KEY && headers["X-Goog-FieldMask"]!.includes("googleMapsLinks"), "P1 cabeçalhos", headers);
    ok("P1: Place Details (New) com a chave só no cabeçalho X-Goog-Api-Key e FieldMask com googleMapsLinks; o link vem de writeAReviewUri");
  }
  const googleError = async (status: number, errStatus: string) =>
    code(getPlaceDetails({ apiKey: KEY, fetch: fakeFetch(() => json({ error: { code: status, status: errStatus, message: "x" } }, status)) }, "ChIJadegaMonster0001"));
  check((await googleError(429, "RESOURCE_EXHAUSTED")) === "quota_exceeded", "P2 cota");
  check((await googleError(403, "PERMISSION_DENIED")) === "google_denied", "P2 chave recusada");
  check((await googleError(404, "NOT_FOUND")) === "not_found", "P2 não encontrado");
  check((await googleError(503, "UNAVAILABLE")) === "google_unavailable", "P2 5xx");
  check(
    (await code(getPlaceDetails({ apiKey: KEY, fetch: fakeFetch(() => Promise.reject(new Error("ECONNRESET"))) }, "ChIJadegaMonster0001"))) === "google_unavailable",
    "P2 rede",
  );
  ok("P2: erros do Google mapeados: cota (429), chave/API recusada (403), não encontrado, indisponível e falha de rede");

  // ---------------- S: regra de escolha e serviço ----------------
  const monster = { placeId: "ChIJadegaMonster0001", name: "Adega Monster", address: "a", lat: -23.5012, lng: -46.8765, reviewUrl: REVIEW_URL };
  const monster2 = { ...monster, placeId: "ChIJadegaMonster0002", lat: -23.6, lng: -46.9 };
  const other = { ...monster, placeId: "ChIJoutraAdega00001", name: "Adega Central", lat: -23.50125, lng: -46.87655 };
  check(pickUnambiguous({ name: "Adega Monster", lat: -23.5012, lng: -46.8765 }, [monster, other])?.placeId === monster.placeId, "S1 1 com mesmo nome a < 150 m");
  check(pickUnambiguous({ name: "Adega Monster", lat: -23.5012, lng: -46.8765 }, [monster, { ...monster, placeId: "ChIJgemeo000000001" }]) === null, "S1 dois iguais no mesmo ponto");
  check(pickUnambiguous({ query: "Adega Monster" }, [monster, monster2]) === null, "S1 dois resultados sem coordenadas");
  check(pickUnambiguous({ query: "Adega Monster Barueri" }, [monster])?.placeId === monster.placeId, "S1 um resultado com nome contido na busca");
  check(pickUnambiguous({ query: "Padaria Sol" }, [monster]) === null, "S1 um resultado com outro nome");
  ok("S1: escolha automática só com correspondência única (mesmo nome e mesmo ponto, ou busca com um só resultado de mesmo nome)");

  const places = (results: ReturnType<typeof place>[], detailsOverride?: ReturnType<typeof place>) =>
    fakeFetch((url) => {
      if (url.pathname === "/v1/places:searchText") return json({ places: results });
      if (url.pathname.startsWith("/v1/places/")) return json(detailsOverride ?? results[0] ?? {});
      if (url.hostname === "share.google") return redirect("https://www.google.com/search?q=Adega+Monster");
      return json({});
    });
  const deps = (f: typeof fetch) => ({ places: { apiKey: KEY, fetch: f }, resolve: { fetch: f, lookup: PUBLIC_LOOKUP } });

  const found = await resolveReviewLink(MAPS_PLACE, deps(places([place("ChIJadegaMonster0001", "Adega Monster", -23.5012, -46.8765, REVIEW_URL)])));
  check(found.status === "found" && found.place.reviewUrl === REVIEW_URL && found.place.placeId === "ChIJadegaMonster0001", "S2 encontrado", found);
  const viaShare = await resolveReviewLink("https://share.google/UHvh2Pg8JPeIykuoO", deps(places([place("ChIJadegaMonster0001", "Adega Monster", -23.5, -46.8, REVIEW_URL)])));
  check(viaShare.status === "found" && viaShare.originalUrl === "https://share.google/UHvh2Pg8JPeIykuoO", "S2 via share.google", viaShare);
  ok("S2: link do Google Maps e link share.google chegam ao link oficial de avaliação (writeAReviewUri)");

  const ambiguous = await resolveReviewLink("https://share.google/x", deps(places([place("ChIJadegaMonster0001", "Adega Monster", -23.5, -46.8), place("ChIJadegaMonster0002", "Adega Monster", -23.7, -46.6)])));
  check(ambiguous.status === "choose" && ambiguous.candidates.length === 2 && !("place" in ambiguous), "S3 ambíguo", ambiguous);
  const nothing = await resolveReviewLink(MAPS_PLACE, deps(places([])));
  check(nothing.status === "not_identified", "S3 nada encontrado", nothing);
  const noHints = await resolveReviewLink("https://share.google/x", deps(fakeFetch(() => new Response("ok"))));
  check(noHints.status === "not_identified", "S3 sem pistas", noHints);
  const noReview = await code(resolveReviewLink(MAPS_PLACE, deps(places([place("ChIJadegaMonster0001", "Adega Monster", -23.5012, -46.8765, null)], place("ChIJadegaMonster0001", "Adega Monster", -23.5012, -46.8765, null)))));
  check(noReview === "review_link_unavailable", "S3 sem writeAReviewUri não inventa link", noReview);
  const manual = await searchReviewCandidates("Adega Monster", deps(places([place("ChIJadegaMonster0001", "Adega Monster", -23.5, -46.8)])));
  check(manual.length === 1 && !("reviewUrl" in manual[0]!), "S3 pesquisa manual sempre pede escolha", manual);
  ok("S3: ambíguo devolve lista (nada escolhido); sem resultado ou sem pistas pede pesquisa; sem writeAReviewUri não inventa link; pesquisa manual sempre pede escolha");

  // ---------------- K: handler (chave, cota, erros) ----------------
  let consumed = 0;
  const consumeQuota = async () => void consumed++;
  const noKey = await code(handleGoogleReviewRequest({ action: "resolve", url: MAPS_PLACE }, { apiKey: null, consumeQuota }));
  check(noKey === "not_configured" && consumed === 0, "K1 sem chave", { noKey, consumed });
  const bad = await code(handleGoogleReviewRequest({ action: "resolve", url: "https://evil.com/x" }, { apiKey: KEY, consumeQuota }));
  const badQuery = await code(handleGoogleReviewRequest({ action: "search", query: "a" }, { apiKey: KEY, consumeQuota }));
  check(bad === "domain_not_allowed" && badQuery === "invalid_query" && consumed === 0, "K1 entrada inválida gastou cota", { bad, badQuery, consumed });
  const limited = await code(
    handleGoogleReviewRequest({ action: "resolve", url: MAPS_PLACE }, { apiKey: KEY, consumeQuota: async () => { throw new DirectLabError("rate_limited", "x", 42); } }),
  );
  check(limited === "rate_limited", "K1 rate limit", limited);
  ok("K1: sem chave → não configurado; entrada inválida é recusada antes de gastar cota; cota estourada → 429");

  const logs: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => void logs.push(args.map(String).join(" "));
  const response = directLabErrorResponse(new DirectLabError("google_denied", `Places API 403: API key ${KEY} not valid`), KEY);
  const rate = directLabErrorResponse(new DirectLabError("rate_limited", "x", 42), KEY);
  console.error = original;
  const body = await response.text();
  check(response.status === 502 && !body.includes(KEY) && !body.includes("Places API 403") && body.includes("Avise o administrador"), "K2 resposta", body);
  check(logs.length === 1 && !logs[0]!.includes(KEY) && logs[0]!.includes("***"), "K2 log sem a chave", logs);
  check(rate.status === 429 && rate.headers.get("Retry-After") === "42", "K2 Retry-After");
  const success = await handleGoogleReviewRequest({ action: "resolve", url: MAPS_PLACE }, {
    apiKey: KEY,
    consumeQuota,
    fetch: places([place("ChIJadegaMonster0001", "Adega Monster", -23.5012, -46.8765, REVIEW_URL)]),
    resolve: { lookup: PUBLIC_LOOKUP },
  });
  check(!JSON.stringify(success).includes(KEY) && consumed === 1, "K2 chave no resultado", success);
  ok("K2: erro técnico vira mensagem amigável; o log registra o detalhe sem a chave; a chave nunca aparece na resposta");

  // ---------------- A: Usar em uma placa reaproveita as rotas existentes ----------------
  const r = buildApplyRequest("reseller", { id: "p1", customer_id: "c1" }, REVIEW_URL);
  const a = buildApplyRequest("admin", { id: "p2", customer_id: null }, REVIEW_URL);
  check(r.url === "/api/reseller/plates/p1" && r.method === "POST" && r.body.customer_id === "c1" && r.body.destination_type === "google_review", "A1 revendedor", r);
  check(a.url === "/api/admin/plates/p2" && a.method === "PATCH" && a.body.customer_id === null, "A1 ADMIN", a);
  ok("A1: 'Usar em uma placa' chama as rotas existentes da placa (revendedor: RPC configure_reseller_plate; ADMIN: PATCH), mantendo o cliente");

  // ---------------- Z: rotas autenticadas e menus ----------------
  const root = process.cwd();
  const read = (p: string) => readFileSync(join(root, p), "utf8");
  for (const route of ["src/app/api/directlab/google-review/route.ts", "src/app/api/directlab/plates/route.ts"]) {
    const src = read(route);
    const handler = src.slice(src.search(/export async function (GET|POST)/));
    check(/^[^]*?const auth = await requireDirectLabApi\(\);\s*if \(!auth\.ok\) return auth\.response;/.test(handler.slice(0, 200)), `Z1 ${route} autentica primeiro`);
    check(!/service_role|createAdminClient|SERVICE_ROLE/.test(src), `Z1 ${route} usa service role`);
  }
  const platesRoute = read("src/app/api/directlab/plates/route.ts");
  check(platesRoute.includes('.eq("reseller_id", auth.resellerId).neq("status", "blocked")') && !/\.update\(|\.rpc\(/.test(platesRoute), "Z1 listagem do revendedor");
  const clientBundle = ["src/components/directlab/GoogleReviewTool.tsx", "src/components/directlab/UseInPlateDialog.tsx", "src/lib/directlab/urls.ts", "src/lib/directlab/errors.ts"].map(read).join("\n");
  check(!/GOOGLE_PLACES_API_KEY|NEXT_PUBLIC_GOOGLE|env\.server|places\.googleapis/.test(clientBundle), "Z1 chave ou Places no código do navegador");
  check(read("src/components/admin/AdminNav.tsx").includes('"/admin/directlab"') && read("src/components/reseller/ResellerNav.tsx").includes('"/reseller/directlab"'), "Z1 menus");
  check(/^GOOGLE_PLACES_API_KEY=$/m.test(read(".env.example")), "Z1 .env.example");
  ok("Z1: rotas do DirectLab autenticam antes de tudo e usam a sessão do usuário (sem service role); a chave e a Places API nunca vão para o navegador; menus e .env.example");

  if (failures) {
    console.log(`${failures} falha(s)`);
    process.exit(1);
  }
  finished = true;
  console.log("DirectLab OK");
  process.exit(0);
}

// Se o processo terminar sem chegar ao fim (promessa esquecida), é falha — nunca sucesso silencioso.
process.on("exit", (code) => {
  if (code === 0 && !finished) {
    console.log("FALHA: o teste terminou sem concluir (promessa pendente)");
    process.exitCode = 1;
  }
});
main().then(() => void (finished = true)).catch((error) => {
  console.error(error);
  process.exit(1);
});
