/**
 * Admin › Placas: seleção múltipla, quarentena, restauração e exclusão com senha
 * (Chromium real + Supabase simulado que valida a senha de verdade).
 */
import { readFileSync } from "node:fs";
import puppeteer from "puppeteer-core";

const APP = process.env.APP_URL ?? "http://localhost:3100";
const STUB = process.env.STUB_URL ?? "http://127.0.0.1:54399";
const SERVER_LOG = process.env.SERVER_LOG ?? "";
const PASSWORD = "Senha-Forte-2026";
const WRONG = "Senha-Errada-XYZ-123";
const VIEWPORTS = [[320, 568], [360, 800], [375, 812], [390, 844], [412, 915], [430, 932], [1024, 768], [1280, 720], [1366, 768], [1440, 900], [1920, 1080]];
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
const browser = await launch();
const page = await browser.newPage();
const cdp = await page.createCDPSession();
const setMode = (m) => fetch(`${STUB}/__mode?m=${m}`);
const bulkCalls = async () => (await (await fetch(`${STUB}/__plates-bulk`)).json()).calls;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function loginAs(email) {
  await cdp.send("Network.clearBrowserCookies");
  await page.setViewport({ width: 1366, height: 900 });
  await page.goto(`${APP}/login`, { waitUntil: "networkidle0" });
  await page.type("#email", email);
  await page.type("#password", PASSWORD);
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => null), page.click(".login-button")]);
}
const barText = () => page.$eval("[data-bulk-bar] [data-bulk-count]", (e) => e.textContent.trim()).catch(() => null);
const clickRow = (code) => page.$eval(`[data-plate-row="${code}"] input[type=checkbox]`, (e) => e.click());
const clickText = (selector, text) =>
  page.evaluate((s, t) => [...document.querySelectorAll(s)].find((b) => b.textContent.trim() === t)?.click(), selector, text);
const api = (method, path, body) =>
  page.evaluate(
    async (m, p, b) => {
      const r = await fetch(p, { method: m, headers: { "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined });
      return r.status;
    },
    method,
    path,
    body,
  );

try {
  // ---------- 1. seleção ----------
  await setMode("default");
  await loginAs("admin@teste.com");
  await page.goto(`${APP}/admin/plates`, { waitUntil: "networkidle0" });
  const tabs = await page.$$eval('nav[aria-label="Filtrar placas por situação"] a', (as) => as.map((a) => a.textContent));
  check(tabs.length === 3 && tabs[0].startsWith("Operacionais") && tabs[1].startsWith("Quarentena") && tabs[2].startsWith("Todas"), "T1 abas", tabs);
  check((await barText()) === null, "T1 sem barra sem seleção");
  await clickRow("QYM2T6");
  const one = await barText();
  await clickRow("WFBPYC");
  const two = await barText();
  await page.click("[data-select-page]");
  const all = await barText();
  check(one === "1 placa selecionada" && two === "2 placas selecionadas" && all === "5 placas selecionadas" && !(await page.$("[data-select-filter]")), "T1 seleção", { one, two, all });
  ok(`T1: abas ${tabs.join(" | ")}; marcar 1 → '${one}', 2 → '${two}', página inteira → '${all}'; a barra só aparece com seleção`);

  // ---------- 2. 1000 placas: selecionar todas do filtro + quarentena numa chamada ----------
  await setMode("plates-1000");
  await page.goto(`${APP}/admin/plates?batch=9b000000-0000-4000-8000-000000000001`, { waitUntil: "networkidle0" });
  await page.click("[data-select-page]");
  const banner = await page.$eval("[data-select-filter]", (e) => e.textContent.replace(/\s+/g, " ").trim());
  await page.click("[data-select-all-filter]");
  await page.waitForFunction(() => document.querySelector("[data-bulk-count]")?.textContent.includes("1.000"), { timeout: 8000 });
  const thousand = await barText();
  check(banner.includes("5 placas desta página selecionadas.") && banner.includes("Selecionar todas as 1.000 placas deste filtro") && thousand.startsWith("1.000 placas selecionadas") && thousand.includes("todas deste filtro"), "T2 seleção 1000", { banner, thousand });
  const before = (await bulkCalls()).length;
  await page.click('[data-bulk-action="quarantine"]');
  await page.waitForSelector('[role="dialog"] textarea');
  const dlg = await page.$eval('[role="dialog"]', (e) => e.textContent);
  await page.type('[role="dialog"] textarea', "Lote descartado na gráfica");
  await clickText('[role="dialog"] button', "Colocar em quarentena");
  await page.waitForSelector('[data-bulk-feedback]', { timeout: 10000 });
  const fbq = await page.$eval("[data-bulk-feedback]", (e) => e.textContent);
  const callsQ = (await bulkCalls()).slice(before);
  check(dlg.includes("Colocar 1.000 placas em quarentena?") && dlg.includes("Motivo (opcional)") && fbq.includes("✓ 1.000 placas colocadas em quarentena.") && callsQ.length === 1 && callsQ[0].fn === "admin_plates_quarantine" && callsQ[0].n === 1000 && callsQ[0].reason === "Lote descartado na gráfica", "T2 quarentena", { dlg: dlg.slice(0, 120), fbq, callsQ });
  ok(`T2: lote com 1000 placas: '${banner.split(".")[0]}.' → 'Selecionar todas as 1.000 placas deste filtro' → '${thousand}'; quarentena com motivo → UMA chamada com 1000 placas → '${fbq.trim()}'`);

  // ---------- 3. exclusão: senha errada bloqueia; certa exclui (resultado parcial claro) ----------
  await page.click("[data-select-page]");
  await page.click("[data-select-all-filter]");
  await page.waitForFunction(() => document.querySelector("[data-bulk-count]")?.textContent.includes("1.000"), { timeout: 8000 });
  const beforeD = (await bulkCalls()).length;
  await page.click('[data-bulk-action="delete"]');
  await page.waitForSelector("[data-delete-password]");
  const dlgD = await page.$eval('[role="dialog"]', (e) => e.textContent);
  await page.type("[data-delete-password]", WRONG);
  await clickText('[role="dialog"] button', "Excluir definitivamente");
  await page.waitForFunction(() => document.querySelector('[role="dialog"]')?.textContent.includes("Senha inválida"), { timeout: 10000 });
  const wrongMsg = await page.$eval('[role="dialog"]', (e) => e.textContent);
  const afterWrong = (await bulkCalls()).slice(beforeD);
  check(dlgD.includes("Excluir definitivamente 1.000 placas?") && dlgD.includes("não pode ser desfeita") && wrongMsg.includes("Senha inválida. Nenhuma placa foi excluída.") && afterWrong.length === 0, "T3 senha errada", { afterWrong });
  await page.$eval("[data-delete-password]", (e) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(e, "");
    e.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.type("[data-delete-password]", PASSWORD);
  await clickText('[role="dialog"] button', "Excluir definitivamente");
  await page.waitForFunction(() => document.querySelector("[data-bulk-feedback]")?.textContent.includes("excluídas"), { timeout: 10000 });
  const fbd = await page.$eval("[data-bulk-feedback]", (e) => e.textContent.replace(/\s+/g, " ").trim());
  const callsD = (await bulkCalls()).slice(beforeD);
  check(callsD.length === 1 && callsD[0].fn === "admin_plates_delete_unused" && callsD[0].n === 1000 && fbd.includes("✓ 997 placas excluídas.") && fbd.includes("3 placas não puderam ser excluídas por possuírem histórico"), "T3 exclusão", { callsD, fbd });
  ok(`T3: 'Excluir definitivamente 1.000 placas?' + senha errada → 'Senha inválida. Nenhuma placa foi excluída.' e NENHUMA chamada de exclusão; senha certa → 1 chamada com 1000 placas → '${fbd}'`);

  // ---------- 4. aba Quarentena: restaurar ----------
  await setMode("default");
  await page.goto(`${APP}/admin/plates?estado=quarantine`, { waitUntil: "networkidle0" });
  const head = await page.$$eval("table thead th", (ths) => ths.map((t) => t.textContent.trim()));
  await page.click("[data-select-page]");
  const restoreBtn = !!(await page.$('[data-bulk-action="restore"]')) && !(await page.$('[data-bulk-action="quarantine"]'));
  const beforeR = (await bulkCalls()).length;
  await page.click('[data-bulk-action="restore"]');
  await page.waitForSelector('[role="dialog"]');
  await clickText('[role="dialog"] button', "Restaurar");
  await page.waitForSelector("[data-bulk-feedback]", { timeout: 10000 });
  const callsR = (await bulkCalls()).slice(beforeR);
  check(head.includes("Quarentena") && restoreBtn && callsR.length === 1 && callsR[0].fn === "admin_plates_restore" && callsR[0].n === 5, "T4", { head, callsR });
  ok("T4: aba Quarentena mostra a coluna 'Quarentena' e troca a ação por 'Restaurar' (+ excluir); restaurar a seleção = 1 chamada");

  // ---------- 5. revendedor e público ----------
  const adminIds = await api("GET", "/api/admin/plates/ids?estado=all");
  await loginAs("revenda@teste.com");
  const r1 = await api("POST", "/api/admin/plates/bulk", { action: "delete", ids: ["9a7e0000-0000-4000-8000-000000000001"], password: PASSWORD });
  const r2 = await api("POST", "/api/admin/plates/bulk", { action: "quarantine", ids: ["9a7e0000-0000-4000-8000-000000000001"] });
  const r3 = await api("GET", "/api/admin/plates/ids?estado=all");
  await cdp.send("Network.clearBrowserCookies");
  const a1 = await api("POST", "/api/admin/plates/bulk", { action: "delete", ids: ["9a7e0000-0000-4000-8000-000000000001"], password: PASSWORD });
  const a2 = await api("GET", "/api/admin/plates/ids");
  check(adminIds === 200 && r1 === 403 && r2 === 403 && r3 === 403 && a1 === 401 && a2 === 401, "T5", { adminIds, r1, r2, r3, a1, a2 });
  ok("T5: ADMIN acessa; revendedor recebe 403 em excluir, quarentenar e listar ids; sem login, 401");

  // ---------- 6. responsividade com a barra de ações ----------
  await loginAs("admin@teste.com");
  const problems = [];
  for (const [w, h] of VIEWPORTS) {
    await page.setViewport({ width: w, height: h });
    await page.goto(`${APP}/admin/plates`, { waitUntil: "networkidle0" });
    await page.click("[data-select-page]");
    await page.waitForSelector("[data-bulk-bar]");
    const m = await page.evaluate(() => {
      const vw = innerWidth;
      const bar = document.querySelector("[data-bulk-bar]").getBoundingClientRect();
      const cut = [...document.querySelectorAll("[data-bulk-bar] button")].filter((b) => {
        const r = b.getBoundingClientRect();
        return r.left < -0.5 || r.right > vw + 0.5 || b.scrollWidth > b.clientWidth + 1;
      }).map((b) => b.textContent);
      // Barra inteira na tela também na VERTICAL (no celular ela fica fixa no rodapé).
      window.scrollTo(0, 0);
      const top = document.querySelector("[data-bulk-bar]").getBoundingClientRect();
      const vertical = top.top >= -0.5 && top.bottom <= innerHeight + 0.5;
      return { overflow: document.documentElement.scrollWidth > vw + 0.5, barOut: bar.left < -0.5 || bar.right > vw + 0.5 || (vw < 640 && !vertical), cut, h: Math.round(top.height) };
    });
    if (m.overflow) problems.push(`${w}x${h}: rolagem horizontal da página`);
    if (m.barOut || m.cut.length) problems.push(`${w}x${h}: barra/botões cortados ${JSON.stringify(m.cut)}`);
    if (w === 390 || w === 1366) {
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: `/tmp/placas-selecao-${w}.png` });
    }
    if (w === 320) console.log(`   (altura da barra em 320px: ${m.h}px)`);
  }
  check(problems.length === 0, "T6", problems);
  ok("T6: em 11 resoluções (320×568 a 1920×1080), com placas selecionadas: página sem rolagem horizontal (a tabela rola dentro do card) e a barra de ações inteira (no celular, fixa no rodapé e visível mesmo com a página no topo), com nenhum botão cortado");

  // ---------- 7. senhas nunca no log do servidor ----------
  if (SERVER_LOG) {
    const log = readFileSync(SERVER_LOG, "utf8");
    check(!log.includes(PASSWORD) && !log.includes(WRONG), "T7");
    ok("T7: nem a senha certa nem a errada aparecem no log do servidor");
  }
} catch (e) {
  failures++;
  console.log("FALHA erro inesperado", e.message);
} finally {
  await setMode("default");
  await browser.close();
}
if (failures) {
  console.log(`${failures} falha(s)`);
  process.exit(1);
}
console.log("E2E de Admin › Placas OK");
