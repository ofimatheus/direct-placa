/**
 * Densidade responsiva: 9 resoluções × todas as telas dos dois painéis, num
 * Chromium real, contra o Supabase simulado (scripts/e2e/supabase-stub.mjs).
 * Confere overflow global, sidebar/gaveta, KPIs sem corte (inclusive com
 * valores longos), títulos, menus, tabelas (rolagem interna) e botões.
 * Pré-requisitos: iguais aos de login-e2e.mjs (stub + app na porta 3100).
 */
import puppeteer from "puppeteer-core";

const APP = process.env.APP_URL ?? "http://localhost:3100";
const STUB = process.env.STUB_URL ?? "http://127.0.0.1:54399";
const SHOTS = process.env.SHOTS_DIR ?? "/tmp";
const VIEWPORTS = [
  [1920, 1080], [1600, 900], [1440, 900], [1366, 768], [1280, 720], [1024, 768], [768, 1024], [390, 844], [360, 800],
];
const PAGES = {
  admin: ["/admin/dashboard", "/admin/sales", "/admin/plates", "/admin/batches", "/admin/templates", "/admin/resellers", "/admin/customers", "/admin/accesses", "/admin/directlab", "/admin/directlab/google-review", "/admin/directlab/directlink", "/admin/settings"],
  reseller: ["/reseller/dashboard", "/reseller/plates", "/reseller/customers", "/reseller/sales", "/reseller/sales/new", "/reseller/accesses", "/reseller/directlab", "/reseller/directlab/google-review", "/reseller/directlab/directlink", "/reseller/account"],
};
const expectedSidebar = (w) => (w < 1024 ? 0 : w < 1440 ? 224 : w < 1600 ? 264 : 288);
const expectedKpiCols = (w) => (w >= 1280 ? 4 : w >= 560 ? 2 : 1);

let failures = 0;
const problems = [];
const fail = (msg) => {
  failures++;
  if (problems.length < 40) problems.push(msg);
};

async function launch() {
  if (process.env.CHROME_PATH) return puppeteer.launch({ executablePath: process.env.CHROME_PATH, headless: true, args: ["--no-sandbox"] });
  const chromium = (await import("@sparticuz/chromium")).default;
  return puppeteer.launch({ args: chromium.args, executablePath: await chromium.executablePath(), headless: true });
}

/** Tudo o que é medido numa página (executa no navegador). */
function measure() {
  const vw = window.innerWidth;
  const out = { overflow: document.documentElement.scrollWidth > vw + 0.5, sidebarW: 0, menuButton: false, kpis: [], kpiCols: 0, title: null, nav: [], tables: [], smallButtons: [] };
  const aside = document.querySelector("[data-shell-sidebar]");
  if (aside && getComputedStyle(aside).display !== "none") out.sidebarW = Math.round(aside.getBoundingClientRect().width);
  const menu = document.querySelector('button[aria-label="Abrir menu"]');
  out.menuButton = !!menu && getComputedStyle(menu.closest("header")).display !== "none";
  const cards = [...document.querySelectorAll("[data-kpi-grid] > *")];
  const firstGrid = document.querySelector("[data-kpi-grid]");
  if (firstGrid) out.kpiCols = new Set([...firstGrid.children].map((c) => Math.round(c.getBoundingClientRect().left))).size;
  for (const card of cards) {
    const c = card.getBoundingClientRect();
    for (const el of card.querySelectorAll("[data-kpi-value], .kpi-label, .kpi-hint p")) {
      const r = el.getBoundingClientRect();
      const text = el.textContent.trim();
      if (el.scrollWidth > el.clientWidth + 1 || r.right > c.right + 0.5 || r.left < c.left - 0.5 || text.includes("…"))
        out.kpis.push(`${text.slice(0, 24)} (texto ${Math.round(el.scrollWidth)} > caixa ${el.clientWidth})`);
    }
  }
  const h1 = document.querySelector("main h1");
  if (h1 && (h1.scrollWidth > h1.clientWidth + 1 || h1.getBoundingClientRect().right > vw)) out.title = h1.textContent;
  const aside2 = aside && getComputedStyle(aside).display !== "none" ? aside : null;
  if (aside2) for (const span of aside2.querySelectorAll(".shell-nav-item span")) if (span.scrollWidth > span.clientWidth + 1) out.nav.push(span.textContent);
  for (const table of document.querySelectorAll("main table")) {
    const tw = table.getBoundingClientRect().width;
    let el = table.parentElement;
    let ok = false;
    while (el && el !== document.body) {
      const ox = getComputedStyle(el).overflowX;
      if (ox === "auto" || ox === "scroll") { ok = true; break; }
      if (el.clientWidth + 1 < tw && (ox === "hidden" || ox === "clip")) break;
      if (el.clientWidth + 1 >= tw) { ok = true; break; }
      el = el.parentElement;
    }
    if (!ok) out.tables.push(`${table.querySelector("th")?.textContent ?? "tabela"} (${Math.round(tw)}px cortada)`);
  }
  const minH = vw < 1024 ? 40 : 34;
  for (const b of document.querySelectorAll("main .btn:not(.btn-small)")) {
    const r = b.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && r.height < minH - 0.5) out.smallButtons.push(`${b.textContent.trim().slice(0, 20)}=${Math.round(r.height)}px`);
  }
  return out;
}

const browser = await launch();
const page = await browser.newPage();
const cdp = await page.createCDPSession();
const summary = {};
try {
  for (const mode of ["default", "long"]) {
    await fetch(`${STUB}/__mode?m=${mode}`);
    for (const [who, pages] of Object.entries(PAGES)) {
      await cdp.send("Network.clearBrowserCookies");
      await page.setViewport({ width: 1440, height: 900 });
      await page.goto(`${APP}/login`, { waitUntil: "networkidle0" });
      await page.type("#email", who === "admin" ? "admin@teste.com" : "revenda@teste.com");
      await page.type("#password", "Senha-Forte-2026");
      await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => null), page.click(".login-button")]);
      const list = mode === "long" ? pages.filter((p) => p.endsWith("/dashboard")) : pages;
      for (const [w, h] of VIEWPORTS) {
        await page.setViewport({ width: w, height: h });
        for (const path of list) {
          await page.goto(`${APP}${path}`, { waitUntil: "networkidle0", timeout: 60000 });
          const m = await page.evaluate(measure);
          const tag = `${w}x${h} ${mode === "long" ? "[valores longos] " : ""}${path}`;
          if (m.overflow) fail(`${tag}: rolagem horizontal global`);
          if (w >= 1024 && Math.abs(m.sidebarW - expectedSidebar(w)) > 1) fail(`${tag}: sidebar ${m.sidebarW}px (esperado ${expectedSidebar(w)})`);
          if (w < 1024 && (m.sidebarW !== 0 || !m.menuButton)) fail(`${tag}: sidebar/gaveta incorretas`);
          if (m.kpis.length) fail(`${tag}: KPI cortado ${JSON.stringify(m.kpis)}`);
          if (path.endsWith("/dashboard") && m.kpiCols !== expectedKpiCols(w)) fail(`${tag}: ${m.kpiCols} KPIs por linha (esperado ${expectedKpiCols(w)})`);
          if (m.title) fail(`${tag}: título cortado "${m.title}"`);
          if (m.nav.length) fail(`${tag}: menu cortado ${JSON.stringify(m.nav)}`);
          if (m.tables.length) fail(`${tag}: ${JSON.stringify(m.tables)}`);
          if (m.smallButtons.length) fail(`${tag}: botões baixos ${JSON.stringify(m.smallButtons)}`);
          summary[`${w}x${h}`] = (summary[`${w}x${h}`] ?? 0) + 1;
          if (mode === "default" && path.endsWith("/dashboard") && [1920, 1366, 1280].includes(w))
            await page.screenshot({ path: `${SHOTS}/resp-${who}-${w}.png` });
          if (mode === "long" && path.endsWith("/dashboard") && [1366, 1280].includes(w))
            await page.screenshot({ path: `${SHOTS}/resp-long-${who}-${w}.png` });
        }
        // Gaveta (tablet/celular): abre com o botão e fecha com Esc.
        if (w < 1024 && mode === "default") {
          await page.goto(`${APP}${pages[0]}`, { waitUntil: "networkidle0" });
          await page.click('button[aria-label="Abrir menu"]');
          await page.waitForSelector("#shell-drawer", { timeout: 5000 }).catch(() => null);
          const items = await page.$$eval("#shell-drawer .shell-nav-item", (els) => els.length);
          await page.keyboard.press("Escape");
          await new Promise((r) => setTimeout(r, 150));
          const closed = !(await page.$("#shell-drawer"));
          if (items < pages.length - 1 || !closed) fail(`${w}x${h} ${who}: gaveta (itens=${items}, fechou=${closed})`);
        }
      }
    }
  }
} finally {
  await browser.close();
}
console.log(`Páginas medidas por resolução: ${JSON.stringify(summary)}`);
if (failures) {
  console.log(`${failures} problema(s):\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
console.log("OK R1: 9 resoluções × 22 telas (ADMIN e revendedor) sem rolagem horizontal global");
console.log("OK R2: sidebar 224 px (1024–1439), 264 px (1440–1599), 288 px (≥1600); gaveta abaixo de 1024 px, abre e fecha com Esc");
console.log("OK R3: KPIs sem corte nem reticências (inclusive R$ 1.234.567,89), 4 por linha no desktop/notebook, 2 no tablet, 1 no celular");
console.log("OK R4: títulos e itens de menu sem corte; tabelas largas rolam dentro do próprio componente; botões com altura adequada");
console.log("E2E responsivo OK");
