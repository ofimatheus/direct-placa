/**
 * DirectLab · o que conta como utilização (handler) e a ligação com o banco.
 * Rede simulada: nenhum acesso real ao Google.
 *   npm run test:directlab-quota
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DIRECTLAB_ERRORS, DirectLabError } from "@/lib/directlab/errors";
import { DIRECTLAB_LIMITS, directLabErrorResponse, handleGoogleReviewRequest, type HandlerContext } from "@/lib/directlab/handler";

let failures = 0;
const ok = (label: string) => console.log(`OK ${label}`);
const check = (cond: unknown, label: string, detail?: unknown) => {
  if (!cond) {
    failures++;
    console.log(`FALHA ${label}`, detail ?? "");
  }
};
const KEY = "AIzaSy-TESTE-NAO-REAL-999";
const MAPS_PLACE = "https://www.google.com/maps/place/Adega+Monster/@-23.5,-46.8,17z/data=!3m1!4b1!3d-23.5012!4d-46.8765";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const place = (id: string, name: string, review = true) => ({
  id,
  displayName: { text: name },
  formattedAddress: `${name}, Barueri`,
  location: { latitude: -23.5012, longitude: -46.8765 },
  ...(review ? { googleMapsLinks: { writeAReviewUri: `https://search.google.com/local/writereview?placeid=${id}` } } : {}),
});

function harness(opts: { daily?: "ok" | "admin" | "exhausted"; burst?: "ok" | "denied"; places?: (url: URL) => Response; share?: (url: URL) => Response } = {}) {
  const counts = { burst: 0, daily: 0, places: 0, share: 0 };
  let used = 3;
  const fetchImpl = (async (input: string | URL) => {
    const url = new URL(String(input));
    if (url.hostname === "places.googleapis.com") {
      counts.places++;
      const byEndpoint = (u: URL) =>
        u.pathname.startsWith("/v1/places/") ? json(place("ChIJadegaMonster0001", "Adega Monster")) : json({ places: [place("ChIJadegaMonster0001", "Adega Monster")] });
      return (opts.places ?? byEndpoint)(url);
    }
    counts.share++;
    return (opts.share ?? (() => new Response(null, { status: 302, headers: { location: MAPS_PLACE } })))(url);
  }) as typeof fetch;
  const ctx: HandlerContext = {
    apiKey: KEY,
    fetch: fetchImpl,
    resolve: { lookup: async () => ["142.250.79.46"] },
    consumeQuota: async () => {
      counts.burst++;
      if (opts.burst === "denied") throw new DirectLabError("rate_limited", "rajada", 30);
    },
    // Regra nova (migration 026): consulta sem consumir + cobrança SÓ no sucesso. counts.daily = cobranças.
    checkGeneration: async () => {
      if (opts.daily === "exhausted") throw new DirectLabError("daily_limit", "esgotada", 3600);
    },
    chargeGeneration: async () => {
      counts.daily++;
      if (opts.daily === "admin") return null;
      used++;
      return { used, limit: 10 };
    },
  };
  return { ctx, counts };
}
async function code(p: Promise<unknown>) {
  try {
    await p;
    return "sem erro";
  } catch (e) {
    return e instanceof DirectLabError ? e.code : `inesperado: ${(e as Error).message}`;
  }
}

async function main() {
  // H1: inválidas localmente não consomem nada
  const invalid: unknown[] = [
    null,
    {},
    { action: "resolve", url: "" },
    { action: "resolve", url: "não é link" },
    { action: "resolve", url: "https://evil.com/maps/place/x" },
    { action: "resolve", url: "http://share.google/x" },
    { action: "search", query: "ab" },
    { action: "place", placeId: "curto" },
  ];
  for (const body of invalid) {
    const { ctx, counts } = harness();
    const c = await code(handleGoogleReviewRequest(body, ctx));
    check(c !== "sem erro" && counts.burst === 0 && counts.daily === 0 && counts.places === 0 && counts.share === 0, `H1 ${JSON.stringify(body)}`, { c, counts });
  }
  ok("H1: formulário vazio, URL inválida, domínio não permitido, http, pesquisa curta e Place ID inválido: nenhuma cota consumida e nenhum acesso externo");

  // H2: link válido que não chega à Places API → cota diária intacta
  {
    const { ctx, counts } = harness({ share: () => new Response("<html>", { status: 200 }) });
    const r = (await handleGoogleReviewRequest({ action: "resolve", url: "https://share.google/semPistas" }, ctx)) as { status: string; quota?: unknown };
    check(r.status === "not_identified" && counts.burst === 1 && counts.daily === 0 && counts.places === 0 && !r.quota, "H2", { r, counts });
    ok("H2: link válido que não chega à Places API (não identificado) passa pela proteção curta, mas não gasta a cota diária");
  }

  // H3: uma operação = uma utilização (mesmo com 2 chamadas à Places API)
  {
    const { ctx, counts } = harness({
      places: (url) =>
        url.pathname === "/v1/places:searchText"
          ? json({ places: [place("ChIJadegaMonster0001", "Adega Monster", false)] })
          : json(place("ChIJadegaMonster0001", "Adega Monster")),
    });
    const r = (await handleGoogleReviewRequest({ action: "resolve", url: MAPS_PLACE }, ctx)) as { status: string; quota?: { used: number; limit: number } };
    check(r.status === "found" && counts.places === 2 && counts.daily === 1 && r.quota?.used === 4 && r.quota.limit === 10, "H3", { r, counts });
    for (const body of [{ action: "search", query: "Adega Monster" }, { action: "place", placeId: "ChIJadegaMonster0001" }]) {
      const h = harness();
      await handleGoogleReviewRequest(body, h.ctx);
      // Regra mudou a pedido: pesquisar NÃO cobra (antes: 1); gerar o link escolhido cobra 1.
      check(h.counts.daily === (body.action === "search" ? 0 : 1) && h.counts.places === 1, `H3 ${body.action}`, h.counts);
    }
    ok("H3: resolver (busca + detalhes = 2 chamadas) cobra 1 ao gerar o link; pesquisar cobra 0 (regra nova); gerar o link do local escolhido cobra 1");
  }

  // H4: cota esgotada → nenhuma chamada à Places API
  {
    const { ctx, counts } = harness({ daily: "exhausted" });
    const c = await code(handleGoogleReviewRequest({ action: "resolve", url: MAPS_PLACE }, ctx));
    // Regra mudou a pedido: identificar o local (1 busca) é livre; a GERAÇÃO é barrada antes do Place Details e nada é cobrado.
    check(c === "daily_limit" && counts.places === 1 && counts.daily === 0, "H4", { c, counts });
    const res = directLabErrorResponse(new DirectLabError("daily_limit", "x", 5400));
    const body = (await res.json()) as { error: string; code: string };
    check(
      res.status === 429 && res.headers.get("Retry-After") === "5400" && body.code === "daily_limit" &&
        body.error === "Você atingiu o limite diário definido para sua conta. Entre em contato com o administrador para aumentar o limite.",
      "H4 resposta",
      body,
    );
    ok("H4: cota esgotada → 429 'daily_limit' com a mensagem pedida; a geração é barrada antes da chamada final ao Google e nada é cobrado");
  }

  // H5: erro do Google depois de iniciar a consulta conta
  {
    const { ctx, counts } = harness({ places: () => json({ error: { status: "PERMISSION_DENIED", message: "billing" } }, 403) });
    const c = await code(handleGoogleReviewRequest({ action: "search", query: "Adega Monster" }, ctx));
    // Regra mudou a pedido: erro do Google NÃO cobra (antes: 1).
    check(c === "google_denied" && counts.daily === 0 && counts.places === 1, "H5", { c, counts });
    const h = harness({ places: () => json({ error: { status: "PERMISSION_DENIED", message: "billing" } }, 403) });
    const c2 = await code(handleGoogleReviewRequest({ action: "place", placeId: "ChIJadegaMonster0001" }, h.ctx));
    check(c2 === "google_denied" && h.counts.daily === 0, "H5 geração", { c2, counts: h.counts });
    ok("H5: o Google recusar (ex.: 403 PERMISSION_DENIED) na pesquisa ou na geração cobra 0 (regra nova)");
  }

  // H6: ADMIN sem cota diária
  {
    const { ctx, counts } = harness({ daily: "admin" });
    const r = (await handleGoogleReviewRequest({ action: "resolve", url: MAPS_PLACE }, ctx)) as { status: string; quota?: unknown };
    check(r.status === "found" && counts.burst === 1 && !("quota" in r), "H6", { r, counts });
    ok("H6: ADMIN passa pela proteção curta, mas não tem cota diária (sem contador na resposta)");
  }

  // H7: rajada negada não gasta a cota do dia nem acessa a rede
  {
    const { ctx, counts } = harness({ burst: "denied" });
    const c = await code(handleGoogleReviewRequest({ action: "resolve", url: "https://share.google/x" }, ctx));
    check(c === "rate_limited" && counts.daily === 0 && counts.places === 0 && counts.share === 0, "H7", { c, counts });
    ok("H7: proteção curta negada → sem cota diária gasta e sem nenhum acesso externo");
  }

  // H8: ligação com o banco (sem limites vindos do cliente) e mensagem única
  const root = process.cwd();
  const quotaSrc = readFileSync(join(root, "src/lib/directlab/quota.ts"), "utf8");
  const route = readFileSync(join(root, "src/app/api/directlab/google-review/route.ts"), "utf8");
  const migration = readFileSync(join(root, "supabase/migrations/20261002120000_directlab_daily_quota.sql"), "utf8");
  check(/rpc\("directlab_consume", \{ p_kind: kind \}\)/.test(quotaSrc) && !/p_max|p_window/.test(quotaSrc), "H8 RPC sem limites do cliente");
  check(
    route.includes("checkGeneration: (placeId) => checkDirectLabGeneration(auth.session.supabase, placeId)") &&
      route.includes("chargeGeneration: (placeId) => chargeDirectLabGeneration(auth.session.supabase, placeId)") &&
      route.includes("consumeQuota: () => consumeDirectLabBurst(auth.session.supabase)") &&
      !route.includes("consumeDaily"),
    "H8 rota (regra nova: consulta + cobrança no sucesso)",
  );
  check(/select 10, 60, 10;/.test(migration) && DIRECTLAB_LIMITS.resellerDaily === 10 && DIRECTLAB_LIMITS.burstPerMinute === 10, "H8 números iguais no banco e na aplicação");
  check(DIRECTLAB_ERRORS.daily_limit.status === 429, "H8 status");
  ok("H8: a rota usa as RPCs do banco sem enviar limites (papel e limites decididos no banco); números 10/min e 10/dia iguais na migration e na aplicação");

  if (failures) {
    console.log(`${failures} falha(s)`);
    process.exit(1);
  }
  console.log("Cota do DirectLab OK");
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
