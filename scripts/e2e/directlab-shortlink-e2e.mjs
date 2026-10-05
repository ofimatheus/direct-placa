/**
 * Link curto da Avaliação Google (/r/<código>) num servidor Next real + Chromium.
 */
import puppeteer from "puppeteer-core";

const APP = process.env.APP_URL ?? "http://localhost:3100";
const STUB = process.env.STUB_URL ?? "http://127.0.0.1:54399";
let failures = 0;
const ok = (l) => console.log(`OK ${l}`);
const check = (c, l, d) => {
  if (!c) {
    failures++;
    console.log(`FALHA ${l}`, JSON.stringify(d ?? "").slice(0, 400));
  }
};
async function launch() {
  if (process.env.CHROME_PATH) return puppeteer.launch({ executablePath: process.env.CHROME_PATH, headless: true, args: ["--no-sandbox"] });
  const chromium = (await import("@sparticuz/chromium")).default;
  return puppeteer.launch({ args: chromium.args, executablePath: await chromium.executablePath(), headless: true });
}
const REVIEW = "https://www.google.com/maps/place//data=!4m3!3m2!1s0x94cf01b30bf59ca7:0x21e10e82e733c4f7!12e1?g_mp=Cidnb29nbGUubWFwcy5wbGFjZXMudjEuUGxhY2VzLkdldFBsYWNl";
const calls = async () => (await fetch(`${STUB}/__calls`)).json();
const raw = (path) => fetch(`${APP}${path}`, { redirect: "manual" });

const browser = await launch();
await browser.defaultBrowserContext().overridePermissions(APP, ["clipboard-read", "clipboard-write", "clipboard-sanitized-write"]);
const page = await browser.newPage();
async function loginAs(email) {
  await (await page.createCDPSession()).send("Network.clearBrowserCookies");
  await page.setViewport({ width: 1366, height: 900 });
  await page.goto(`${APP}/login`, { waitUntil: "networkidle0" });
  await page.type("#email", email);
  await page.type("#password", "Senha-Forte-2026");
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => null), page.click(".login-button")]);
}

try {
  // ---------- 1. rota pública ----------
  await fetch(`${STUB}/__review-link?code=A7K4829&dest=${encodeURIComponent(REVIEW)}`);
  const r1 = await raw("/r/A7K4829");
  const r2 = await raw("/r/a7k4829");
  check(r1.status === 302 && r1.headers.get("location") === REVIEW && r1.headers.get("cache-control")?.includes("no-store") && r2.status === 302, "R1 redirect", { status: r1.status, location: r1.headers.get("location") });
  const before = await calls();
  const statuses = [];
  for (let i = 0; i < 100; i++) statuses.push((await raw("/r/A7K4829")).status);
  const after = await calls();
  check(statuses.every((s) => s === 302) && after.chargeCalls === before.chargeCalls && after.finalizeCalls === before.finalizeCalls && after.reviewLookups === before.reviewLookups + 100, "R2 100 acessos", { before, after });
  ok(`R1/R2: GET /r/A7K4829 (sem login) → 302 para o link oficial do Google (Cache-Control: no-store; minúsculas também); 100 acessos = 100 consultas só do código, ${after.chargeCalls - before.chargeCalls} cobranças e ${after.finalizeCalls - before.finalizeCalls} gerações`);

  const nf = await raw("/r/ZZZZZZZ");
  const nfText = await nf.text();
  const lookups0 = (await calls()).reviewLookups;
  const bad = await Promise.all(["/r/ABC", "/r/A7K4829X", "/r/A7K4829?dest=https://evil.example.com"].map(async (p) => (await raw(p)).status));
  const evil = await raw("/r/A7K4829?dest=https://evil.example.com&url=https://evil.example.com");
  check(nf.status === 404 && nfText.includes("Link não encontrado ou indisponível.") && nf.headers.get("x-robots-tag")?.includes("noindex"), "R3 inexistente", nf.status);
  check(bad[0] === 404 && bad[1] === 404 && evil.status === 302 && evil.headers.get("location") === REVIEW && (await calls()).reviewLookups === lookups0 + 2, "R4 query ignorada", { bad, evil: evil.headers.get("location") });
  ok("R3/R4: código inexistente → 404 'Link não encontrado ou indisponível.' (noindex); formato inválido → 404 sem consultar o banco; ?dest=/?url= na requisição são IGNORADOS (continua indo para o destino guardado)");

  // ---------- 2. rotas públicas antigas intactas ----------
  const login = await raw("/login");
  const landing = await raw("/revendedores");
  check(login.status === 200 && landing.status === 200, "R5", [login.status, landing.status]);
  ok("R5: /login e /revendedores continuam respondendo (as rotas /go e /link são cobertas pelos E2E próprios)");

  // ---------- 3. rota real da geração: Google fora → nada cobrado, nenhum link ----------
  await loginAs("revenda@teste.com");
  const g0 = await calls();
  const gen = await page.evaluate(async () => {
    const r = await fetch("/api/directlab/google-review", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "place", placeId: "ChIJcarvalhoBarueri01" }) });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  });
  const g1 = await calls();
  check(gen.status >= 400 && g1.finalizeCalls === g0.finalizeCalls && g1.chargeCalls === g0.chargeCalls, "G1", { gen, g0, g1 });
  ok(`G1: pela rota real, a geração com o Google indisponível falha (${gen.body.code}) e NÃO chama a finalização (0 cobrança, 0 link curto)`);

  // ---------- 4. interface no navegador real ----------
  await page.setRequestInterception(true);
  let apiHits = 0;
  page.on("request", (req) => {
    if (!req.url().endsWith("/api/directlab/google-review")) return req.continue();
    apiHits++;
    const body = JSON.parse(req.postData() ?? "{}");
    const reply = (status, b) => req.respond({ status, contentType: "application/json", body: JSON.stringify(b) });
    if (body.action === "place" || body.action === "resolve")
      return reply(200, { status: "found", originalUrl: null, quota: { used: 6, limit: 10 }, shortLink: { code: "A7K4829", url: `${APP}/r/A7K4829`, bytes: Buffer.byteLength(`${APP}/r/A7K4829`, "utf8") }, place: { placeId: "ChIJcarvalhoBarueri01", name: "Barbearia Carvalho", address: "Rua Exemplo, 456 - Santana de Parnaíba - SP", reviewUrl: REVIEW } });
    return reply(200, { status: "not_identified", originalUrl: body.url });
  });
  const problems = [];
  for (const [w, h] of [[390, 844], [320, 568], [1366, 768]]) {
    await page.setViewport({ width: w, height: h });
    await page.goto(`${APP}/reseller/directlab/google-review`, { waitUntil: "networkidle0" });
    // Só envia depois que o React assumiu o campo (na 1ª carga, digitar antes da hidratação
    // pode ser apagado pelo campo controlado): confere valor + botão habilitado; senão digita de novo.
    const LINK = "https://share.google/UHvh2Pg8JPeIykuoO";
    for (let tentativa = 1; tentativa <= 3; tentativa++) {
      await page.click("#directlab-link", { clickCount: 3 });
      await page.type("#directlab-link", LINK);
      const pronto = await page
        .waitForFunction(
          (v) => document.querySelector("#directlab-link")?.value === v && [...document.querySelectorAll("button")].some((b) => b.textContent.includes("Gerar link") && !b.disabled),
          { timeout: 3000 },
          LINK,
        )
        .then(() => true)
        .catch(() => false);
      if (pronto) break;
      console.log(`aviso: ${w}px tentativa ${tentativa} — campo ainda não pronto (hidratação), digitando de novo`);
    }
    await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.includes("Gerar link")).click());
    try {
      await page.waitForSelector("[data-directlab-short-url]", { timeout: 10000 });
    } catch (e) {
      // Diagnóstico: o que a tela mostrava quando o resultado não apareceu.
      const diag = await page.evaluate(() => ({
        estado: [...document.querySelectorAll("[data-directlab-state]")].map((el) => el.getAttribute("data-directlab-state")),
        erro: document.querySelector("[data-directlab-error]")?.textContent?.slice(0, 160) ?? null,
        valorDoCampo: document.querySelector("#directlab-link")?.value ?? null,
        botaoDesabilitado: [...document.querySelectorAll("button")].find((b) => b.textContent.includes("Gerar link"))?.disabled ?? null,
      }));
      console.log("DIAG", w, JSON.stringify({ ...diag, chamadasApi: apiHits }));
      await page.screenshot({ path: `/tmp/shortlink-falha-${w}.png` });
      throw e;
    }
    const view = await page.evaluate(() => ({
      title: document.querySelector('[data-directlab-state="found"]')?.textContent?.includes("Link de avaliação gerado"),
      short: document.querySelector("[data-directlab-short-url]")?.value,
      bytes: document.querySelector("[data-directlab-short-bytes]")?.textContent,
      original: !!document.querySelector("[data-directlab-original-link]"),
      overflow: document.documentElement.scrollWidth > innerWidth,
    }));
    if (!view.title || !view.short?.endsWith("/r/A7K4829") || !view.original) problems.push(`${w}: ${JSON.stringify(view)}`);
    if (view.overflow) problems.push(`${w}: rolagem horizontal`);
    if (w === 390) {
      await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Copiar link").click());
      const clip = await page.evaluate(() => navigator.clipboard.readText());
      if (!clip.endsWith("/r/A7K4829")) problems.push(`copiar: ${clip}`);
      await page.screenshot({ path: "/tmp/shortlink-390.png" });
    }
  }
  check(problems.length === 0, "U1", problems);
  ok("U1: no navegador real (320, 390 e 1366): '✓ Link de avaliação gerado' com o link curto como principal, 'Ver link original do Google' secundário, 'Copiar link' grava o link CURTO na área de transferência; sem rolagem horizontal");
} catch (e) {
  failures++;
  console.log("FALHA erro inesperado", e.message);
} finally {
  await browser.close();
}
if (failures) {
  console.log(`${failures} falha(s)`);
  process.exit(1);
}
console.log("E2E do link curto OK");
