/**
 * Hub do DirectLab e DirectLink no ADMIN, num Chromium real contra o Supabase
 * simulado. Inclui a reprodução do erro "banco sem a migration do DirectLink".
 * Pré-requisitos: iguais aos de login-e2e.mjs.
 */
import puppeteer from "puppeteer-core";

const APP = process.env.APP_URL ?? "http://localhost:3100";
const STUB = process.env.STUB_URL ?? "http://127.0.0.1:54399";
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
async function loginAs(email) {
  await cdp.send("Network.clearBrowserCookies");
  await page.setViewport({ width: 1366, height: 768 });
  await page.goto(`${APP}/login`, { waitUntil: "networkidle0" });
  await page.type("#email", email);
  await page.type("#password", "Senha-Forte-2026");
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => null), page.click(".login-button")]);
}
const hubInfo = () =>
  page.evaluate(() => {
    const cards = [...document.querySelectorAll("[data-directlab-card]")];
    return {
      overflow: document.documentElement.scrollWidth > innerWidth,
      form: !!document.querySelector("[data-directlab-tool], #directlab-link"),
      cards: cards.map((c) => {
        const r = c.getBoundingClientRect();
        return { key: c.dataset.directlabCard, href: c.getAttribute("href"), status: c.querySelector("[data-directlab-card-status]")?.textContent ?? "", w: Math.round(r.width), h: Math.round(r.height), left: Math.round(r.left), tag: c.tagName };
      }),
      mainW: Math.round(document.querySelector("main").getBoundingClientRect().width),
    };
  });

try {
  await setMode("default");
  // ---------- revendedor ----------
  await loginAs("revenda@teste.com");
  for (const [w, h] of [[1920, 1080], [1366, 768], [1280, 720], [768, 1024], [390, 844], [360, 800]]) {
    await page.setViewport({ width: w, height: h });
    await page.goto(`${APP}/reseller/directlab`, { waitUntil: "networkidle0" });
    const m = await hubInfo();
    const g = m.cards.find((c) => c.key === "google-review");
    const d = m.cards.find((c) => c.key === "directlink");
    check(!m.overflow && !m.form && m.cards.length === 2, `H1 ${w}: só cards, sem formulário`, m);
    check(g?.href === "/reseller/directlab/google-review" && d?.href === "/reseller/directlab/directlink" && g.tag === "A", `H1 ${w}: links`, m.cards);
    check(g?.status === "4 de 10 utilizações hoje" && d?.status === "2 de 3 páginas", `H2 ${w}: limites do revendedor`, m.cards);
    const perRow = new Set(m.cards.map((c) => c.left)).size;
    check(w < 640 ? perRow === 1 : perRow === 2, `H3 ${w}: ${perRow} por linha`);
    check(g.h >= 180, `H3 ${w}: área de toque`, g);
  }
  ok("H1: /reseller/directlab mostra só o catálogo (2 cards clicáveis inteiros), sem o formulário da Avaliação Google");
  ok("H2: cards mostram os limites do revendedor: '4 de 10 utilizações hoje' e '2 de 3 páginas'");
  ok("H3: 1920, 1366, 1280, 768, 390 e 360 px sem overflow; 2 cards por linha a partir de 640 px, 1 no celular; card inteiro clicável (≥ 180 px de altura)");

  await page.setViewport({ width: 390, height: 844 });
  await page.goto(`${APP}/reseller/directlab`, { waitUntil: "networkidle0" });
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), page.click('[data-directlab-card="google-review"]')]);
  check(page.url().endsWith("/reseller/directlab/google-review") && (await page.$('[data-directlab-tool="google-review"]')), "H4 abre Avaliação Google", page.url());
  check((await page.$eval("[data-directlab-quota]", (e) => e.textContent).catch(() => null)) === "4 de 10 utilizações hoje", "H4 contador na ferramenta");
  check((await page.$$('[data-directlab-tool="google-review"]')).length === 1, "H4 formulário único");
  await page.goto(`${APP}/reseller/directlab`, { waitUntil: "networkidle0" });
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), page.click('[data-directlab-card="directlink"]')]);
  check(page.url().endsWith("/reseller/directlab/directlink") && (await page.$("[data-directlink-list]")), "H5 abre DirectLink", page.url());
  check((await page.$eval("[data-directlink-pages]", (e) => e.textContent).catch(() => null)) === "2 de 3 páginas utilizadas", "H5 contador de páginas");
  ok("H4–H5: o card abre a página própria de cada ferramenta (formulário do Google uma vez só, com '4 de 10'); DirectLink lista as páginas com '2 de 3 páginas utilizadas'");

  // Limite atingido (Google 10/10, DirectLink 3/3)
  await setMode("limite");
  await page.goto(`${APP}/reseller/directlab`, { waitUntil: "networkidle0" });
  const lim = await hubInfo();
  check(lim.cards.find((c) => c.key === "google-review")?.status === "10 de 10 utilizações hoje", "H6 hub esgotado", lim.cards);
  await page.goto(`${APP}/reseller/directlab/directlink`, { waitUntil: "networkidle0" });
  const limText = await page.$eval("[data-directlink-limit]", (e) => e.textContent).catch(() => null);
  check(limText === "Você atingiu o limite de páginas DirectLink definido para sua conta. Entre em contato com o administrador para aumentar o limite.", "H6 mensagem DirectLink", limText);
  check((await page.$("[data-directlink-create-disabled]")) && !(await page.$('a[href="/reseller/directlab/directlink/new"]')), "H6 criar desabilitado");
  await page.goto(`${APP}/reseller/directlab/directlink/new`, { waitUntil: "networkidle0" });
  check((await page.$("[data-directlink-limit]")) && !(await page.$("#directlink-title, [data-directlink-editor]")), "H6 /new bloqueado");
  await page.goto(`${APP}/reseller/directlab/google-review`, { waitUntil: "networkidle0" });
  const ex = await page.$eval("[data-directlab-exhausted]", (e) => e.textContent).catch(() => null);
  check(ex === "Você atingiu o limite diário definido para sua conta. Entre em contato com o administrador para aumentar o limite.", "H6 mensagem Google", ex);
  ok("H6: no limite, o hub mostra '10 de 10', o DirectLink mostra a mensagem pedida e bloqueia a criação (lista e /new), e a Avaliação Google mostra a mensagem do limite da conta");
  await setMode("default");

  // ---------- ADMIN ----------
  await loginAs("admin@teste.com");
  for (const [w, h] of [[1366, 768], [390, 844]]) {
    await page.setViewport({ width: w, height: h });
    await page.goto(`${APP}/admin/directlab`, { waitUntil: "networkidle0" });
    const m = await hubInfo();
    check(!m.overflow && !m.form && m.cards.length === 2, `H7 ${w}: só cards`, m);
    check(m.cards.find((c) => c.key === "google-review")?.status === "Sem limite diário" && m.cards.find((c) => c.key === "google-review")?.href === "/admin/directlab/google-review", `H7 ${w}: ADMIN sem limite`, m.cards);
  }
  await page.goto(`${APP}/admin/directlab/google-review`, { waitUntil: "networkidle0" });
  check((await page.$eval("[data-directlab-unlimited]", (e) => e.textContent).catch(() => null)) === "Sem limite diário" && !(await page.$("[data-directlab-quota]")), "H7 aviso na ferramenta");
  ok("H7: /admin/directlab mostra só o catálogo; o ADMIN vê 'Sem limite diário' no card e na ferramenta (aviso mantido)");

  await page.setViewport({ width: 1366, height: 768 });
  await page.goto(`${APP}/admin/directlab/directlink`, { waitUntil: "networkidle0" });
  const adminList = await page.$$eval("[data-directlink-list] li", (els) => els.map((e) => e.textContent));
  check(adminList.length === 2 && adminList.some((t) => t.includes("Adega Monster")) && !(await page.$("[data-directlink-load-error]")), "D1 ADMIN lista", adminList);
  check(await page.$('a[href="/admin/directlab/directlink/new"]'), "D1 ADMIN pode criar");
  ok("D1: com a migration aplicada, o ADMIN abre DirectLab > DirectLink e lista os DirectLinks (dele e dos revendedores), com '+ Criar DirectLink'");

  // Reprodução do erro relatado: banco SEM a migration do DirectLink.
  await setMode("sem-directlink");
  const resp = await page.goto(`${APP}/admin/directlab/directlink`, { waitUntil: "networkidle0" });
  const errAdmin = await page.$eval("[data-directlink-load-error]", (e) => ({ kind: e.dataset.directlinkLoadError, text: e.textContent })).catch(() => null);
  check(resp.status() === 200 && errAdmin?.kind === "missing_schema" && errAdmin.text.includes("Não foi possível carregar os DirectLinks.") && errAdmin.text.includes("20261004120000_directlink.sql"), "D2 ADMIN sem migration", errAdmin);
  check(!errAdmin?.text.includes("PGRST205") && !errAdmin?.text.includes("schema cache"), "D2 sem detalhe técnico na tela");
  await loginAs("revenda@teste.com");
  await page.goto(`${APP}/reseller/directlab/directlink`, { waitUntil: "networkidle0" });
  const errRes = await page.$eval("[data-directlink-load-error]", (e) => e.textContent).catch(() => null);
  check(errRes?.includes("Não foi possível carregar os DirectLinks.") && !errRes.includes("migration"), "D2 revendedor: mensagem genérica", errRes);
  ok("D2: sem a migration (PGRST205, o erro relatado), a página não quebra: mostra 'Não foi possível carregar os DirectLinks. Tente novamente.'; o ADMIN vê qual migration aplicar; o revendedor, só a mensagem genérica; nada técnico na tela");
  await setMode("default");
} finally {
  await browser.close();
}
if (failures) {
  console.log(`${failures} falha(s)`);
  process.exit(1);
}
console.log("E2E do hub do DirectLab OK");
