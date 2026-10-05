/**
 * Link curto da Avaliação Google (/r/<código>): geração, cobrança, rota pública,
 * segurança do destino, tamanho em bytes e proxy.
 *   npm run test:directlab-shortlink
 */
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { DirectLabError } from "@/lib/directlab/errors";
import { directLabErrorResponse, handleGoogleReviewRequest } from "@/lib/directlab/handler";
import {
  NFC_SHORT_LINK_TARGET_BYTES,
  buildReviewShortLink,
  isShortLinkDestination,
  resolveReviewShortLink,
  reviewShortUrl,
  urlByteLength,
} from "@/lib/directlab/short-link";

let failures = 0;
const ok = (l: string) => console.log(`OK ${l}`);
const check = (c: unknown, l: string, d?: unknown) => {
  if (!c) {
    failures++;
    console.log(`FALHA ${l}`, JSON.stringify(d ?? "").slice(0, 400));
  }
};
const logs: string[] = [];
for (const lvl of ["warn", "error"] as const) console[lvl] = (...a: unknown[]) => void logs.push(a.map((x) => JSON.stringify(x)).join(" "));

const REVIEW = "https://www.google.com/maps/place//data=!4m3!3m2!1s0x94cf01b30bf59ca7:0x21e10e82e733c4f7!12e1?g_mp=Cidnb29nbGUubWFwcy5wbGFjZXMudjEuUGxhY2VzLkdldFBsYWNl";
const PLACE = "ChIJadegaMonster0001";

/** Places API simulada: conta as chamadas. */
function placesFetch(counter: { n: number }, reviewUrl = REVIEW) {
  return (async (url: string) => {
    counter.n++;
    const u = String(url);
    if (u.includes("places/")) return new Response(JSON.stringify({ id: PLACE, displayName: { text: "Adega Monster" }, formattedAddress: "Av. Exemplo, 123", googleMapsLinks: { writeAReviewUri: reviewUrl } }), { status: 200 });
    return new Response("{}", { status: 404 });
  }) as unknown as typeof fetch;
}

async function run(ctx: Record<string, unknown>, body: unknown) {
  return handleGoogleReviewRequest(body, { apiKey: "chave-teste", consumeQuota: async () => undefined, ...ctx } as never);
}
/** Como a rota faz: erro → resposta HTTP (status + JSON que o usuário recebe). */
async function attempt(ctx: Record<string, unknown>, body: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  try {
    return { status: 200, body: (await run(ctx, body)) as unknown as Record<string, unknown> };
  } catch (error) {
    const res = directLabErrorResponse(error);
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  }
}

async function main() {
  // ---------- 1. tamanho e origem ----------
  const sample = "https://go.directplaca.com/r/A7K4829";
  check(urlByteLength(sample) === Buffer.byteLength(sample, "utf8") && urlByteLength(sample) === 36 && urlByteLength(sample) <= NFC_SHORT_LINK_TARGET_BYTES, "B1 exemplo");
  check(urlByteLength("https://plaça.com/r/A") === Buffer.byteLength("https://plaça.com/r/A", "utf8") && urlByteLength("https://plaça.com/r/A") === "https://plaça.com/r/A".length + 1, "B1 UTF-8 real ≠ length");
  check(reviewShortUrl("A7K4829", "https://go.directplaca.com/go") === sample && reviewShortUrl("A7K4829", "https://go.directplaca.com") === sample, "B1 origem de NEXT_PUBLIC_GO_BASE_URL");
  check(reviewShortUrl("A7K4829", "") === null && reviewShortUrl("A7K4829", "isso não é url") === null, "B1 sem origem configurada");
  const configured = process.env.NEXT_PUBLIC_GO_BASE_URL;
  if (configured) {
    const link = buildReviewShortLink("A7K4829", configured)!;
    check(link && link.bytes === Buffer.byteLength(link.url, "utf8"), "B1 domínio configurado", link);
    console.log(`   (domínio configurado ${new URL(configured).origin}: ${link.bytes} bytes — ${link.bytes <= 40 ? "dentro" : "acima"} da referência de 40 para NFC)`);
  }
  ok(`B1: link curto = origem de NEXT_PUBLIC_GO_BASE_URL + /r/<7>; exemplo ${sample} = ${urlByteLength(sample)} bytes (UTF-8 real, igual a Buffer.byteLength; com 'ç' bytes ≠ length); sem origem configurada → não monta link (nada de localhost)`);

  // ---------- 2. destino permitido ----------
  const good = [REVIEW, "https://search.google.com/local/writereview?placeid=ChIJxyz", "https://g.page/r/CZx0abc/review", "https://maps.google.com/maps/place/x"];
  const bad = [
    "javascript:alert(1)//https://www.google.com/maps/",
    "data:text/html,<script>alert(1)</script>",
    "file:///etc/passwd#https://www.google.com/maps/",
    "http://www.google.com/maps/place/x",
    "https://evil.example.com/maps/place/x",
    "https://www.google.com.evil.com/maps/place/x",
    "https://evil@www.google.com/maps/place/x",
    "https://www.google.com/url?q=https://evil.example.com",
    "https://www.google.com/maps/../url?q=https://evil.example.com",
    "https://www.google.com/maps/%2E%2E/url?q=x",
    "https://www.google.com/maps/place/x y",
    "https://g.page/outra",
  ];
  check(good.every(isShortLinkDestination) && !bad.some(isShortLinkDestination), "D", { aceitos: good.filter(isShortLinkDestination).length, recusadosErrado: bad.filter(isShortLinkDestination) });
  const sql = readFileSync("supabase/migrations/20261009120000_directlab_review_short_links.sql", "utf8");
  check(sql.includes("'^https://(www\\.|maps\\.)?google\\.com/maps/'") && sql.includes("(\\.\\.|%2e|%5c)"), "D regra igual no banco");
  ok(`D: destino só pode ser link de avaliação do Google (${good.length} formatos oficiais aceitos; ${bad.length} recusados: javascript:, data:, file:, http, host falso, usuário na URL, google.com/url, "..", %2E%2E, espaço, g.page fora de /r/) — a mesma regra existe no banco`);

  // ---------- 3. geração ----------
  const places = { n: 0 };
  const finals: { placeId: string; destination: string }[] = [];
  let charged = 0;
  const finalize = async (placeId: string, destination: string) => {
    finals.push({ placeId, destination });
    charged++;
    return { quota: { used: 1, limit: 20 }, code: "A7K4829" };
  };
  const ctx = { fetch: placesFetch(places), finalizeGeneration: finalize, chargeGeneration: async () => { throw new Error("charge NÃO deveria ser chamado"); }, shortLinkUrl: (c: string) => reviewShortUrl(c, "https://go.directplaca.com/go") };
  const r = (await run(ctx, { action: "place", placeId: PLACE })) as { status: string; place: { reviewUrl: string }; shortLink: { code: string; url: string; bytes: number }; quota: unknown };
  check(r.status === "found" && r.shortLink?.url === sample && r.shortLink.bytes === Buffer.byteLength(sample, "utf8") && r.shortLink.code === "A7K4829", "G1 link curto", r);
  check(r.place.reviewUrl === REVIEW && finals.length === 1 && finals[0]!.destination === REVIEW && finals[0]!.placeId === PLACE && charged === 1, "G1 original e destino do Google", finals);
  ok("G1: geração bem-sucedida → resposta traz o link curto (principal: código, URL e bytes) e mantém o link original do Google; o destino gravado é exatamente o writeAReviewUri validado; cobrança + link numa só chamada");

  // ---------- 4. falhas e cobrança ----------
  const failCtx = { ...ctx, finalizeGeneration: async () => { throw new DirectLabError("short_link_unavailable", "simulada"); } };
  const f = await attempt(failCtx, { action: "place", placeId: PLACE });
  check(f.status === 503 && f.body.code === "short_link_unavailable" && String(f.body.error).includes("Nada foi descontado") && !JSON.stringify(f.body).includes("/r/"), "F1", f);
  const googleDown = { n: 0 };
  let finalizeCalls = 0;
  const g = await attempt({ ...ctx, fetch: (async () => { googleDown.n++; return new Response("{}", { status: 503 }); }) as unknown as typeof fetch, finalizeGeneration: async () => { finalizeCalls++; return { quota: null, code: "A7K4829" }; } }, { action: "place", placeId: PLACE });
  check(g.status >= 500 && g.body.code === "google_unavailable" && finalizeCalls === 0, "F2", g);
  const limit = await attempt({ ...ctx, finalizeGeneration: async () => { throw new DirectLabError("daily_limit", "cota", 3600); } }, { action: "place", placeId: PLACE });
  check(limit.status === 429 && limit.body.code === "daily_limit" && !JSON.stringify(limit.body).includes("/r/"), "F3", limit);
  ok("F: falha ao gravar o link → erro 'Nada foi descontado; tente de novo' (o banco desfaz a cobrança na mesma transação); erro do Google → a finalização nem é chamada (0 cobrança, 0 link); cota esgotada → nenhum link entregue");

  // ---------- 5. repetição e formato fora do padrão ----------
  const codes: string[] = [];
  const retryCtx = { ...ctx, finalizeGeneration: async () => ({ quota: { used: 1, limit: 20 }, code: "A7K4829" }) };
  for (let i = 0; i < 3; i++) codes.push(((await run(retryCtx, { action: "place", placeId: PLACE })) as { shortLink: { code: string } }).shortLink.code);
  check(new Set(codes).size === 1, "R1", codes);
  let chargedOld = 0;
  const oddCtx = { ...ctx, fetch: placesFetch({ n: 0 }, "https://www.google.com/search?q=avaliar"), finalizeGeneration: async () => { throw new Error("não deveria"); }, chargeGeneration: async () => { chargedOld++; return null; } };
  const odd = (await run(oddCtx, { action: "place", placeId: PLACE })) as { status: string; shortLink?: unknown; place: { reviewUrl: string } };
  check(odd.status === "found" && !odd.shortLink && chargedOld === 1 && logs.some((l) => l.includes("directlab_short_link_skipped_format")), "R2", odd);
  ok("R: repetir a geração devolve o mesmo código (o banco reaproveita dono + Place ID); se o Google devolver um formato fora dos permitidos, NENHUM link curto é criado — entrega o link do Google como antes, cobrando 1 só vez");

  // ---------- 6. rota pública ----------
  const lookups: string[] = [];
  const db = new Map([["A7K4829", REVIEW], ["BADDEST", "https://evil.example.com/x"]]);
  const lookup = async (code: string) => {
    lookups.push(code);
    return db.get(code) ?? null;
  };
  const before = places.n;
  const res = await resolveReviewShortLink("A7K4829", lookup);
  const lower = await resolveReviewShortLink("a7k4829", lookup);
  check(res.status === 302 && (res as { location: string }).location === REVIEW && lower.status === 302, "P1 302", res);
  const n0 = lookups.length;
  const invalid = await Promise.all(["", "ABC", "ABCDEFGH", "../admin", "A7K4820", "A7K482O"].map((c) => resolveReviewShortLink(c, lookup)));
  check(invalid.every((x) => x.status === 404) && lookups.length === n0 + 0, "P2 formato inválido não consulta o banco", { invalid, consultas: lookups.length - n0 });
  check((await resolveReviewShortLink("ZZZZZZZ", lookup)).status === 404 && (await resolveReviewShortLink("BADDEST", lookup)).status === 404, "P3 inexistente / destino adulterado");
  check((await resolveReviewShortLink("A7K4829", async () => { throw new Error("banco fora"); })).status === 503, "P4 banco fora");
  for (let i = 0; i < 100; i++) await resolveReviewShortLink("A7K4829", lookup);
  check(places.n === before && charged === 1 + 0 && lookups.filter((c) => c === "A7K4829").length >= 101, "P5 100 acessos", { places: places.n - before });
  const route = readFileSync("src/app/r/[code]/route.ts", "utf8");
  // Checagens sobre o CÓDIGO (sem comentários: a documentação da rota cita "nunca 301").
  const routeCode = route.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  check(routeCode.includes("status: 302") && !/\b301\b|permanentRedirect|status:\s*30[18]/.test(routeCode) && !/searchParams|request\.url|places|consume|charge|quota/i.test(routeCode), "P6 rota só código");
  ok("P: /r/<código> → 302 para o destino guardado (aceita minúsculas; nunca 301); formato inválido → 404 sem consultar o banco; inexistente ou destino adulterado → 404; banco fora → 503; 100 acessos = 0 chamadas ao Google e 0 cobranças; a rota não lê destino da requisição");

  // ---------- 7. proxy ----------
  process.env.NEXT_PUBLIC_GO_BASE_URL = "https://go.exemplo.com";
  const { proxy } = await import("@/proxy");
  const at = async (url: string, host: string) => proxy(new NextRequest(url, { headers: { host } }));
  const goR = await at("https://go.exemplo.com/r/A7K4829", "go.exemplo.com");
  const goPlate = await at("https://go.exemplo.com/A7K482", "go.exemplo.com");
  const goLink = await at("https://go.exemplo.com/link/A7K4829", "go.exemplo.com");
  const goEvil = await at("https://go.exemplo.com/r/../admin", "go.exemplo.com");
  const goAdmin = await at("https://go.exemplo.com/admin", "go.exemplo.com");
  const goNested = await at("https://go.exemplo.com/reseller/plates", "go.exemplo.com");
  const goRExtra = await at("https://go.exemplo.com/r/A7K4829/extra", "go.exemplo.com");
  const appR = await at("https://app.exemplo.com/r/A7K4829", "app.exemplo.com");
  check(goR.headers.get("x-middleware-next") === "1" && goLink.headers.get("x-middleware-next") === "1" && appR.headers.get("x-middleware-next") === "1", "X1 /r e /link liberados");
  check((goPlate.headers.get("x-middleware-rewrite") ?? "").endsWith("/go/A7K482"), "X2 placa continua reescrita para /go", goPlate.headers.get("x-middleware-rewrite"));
  // No domínio go, "/admin" (e "/r/../admin", que a URL normaliza para "/admin") é tratado como CÓDIGO de placa
  // (reescrito para /go/admin, como antes desta mudança): o painel nunca é servido ali. Subpastas → 404.
  const asPlate = (r: Response) => (r.headers.get("x-middleware-rewrite") ?? "").endsWith("/go/admin");
  check(asPlate(goAdmin) && asPlate(goEvil) && goNested.status === 404 && goRExtra.status === 404, "X3 nada mais aberto no domínio go", [goAdmin.headers.get("x-middleware-rewrite"), goNested.status, goRExtra.status]);
  ok("X: proxy — /r/<7> liberado sem sessão no domínio go e no domínio do app; placas (/<código> → /go/<código>) e DirectLink (/link/<código>) como antes; no domínio go o painel nunca é servido (/admin vira consulta de placa, como antes) e subpastas como /reseller/plates e /r/<código>/extra dão 404");

  if (failures) {
    console.log(`${failures} falha(s)`);
    process.exit(1);
  }
  console.log("Link curto da Avaliação Google OK");
  process.exit(0);
}
main().catch((e) => {
  console.log("erro:", e instanceof Error ? e.stack : e);
  process.exit(1);
});
