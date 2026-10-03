/**
 * Configurações > Integrações (Google Places) num Chromium real contra o
 * Supabase simulado (chave FALSA). Prova que a chave nunca chega ao navegador
 * (HTML, payload do React, JS, respostas) e que o revendedor é barrado.
 * Pré-requisitos: iguais aos de login-e2e.mjs.
 */
import puppeteer from "puppeteer-core";

const APP = process.env.APP_URL ?? "http://localhost:3100";
const STUB = process.env.STUB_URL ?? "http://127.0.0.1:54399";
const FAKE = "AIzaFAKEE2EchaveFalsaDoSimulador000X9zQ";
let failures = 0;
const ok = (l) => console.log(`OK ${l}`);
const check = (c, l, d) => {
  if (!c) {
    failures++;
    console.log(`FALHA ${l}`, d ?? "");
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
const bodies = [];
page.on("response", async (r) => {
  if (!r.url().startsWith(APP)) return;
  try {
    bodies.push({ url: r.url(), text: await r.text() });
  } catch {}
});
async function loginAs(email) {
  await cdp.send("Network.clearBrowserCookies");
  await page.setViewport({ width: 1366, height: 768 });
  await page.goto(`${APP}/login`, { waitUntil: "networkidle0" });
  await page.type("#email", email);
  await page.type("#password", "Senha-Forte-2026");
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => null), page.click(".login-button")]);
}
const api = (method, path, body) =>
  page.evaluate(
    async (m, p, b) => {
      const r = await fetch(p, { method: m, headers: b ? { "Content-Type": "application/json" } : undefined, body: b ? JSON.stringify(b) : undefined });
      return { status: r.status, text: await r.text() };
    },
    method,
    path,
    body,
  );

try {
  // ---------- ADMIN ----------
  await setMode("default");
  await loginAs("admin@teste.com");
  await page.goto(`${APP}/admin/settings`, { waitUntil: "networkidle0" });
  const tabs = await page.$$eval('nav[aria-label="Seções de configurações"] a', (as) => as.map((a) => a.getAttribute("href")));
  check(tabs.join() === "/admin/settings,/admin/settings/integrations" && (await page.$("#branding-title")), "I1 abas e branding", tabs);
  await page.goto(`${APP}/admin/settings/integrations`, { waitUntil: "networkidle0" });
  check((await page.$eval("[data-gp-status]", (e) => e.textContent)) === "Não configurada" && (await page.$eval("[data-gp-env]", (e) => e.textContent)) === "Não definida", "I1 sem chave");
  ok("I1: Configurações ganhou as abas 'Geral e branding' | 'Integrações' (branding intacto); sem chave mostra 'Não configurada'");

  await setMode("places-key");
  bodies.length = 0;
  await page.goto(`${APP}/admin/settings/integrations`, { waitUntil: "networkidle0" });
  check((await page.$eval("[data-gp-source]", (e) => e.textContent)) === "Configuração do administrador" && (await page.$eval("[data-gp-masked]", (e) => e.textContent)) === "AIza••••••••••••X9zQ", "I2 máscara");
  const html = await page.content();
  const raw = await api("GET", "/admin/settings/integrations");
  const rsc = await page.evaluate(async () => (await fetch(location.pathname, { headers: { RSC: "1" } })).text());
  const scripts = await page.$$eval("script[src]", (ss) => ss.map((s) => s.src));
  const js = await page.evaluate(async (srcs) => (await Promise.all(srcs.map((s) => fetch(s).then((r) => r.text())))).join("\n"), scripts);
  check(!html.includes(FAKE) && !raw.text.includes(FAKE) && !rsc.includes(FAKE), "I2 HTML/payload sem a chave");
  check(scripts.length > 0 && !js.includes(FAKE) && !js.includes("GOOGLE_PLACES_API_KEY"), "I2 JS sem a chave", scripts.length);
  ok(`I2: com chave do ADMIN, a tela mostra só 'AIza••••••••••••X9zQ'; a chave não está no HTML, no payload do React (RSC) nem nos ${scripts.length} arquivos JS carregados`);

  await page.click("[data-gp-test]");
  await page.waitForSelector("[data-gp-feedback]", { timeout: 20000 });
  const fb = await page.$eval("[data-gp-feedback]", (e) => e.textContent);
  check(/Google|chave/.test(fb ?? ""), "I3 resultado", fb);
  check(!bodies.some((b) => b.text.includes(FAKE)), "I3 respostas sem a chave", bodies.filter((b) => b.text.includes(FAKE)).map((b) => b.url));
  ok(`I3: 'Testar conexão' chama o Google no servidor com a chave do ADMIN (aqui sem internet: "${(fb ?? "").slice(0, 60)}…"); nenhuma resposta ao navegador contém a chave`);

  await page.click("[data-gp-edit]");
  await page.type("#gp-new-key", "AIza-curta");
  check(await page.$eval('[data-gp-form] button[type="submit"]', (b) => b.disabled), "I4 formato");
  for (const w of [390, 360]) {
    await page.setViewport({ width: w, height: 800 });
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `I4 sem overflow ${w}`);
  }
  ok("I4: formulário de chave nova valida o formato antes de enviar; tela sem overflow em 390 e 360 px");

  // Avaliação Google: ADMIN sem chave → mensagem do ADMIN
  await setMode("default");
  const adminNo = await api("POST", "/api/directlab/google-review", { action: "place", placeId: "ChIJadegaMonster0001" });
  check(adminNo.status === 503 && JSON.parse(adminNo.text).error === "Google Places ainda não foi configurado. Entre em Configurações > Integrações.", "I5 ADMIN sem chave", adminNo.text);

  // ---------- REVENDEDOR ----------
  await loginAs("revenda@teste.com");
  const resNo = await api("POST", "/api/directlab/google-review", { action: "place", placeId: "ChIJadegaMonster0001" });
  check(resNo.status === 503 && JSON.parse(resNo.text).error === "A integração com o Google está temporariamente indisponível. Entre em contato com o administrador.", "I5 revendedor sem chave", resNo.text);
  await setMode("places-key");
  const resKey = await api("POST", "/api/directlab/google-review", { action: "place", placeId: "ChIJadegaMonster0001" });
  check(JSON.parse(resKey.text).code !== "not_configured" && !resKey.text.includes(FAKE), "I5 com chave do ADMIN", resKey.text);
  ok(`I5: sem chave, ADMIN recebe 'Google Places ainda não foi configurado. Entre em Configurações > Integrações.' e o revendedor 'temporariamente indisponível'; com a chave do ADMIN a Avaliação Google passa a consultar o Google (aqui sem internet: ${JSON.parse(resKey.text).code})`);

  await page.goto(`${APP}/admin/settings/integrations`, { waitUntil: "networkidle0" });
  check(!page.url().includes("/admin/settings/integrations") && !(await page.$("[data-integration]")), "I6 página", page.url());
  for (const [m, p, b] of [["PUT", "/api/admin/integrations/google-places", { apiKey: "AIzaFAKEtentativaDoRevendedor00000000Rv1" }], ["DELETE", "/api/admin/integrations/google-places"], ["POST", "/api/admin/integrations/google-places/test"]]) {
    const r = await api(m, p, b);
    check(r.status === 403 && !r.text.includes(FAKE), `I6 ${m} ${p}`, r);
  }
  ok("I6: revendedor não abre Configurações > Integrações (redirecionado) e recebe 403 ao chamar direto testar, salvar e remover");
  await setMode("default");
} finally {
  await browser.close();
}
if (failures) {
  console.log(`${failures} falha(s)`);
  process.exit(1);
}
console.log("E2E de integrações OK");
