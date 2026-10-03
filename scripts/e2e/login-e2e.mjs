/**
 * Ponta a ponta da tela de login num Chromium real, contra o Supabase
 * simulado (scripts/e2e/supabase-stub.mjs). Mede overflow horizontal em várias
 * larguras, troca de banner/logo, fallback e o fluxo real de autenticação.
 *
 * Pré-requisitos (fora das dependências do projeto):
 *   npm i --no-save puppeteer-core @sparticuz/chromium   (ou CHROME_PATH=/caminho/do/chrome)
 *   node scripts/e2e/supabase-stub.mjs &
 *   NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54399 NEXT_PUBLIC_SUPABASE_ANON_KEY=anon npx next dev -p 3100 &
 *   node scripts/e2e/login-e2e.mjs
 */
import puppeteer from "puppeteer-core";

const APP = process.env.APP_URL ?? "http://localhost:3100";
const STUB = process.env.STUB_URL ?? "http://127.0.0.1:54399";
const SHOTS = process.env.SHOTS_DIR ?? "/tmp";
let failures = 0;
const ok = (label) => console.log(`OK ${label}`);
const check = (cond, label, detail) => {
  if (!cond) {
    failures++;
    console.log(`FALHA ${label}`, detail ?? "");
  }
};
const setMode = (m) => fetch(`${STUB}/__mode?m=${m}`);

async function launch() {
  if (process.env.CHROME_PATH) return puppeteer.launch({ executablePath: process.env.CHROME_PATH, headless: true, args: ["--no-sandbox"] });
  const chromium = (await import("@sparticuz/chromium")).default;
  return puppeteer.launch({ args: chromium.args, executablePath: await chromium.executablePath(), headless: true });
}

async function measure(page) {
  return page.evaluate(() => {
    const card = document.querySelector(".login-card")?.getBoundingClientRect();
    const inputs = [...document.querySelectorAll(".login-input")].map((i) => i.getBoundingClientRect().height);
    const button = document.querySelector(".login-button")?.getBoundingClientRect();
    const images = [...document.querySelectorAll("main img")].map((img) => ({ src: img.getAttribute("src"), loaded: img.complete && img.naturalWidth > 0 }));
    return {
      scrollW: document.documentElement.scrollWidth,
      bodyScrollW: document.body.scrollWidth,
      innerW: window.innerWidth,
      card: card && { left: card.left, right: card.right, width: card.width },
      inputs,
      buttonH: button?.height,
      title: document.querySelector("#login-title")?.textContent,
      logoArea: document.querySelector("[data-login-logo]")?.textContent,
      banner: document.querySelector("[data-login-banner]")?.getAttribute("data-login-banner"),
      images,
    };
  });
}

const browser = await launch();
const page = await browser.newPage();
try {
  // ---------- Layout sem overflow, com branding padrão ----------
  await setMode("default");
  const widths = [320, 360, 375, 390, 414, 768, 1024, 1280, 1440, 1920];
  const bad = [];
  for (const width of widths) {
    await page.setViewport({ width, height: width < 768 ? 844 : 960 });
    await page.goto(`${APP}/login`, { waitUntil: "networkidle0" });
    const m = await measure(page);
    const inside = m.card && m.card.left >= 0 && m.card.right <= m.innerW + 0.5;
    if (m.scrollW > m.innerW || m.bodyScrollW > m.innerW || !inside) bad.push({ width, ...m });
    if (width <= 414 && (m.inputs.some((h) => h < 44) || m.buttonH < 44)) bad.push({ width, touch: m.inputs, button: m.buttonH });
    if (width === 1440) await page.screenshot({ path: `${SHOTS}/e2e-login-1440.png` });
    if (width === 390) await page.screenshot({ path: `${SHOTS}/e2e-login-390.png` });
  }
  check(bad.length === 0, "L1 overflow/card fora da tela/alvo de toque", bad);
  const m0 = await measure(page);
  check(m0.title === "Entrar" && m0.logoArea?.includes("DirectPlaca") && m0.banner === "default", "L1 padrão", m0);
  ok(`L1: sem branding personalizado, ${widths.length} larguras (320 a 1920 px) sem scroll horizontal; card sempre inteiro na tela; campos ≥ 44 px no celular`);

  // ---------- Branding personalizado ----------
  await setMode("custom");
  for (const width of [390, 1440]) {
    await page.setViewport({ width, height: 900 });
    await page.goto(`${APP}/login`, { waitUntil: "networkidle0" });
    const m = await measure(page);
    check(m.scrollW <= m.innerW, `L2 overflow com banner (${width})`, m);
    check(m.title === "Bem-vindo" && m.logoArea?.includes("Marca Parceira") && m.banner === "custom", `L2 textos (${width})`, m);
    check(m.images.length >= 2 && m.images.every((i) => i.loaded), `L2 imagens carregadas (${width})`, m.images);
    if (width === 1440) await page.screenshot({ path: `${SHOTS}/e2e-login-custom-1440.png` });
  }
  ok("L2: com branding personalizado, banner e logo carregam do bucket público e o layout continua sem overflow");

  await setMode("swap");
  await page.goto(`${APP}/login`, { waitUntil: "networkidle0" });
  let m = await measure(page);
  check(m.images.some((i) => i.src?.endsWith("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2.jpg") && i.loaded), "L3 banner trocado", m.images);
  check(await page.$("form[data-login-form] input[name=password]"), "L3 formulário");
  await setMode("only-logo");
  await page.goto(`${APP}/login`, { waitUntil: "networkidle0" });
  m = await measure(page);
  check(m.logoArea === "" && m.images.some((i) => i.src?.includes("/branding/logo/") && i.loaded) && m.banner === "default", "L3 somente logo", m);
  ok("L3: trocar o banner e usar só a logo não quebram o login (sem novo build)");

  // ---------- Fallback ----------
  for (const failMode of ["error", "hang"]) {
    await setMode(failMode);
    const started = Date.now();
    await page.goto(`${APP}/login`, { waitUntil: "networkidle0", timeout: 20000 });
    m = await measure(page);
    check(m.title === "Entrar" && m.logoArea?.includes("DirectPlaca"), `L4 fallback (${failMode})`, m);
    console.log(`   · ${failMode}: login renderizado com o padrão em ${Date.now() - started} ms`);
  }
  ok("L4: Supabase com erro ou travado → login abre com o padrão DirectPlaca");

  // ---------- Autenticação (mesma server action de antes) ----------
  await setMode("default");
  await page.setViewport({ width: 1280, height: 900 });
  // Cada login começa sem sessão: cookies limpos (o Chromium empacotado roda em
  // processo único e não abre contextos isolados).
  const cdp = await page.createCDPSession();
  const login = async (email, password, path = "/login") => {
    await cdp.send("Network.clearBrowserCookies");
    await page.goto(`${APP}${path}`, { waitUntil: "networkidle0" });
    await page.type("#email", email);
    await page.type("#password", password);
    await Promise.all([page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => null), page.click(".login-button")]);
    await new Promise((r) => setTimeout(r, 800));
    const url = new URL(page.url());
    const alert = await page.$eval("[role=alert]", (el) => el.textContent).catch(() => null);
    return { path: url.pathname, search: url.search, alert };
  };
  const wrong = await login("admin@teste.com", "senha-errada");
  check(wrong.path === "/login" && wrong.search.includes("error=1") && wrong.alert === "E-mail ou senha incorretos.", "A1 senha errada", wrong);
  const admin = await login("admin@teste.com", "Senha-Forte-2026");
  check(admin.path === "/admin/dashboard", "A2 ADMIN", admin);
  const reseller = await login("revenda@teste.com", "Senha-Forte-2026");
  check(reseller.path === "/reseller/dashboard", "A3 revendedor", reseller);
  const inactive = await login("inativo@teste.com", "Senha-Forte-2026");
  check(inactive.path === "/login" && inactive.search.includes("error=inactive") && inactive.alert?.includes("desativado"), "A4 inativo", inactive);
  const next = await login("admin@teste.com", "Senha-Forte-2026", "/login?next=/admin/plates");
  check(next.path === "/admin/plates", "A5 next", next);
  ok("A1–A5: senha errada, ADMIN, revendedor, acesso inativo e retorno ao destino (next) funcionam como antes");

  // ---------- Mostrar/ocultar senha ----------
  await cdp.send("Network.clearBrowserCookies");
  await page.goto(`${APP}/login`, { waitUntil: "networkidle0" });
  await page.type("#password", "abc");
  await page.click('button[aria-label="Mostrar senha"]');
  const type = await page.$eval("#password", (el) => el.getAttribute("type"));
  check(type === "text", "A6 mostrar senha", type);
  ok("A6: o botão de mostrar senha funciona (não é decorativo)");
} finally {
  await browser.close();
}
if (failures) {
  console.log(`${failures} falha(s)`);
  process.exit(1);
}
console.log("E2E do login OK");
