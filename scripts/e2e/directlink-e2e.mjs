/**
 * DirectLink público num Chromium real (mesmos pré-requisitos de
 * login-e2e.mjs). Mobile-first: 320–430 px, tablet e desktop. Sem login.
 */
import puppeteer from "puppeteer-core";

const APP = process.env.APP_URL ?? "http://localhost:3100";
const SHOTS = process.env.SHOTS_DIR ?? "/tmp";
const VIEWPORTS = [[320, 568], [360, 800], [375, 812], [390, 844], [412, 915], [430, 932], [768, 1024], [1440, 900], [1920, 1080]];
let failures = 0;
const problems = [];
const fail = (m) => { failures++; problems.push(m); };

async function launch() {
  if (process.env.CHROME_PATH) return puppeteer.launch({ executablePath: process.env.CHROME_PATH, headless: true, args: ["--no-sandbox"] });
  const chromium = (await import("@sparticuz/chromium")).default;
  return puppeteer.launch({ args: chromium.args, executablePath: await chromium.executablePath(), headless: true });
}

for (const code of ["OFF2345", "zz", "ABC2345/../x"]) {
  const r = await fetch(`${APP}/link/${code}`, { redirect: "manual" });
  if (r.status !== 404) fail(`/link/${code} respondeu ${r.status} (esperado 404)`);
}
const ok = await fetch(`${APP}/link/ABC2345`, { redirect: "manual" });
if (ok.status !== 200) fail(`/link/ABC2345 sem login respondeu ${ok.status}`);

const browser = await launch();
const page = await browser.newPage();
const rows = [];
try {
  for (const [w, h] of VIEWPORTS) {
    await page.setViewport({ width: w, height: h });
    await page.goto(`${APP}/link/ABC2345`, { waitUntil: "networkidle0" });
    const m = await page.evaluate(() => {
      const list = document.querySelector("[data-dl-items]").getBoundingClientRect();
      const items = [...document.querySelectorAll("[data-dl-item]")].map((el) => {
        const r = el.getBoundingClientRect();
        const t = el.querySelector(".dl-btn-title");
        return { w: r.width, h: r.height, cut: t ? t.scrollWidth > t.clientWidth + 1 : false };
      });
      const col = document.querySelector("[data-directlink-view] > div").getBoundingClientRect();
      const h1 = document.querySelector("h1");
      const banner = document.querySelector("[data-dl-banner] img");
      const logo = document.querySelector("[data-dl-logo]");
      const lr = logo?.getBoundingClientRect();
      const topHit = lr ? document.elementFromPoint(lr.left + lr.width / 2, lr.top + 8) : null;
      return {
        overflow: document.documentElement.scrollWidth > innerWidth,
        listW: list.width, items, colW: col.width, colLeft: col.left, colRight: innerWidth - col.right,
        titleCut: h1.scrollWidth > h1.clientWidth + 1,
        bannerFit: banner ? getComputedStyle(banner).objectFit : null, bannerLoaded: banner ? banner.complete && banner.naturalWidth > 0 : false,
        logoOnTop: logo ? topHit === logo : true,
      };
    });
    const tag = `${w}x${h}`;
    if (m.overflow) fail(`${tag}: rolagem horizontal`);
    if (m.items.length !== 9) fail(`${tag}: ${m.items.length} botões (esperado 9)`);
    if (m.items.some((i) => Math.abs(i.w - m.listW) > 1)) fail(`${tag}: botão não ocupa a largura toda`);
    if (m.items.some((i) => i.h < 48)) fail(`${tag}: botão com menos de 48 px`);
    if (m.items.some((i) => i.cut) || m.titleCut) fail(`${tag}: texto cortado`);
    if (m.colW > 520.5) fail(`${tag}: página larga demais (${m.colW})`);
    if (w >= 768 && Math.abs(m.colLeft - m.colRight) > 1) fail(`${tag}: página não centralizada`);
    if (m.bannerFit !== "cover" || !m.bannerLoaded) fail(`${tag}: banner`);
    if (!m.logoOnTop) fail(`${tag}: logo coberta pelo banner`);
    rows.push(`${tag.padEnd(10)} coluna ${Math.round(m.colW)}px · botões ${Math.round(m.items[0].w)}×${Math.round(Math.min(...m.items.map((i) => i.h)))}+px`);
    if ([320, 390, 1440].includes(w)) await page.screenshot({ path: `${SHOTS}/dl-${w}.png`, fullPage: w !== 1440 });
  }
  await page.setViewport({ width: 390, height: 844 });
  await page.goto(`${APP}/link/ABC2345`, { waitUntil: "networkidle0" });
  await browser.defaultBrowserContext().overridePermissions(APP, ["clipboard-read", "clipboard-write", "clipboard-sanitized-write"]);
  await page.evaluate(() => document.querySelector('[data-dl-item="pix"]').scrollIntoView({ block: "center" }));
  await page.click('[data-dl-item="pix"]');
  await page.waitForSelector("[data-pix-sheet]");
  await page.screenshot({ path: `${SHOTS}/dl-pix-390.png` });
  await page.evaluate(() => [...document.querySelectorAll("[data-pix-sheet] button")].find((b) => b.textContent === "Copiar chave").click());
  await page.waitForFunction(() => document.querySelector("[data-pix-status]")?.textContent === "Chave PIX copiada", { timeout: 5000 }).catch(() => fail("PIX: sem 'Chave PIX copiada'"));
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  if (clip !== "adega@monster.com.br") fail(`PIX: área de transferência "${clip}"`);
  const wa = await page.$eval('[data-dl-item="whatsapp"]', (a) => ({ href: a.getAttribute("href"), rel: a.getAttribute("rel"), target: a.getAttribute("target") }));
  if (wa.href !== "https://wa.me/5511999998888" || wa.rel !== "noopener noreferrer" || wa.target !== "_blank") fail(`WhatsApp: ${JSON.stringify(wa)}`);
} finally {
  await browser.close();
}
console.log(rows.join("\n"));
if (failures) {
  console.log(`${failures} problema(s):\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
console.log("OK DE1: página pública abre sem login; inativa, inexistente ou código inválido → 404");
console.log("OK DE2: 320, 360, 375, 390, 412 e 430 px (e tablet/desktop): sem rolagem horizontal, botões com a largura toda e ≥ 48 px, texto nunca cortado, banner com object-fit: cover");
console.log("OK DE3: no desktop a página fica centralizada com no máximo 520 px; a logo fica inteira por cima do banner");
console.log("OK DE4: PIX copia a chave para a área de transferência real e mostra 'Chave PIX copiada'; WhatsApp abre wa.me em nova aba com noopener");
console.log("E2E do DirectLink OK");
