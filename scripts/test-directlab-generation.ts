/**
 * Avaliação Google — cobrança só no sucesso, links do Google e pesquisa.
 * Google e banco SIMULADOS (sem rede, sem chave real).
 *   npm run test:directlab-generation
 */
import { createCandidateTokens } from "@/lib/directlab/candidate-token";
import { DirectLabError } from "@/lib/directlab/errors";
import { handleGoogleReviewRequest, type HandlerContext } from "@/lib/directlab/handler";
import { resolveGoogleLink } from "@/lib/directlab/resolver";
import { extractPlaceHints, isFinalGoogleUrl, parseUserGoogleUrl, urlShape } from "@/lib/directlab/urls";

let failures = 0;
const ok = (l: string) => console.log(`OK ${l}`);
const check = (c: unknown, l: string, d?: unknown) => {
  if (!c) {
    failures++;
    console.log(`FALHA ${l}`, typeof d === "string" ? d : JSON.stringify(d ?? ""));
  }
};
const logs: string[] = [];
for (const level of ["warn", "error", "info"] as const) console[level] = (...a: unknown[]) => void logs.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" "));

const KEY = "AIzaFAKEchaveFalsaDoTesteDeGeracao00Gen";
const CID = BigInt("0x1a2b3c4d5e6f7081").toString();
const OTHER_CID = "987654321012345678";
const MAPS_FTID = "https://www.google.com/maps/place/Barbearia+do+Carvalho/@-23.5,-46.87,17z/data=!3m1!4b1!4m6!3m5!1s0x94cf03a1b2c3d4e5:0x1a2b3c4d5e6f7081!8m2!3d-23.5011!4d-46.8761!16s%2Fg%2F11abc123xy";
const review = (cidHex: string) => `https://www.google.com/maps/place//data=!4m3!3m2!1s0x94cf03a1b2c3d4e5:0x${cidHex}!12e1`;
const place = (id: string, name: string, cid: string, opts: { review?: boolean; lat?: number; lng?: number; address?: string } = {}) => ({
  id,
  displayName: { text: name },
  formattedAddress: opts.address ?? `${name}, Av. Exemplo, 123 - Barueri - SP`,
  location: { latitude: opts.lat ?? -23.5011, longitude: opts.lng ?? -46.8761 },
  googleMapsUri: `https://maps.google.com/?cid=${cid}`,
  ...(opts.review === false ? {} : { googleMapsLinks: { writeAReviewUri: review(BigInt(cid).toString(16)) } }),
});
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const redirect = (to: string, status = 302) => new Response(null, { status, headers: { location: to } });
const html = (body: string) => new Response(body, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });

type Route = (url: URL, init: RequestInit) => Response | Promise<Response>;
interface World {
  routes: Record<string, Route>;
  search?: (text: string) => unknown;
  details?: (id: string) => Response;
}

/** Banco simulado com a MESMA regra da migration 026 (limite + sem cobrança dupla por local/dia). */
function fakeDb(limit: number | null, used = 0) {
  const generated = new Set<string>();
  const db = { hits: used, checks: 0, charges: 0, raceOnCharge: false };
  return {
    db,
    check: async (placeId: string) => {
      db.checks++;
      if (limit !== null && !generated.has(placeId) && db.hits >= limit) throw new DirectLabError("daily_limit", "esgotada", 3600);
    },
    charge: async (placeId: string) => {
      db.charges++;
      if (limit === null) return null;
      if (generated.has(placeId)) return { used: db.hits, limit };
      if (db.raceOnCharge || db.hits >= limit) throw new DirectLabError("daily_limit", "esgotada na cobrança", 3600);
      db.hits++;
      generated.add(placeId);
      return { used: db.hits, limit };
    },
  };
}

function setup(world: World, gate: ReturnType<typeof fakeDb>, userId = "user-1", secret: string | null = "segredo-de-teste-do-servidor") {
  const calls = { places: 0, search: 0, details: 0, net: 0, textQueries: [] as string[] };
  const fetchImpl = (async (input: string | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    if (url.hostname === "places.googleapis.com") {
      calls.places++;
      if (url.pathname === "/v1/places:searchText") {
        calls.search++;
        const text = JSON.parse(String(init.body)).textQuery as string;
        calls.textQueries.push(text);
        const r = world.search?.(text);
        return r instanceof Response ? r : json(r ?? { places: [] });
      }
      calls.details++;
      const id = decodeURIComponent(url.pathname.replace("/v1/places/", ""));
      return world.details ? world.details(id) : json(place(id, "Local Detalhado", "111"));
    }
    calls.net++;
    const key = `${url.hostname}${url.pathname}`;
    const route = world.routes[key] ?? world.routes[url.hostname];
    if (!route) return new Response("sem rota", { status: 404 });
    return route(url, init);
  }) as typeof fetch;
  const ctx: HandlerContext = {
    apiKey: KEY,
    fetch: fetchImpl,
    resolve: { lookup: async () => ["142.250.79.46"] },
    consumeQuota: async () => undefined,
    checkGeneration: gate.check,
    chargeGeneration: gate.charge,
    tokens: createCandidateTokens(secret, userId),
  };
  return { ctx, calls };
}
async function run(body: unknown, ctx: HandlerContext): Promise<{ ok: true; r: Record<string, unknown> } | { ok: false; code: string }> {
  try {
    return { ok: true, r: (await handleGoogleReviewRequest(body, ctx)) as Record<string, unknown> };
  } catch (e) {
    return { ok: false, code: e instanceof DirectLabError ? e.code : `inesperado: ${(e as Error).message}` };
  }
}
const twoCarvalhos = { places: [place("ChIJcarvalhoBarueri01", "Barbearia do Carvalho", CID), place("ChIJcarvalhoPremium02", "Barbearia do Carvalho", OTHER_CID, { lat: -23.5012, lng: -46.8762 })] };

async function main() {
  // ================= LINKS =================
  const shareWorld: World = {
    routes: {
      "share.google/AbCdEf": () => redirect("https://www.google.com/share.google?q=CodigoOpacoXYZ"),
      "www.google.com/share.google": () => redirect(MAPS_FTID),
    },
    search: () => twoCarvalhos,
  };
  {
    const db = fakeDb(8, 5);
    const { ctx, calls } = setup(shareWorld, db);
    const res = await run({ action: "resolve", url: "https://share.google/AbCdEf" }, ctx);
    const r = res.ok ? res.r : {};
    check(res.ok && r.status === "found" && (r.place as { placeId: string }).placeId === "ChIJcarvalhoBarueri01", "L1 share.google", res);
    check(!calls.textQueries.some((t) => t.includes("CodigoOpaco")) && calls.textQueries[0] === "Barbearia do Carvalho", "L1 código opaco não vira busca", calls.textQueries);
    check(calls.places === 1 && calls.details === 0 && db.db.charges === 1 && db.db.hits === 6 && JSON.stringify(r.quota) === '{"used":6,"limit":8}', "L1 chamadas/cobrança", { calls, db: db.db });
    ok("L1: share.google → www.google.com/share.google?q=<código> (intermediária, seguida) → /maps/place com 0x…:0x… → CID confirmado entre 2 resultados de mesmo nome; o código opaco nunca vira texto de busca; 1 chamada à Places API; cobra 1 (5→6 de 8)");
  }
  const hintsFtid = extractPlaceHints(new URL(MAPS_FTID));
  check(hintsFtid.cid === CID && hintsFtid.kgmid === "/g/11abc123xy" && hintsFtid.name === "Barbearia do Carvalho" && hintsFtid.lat === -23.5011, "L2 parser FTID", hintsFtid);
  check(!isFinalGoogleUrl(new URL("https://www.google.com/share.google?q=X")) && JSON.stringify(extractPlaceHints(new URL("https://www.google.com/share.google?q=X"))) === "{}", "L2 intermediária");
  const formats: [string, Record<string, unknown>][] = [
    ["https://www.google.com/maps/search/?api=1&query=Padaria&query_place_id=ChIJpadariaCentro0001", { placeId: "ChIJpadariaCentro0001", query: "Padaria" }],
    ["https://maps.google.com/?cid=12345678901234567", { cid: "12345678901234567" }],
    ["https://www.google.com/maps?ftid=0x94cf:0xff", { cid: "255" }],
    ["https://www.google.com/maps?q=place_id:ChIJqPlaceId000000001", { placeId: "ChIJqPlaceId000000001" }],
    ["https://www.google.com/maps/search/Pizzaria+Bella+Barueri/@-23.5,-46.8,15z", { query: "Pizzaria Bella Barueri", lat: -23.5, lng: -46.8 }],
    ["https://www.google.com/search?q=Barbearia+do+Carvalho+Barueri&kgmid=/g/11abc123xy", { query: "Barbearia do Carvalho Barueri", kgmid: "/g/11abc123xy" }],
    ["https://www.google.com.br/maps/place/Adega/@-23.4,-46.7,17z", { name: "Adega", lat: -23.4, lng: -46.7 }],
  ];
  for (const [u, expected] of formats) {
    const h = extractPlaceHints(new URL(u)) as Record<string, unknown>;
    check(Object.entries(expected).every(([k, v]) => h[k] === v), `L2 ${u}`, h);
  }
  ok("L2: formatos lidos da própria URL: /maps/place (nome, ponto, 0x…:0x… → CID, /g/ kgmid), /maps/search (api=1, query_place_id, texto), ?cid=, ftid=, q=place_id:, /search?q=&kgmid=, google.com.br; URL intermediária não gera pistas");

  // redirects válidos e bloqueios
  const chain: World = {
    routes: {
      "maps.app.goo.gl/a": () => redirect("https://maps.app.goo.gl/b"),
      "maps.app.goo.gl/b": () => redirect("https://www.google.com/url?q=https://consent.google.com/ml?continue%3Dhttps://www.google.com/maps/place/Adega/@-23.4,-46.7,17z"),
      "maps.app.goo.gl/one": () => redirect("https://www.google.com/maps/place/Adega/@-23.4,-46.7,17z"),
      "maps.app.goo.gl/meta": () => html('<html><head><meta http-equiv="refresh" content="0; url=https://www.google.com/maps/place/Adega/@-23.4,-46.7,17z&amp;x=1"></head></html>'),
      "maps.app.goo.gl/evil": () => redirect("https://evil.example.com/maps"),
      "maps.app.goo.gl/loop1": () => redirect("https://maps.app.goo.gl/loop2"),
      "maps.app.goo.gl/loop2": () => redirect("https://maps.app.goo.gl/loop1"),
      "maps.app.goo.gl/http": () => redirect("http://www.google.com/maps/place/Adega"),
      "maps.app.goo.gl/ip": () => redirect("https://127.0.0.1/maps"),
      "maps.app.goo.gl/nohints": () => html("<html><body>sem redirecionamento</body></html>"),
      "maps.app.goo.gl/consent": () => redirect("https://consent.google.com/ml?hl=pt"),
      "consent.google.com": () => {
        throw new Error("consent.google.com não pode ser baixada");
      },
      ...Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`maps.app.goo.gl/m${i}`, () => redirect(`https://maps.app.goo.gl/m${i + 1}`)])),
    },
  };
  const resolveWith = async (u: string, lookup: (h: string) => Promise<string[]> = async () => ["142.250.79.46"]) => {
    const { ctx } = setup(chain, fakeDb(10));
    try {
      const r = await resolveGoogleLink(parseUserGoogleUrl(u), { fetch: ctx.fetch, lookup });
      return { ok: true as const, r };
    } catch (e) {
      return { ok: false as const, code: (e as DirectLabError).code };
    }
  };
  const one = await resolveWith("https://maps.app.goo.gl/one");
  const multi = await resolveWith("https://maps.app.goo.gl/a");
  const meta = await resolveWith("https://maps.app.goo.gl/meta");
  check(one.ok && one.r.hints.name === "Adega" && one.r.hops.length === 2, "L3 redirect único", one);
  check(multi.ok && multi.r.hints.name === "Adega", "L3 vários redirects + /url?q= + consent", multi);
  check(meta.ok && meta.r.hints.name === "Adega", "L3 meta refresh", meta);
  ok("L3: maps.app.goo.gl com redirect único, vários redirects válidos (inclui /url?q= e consent?continue=, desembrulhados sem baixar) e meta refresh declarado → URL final do Maps");
  const blocked: [string, string, ((h: string) => Promise<string[]>)?][] = [
    ["https://maps.app.goo.gl/evil", "redirect_blocked"],
    ["https://maps.app.goo.gl/loop1", "redirect_blocked"],
    ["https://maps.app.goo.gl/m0", "redirect_blocked"],
    ["https://maps.app.goo.gl/http", "redirect_blocked"],
    ["https://maps.app.goo.gl/ip", "redirect_blocked"],
    ["https://maps.app.goo.gl/one", "redirect_blocked", async () => ["10.0.0.5"]],
    ["https://maps.app.goo.gl/one", "redirect_blocked", async () => ["127.0.0.1"]],
  ];
  for (const [u, code, lookup] of blocked) {
    const r = await resolveWith(u, lookup);
    check(!r.ok && r.code === code, `L4 ${u}`, r);
  }
  // Recusadas antes de qualquer acesso à rede (invalid_url = sem domínio/malformada; domain_not_allowed = fora da allowlist).
  for (const u of ["http://localhost/maps", "https://localhost/maps", "https://127.0.0.1/maps", "https://evil.com/maps/place/x", "https://exa mple", "javascript:alert(1)", "", "https://www.google.com:8443/maps", "https://user:pw@www.google.com/maps"]) {
    let c = "aceitou";
    try {
      parseUserGoogleUrl(u);
    } catch (e) {
      c = (e as DirectLabError).code;
    }
    check(c === "invalid_url" || c === "domain_not_allowed", `L4 entrada ${u}`, c);
  }
  const consentOnly = await resolveWith("https://maps.app.goo.gl/consent");
  check(consentOnly.ok && JSON.stringify(consentOnly.r.hints) === "{}", "L4 consent sem continue não é baixada", consentOnly);
  ok("L4: bloqueados: redirect para domínio proibido, laço, excesso de redirects (>5), http, IP literal, DNS que aponta para IP privado (10.x) ou loopback; entradas localhost, 127.0.0.1, domínio estranho, porta, credenciais, javascript: e malformadas são recusadas antes da rede; consent.google.com nunca é baixada");
  const unrec = await resolveWith("https://maps.app.goo.gl/nohints");
  const diags = logs.filter((l) => l.includes("directlab_link_unrecognized"));
  check(unrec.ok && JSON.stringify(unrec.r.hints) === "{}" && diags.some((l) => l.includes('"shape":"maps.app.goo.gl/:x"')) && !diags.some((l) => l.includes("nohints")), "L5 diagnóstico", diags);
  check(urlShape(new URL("https://www.google.com/share.google?q=Segredo123&x=1")) === "www.google.com/share.google?q,x", "L5 forma sem valores");
  ok("L5: link que não se resolve registra só a FORMA da URL (host, caminho genérico, nomes de parâmetros) — nunca valores — para mapear formatos novos do Google");

  // ================= COTA: só no sucesso =================
  const searchWorld: World = {
    routes: {},
    search: (text) => {
      if (/nada/i.test(text)) return { places: [] };
      if (/erro/i.test(text)) return json({ error: { status: "PERMISSION_DENIED", message: "billing" } }, 403);
      return twoCarvalhos;
    },
  };
  {
    const db = fakeDb(8, 5);
    const { ctx, calls } = setup(searchWorld, db);
    const s1 = await run({ action: "search", query: "Barbearia do Carvalho" }, ctx);
    const s2 = await run({ action: "search", query: "Barbearia do Carvalho Barueri" }, ctx);
    const s3 = await run({ action: "search", query: "Av. Exemplo, 123 - Barueri" }, ctx);
    const none = await run({ action: "search", query: "nada aqui" }, ctx);
    const cands = s1.ok ? (s1.r.candidates as { placeId: string; name: string; address: string; token?: string }[]) : [];
    check(s1.ok && s1.r.status === "choose" && cands.length === 2 && cands[0]!.address.includes("Barueri") && cands.every((c) => c.token), "Q1 pesquisa", s1);
    check(s2.ok && s3.ok && !none.ok && none.code === "not_found", "Q2/Q3", { s2, s3, none });
    check(db.db.charges === 0 && db.db.checks === 0 && db.db.hits === 5 && calls.search === 4, "Q1–Q3 cobrança", { db: db.db, calls });
    ok("Q1–Q3: pesquisar por nome, nome + cidade e endereço (e pesquisar de novo) devolve a lista (nome + endereço com cidade/UF) e cobra 0; pesquisa sem resultados → 'não encontrado', 0; continua 5 de 8");

    // Q4: selecionar = só no navegador (nenhuma chamada). Gerar o escolhido COM o comprovante: 0 chamada extra ao Google.
    const before = calls.places;
    const gen = await run({ action: "place", placeId: cands[1]!.placeId, token: cands[1]!.token }, ctx);
    check(gen.ok && gen.r.status === "found" && (gen.r.place as { name: string }).name === "Barbearia do Carvalho" && calls.places === before && db.db.hits === 6, "Q4/Q10 gerar escolhido", { gen, calls, db: db.db });
    ok("Q4/Q10: selecionar não chama o servidor; 'Gerar link' do escolhido reaproveita o link oficial da pesquisa (comprovante assinado, 0 chamada extra ao Google) e cobra exatamente 1 (6 de 8)");

    // Q16: refresh/retry do mesmo local → não cobra de novo
    const again = await run({ action: "place", placeId: cands[1]!.placeId, token: cands[1]!.token }, ctx);
    check(again.ok && db.db.hits === 6 && JSON.stringify(again.ok ? again.r.quota : null) === '{"used":6,"limit":8}', "Q16 retry", { again, db: db.db });
    ok("Q16: repetir a geração do MESMO local (refresh/retry) entrega o link de novo sem cobrar (continua 6 de 8)");

    // Trocar de resultado: outro local cobra 1
    const other = await run({ action: "place", placeId: cands[0]!.placeId, token: cands[0]!.token }, ctx);
    check(other.ok && db.db.hits === 7, "Q4 troca de resultado", db.db);
    ok("Q4b: trocar o resultado escolhido e gerar o outro local cobra 1 por local (7 de 8)");
  }
  {
    const db = fakeDb(8, 5);
    const { ctx } = setup(searchWorld, db);
    const results = await Promise.all([
      run({ action: "resolve", url: "não é link" }, ctx),
      run({ action: "resolve", url: "https://evil.com/maps" }, ctx),
      run({ action: "search", query: "erro" }, ctx),
    ]);
    check(!results[0]!.ok && !results[1]!.ok && !results[2]!.ok && db.db.charges === 0 && db.db.hits === 5, "Q5/Q8", results);
    ok("Q5/Q8: link inválido, domínio proibido e erro do Google (PERMISSION_DENIED) cobram 0");
  }
  {
    const db = fakeDb(8, 5);
    const { ctx } = setup({ routes: { "share.google/sem": () => html("<html>sem pistas</html>") } }, db);
    const r = await run({ action: "resolve", url: "https://share.google/sem" }, ctx);
    check(r.ok && r.r.status === "not_identified" && db.db.charges === 0, "Q6", r);
    ok("Q6: share.google que não se resolve → 'não identificado', cobra 0");
  }
  {
    const db = fakeDb(8, 5);
    const { ctx } = setup({ routes: {}, search: () => twoCarvalhos }, db);
    const r = await run({ action: "resolve", url: "https://www.google.com/search?q=Barbearia+do+Carvalho&kgmid=/g/11abc123xy" }, ctx);
    check(r.ok && r.r.status === "choose" && (r.r.candidates as unknown[]).length === 2 && db.db.charges === 0 && db.db.checks === 0, "Q7", r);
    ok("Q7: link ambíguo (dois locais de mesmo nome, sem identificador) → lista para escolher, cobra 0");
  }
  for (const [label, details] of [
    ["403", () => json({ error: { status: "PERMISSION_DENIED" } }, 403)],
    ["sem link oficial", () => json(place("ChIJsemLinkOficial0001", "Sem Link", "222", { review: false }))],
    ["timeout", () => { throw Object.assign(new Error("aborted"), { name: "AbortError" }); }],
    ["resposta estranha", () => new Response("<html>", { status: 200 })],
  ] as const) {
    const db = fakeDb(8, 5);
    const { ctx } = setup({ routes: {}, details: details as () => Response }, db);
    const r = await run({ action: "place", placeId: "ChIJsemLinkOficial0001" }, ctx);
    check(!r.ok && db.db.charges === 0 && db.db.hits === 5, `Q8/Q9 ${label}`, r);
  }
  ok("Q8/Q9: na geração, Google recusando (403), local sem link oficial, timeout/falha de rede e resposta inesperada cobram 0");

  {
    const db = fakeDb(8, 8);
    const { ctx, calls } = setup(searchWorld, db);
    const s = await run({ action: "search", query: "Barbearia do Carvalho" }, ctx);
    const cands = s.ok ? (s.r.candidates as { placeId: string; token?: string }[]) : [];
    const before = calls.places;
    const g = await run({ action: "place", placeId: "ChIJoutroLocal0000001" }, ctx);
    check(s.ok && cands.length === 2, "Q12 pesquisa no limite", s);
    check(!g.ok && g.code === "daily_limit" && calls.places === before && db.db.hits === 8 && db.db.charges === 0, "Q11", { g, calls, db: db.db });
    ok("Q11–Q12: no limite (8 de 8) a pesquisa continua funcionando, mas gerar é barrado ANTES da chamada final ao Google (daily_limit), sem cobrar");
  }
  {
    const db = fakeDb(8, 7);
    db.db.raceOnCharge = true;
    const { ctx } = setup({ routes: {} }, db);
    const r = await run({ action: "place", placeId: "ChIJcorridaConcorr01" }, ctx);
    check(!r.ok && r.code === "daily_limit" && db.db.hits === 7, "Q15", r);
    ok("Q15: se a cota acabar entre a consulta e a cobrança (outra aba/concorrência), o link NÃO é entregue e nada é cobrado (concorrência real coberta no SQL CH9/CH10)");
  }
  {
    const db = fakeDb(null);
    const { ctx } = setup(searchWorld, db);
    let all = true;
    for (let i = 0; i < 25; i++) {
      const r = await run({ action: "place", placeId: `ChIJadminLocal${String(i).padStart(6, "0")}` }, ctx);
      all &&= r.ok && !("quota" in r.r);
    }
    check(all, "Q13 ADMIN");
    ok("Q13: ADMIN gera 25 links sem limite e sem contador; pesquisa também funciona para ADMIN");
  }
  {
    // Q14: comprovante forjado/alterado/vencido/de outro usuário é ignorado → consulta o Google (o link vem do Google, nunca do navegador)
    const db = fakeDb(8, 0);
    const { ctx, calls } = setup(searchWorld, db, "user-1");
    const s = await run({ action: "search", query: "Barbearia do Carvalho" }, ctx);
    const c = (s.ok ? (s.r.candidates as { placeId: string; token?: string }[]) : [])[0]!;
    const [body, sig] = c.token!.split(".");
    const forged = JSON.parse(Buffer.from(body!, "base64url").toString());
    forged.r = "https://www.google.com/maps/forjado";
    const tampered = `${Buffer.from(JSON.stringify(forged)).toString("base64url")}.${sig}`;
    const otherUser = createCandidateTokens("segredo-de-teste-do-servidor", "user-2").sign({ placeId: c.placeId, name: "x", address: null, reviewUrl: review("1") });
    const expired = createCandidateTokens("segredo-de-teste-do-servidor", "user-1", () => Date.now() - 3600_000).sign({ placeId: c.placeId, name: "x", address: null, reviewUrl: review("1") });
    for (const [label, token] of [["alterado", tampered], ["outro usuário", otherUser], ["vencido", expired], ["lixo", "abc.def"]] as const) {
      const before = calls.details;
      const r = await run({ action: "place", placeId: c.placeId, token }, ctx);
      check(r.ok && calls.details === before + 1 && !JSON.stringify(r.r).includes("forjado"), `Q14 ${label}`, r);
    }
    ok("Q14: comprovante alterado, de outro usuário, vencido ou inválido é ignorado: o servidor consulta o Google (o link nunca vem do navegador); a cota só é cobrada pelo servidor (rota + banco)");
  }

  // ================= CHAMADAS AO GOOGLE NOS FLUXOS TÍPICOS =================
  {
    const db = fakeDb(10);
    const { ctx, calls } = setup({ routes: {} }, db);
    await run({ action: "resolve", url: "https://www.google.com/maps/search/?api=1&query=Padaria&query_place_id=ChIJpadariaCentro0001" }, ctx);
    check(calls.places === 1 && calls.details === 1, "C1 Place ID", calls);
    const s = setup({ routes: {}, search: () => twoCarvalhos }, fakeDb(10), "u", null);
    const r = await run({ action: "search", query: "Barbearia do Carvalho" }, s.ctx);
    const c = (r.ok ? (r.r.candidates as { placeId: string; token?: string }[]) : [])[0]!;
    await run({ action: "place", placeId: c.placeId, token: c.token }, s.ctx);
    check(!c.token && s.calls.places === 2, "C2 sem segredo: Details de novo", s.calls);
    ok("C1–C2: link com Place ID = 1 chamada (Details); sem segredo de assinatura no servidor, a geração consulta o Google de novo (pesquisa + Details = 2) — correto, só menos econômico");
  }

  const leaked = logs.filter((l) => l.includes(KEY) || l.includes("CodigoOpacoXYZ"));
  check(leaked.length === 0, "LOG", leaked);
  ok(`LOG: ${logs.length} linhas de log; nenhuma contém a chave ou valores dos links`);

  if (failures) {
    console.log(`${failures} falha(s)`);
    process.exit(1);
  }
  console.log("Avaliação Google (geração) OK");
  process.exit(0);
}
main().catch((e) => {
  console.log("erro:", e instanceof Error ? e.stack : e);
  process.exit(1);
});
