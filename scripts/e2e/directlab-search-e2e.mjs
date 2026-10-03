/**
 * Avaliação Google — modo pesquisa e cobrança só no sucesso, num Chromium
 * real contra o Supabase simulado. Parte 1 usa a ROTA REAL (sem internet no
 * teste: o Google sempre falha) e prova que nada é cobrado. Parte 2 simula o
 * Google no navegador para percorrer a interface em celular e notebook.
 */
import puppeteer from "puppeteer-core";

const APP = process.env.APP_URL ?? "http://localhost:3100";
const STUB = process.env.STUB_URL ?? "http://127.0.0.1:54399";
let failures = 0;
const ok = (l) => console.log(`OK ${l}`);
const check = (c, l, d) => {
  if (!c) {
    failures++;
    console.log(`FALHA ${l}`, JSON.stringify(d ?? ""));
  }
};
async function launch() {
  if (process.env.CHROME_PATH) return puppeteer.launch({ executablePath: process.env.CHROME_PATH, headless: true, args: ["--no-sandbox"] });
  const chromium = (await import("@sparticuz/chromium")).default;
  return puppeteer.launch({ args: chromium.args, executablePath: await chromium.executablePath(), headless: true });
}
const browser = await launch();
const page = await browser.newPage();
const cdp = await page.createCDPSession();
const setMode = (m) => fetch(`${STUB}/__mode?m=${m}`);
const charges = async () => (await (await fetch(`${STUB}/__calls`)).json()).chargeCalls;
async function loginAs(email) {
  await cdp.send("Network.clearBrowserCookies");
  await page.setViewport({ width: 1366, height: 768 });
  await page.goto(`${APP}/login`, { waitUntil: "networkidle0" });
  await page.type("#email", email);
  await page.type("#password", "Senha-Forte-2026");
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => null), page.click(".login-button")]);
}
const api = (body) =>
  page.evaluate(async (b) => {
    const r = await fetch("/api/directlab/google-review", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  }, body);
const overflow = () => page.evaluate(() => document.documentElement.scrollWidth > innerWidth);

try {
  // ---------- Parte 1: rota real, Google indisponível → nada é cobrado ----------
  await setMode("places-key");
  await loginAs("revenda@teste.com");
  const start = await charges();
  const results = [];
  for (const body of [
    { action: "search", query: "Barbearia do Carvalho" },
    { action: "search", query: "Barbearia do Carvalho Barueri" },
    { action: "resolve", url: "não é um link" },
    { action: "resolve", url: "https://evil.com/maps/place/x" },
    { action: "resolve", url: "https://share.google/AbCdEfGh" },
    { action: "place", placeId: "ChIJcarvalhoBarueri01" },
    { action: "place", placeId: "ChIJcarvalhoBarueri01", token: "forjado.comprovante" },
  ]) results.push({ body, ...(await api(body)) });
  const after = await charges();
  check(results.every((r) => r.status >= 400) && after === start, "P1", { start, after, results: results.map((r) => [r.body.action, r.status, r.body.code]) });
  ok(`P1: pela rota real, ${results.length} operações (pesquisas, links inválidos, share.google e geração) que falharam por falta de internet/Google → a cobrança NUNCA foi chamada (${start} → ${after})`);
  await setMode("default");

  // ---------- Parte 2: interface (Google simulado no navegador) ----------
  let apiCalls = [];
  let currentWho = "revenda@teste.com";
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    if (!req.url().endsWith("/api/directlab/google-review")) return req.continue();
    const body = JSON.parse(req.postData() ?? "{}");
    apiCalls.push(body);
    const reply = (status, b) => req.respond({ status, contentType: "application/json", body: JSON.stringify(b) });
    if (body.action === "search") {
      return reply(200, {
        status: "choose",
        originalUrl: null,
        candidates: [
          { placeId: "ChIJcarvalhoBarueri01", name: "Barbearia do Carvalho — Corte, Barba e Bigode Tradicional desde 1998", address: "Avenida Exemplo Muito Comprida, 1234, Jardim dos Exemplos - Barueri - SP, 06400-000", token: "t1" },
          { placeId: "ChIJcarvalhoPremium02", name: "Barbearia Carvalho Premium", address: "Rua Exemplo, 456 - Santana de Parnaíba - SP", token: "t2" },
        ],
      });
    }
    if (body.action === "place") {
      // Como o servidor real: contador só para revendedor (para o ADMIN a cobrança devolve null).
      return reply(200, { status: "found", originalUrl: null, ...(currentWho.startsWith("revenda") ? { quota: { used: 5, limit: 10 } } : {}), place: { placeId: body.placeId, name: "Barbearia Carvalho Premium", address: "Rua Exemplo, 456 - Santana de Parnaíba - SP", reviewUrl: "https://www.google.com/maps/place//data=!4m3!3m2!1s0x94cf:0x1a2b!12e1" } });
    }
    return reply(200, { status: "not_identified", originalUrl: body.url });
  });

  for (const [who, w, h] of [["revenda@teste.com", 390, 844], ["revenda@teste.com", 360, 800], ["revenda@teste.com", 1366, 768], ["revenda@teste.com", 1280, 720], ["admin@teste.com", 1366, 768], ["admin@teste.com", 390, 844]]) {
    if (w === 390 || (who === "admin@teste.com" && w === 1366)) await loginAs(who);
    currentWho = who;
    await page.setViewport({ width: w, height: h });
    const base = who.startsWith("admin") ? "/admin" : "/reseller";
    await page.goto(`${APP}${base}/directlab/google-review`, { waitUntil: "networkidle0" });
    apiCalls = [];
    await page.click('[data-directlab-mode="search"]');
    await page.type("#directlab-search", "Barbearia do Carvalho Barueri");
    check(apiCalls.length === 0, `S1 ${who} ${w}: digitar não chama`, apiCalls);
    await page.click('[data-directlab-search-form] button[type="submit"]');
    await page.waitForSelector('[data-directlab-state="choose"] li button');
    check(!(await overflow()), `S2 ${who} ${w}: lista sem overflow`);
    const selectButtons = await page.$$('[data-directlab-state="choose"] li button');
    await selectButtons[0].click();
    await page.waitForSelector('[data-directlab-state="selected"]');
    const alterar = await page.$$('[data-directlab-state="selected"] button');
    await alterar[1].click();
    await page.waitForSelector('[data-directlab-state="choose"] li button');
    await (await page.$$('[data-directlab-state="choose"] li button'))[1].click();
    await page.waitForSelector('[data-directlab-state="selected"]');
    check(apiCalls.length === 1, `S3 ${who} ${w}: selecionar/alterar não chamam`, apiCalls);
    await page.click('[data-directlab-state="selected"] button.btn-primary');
    await page.waitForSelector('[data-directlab-state="found"]');
    check(apiCalls.length === 2 && apiCalls[1].action === "place" && apiCalls[1].placeId === "ChIJcarvalhoPremium02" && apiCalls[1].token === "t2", `S4 ${who} ${w}: gerar`, apiCalls);
    check(!(await overflow()), `S4 ${who} ${w}: resultado sem overflow`);
    if (who.startsWith("revenda")) {
      const q = await page.$eval("[data-directlab-quota]", (e) => e.textContent).catch(() => null);
      check(q === "5 de 10 utilizações hoje", `S4 ${w}: contador`, q);
    } else {
      check((await page.$eval("[data-directlab-unlimited]", (e) => e.textContent).catch(() => null)) === "Sem limite diário", `S4 ADMIN ${w}`);
    }
  }
  ok("S1–S4: em 390, 360, 1366 e 1280 px (revendedor) e 1366/390 (ADMIN): digitar não chama a API; pesquisar mostra a lista (nomes e endereços longos sem overflow); selecionar e 'Alterar estabelecimento' não chamam; 'Gerar link de avaliação' envia o escolhido (com comprovante) e mostra o link; contador do revendedor só muda na geração; ADMIN 'Sem limite diário'");
} finally {
  await browser.close();
}
if (failures) {
  console.log(`${failures} falha(s)`);
  process.exit(1);
}
console.log("E2E da pesquisa da Avaliação Google OK");
