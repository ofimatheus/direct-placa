/**
 * Landing pública de revendedores (/revendedores) num Chromium real.
 * 11 resoluções: sem overflow, sem texto cortado, CTA visível sem rolar,
 * imagens carregadas e sem distorção, FAQ, âncoras, SEO e rotas antigas.
 * Pré-requisitos: iguais aos de login-e2e.mjs (stub + app na porta 3100).
 */
import puppeteer from "puppeteer-core";

const APP = process.env.APP_URL ?? "http://localhost:3100";
const VIEWPORTS = [[320, 568], [360, 800], [375, 812], [390, 844], [412, 915], [430, 932], [1024, 768], [1280, 720], [1366, 768], [1440, 900], [1920, 1080]];
let failures = 0;
const problems = [];
const fail = (m) => {
  failures++;
  if (problems.length < 40) problems.push(m);
};
async function launch() {
  if (process.env.CHROME_PATH) return puppeteer.launch({ executablePath: process.env.CHROME_PATH, headless: true, args: ["--no-sandbox"] });
  const chromium = (await import("@sparticuz/chromium")).default;
  return puppeteer.launch({ args: chromium.args, executablePath: await chromium.executablePath(), headless: true });
}
const browser = await launch();
const page = await browser.newPage();

try {
  // ---------- rotas antigas intactas (sem sessão) ----------
  const status = async (path) => {
    const r = await fetch(`${APP}${path}`, { redirect: "manual" });
    return { status: r.status, location: r.headers.get("location") ?? "" };
  };
  const routes = {
    "/revendedores": await status("/revendedores"),
    "/": await status("/"),
    "/login": await status("/login"),
    "/admin/dashboard": await status("/admin/dashboard"),
    "/reseller/dashboard": await status("/reseller/dashboard"),
    "/link/ABC2345": await status("/link/ABC2345"),
  };
  if (routes["/revendedores"].status !== 200) fail(`rota /revendedores ${JSON.stringify(routes["/revendedores"])}`);
  if (!(routes["/"].status >= 300 && routes["/"].status < 400 && routes["/"].location.includes("/login"))) fail(`/ mudou ${JSON.stringify(routes["/"])}`);
  if (routes["/login"].status !== 200) fail("/login");
  for (const p of ["/admin/dashboard", "/reseller/dashboard"]) if (!(routes[p].status >= 300 && routes[p].status < 400 && routes[p].location.includes("/login"))) fail(`${p} ${JSON.stringify(routes[p])}`);
  if (routes["/link/ABC2345"].status !== 200) fail("/link/ABC2345");
  console.log(`OK L1: /revendedores 200 sem login; rotas antigas iguais: / → /login, /login 200, /admin e /reseller → /login, /link/<código> 200`);

  // ---------- SEO ----------
  await page.setViewport({ width: 1366, height: 768 });
  await page.goto(`${APP}/revendedores`, { waitUntil: "networkidle0" });
  const seo = await page.evaluate(() => {
    const m = (sel, attr = "content") => document.querySelector(sel)?.getAttribute(attr) ?? null;
    return {
      title: document.title,
      description: m('meta[name="description"]'),
      robots: m('meta[name="robots"]'),
      canonical: m('link[rel="canonical"]', "href"),
      ogTitle: m('meta[property="og:title"]'),
      ogImage: m('meta[property="og:image"]'),
      ogLocale: m('meta[property="og:locale"]'),
      twitterCard: m('meta[name="twitter:card"]'),
      lang: document.documentElement.lang,
      h1: [...document.querySelectorAll("h1")].map((h) => h.textContent.trim()),
      h2: document.querySelectorAll("h2").length,
      orderOk: [...document.querySelectorAll("h1,h2,h3")].every((h, i, all) => i === 0 || Number(h.tagName[1]) <= Number(all[i - 1].tagName[1]) + 1),
    };
  });
  if (seo.title !== "DirectPlaca | Placas inteligentes para revendedores") fail(`title ${seo.title}`);
  if (!seo.description || seo.description.length < 80 || seo.description.length > 200) fail(`description ${seo.description}`);
  if (seo.robots !== "index, follow") fail(`robots ${seo.robots}`);
  if (!seo.canonical?.endsWith("/revendedores") || !seo.ogTitle || !seo.ogImage?.includes("/revendedores/opengraph-image") || seo.ogLocale !== "pt_BR" || seo.twitterCard !== "summary_large_image") fail(`og ${JSON.stringify(seo)}`);
  if (seo.lang !== "pt-BR" || seo.h1.length !== 1 || seo.h2 < 9 || !seo.orderOk) fail(`headings ${JSON.stringify(seo)}`);
  const og = await fetch(`${APP}/revendedores/opengraph-image`);
  const ogBuf = Buffer.from(await og.arrayBuffer());
  const ogW = ogBuf.readUInt32BE(16);
  const ogH = ogBuf.readUInt32BE(20);
  if (og.status !== 200 || og.headers.get("content-type") !== "image/png" || ogW !== 1200 || ogH !== 630) fail(`og image ${og.status} ${ogW}x${ogH}`);
  console.log(`OK L2: SEO — title "${seo.title}", description (${seo.description.length} car.), robots index/follow (o painel continua noindex), canonical, Open Graph pt_BR, Twitter large image, imagem social 1200×630, 1 h1 e ${seo.h2} h2 em ordem`);

  // ---------- 11 resoluções ----------
  for (const [w, h] of VIEWPORTS) {
    await page.setViewport({ width: w, height: h });
    await page.goto(`${APP}/revendedores`, { waitUntil: "networkidle0" });
    const fold = await page.evaluate(() => {
      const cta = document.querySelector("#inicio [data-landing-cta]").getBoundingClientRect();
      return { ctaBottom: Math.round(cta.bottom), ctaVisible: cta.top >= 0 && cta.bottom <= innerHeight && cta.width > 0 };
    });
    if (!fold.ctaVisible) fail(`${w}x${h}: CTA do hero fora da tela sem rolar (base ${fold.ctaBottom}px)`);
    // rola a página inteira para carregar as imagens preguiçosas
    await page.evaluate(async () => {
      for (let y = 0; y < document.documentElement.scrollHeight; y += Math.round(innerHeight * 0.8)) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 70));
      }
    });
    await page.waitForNetworkIdle({ idleTime: 300, timeout: 15000 }).catch(() => null);
    const m = await page.evaluate(() => {
      const vw = innerWidth;
      const out = { overflow: document.documentElement.scrollWidth > vw + 0.5, cut: [], imgs: [], cards: [], ids: [] };
      for (const el of document.querySelectorAll(".landing h1, .landing h2, .landing h3, .landing p, .landing a, .landing button, .landing summary, .landing li")) {
        const r = el.getBoundingClientRect();
        if (!r.width) continue;
        if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== "auto") out.cut.push(`${el.tagName}:${el.textContent.trim().slice(0, 30)}`);
        if (r.right > vw + 0.5 || r.left < -0.5) {
          if (!el.closest(".landing-phone-peek, .landing-hero")) out.cut.push(`fora da tela ${el.tagName}:${el.textContent.trim().slice(0, 30)}`);
        }
      }
      for (const img of document.querySelectorAll(".landing img")) {
        const r = img.getBoundingClientRect();
        const natural = img.naturalWidth / img.naturalHeight;
        const shown = r.width / r.height;
        if (!img.complete || !img.naturalWidth) out.imgs.push(`não carregou ${img.alt}`);
        else if (Math.abs(natural - shown) / natural > 0.03) out.imgs.push(`distorcida ${img.alt} ${natural.toFixed(2)}≠${shown.toFixed(2)}`);
      }
      for (const card of document.querySelectorAll("[data-landing-tiers] > li, [data-landing-plan]")) {
        const r = card.getBoundingClientRect();
        if (r.left < 0 || r.right > vw + 0.5 || card.scrollWidth > card.clientWidth + 1) out.cards.push(card.dataset.tier ?? "plano");
      }
      for (const a of document.querySelectorAll('header nav a[href^="#"], .landing a[href^="#"]')) {
        const id = a.getAttribute("href").slice(1);
        if (id && !document.getElementById(id)) out.ids.push(id);
      }
      return out;
    });
    if (m.overflow) fail(`${w}x${h}: rolagem horizontal`);
    if (m.cut.length) fail(`${w}x${h}: texto cortado ${JSON.stringify(m.cut.slice(0, 5))}`);
    if (m.imgs.length) fail(`${w}x${h}: imagens ${JSON.stringify(m.imgs)}`);
    if (m.cards.length) fail(`${w}x${h}: cards quebrados ${JSON.stringify(m.cards)}`);
    if (m.ids.length) fail(`${w}x${h}: âncoras sem destino ${JSON.stringify(m.ids)}`);
    if (w === 390 || w === 1366) await page.screenshot({ path: `/tmp/landing-${w}.png` });
  }
  console.log(`OK L3: ${VIEWPORTS.length} resoluções (320×568 a 1920×1080): sem rolagem horizontal, sem texto cortado ou fora da tela, cards de preço e plano inteiros, todas as imagens carregadas e sem distorção, âncoras válidas`);
  console.log("OK L4: CTA 'Quero ser revendedor' do hero visível sem rolar em todas as resoluções (inclusive 320×568)");

  // ---------- FAQ por teclado, CTA, conteúdo comercial ----------
  await page.setViewport({ width: 390, height: 844 });
  await page.goto(`${APP}/revendedores#faq`, { waitUntil: "networkidle0" });
  const before = await page.$eval("[data-landing-faq] details", (d) => d.open);
  await page.focus("[data-landing-faq] summary");
  await page.keyboard.press("Enter");
  const after = await page.$eval("[data-landing-faq] details", (d) => d.open);
  if (before || !after) fail("FAQ não abre pelo teclado");
  const content = await page.evaluate(() => ({
    ctas: [...document.querySelectorAll("[data-landing-cta]")].map((a) => a.getAttribute("href")),
    tiers: [...document.querySelectorAll("[data-landing-tiers] > li")].map((li) => li.textContent),
    text: document.querySelector(".landing").textContent,
    hint: !!document.querySelector("[data-landing-config-hint]"),
  }));
  if (!content.ctas.length || content.ctas.some((h) => h !== "#contato")) fail(`CTAs ${JSON.stringify(content.ctas)}`);
  if (content.tiers.length !== 4 || !content.tiers.slice(0, 3).every((t) => t.includes("Sob consulta")) || !content.tiers[3].includes("Condição personalizada")) fail("lotes");
  if (/R\$\s?\d/.test(content.text)) fail("algum preço em R$ apareceu sem estar configurado");
  if (/renda garantida|lucro garantido|fature|franquia/i.test(content.text)) fail("linguagem proibida");
  if (content.hint) fail("aviso de configuração apareceu em produção");
  console.log(`OK L5: FAQ abre pelo teclado; ${content.ctas.length} botões de contato levam ao destino configurado (sem contato definido: #contato); lotes '10/25/50 = Sob consulta' e '100+ = Condição personalizada'; nenhum preço inventado; sem 'renda garantida/franquia'; aviso de configuração não aparece em produção`);
} finally {
  await browser.close();
}
if (failures) {
  console.log(`${failures} problema(s):\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
console.log("E2E da landing OK");
