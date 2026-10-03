/**
 * DirectLab ponta a ponta num Chromium real, contra o Supabase simulado.
 * Mesmos pré-requisitos de login-e2e.mjs (stub + next dev SEM
 * GOOGLE_PLACES_API_KEY). O Google não é acessado: o teste confere a
 * autenticação real das rotas, o estado "não configurado", o layout em
 * celular e desktop e a área de transferência real.
 */
import puppeteer from "puppeteer-core";

const APP = process.env.APP_URL ?? "http://localhost:3100";
const PASSWORD = "Senha-Forte-2026";
const REVIEW = "https://search.google.com/local/writereview?placeid=ChIJadegaMonster0001";
let failures = 0;
const ok = (label) => console.log(`OK ${label}`);
const check = (cond, label, detail) => {
  if (!cond) {
    failures++;
    console.log(`FALHA ${label}`, detail ?? "");
  }
};

async function launch() {
  if (process.env.CHROME_PATH) return puppeteer.launch({ executablePath: process.env.CHROME_PATH, headless: true, args: ["--no-sandbox"] });
  const chromium = (await import("@sparticuz/chromium")).default;
  return puppeteer.launch({ args: chromium.args, executablePath: await chromium.executablePath(), headless: true });
}

// ---------- E1: sem login ----------
for (const [method, path] of [["POST", "/api/directlab/google-review"], ["GET", "/api/directlab/plates"]]) {
  const res = await fetch(`${APP}${path}`, { method, headers: { "Content-Type": "application/json" }, body: method === "POST" ? JSON.stringify({ action: "resolve", url: "https://share.google/x" }) : undefined });
  const body = await res.json().catch(() => ({}));
  check(res.status === 401 && !JSON.stringify(body).includes("GOOGLE"), `E1 ${path} sem login → ${res.status}`, body);
}
const page0 = await fetch(`${APP}/reseller/directlab`, { redirect: "manual" });
check(page0.status >= 300 && page0.status < 400 && (page0.headers.get("location") ?? "").includes("/login"), "E1 página sem login", page0.status);
ok("E1: sem login, as rotas do DirectLab respondem 401 e a página manda para /login");

const browser = await launch();
const page = await browser.newPage();
const cdp = await page.createCDPSession();

async function loginAs(email) {
  await cdp.send("Network.clearBrowserCookies");
  await page.goto(`${APP}/login`, { waitUntil: "networkidle0" });
  await page.type("#email", email);
  await page.type("#password", PASSWORD);
  await Promise.all([page.waitForNavigation({ waitUntil: "domcontentloaded" }).catch(() => null), page.click(".login-button")]);
}
/** Clica como uma pessoa: centraliza o botão e confirma que nada (ex.: barra inferior fixa) está por cima dele. */
async function clickButton(label) {
  const result = await page.evaluate((text) => {
    const el = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === text);
    if (!el) return { found: false };
    el.scrollIntoView({ block: "center" });
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { found: true, reachable: el === top || el.contains(top) };
  }, label);
  check(result.found && result.reachable, `botão "${label}" alcançável (não coberto)`, result);
  await page.evaluate((text) => [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === text)?.click(), label);
}
async function overflow() {
  return page.evaluate(() => ({ scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth }));
}
async function apiFromPage(body) {
  return page.evaluate(async (b) => {
    const r = await fetch("/api/directlab/google-review", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });
    return { status: r.status, body: await r.json() };
  }, body);
}

try {
  // ---------- E2: revendedor ----------
  await loginAs("revenda@teste.com");
  for (const width of [360, 390, 1440]) {
    await page.setViewport({ width, height: 860 });
    await page.goto(`${APP}/reseller/directlab/google-review`, { waitUntil: "networkidle0" });
    const m = await overflow();
    check(m.scrollW <= m.innerW, `E2 overflow revendedor ${width}`, m);
    check(await page.$('[data-directlab-tool="google-review"]'), `E2 ferramenta ${width}`);
  }
  check(await page.$('a[href="/reseller/directlab"]'), "E2 menu do revendedor");
  const reseller = await apiFromPage({ action: "resolve", url: "https://share.google/UHvh2Pg8JPeIykuoO" });
  check(reseller.status === 503 && reseller.body.code === "not_configured" && !JSON.stringify(reseller.body).includes("GOOGLE_PLACES"), "E2 revendedor chega ao endpoint", reseller);
  const external = await apiFromPage({ action: "resolve", url: "https://evil.com/x" });
  check(external.status === 422 && external.body.code === "domain_not_allowed", "E2 domínio externo no servidor", external);

  await page.type("#directlab-link", "https://share.google/UHvh2Pg8JPeIykuoO");
  await page.click('[data-directlab-tool] button[type="submit"]');
  await page.waitForSelector('[data-directlab-error="not_configured"]', { timeout: 15000 });
  const plates = await page.evaluate(async () => (await fetch("/api/directlab/plates")).status);
  check(plates !== 401 && plates !== 403, "E2 listagem de placas autenticada", plates);
  ok("E2: revendedor abre o DirectLab (menu + página), chega ao endpoint autenticado; sem chave vê 'não configurado'; domínio externo é recusado no servidor; sem overflow em 360, 390 e 1440 px");

  // ---------- E3: ADMIN ----------
  await loginAs("admin@teste.com");
  await page.setViewport({ width: 390, height: 860 });
  await page.goto(`${APP}/admin/directlab/google-review`, { waitUntil: "networkidle0" });
  const ma = await overflow();
  check(ma.scrollW <= ma.innerW && (await page.$('[data-directlab-tool="google-review"]')), "E3 página do ADMIN", ma);
  const admin = await apiFromPage({ action: "resolve", url: "https://maps.app.goo.gl/AbC123" });
  check(admin.status === 503 && admin.body.code === "not_configured", "E3 ADMIN chega ao endpoint", admin);
  ok("E3: ADMIN abre o DirectLab e chega ao endpoint autenticado; sem overflow no celular");

  // ---------- E4: resultado, copiar e modal no celular (API simulada no navegador) ----------
  await loginAs("revenda@teste.com");
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const url = req.url();
    const reply = (body) => req.respond({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    if (url.endsWith("/api/directlab/google-review")) {
      return reply({ status: "found", place: { placeId: "ChIJadegaMonster0001", name: "Adega Monster Conveniência e Tabacaria do Centro", address: "Avenida Exemplo Muito Comprida, 12345 - Jardim Paulista, Barueri - SP, 06400-000", reviewUrl: REVIEW + "&x=" + "y".repeat(120) }, originalUrl: "https://share.google/UHvh2Pg8JPeIykuoO" });
    }
    if (url.includes("/api/directlab/plates")) {
      return reply({ role: "reseller", plates: [{ id: "p1", public_code: "JKJ4NN", status: "assigned", customer_id: null, customer_name: "Adega Monster Conveniência e Tabacaria", reseller_name: null, destination_type: "website", destination_url: "https://um-site-com-um-endereco-bem-longo.com.br/pagina/interna" }] });
    }
    return req.continue();
  });
  for (const width of [360, 390]) {
    await page.setViewport({ width, height: 860 });
    await page.goto(`${APP}/reseller/directlab/google-review`, { waitUntil: "networkidle0" });
    await page.type("#directlab-link", "https://share.google/UHvh2Pg8JPeIykuoO");
    await page.click('[data-directlab-tool] button[type="submit"]');
    await page.waitForSelector('[data-directlab-state="found"]');
    const m = await overflow();
    check(m.scrollW <= m.innerW, `E4 overflow com resultado ${width}`, m);
    if (width === 390) await page.screenshot({ path: "/tmp/e2e-directlab-390.png", fullPage: true });
  }
  // O navegador só libera a área de transferência com permissão; sem ela, o CopyButton abre o modal de cópia manual.
  await browser.defaultBrowserContext().overridePermissions(APP, ["clipboard-read", "clipboard-write", "clipboard-sanitized-write"]);
  await clickButton("Copiar link");
  const copyOutcome = await page
    .waitForFunction(() => (document.body.textContent.includes("Link copiado") ? "copiado" : document.body.textContent.includes("Copiar texto") ? "manual" : false), { timeout: 5000 })
    .then((h) => h.jsonValue())
    .catch(() => "nada");
  check(copyOutcome === "copiado", "E4 feedback de cópia", copyOutcome);
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  check(clip.startsWith(REVIEW), "E4 área de transferência real", clip);
  await clickButton("Usar em uma placa");
  await page.waitForSelector("[data-plate-list] button");
  const dialog = await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]')?.getBoundingClientRect();
    return { left: d?.left, right: d?.right, innerW: window.innerWidth, scrollW: document.documentElement.scrollWidth };
  });
  check(dialog.left >= 0 && dialog.right <= dialog.innerW && dialog.scrollW <= dialog.innerW, "E4 modal cabe na tela", dialog);
  await page.screenshot({ path: "/tmp/e2e-directlab-modal-390.png" });
  ok("E4: no celular, card de resultado (nome, endereço e link longos) e modal de placas sem overflow; Copiar link grava na área de transferência real e mostra 'Link copiado'");

  await page.setViewport({ width: 1440, height: 900 });
  await page.keyboard.press("Escape");
  await page.screenshot({ path: "/tmp/e2e-directlab-1440.png" });
} finally {
  await browser.close();
}
if (failures) {
  console.log(`${failures} falha(s)`);
  process.exit(1);
}
console.log("E2E do DirectLab OK");
