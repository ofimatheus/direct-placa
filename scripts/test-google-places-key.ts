/**
 * Chave da Google Places gerenciada pelo ADMIN — servidor (sem rede real; chaves FALSAS).
 *   npm run test:google-places-key
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { handleGoogleReviewRequest } from "@/lib/directlab/handler";
import { removeCustomKey, saveNewKey, testEffectiveConnection, type PlacesAdminDeps } from "@/lib/integrations/google-places/admin";
import { resolveGooglePlacesApiKey } from "@/lib/integrations/google-places/key";
import { PLACES_NOT_CONFIGURED_ADMIN } from "@/lib/integrations/google-places/messages";
import { testGooglePlacesKey } from "@/lib/integrations/google-places/test";

let failures = 0;
const ok = (l: string) => console.log(`OK ${l}`);
const check = (c: unknown, l: string, d?: unknown) => {
  if (!c) {
    failures++;
    console.log(`FALHA ${l}`, d ?? "");
  }
};
// Chaves FALSAS (formato válido). Nunca chaves reais.
const ADMIN_KEY = "AIzaFAKEchaveDoAdminParaTestes00000Ad1n";
const ADMIN_KEY2 = "AIzaFAKEchaveNovaDoAdminParaTestes0Nv2x";
const ENV_KEY = "AIzaFAKEchaveDoAmbienteParaTestes000Env";
const BAD_KEY = "AIzaFAKEchaveRecusadaPeloGoogle0000Bad1";
const ALL_KEYS = [ADMIN_KEY, ADMIN_KEY2, ENV_KEY, BAD_KEY];

// Captura TODOS os logs para provar que nenhuma chave é registrada.
const logs: string[] = [];
for (const level of ["log", "info", "warn", "error", "debug"] as const) {
  const orig = console[level].bind(console);
  console[level] = (...args: unknown[]) => {
    logs.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
    if (level === "log") orig(...args);
  };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const leaks = (value: unknown) => ALL_KEYS.filter((k) => JSON.stringify(value).includes(k));

async function main() {
  // ---------- 1–4, 9–10: resolução ADMIN > ambiente, sem cache ----------
  const store = { admin: null as string | null, env: ENV_KEY as string | null };
  const deps = { readAdminKey: async () => store.admin, readEnvKey: () => store.env };
  let r = await resolveGooglePlacesApiKey(deps);
  check(r?.key === ENV_KEY && r.source === "env", "K1", r);
  store.admin = ADMIN_KEY;
  r = await resolveGooglePlacesApiKey(deps);
  check(r?.key === ADMIN_KEY && r.source === "admin", "K2/K3", r);
  store.admin = ADMIN_KEY2;
  r = await resolveGooglePlacesApiKey(deps);
  check(r?.key === ADMIN_KEY2, "K4 troca sem restart", r);
  store.admin = null;
  r = await resolveGooglePlacesApiKey(deps);
  check(r?.key === ENV_KEY && r.source === "env", "K9 remover volta ao ambiente", r);
  store.env = null;
  check((await resolveGooglePlacesApiKey(deps)) === null, "K10 sem nenhuma chave");
  const failing = await resolveGooglePlacesApiKey({ readAdminKey: async () => { throw Object.assign(new Error(`falha ${ADMIN_KEY}`), { code: "PGRST202" }); }, readEnvKey: () => ENV_KEY });
  check(failing?.source === "env" && logs.some((l) => l.includes("google_places_key_lookup_failed") && l.includes("PGRST202")), "K11 Vault indisponível → ambiente + log seguro", failing);
  ok("K1–K4, K9–K10: sem chave do ADMIN usa o ambiente; com ela, a do ADMIN tem prioridade; trocar vale na próxima operação (sem cache/restart); remover volta ao ambiente; sem nenhuma → não configurado");
  ok("K11: se o Vault estiver indisponível, registra só o código (PGRST202) e usa o ambiente");

  // ---------- teste real e mínimo: formato da requisição e classificação ----------
  const seen: { url: string; headers: Record<string, string>; body: string }[] = [];
  const fakeGoogle = (status: number, body: unknown) =>
    (async (url: string, init: RequestInit) => {
      seen.push({ url: String(url), headers: init.headers as Record<string, string>, body: String(init.body) });
      return json(body, status);
    }) as unknown as typeof fetch;
  const t = await testGooglePlacesKey(ADMIN_KEY, { fetch: fakeGoogle(200, { places: [{ id: "x" }] }) });
  const req = seen[0];
  check(t.kind === "ok" && req?.url === "https://places.googleapis.com/v1/places:searchText", "T1 ok", t);
  check(req?.headers["X-Goog-Api-Key"] === ADMIN_KEY && req.headers["X-Goog-FieldMask"] === "places.id" && !req.url.includes(ADMIN_KEY) && !req.body.includes(ADMIN_KEY) && JSON.parse(req.body).pageSize === 1, "T1 requisição", req);
  ok("T1: o teste é uma chamada real e mínima (Text Search, só places.id, 1 resultado); a chave vai só no cabeçalho, nunca na URL ou no corpo");
  const cases: [number, unknown, string, string | null][] = [
    [403, { error: { status: "PERMISSION_DENIED", message: "billing", details: [{ reason: "BILLING_DISABLED" }] } }, "permission_denied", "BILLING_DISABLED"],
    [400, { error: { status: "INVALID_ARGUMENT", message: "API key not valid. Please pass a valid API key.", details: [{ reason: "API_KEY_INVALID" }] } }, "invalid_key", "API_KEY_INVALID"],
    [429, { error: { status: "RESOURCE_EXHAUSTED" } }, "quota_exceeded", null],
    [503, { error: { status: "UNAVAILABLE" } }, "unavailable", null],
    [403, { error: { status: "PERMISSION_DENIED", details: [{ reason: "CAMPO_LIVRE_DESCONHECIDO" }] } }, "permission_denied", null],
  ];
  for (const [status, body, kind, reason] of cases) {
    const res = await testGooglePlacesKey(ADMIN_KEY, { fetch: fakeGoogle(status, body) });
    check(res.kind === kind && res.reason === reason, `T2 HTTP ${status} ${kind}`, res);
  }
  const proxy = await testGooglePlacesKey(ADMIN_KEY, { fetch: (async () => new Response("Forbidden by proxy", { status: 403 })) as unknown as typeof fetch });
  check(proxy.kind === "unexpected" && proxy.httpStatus === 403, "T2 403 sem erro do Google (proxy) não é PERMISSION_DENIED", proxy);
  const net = await testGooglePlacesKey(ADMIN_KEY, { fetch: (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch });
  check(net.kind === "unavailable", "T2 rede", net);
  ok("T2: PERMISSION_DENIED (com motivo seguro, ex. BILLING_DISABLED), API key not valid, RESOURCE_EXHAUSTED, Google 5xx e falha de rede são diferenciados; um 403 sem o erro do Google (proxy) não vira PERMISSION_DENIED; motivo desconhecido não é repassado");

  // ---------- 5–8: Testar e salvar / Testar conexão ----------
  const calls = { save: [] as string[], record: [] as string[], test: 0 };
  const current = { admin: ADMIN_KEY as string | null, env: ENV_KEY as string | null };
  const googleSays = (key: string) => (key === BAD_KEY ? { kind: "permission_denied" as const, reason: "API_KEY_SERVICE_BLOCKED", httpStatus: 403 } : { kind: "ok" as const, reason: null, httpStatus: 200 });
  const adminDeps: PlacesAdminDeps = {
    resolveKey: () => resolveGooglePlacesApiKey({ readAdminKey: async () => current.admin, readEnvKey: () => current.env }),
    testKey: async (key) => {
      calls.test++;
      return googleSays(key);
    },
    saveKey: async (key) => {
      calls.save.push(key);
      current.admin = key;
      return key.slice(-4);
    },
    removeKey: async () => {
      current.admin = null;
    },
    recordTest: async (kind, source) => void calls.record.push(`${kind}/${source}`),
  };
  const invalid = await saveNewKey("AIza-curta", adminDeps);
  check(!invalid.ok && invalid.kind === "invalid_format" && calls.test === 0 && calls.save.length === 0, "S1 formato", invalid);
  const denied = await saveNewKey(BAD_KEY, adminDeps);
  check(!denied.ok && denied.kind === "permission_denied" && denied.message.includes("PERMISSION_DENIED") && denied.message.includes("A chave atual foi mantida.") && calls.save.length === 0 && current.admin === ADMIN_KEY, "S2 recusada não substitui", denied);
  const saved = await saveNewKey(`  ${ADMIN_KEY2}  `, adminDeps);
  check(saved.ok && saved.last4 === "0Nv2x".slice(-4) && calls.save[0] === ADMIN_KEY2 && current.admin === ADMIN_KEY2 && calls.record.includes("ok/admin"), "S3 válida salva", saved);
  check((await adminDeps.resolveKey())?.key === ADMIN_KEY2, "S3 vale na hora");
  const test1 = await testEffectiveConnection(adminDeps);
  check(test1.ok && test1.source === "admin" && test1.message === "✓ Conexão realizada com sucesso. Google Places está disponível.", "S4 testar conexão", test1);
  for (const res of [invalid, denied, saved, test1]) check(leaks(res).length === 0, "S5 resposta sem chave", res);
  ok("S1–S5: formato inválido nem chega ao Google; chave recusada (PERMISSION_DENIED) NÃO substitui a atual; chave válida é testada, salva e vale na hora; 'Testar conexão' usa a chave efetiva; nenhuma resposta contém chave");

  // ---------- 9–10: remover ----------
  const rem = await removeCustomKey(adminDeps);
  check(rem.source === "env" && (await adminDeps.resolveKey())?.key === ENV_KEY, "R1 volta ao ambiente", rem);
  current.env = null;
  const rem2 = await removeCustomKey(adminDeps);
  check(rem2.source === null, "R2 sem ambiente", rem2);
  const none = await testEffectiveConnection(adminDeps);
  check(!none.ok && none.kind === "not_configured" && none.message === PLACES_NOT_CONFIGURED_ADMIN && calls.test === 3, "R3 testar sem chave", none);
  ok("R1–R3: remover volta ao ambiente; sem ambiente fica 'não configurado' (testar nem chama o Google)");

  // ---------- 16–17: Avaliação Google usa a chave efetiva ----------
  for (const [label, key] of [["ADMIN", ADMIN_KEY2], ["ambiente", ENV_KEY]] as const) {
    let header = "";
    const effective = await resolveGooglePlacesApiKey({ readAdminKey: async () => (label === "ADMIN" ? key : null), readEnvKey: () => (label === "ADMIN" ? ENV_KEY : key) });
    const result = (await handleGoogleReviewRequest(
      { action: "place", placeId: "ChIJadegaMonster0001" },
      {
        apiKey: effective?.key ?? null,
        fetch: (async (_u: string, init: RequestInit) => {
          header = (init.headers as Record<string, string>)["X-Goog-Api-Key"] ?? "";
          return json({ id: "ChIJadegaMonster0001", displayName: { text: "Adega" }, formattedAddress: "Barueri", googleMapsLinks: { writeAReviewUri: "https://search.google.com/local/writereview?placeid=ChIJadegaMonster0001" } });
        }) as unknown as typeof fetch,
        resolve: { lookup: async () => ["142.250.79.46"] },
        consumeQuota: async () => undefined,
        consumeDaily: async () => null,
      },
    )) as { status: string };
    check(result.status === "found" && header === key, `G${label}`, { result, header });
  }
  ok("G1–G2: a Avaliação Google funciona com a chave do ADMIN (com prioridade sobre o ambiente) e também só com GOOGLE_PLACES_API_KEY");

  // ---------- 14, 15, 18: código, cliente, logs, cota ----------
  const root = process.cwd();
  const read = (p: string) => readFileSync(join(root, p), "utf8");
  const files: string[] = [];
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(n)) files.push(p.replace(root + "/", ""));
    }
  };
  walk(join(root, "src"));
  const envReaders = files.filter((f) => read(f).includes("process.env.GOOGLE_PLACES_API_KEY"));
  check(envReaders.length === 1 && envReaders.at(0) === "src/lib/env.server.ts", "C1 leitura única do ambiente", envReaders);
  check(!files.some((f) => /NEXT_PUBLIC_GOOGLE/.test(read(f))), "C1 sem NEXT_PUBLIC");
  const clientFiles = files.filter((f) => /^["']use client["']/m.test(read(f)));
  const serverOnly = ["integrations/google-places/key", "integrations/google-places/test", "integrations/google-places/admin", "env.server", "supabase/admin"];
  // Só os caminhos de IMPORT contam (uma URL de API no código não é import).
  const importsOf = (f: string) => [...read(f).matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1] ?? "");
  const badClient = clientFiles.filter((f) => importsOf(f).some((spec) => serverOnly.some((m) => spec.endsWith(m))));
  check(importsOf("src/components/settings/GooglePlacesCard.tsx").includes("@/lib/integrations/google-places/messages"), "C2 o card importa só as mensagens");
  check(badClient.length === 0, "C2 componente cliente não importa módulo de servidor", badClient);
  for (const m of ["key", "test", "admin"]) check(read(`src/lib/integrations/google-places/${m}.ts`).startsWith('import "server-only";'), `C2 ${m} é server-only`);
  const viewType = (read("src/components/settings/GooglePlacesCard.tsx").split("export interface GooglePlacesView")[1] ?? "").split("}")[0] ?? "";
  check(viewType.includes("last4") && !/apiKey|api_key|\bkey:/.test(viewType), "C3 props sem chave", viewType);
  const testRoute = read("src/app/api/admin/integrations/google-places/test/route.ts");
  check(testRoute.includes("requireAdminApi()") && !/quota|consume/i.test(testRoute.replace(/\/\*[\s\S]*?\*\//g, "")), "C4 teste do ADMIN sem cota");
  check(read("src/app/api/admin/integrations/google-places/route.ts").match(/requireAdminApi\(\)/g)?.length === 2, "C5 PUT/DELETE só ADMIN");
  check(read("src/app/api/directlab/google-review/route.ts").includes('from "@/lib/integrations/google-places/key"'), "C6 Avaliação Google usa a função central");
  ok("C1–C6: GOOGLE_PLACES_API_KEY é lida em um único lugar (env.server.ts, servidor); nenhum NEXT_PUBLIC_; componentes cliente não importam módulos com a chave; props sem chave; teste do ADMIN não passa pela cota; rotas só ADMIN; Avaliação Google usa getGooglePlacesApiKey()");

  const leaked = logs.filter((l) => ALL_KEYS.some((k) => l.includes(k)));
  check(leaked.length === 0, "L1 logs", leaked);
  check(logs.some((l) => l.includes("google_places_test_failed") && l.includes("permission_denied")), "L1 log seguro existe");
  ok(`L1: ${logs.length} linhas de log capturadas durante os testes; nenhuma contém chave (só códigos como google_places_test_failed/permission_denied)`);

  if (failures) {
    console.log(`${failures} falha(s)`);
    process.exit(1);
  }
  console.log("Chave da Google Places OK");
  process.exit(0);
}
main().catch((e) => {
  console.log(e instanceof Error ? e.message : "erro");
  process.exit(1);
});
