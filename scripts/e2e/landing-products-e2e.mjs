/**
 * "Nossos Produtos" num Chromium real contra o Supabase simulado.
 * Ao final, publica de novo o conteúdo padrão (a página pública volta ao normal).
 */
import puppeteer from "puppeteer-core";

const APP = process.env.APP_URL ?? "http://localhost:3100";
const STUB = process.env.STUB_URL ?? "http://127.0.0.1:54399";
const SHOTS = process.env.WITH_SHOTS ?? "/tmp/with13";
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
const stub = (q) => fetch(`${STUB}/__landing${q}`).then((r) => r.json());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const publicHtml = async () => (await fetch(`${APP}/revendedores`)).text();
async function loginAdmin() {
  await cdp.send("Network.clearBrowserCookies");
  await page.setViewport({ width: 1366, height: 900 });
  await page.goto(`${APP}/login`, { waitUntil: "networkidle0" });
  await page.type("#email", "admin@teste.com");
  await page.type("#password", "Senha-Forte-2026");
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => null), page.click(".login-button")]);
}
const api = (method, path, body) =>
  page.evaluate(
    async (m, p, b) => {
      const r = await fetch(p, { method: m, headers: { "Content-Type": "application/json" }, body: b === undefined ? undefined : JSON.stringify(b) });
      return { status: r.status, text: await r.text() };
    },
    method,
    path,
    body,
  );
let version = 0;
async function publish(content, marker) {
  const put = await api("PUT", "/api/admin/landing/draft", { content, expectedVersion: version });
  if (put.status !== 200) throw new Error(`salvar: ${put.status} ${put.text.slice(0, 200)}`);
  version = JSON.parse(put.text).version;
  const pub = await api("POST", "/api/admin/landing/publish", { expectedVersion: version });
  if (pub.status !== 200) throw new Error(`publicar: ${pub.status} ${pub.text.slice(0, 200)}`);
  for (let i = 0; i < 15; i++) {
    if (marker(await publicHtml())) return;
    await sleep(700);
  }
  throw new Error("a página pública não atualizou");
}
const KEYS = ["tela-dashboard", "tela-placas", "tela-clientes", "tela-directlab", "tela-avaliacao-google", "tela-directlink-publico"];
const prod = (i, extra = {}) => ({ id: `produto-${i}`, image: { kind: "builtin", key: KEYS[i % KEYS.length], alt: `Modelo de placa ${i + 1}` }, title: "", text: "", enabled: true, ...extra });
const info = () =>
  page.evaluate(() => {
    const t = document.querySelector("[data-products-track]");
    const cards = [...document.querySelectorAll("[data-product-card]")];
    return {
      exists: !!document.getElementById("nossos-produtos"),
      cards: cards.length,
      alts: cards.map((c) => c.querySelector("img")?.alt ?? null),
      imgs: document.querySelectorAll("[data-product-card] img").length,
      scroll: t ? Math.round(t.scrollLeft) : null,
      controls: !!document.querySelector("[data-products-controls]"),
      dots: document.querySelectorAll(".landing-products-dot").length,
      autoplay: document.querySelector("[data-products-carousel]")?.getAttribute("data-autoplay"),
      static: t?.classList.contains("is-static"),
      nav: [...document.querySelectorAll("header nav a")].map((a) => a.textContent),
    };
  });
async function openPublic(w = 1366, h = 900) {
  await page.setViewport({ width: w, height: h });
  await page.goto(`${APP}/revendedores`, { waitUntil: "networkidle0" });
  await page.evaluate(() => document.getElementById("nossos-produtos")?.scrollIntoView({ block: "center" }));
  await sleep(500);
}

let base = null;
try {
  await stub("?reset=1");
  await loginAdmin();
  await page.goto(`${APP}/admin/landing`, { waitUntil: "networkidle0" });
  check(await page.$("[data-section-card='products']"), "N1 seção no CMS");
  await page.click("[data-action='save']");
  await page.waitForFunction(() => document.querySelector("[data-landing-feedback]")?.textContent.includes("Rascunho salvo"), { timeout: 10000 });
  const saved = await stub("");
  base = saved.draft.content;
  version = saved.draft.version;
  check(base.products.items.length === 0 && base.order.indexOf("products") === base.order.indexOf("product") + 1, "N1 padrão");
  ok("N1: a seção aparece no CMS; o conteúdo padrão salvo tem 'Nossos Produtos' sem nenhum produto, logo após 'Produto'");

  // ---------- limite no servidor ----------
  const c31 = structuredClone(base);
  c31.products.items = Array.from({ length: 31 }, (_, i) => prod(i));
  const r31 = await api("PUT", "/api/admin/landing/draft", { content: c31, expectedVersion: version });
  check(r31.status === 422 && r31.text.includes("No máximo 30 produtos"), "N2 31 recusado", r31);
  ok("N2: salvar 31 produtos chamando a API diretamente é recusado no servidor (422 'No máximo 30 produtos')");

  // ---------- rascunho / preview / publicação ----------
  const c10 = structuredClone(base);
  c10.products.items = Array.from({ length: 10 }, (_, i) => prod(i, { title: i === 4 ? "Título bem longo de um modelo de placa para conferir a quebra sem estourar o card".slice(0, 80) : i % 3 === 0 ? `Modelo ${i + 1}` : "", text: i === 6 ? "Descrição curta do modelo." : "" }));
  c10.products.items[2].enabled = false;
  c10.products.items[5].image = null;
  c10.products.items[7].image = { kind: "media", mediaId: "99999999-9999-4999-8999-999999999999", path: "media/99999999-9999-4999-8999-999999999999.webp", width: 800, height: 1200, alt: "Imagem ausente no armazenamento" };
  const put10 = await api("PUT", "/api/admin/landing/draft", { content: c10, expectedVersion: version });
  check(put10.status === 200, "N3 salvar", put10);
  if (put10.status === 200) version = JSON.parse(put10.text).version;
  check(!(await publicHtml()).includes('id="nossos-produtos"'), "N3 público sem a seção");
  await page.setViewport({ width: 1366, height: 900 });
  await page.goto(`${APP}/preview/revendedores`, { waitUntil: "networkidle0" });
  const pv = await info();
  check(pv.exists && pv.cards === 8 && pv.alts.join("|").startsWith("Modelo de placa 1|Modelo de placa 2|Modelo de placa 4"), "N3 preview", pv);
  ok("N3: 10 produtos no rascunho: /revendedores continua sem a seção; a pré-visualização mostra o carrossel com 8 (inativo e sem imagem ficam de fora), na ordem do CMS");
  await publish(c10, (h) => h.includes('id="nossos-produtos"'));
  await openPublic();
  const pub = await info();
  check(pub.exists && pub.cards === 8 && pub.nav.includes("Produtos"), "N4 publicado", pub);
  ok("N4: depois de publicar, /revendedores mostra os 8 produtos ativos com imagem, e o item 'Produtos' do menu (administrável) passa a aparecer");

  // ---------- desktop: setas, teclado, arrasto, indicadores ----------
  const s0 = (await info()).scroll;
  await page.click("[data-products-next]");
  await sleep(900);
  const s1 = (await info()).scroll;
  await page.click("[data-products-prev]");
  await sleep(900);
  const s2 = (await info()).scroll;
  await page.focus("[data-products-track]");
  await page.keyboard.press("ArrowRight");
  await sleep(900);
  const s3 = (await info()).scroll;
  await page.keyboard.press("Home");
  await sleep(900);
  const box = await (await page.$("[data-products-track]")).boundingBox();
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2, { steps: 12 });
  await page.mouse.up();
  await sleep(900);
  const s4 = (await info()).scroll;
  const d = await info();
  check(s1 > s0 && s2 < s1 && s3 > s2 && s4 > 0 && d.controls && d.dots >= 2, "N5 desktop", { s0, s1, s2, s3, s4, d });
  const focusRing = await page.evaluate(() => {
    const t = document.querySelector("[data-products-track]");
    t.focus();
    return getComputedStyle(t).outlineStyle;
  });
  check(focusRing !== "none", "N5 foco visível", focusRing);
  ok(`N5: desktop 1366 — seta 'próximo' avança (${s0}→${s1}), 'anterior' volta, ← → Home funcionam no teclado com foco visível, arrastar com o mouse rola (→${s4}); ${d.dots} indicadores`);

  // ---------- movimento automático e pausa ----------
  await openPublic();
  await page.mouse.move(5, 5);
  const a0 = (await info()).scroll;
  await sleep(5600);
  const a1 = (await info()).scroll;
  await page.click("[data-products-pause]");
  await page.mouse.move(5, 5);
  await page.evaluate(() => document.activeElement?.blur());
  const a2 = (await info()).scroll;
  await sleep(5600);
  const a3 = (await info()).scroll;
  check(a1 > a0 && a3 === a2, "N6 autoplay/pausa", { a0, a1, a2, a3 });
  await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
  await openPublic();
  await page.mouse.move(5, 5);
  const m0 = await info();
  await sleep(6000);
  const m1 = await info();
  check(m0.autoplay === "off" && m1.scroll === m0.scroll && !(await page.$("[data-products-pause]")), "N6 movimento reduzido", { m0, m1 });
  await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "no-preference" }]);
  ok("N6: o carrossel anda sozinho de forma suave (a cada 4,5 s); 'Pausar' para o movimento; com prefers-reduced-motion não há movimento automático nem botão de pausa");

  // ---------- celular: swipe por toque ----------
  await openPublic(390, 844);
  const mob = await page.evaluate(() => {
    const t = document.querySelector("[data-products-track]");
    const c = document.querySelector("[data-product-card]");
    return { ratio: c.getBoundingClientRect().width / t.clientWidth, touch: getComputedStyle(t).touchAction };
  });
  const tb = await (await page.$("[data-products-track]")).boundingBox();
  const sw0 = (await info()).scroll;
  const y = Math.round(tb.y + tb.height / 2);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 330, y }] });
  for (let x = 320; x >= 60; x -= 26) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await sleep(1200);
  const sw1 = (await info()).scroll;
  const yScroll0 = await page.evaluate(() => scrollY);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 200, y: y + 60 }] });
  for (let yy = y + 60; yy >= y - 160; yy -= 22) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: 200, y: yy }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await sleep(800);
  const yScroll1 = await page.evaluate(() => scrollY);
  check(mob.ratio > 0.72 && mob.ratio < 0.84 && sw1 > sw0 && yScroll1 > yScroll0 && mob.touch !== "none", "N7 celular", { mob, sw0, sw1, yScroll0, yScroll1 });
  ok(`N7: celular 390 — 1 produto em destaque (${Math.round(mob.ratio * 100)}% da largura, o próximo aparecendo), swipe por toque rola o carrossel (${sw0}→${sw1}) e arrastar na vertical continua rolando a página (${yScroll0}→${yScroll1})`);

  // ---------- 11 resoluções ----------
  const problems = [];
  for (const [w, h] of VIEWPORTS) {
    await openPublic(w, h);
    await page.evaluate(async () => {
      const t = document.querySelector("[data-products-track]");
      for (let i = 0; i < 12; i++) {
        t.scrollLeft += t.clientWidth;
        await new Promise((r) => setTimeout(r, 60));
      }
      t.scrollLeft = 0;
    });
    await page.waitForNetworkIdle({ idleTime: 300, timeout: 10000 }).catch(() => null);
    const m = await page.evaluate(() => {
      const vw = innerWidth;
      const out = { overflow: document.documentElement.scrollWidth > vw + 0.5, controls: [], imgs: [], cards: [], media: new Set() };
      for (const b of document.querySelectorAll("[data-products-controls] button")) {
        const r = b.getBoundingClientRect();
        if (r.left < 0 || r.right > vw + 0.5) out.controls.push(b.getAttribute("aria-label"));
      }
      for (const img of document.querySelectorAll("[data-product-card] img")) {
        if (getComputedStyle(img).objectFit !== "contain") out.imgs.push(`sem contain ${img.alt}`);
      }
      for (const c of document.querySelectorAll("[data-product-card]")) {
        if (c.scrollWidth > c.clientWidth + 1) out.cards.push(c.getAttribute("aria-label"));
        out.media.add(Math.round(c.querySelector(".landing-product-media").getBoundingClientRect().height));
      }
      out.media = [...out.media];
      if (out.media.length !== 1) out.which = [...document.querySelectorAll("[data-product-card]")].map((c) => `${c.querySelector("img")?.alt ?? "?"}=${Math.round(c.querySelector(".landing-product-media").getBoundingClientRect().height)}`);
      return out;
    });
    if (m.overflow) problems.push(`${w}x${h}: rolagem horizontal da página`);
    if (m.controls.length) problems.push(`${w}x${h}: controles cortados ${m.controls}`);
    if (m.imgs.length) problems.push(`${w}x${h}: ${m.imgs}`);
    if (m.cards.length) problems.push(`${w}x${h}: card estourado ${m.cards}`);
    if (m.media.length !== 1) problems.push(`${w}x${h}: cards com alturas de imagem diferentes ${m.media} ${JSON.stringify(m.which)}`);
    if (w === 390 || w === 1366) await page.screenshot({ path: `/tmp/produtos-${w}.png` });
  }
  check(problems.length === 0, "N8 resoluções", problems);
  ok("N8: em 11 resoluções (320×568 a 1920×1080): página sem rolagem horizontal, setas inteiras, imagens sem distorção (contain), título longo não estoura o card e todas as áreas de imagem com a mesma altura — inclusive a do arquivo ausente no armazenamento");

  // ---------- capturas das seções antigas COM produtos (comparação pixel a pixel fora daqui) ----------
  await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
  for (const w of [1366, 390]) {
    await page.setViewport({ width: w, height: 900 });
    await page.goto(`${APP}/revendedores`, { waitUntil: "networkidle0" });
    await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 500) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 40)); } window.scrollTo(0, 0); });
    await page.waitForNetworkIdle({ idleTime: 400 }).catch(() => null);
    await page.evaluate(() => document.fonts.ready);
    await page.addStyleTag({ content: "header{position:static!important}" });
    for (const id of await page.$$eval("main > section[id]", (els) => els.map((e) => e.id))) {
      if (id !== "nossos-produtos") await (await page.$(`section#${id}`)).screenshot({ path: `${SHOTS}/${w}-${id}.png` });
    }
    await (await page.$("footer")).screenshot({ path: `${SHOTS}/${w}-footer.png` });
  }
  await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "no-preference" }]);

  // ---------- reativar ----------
  c10.products.items[2].enabled = true;
  await publish(c10, (h) => (h.match(/data-product-card/g) ?? []).length === 9);
  await openPublic();
  check((await info()).cards === 9, "N9 reativar");
  ok("N9: reativar o produto inativo e publicar o traz de volta (9 produtos)");

  // ---------- quantidades ----------
  const only = (n) => {
    const c = structuredClone(base);
    c.products.items = Array.from({ length: n }, (_, i) => prod(i));
    return c;
  };
  await publish(only(1), (h) => (h.match(/data-product-card/g) ?? []).length === 1);
  await openPublic();
  const one = await info();
  await sleep(5000);
  check(one.cards === 1 && !one.controls && one.static && one.autoplay === "off" && (await info()).scroll === one.scroll, "N10 1 produto", one);
  ok("N10: 1 produto → card centralizado, sem setas, sem indicadores e sem movimento automático");
  await publish(only(4), (h) => (h.match(/data-product-card/g) ?? []).length === 4);
  await openPublic(1366, 900);
  const four = await info();
  await openPublic(390, 844);
  const fourMobile = await info();
  check(four.cards === 4 && four.static && !four.controls && fourMobile.controls && !fourMobile.static, "N11 4 produtos", { four, fourMobile });
  await publish(only(2), (h) => (h.match(/data-product-card/g) ?? []).length === 2);
  await openPublic(1366, 900);
  const two = await info();
  check(two.cards === 2 && two.static && !two.controls, "N11 2 produtos", two);
  ok("N11: 2 e 4 produtos cabem no notebook → centralizados, sem setas e sem duplicar cards para simular loop; no celular, os 4 viram carrossel com setas");
  await publish(only(30), (h) => (h.match(/data-product-card/g) ?? []).length === 30);
  await openPublic(1366, 900);
  const thirty = await info();
  await page.focus("[data-products-track]");
  await page.keyboard.press("End");
  await sleep(1200);
  const thirtyEnd = await info();
  check(thirty.cards === 30 && thirty.imgs <= 8 && thirtyEnd.imgs === 30 && !(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)), "N12 30 produtos", { thirty: thirty.imgs, end: thirtyEnd.imgs });
  ok(`N12: 30 produtos → só ${thirty.imgs} imagens carregadas no início; ao avançar até o fim (tecla End), carregam aos poucos até as 30; sem rolagem horizontal da página`);
  const off = only(5);
  off.products.items = off.products.items.map((p) => ({ ...p, enabled: false }));
  await publish(off, (h) => !h.includes('id="nossos-produtos"'));
  await openPublic(1366, 900);
  const none = await info();
  check(!none.exists && !none.nav.includes("Produtos"), "N13 sem ativos", none);
  ok("N13: com 0 produtos ativos, a seção some inteira (sem espaço vazio) e o item 'Produtos' sai do menu");
} catch (e) {
  failures++;
  console.log("FALHA erro inesperado", e.message);
} finally {
  if (base) {
    try {
      await publish(base, (h) => !h.includes('id="nossos-produtos"') && h.includes("Placas inteligentes."));
      console.log("(landing padrão publicada de novo)");
    } catch (e) {
      console.log("aviso: não restaurou a landing padrão", e.message);
    }
  }
  await stub("?reset=1");
  await browser.close();
}
if (failures) {
  console.log(`${failures} falha(s)`);
  process.exit(1);
}
console.log("E2E de Nossos Produtos OK");
