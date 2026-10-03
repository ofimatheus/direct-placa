/**
 * CMS da landing (Admin › Landing Page), num Chromium real contra o Supabase
 * simulado (rascunho/publicado em memória, mesma regra de versão do banco).
 */
import puppeteer from "puppeteer-core";

const APP = process.env.APP_URL ?? "http://localhost:3100";
const STUB = process.env.STUB_URL ?? "http://127.0.0.1:54399";
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
await browser.defaultBrowserContext().overridePermissions(APP, ["clipboard-read", "clipboard-write", "clipboard-sanitized-write"]);
const page = await browser.newPage();
const cdp = await page.createCDPSession();
const stub = (q) => fetch(`${STUB}/__landing${q}`).then((r) => r.json());
const publicHtml = async () => (await fetch(`${APP}/revendedores`, { headers: { "Cache-Control": "no-cache" } })).text();
async function loginAs(email) {
  await cdp.send("Network.clearBrowserCookies");
  await page.setViewport({ width: 1366, height: 900 });
  await page.goto(`${APP}/login`, { waitUntil: "networkidle0" });
  await page.type("#email", email);
  await page.type("#password", "Senha-Forte-2026");
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => null), page.click(".login-button")]);
}
const api = (method, path, body, isForm = false) =>
  page.evaluate(
    async (m, p, b, f) => {
      const init = { method: m };
      if (f) {
        const fd = new FormData();
        fd.append("file", new File([new Uint8Array([137, 80, 78, 71])], "x.png", { type: "image/png" }));
        init.body = fd;
      } else if (b !== undefined) {
        init.headers = { "Content-Type": "application/json" };
        init.body = JSON.stringify(b);
      }
      const r = await fetch(p, init);
      return { status: r.status, text: await r.text() };
    },
    method,
    path,
    body,
    isForm,
  );
/** Preenche o campo pelo rótulo dentro de um escopo (como o usuário digitaria). */
const setField = (scope, label, value) =>
  page.evaluate(
    (s, l, v) => {
      const root = document.querySelector(s);
      const lab = [...root.querySelectorAll("label")].find((x) => x.querySelector(".field-label span")?.textContent === l);
      const el = lab?.querySelector("input, textarea, select");
      if (!el) return false;
      const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : el.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value").set.call(el, v);
      el.dispatchEvent(new Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
      el.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
      return true;
    },
    scope,
    label,
    value,
  );
const openCard = (id) => page.evaluate((i) => document.querySelector(`[data-section-card="${i}"]`).setAttribute("open", ""), id);
async function waitPublic(predicate, label) {
  for (let i = 0; i < 12; i++) {
    const html = await publicHtml();
    if (predicate(html)) return html;
    await new Promise((r) => setTimeout(r, 800));
  }
  check(false, `${label}: página pública não atualizou`);
  // Diagnóstico: guarda o conteúdo que de fato está publicado no banco simulado.
  try {
    (await import("node:fs")).writeFileSync(`/tmp/publicado-${label}.json`, JSON.stringify((await stub("")).published, null, 1));
  } catch {}
  return publicHtml();
}

try {
  await stub("?reset=1");
  const before = await publicHtml();
  check(before.includes("Placas inteligentes.") && !before.includes("29,90"), "C0 padrão");
  ok("C0: sem nada publicado, /revendedores mostra o conteúdo padrão (a landing original)");

  // ---------- revendedor e público barrados ----------
  await loginAs("revenda@teste.com");
  await page.goto(`${APP}/admin/landing`, { waitUntil: "networkidle0" });
  check(!page.url().includes("/admin/landing") && !(await page.$("[data-landing-editor]")), "C1 revendedor módulo", page.url());
  await page.goto(`${APP}/preview/revendedores`, { waitUntil: "networkidle0" });
  check(!page.url().includes("/preview/") && !(await page.$("[data-landing-preview]")), "C1 revendedor preview", page.url());
  const resApis = [await api("PUT", "/api/admin/landing/draft", { content: {}, expectedVersion: 0 }), await api("POST", "/api/admin/landing/publish", { expectedVersion: 1 }), await api("POST", "/api/admin/landing/discard"), await api("POST", "/api/admin/landing/media", undefined, true), await api("DELETE", "/api/admin/landing/media/11111111-1111-4111-8111-111111111111")];
  check(resApis.every((r) => r.status === 403), "C1 revendedor APIs", resApis.map((r) => r.status));
  await cdp.send("Network.clearBrowserCookies");
  await page.goto(`${APP}/preview/revendedores`, { waitUntil: "networkidle0" });
  check(page.url().includes("/login") && !(await page.$("[data-landing-preview]")), "C1 público preview", page.url());
  const anonApis = [await api("PUT", "/api/admin/landing/draft", { content: {}, expectedVersion: 0 }), await api("POST", "/api/admin/landing/media", undefined, true)];
  check(anonApis.every((r) => r.status === 401), "C1 público APIs", anonApis.map((r) => r.status));
  check((await stub("")).draft === null, "C1 nada gravado");
  ok("C1: revendedor não abre o módulo nem a pré-visualização e recebe 403 em salvar/publicar/descartar/enviar/excluir; público é mandado ao login e recebe 401 (inclusive upload); nada foi gravado");

  // ---------- ADMIN edita pela interface ----------
  await loginAs("admin@teste.com");
  await page.goto(`${APP}/admin/landing`, { waitUntil: "networkidle0" });
  const navOk = await page.$eval('[data-shell-sidebar] a[href="/admin/landing"]', (a) => a.textContent.trim()).catch(() => null);
  check(navOk === "Landing Page" && (await page.$("[data-landing-editor]")), "C2 menu", navOk);
  check((await page.$eval("[data-public-url]", (e) => e.textContent)) === `${APP}/revendedores`, "C2 link público");
  await openCard("hero");
  await setField('[data-section-card="hero"]', "Título principal", "Revenda placas inteligentes com a DirectPlaca");
  await openCard("faq");
  await page.evaluate(() => [...document.querySelectorAll('[data-section-card="faq"] button')].find((b) => b.textContent.trim() === "+ Adicionar").click());
  await page.evaluate(() => {
    const items = document.querySelectorAll('[data-section-card="faq"] [data-list-item]');
    const last = items[items.length - 1];
    const set = (label, v) => {
      const lab = [...last.querySelectorAll("label")].find((x) => x.querySelector(".field-label span")?.textContent === label);
      const el = lab.querySelector("input, textarea");
      Object.getOwnPropertyDescriptor(el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, "value").set.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    };
    set("Pergunta", "Qual é o prazo de entrega das placas?");
    set("Resposta", "O prazo é informado no atendimento, conforme o lote.");
  });
  await page.click('[data-testid="toggle-about"]');
  await page.click('[data-tab="comercial"]');
  await page.evaluate(() => {
    const first = document.querySelector('[data-commercial="wholesale"] [data-list-item]');
    first.setAttribute("data-e2e", "tier1");
  });
  await setField('[data-e2e="tier1"]', "Preço por unidade", "29,90");
  await setField('[data-commercial="subscription"]', "Valor mensal", "59,90");
  await setField('[data-commercial="contact"]', "WhatsApp (só números, com DDI e DDD)", "5511999998888");
  await page.click('[data-tab="seo"]');
  await setField("[data-seo]", "Título SEO", "DirectPlaca | Revenda de placas — teste E2E");
  await page.click('[data-action="save"]');
  await page.waitForFunction(() => document.querySelector("[data-landing-feedback]")?.textContent.includes("Rascunho salvo"), { timeout: 10000 });
  const draft = (await stub("")).draft;
  check(draft?.version === 1 && draft.content.wholesale.tiers[0].unitPriceCents === 2990 && draft.content.subscription.monthlyPriceCents === 5990 && draft.content.about.enabled === false, "C2 rascunho salvo", draft?.content?.wholesale?.tiers?.[0]);
  ok("C2: ADMIN abre 'Landing Page' pelo menu, vê o link público real e edita pela interface (título, FAQ novo, 'Sobre' oculta, preço 29,90, mensalidade 59,90, WhatsApp, SEO); 'Salvar rascunho' grava a versão 1 (preços em centavos)");

  // ---------- rascunho não é público; pré-visualização mostra ----------
  const stillPublic = await publicHtml();
  check(!stillPublic.includes("29,90") && !stillPublic.includes("Revenda placas inteligentes com a DirectPlaca") && stillPublic.includes("Placas inteligentes."), "C3 público intacto");
  await page.goto(`${APP}/preview/revendedores`, { waitUntil: "networkidle0" });
  const prev = await page.content();
  check(prev.includes("Pré-visualização do RASCUNHO") && prev.includes("R$&nbsp;29,90") && prev.includes("Revenda placas inteligentes com a DirectPlaca") && !prev.includes('id="sobre"'), "C3 pré-visualização", prev.slice(0, 0));
  check((await page.$eval('meta[name="robots"]', (m) => m.content).catch(() => null)) === "noindex, nofollow", "C3 preview noindex");
  ok("C3: depois de salvar, /revendedores continua igual; a pré-visualização (só ADMIN, noindex) mostra o rascunho com o aviso, preço R$ 29,90 e sem a seção oculta");

  // ---------- publicar ----------
  await page.goto(`${APP}/admin/landing`, { waitUntil: "networkidle0" });
  await page.click('[data-action="publish"]');
  await page.waitForSelector("[data-confirm]");
  await page.click("[data-confirm-action]");
  await page.waitForFunction(() => document.querySelector("[data-landing-feedback]")?.textContent.includes("Landing publicada com sucesso"), { timeout: 15000 });
  check((await page.$eval("[data-status-text]", (e) => e.textContent)) === "● Publicada", "C4 status");
  const pubHtml = await waitPublic((h) => h.includes("29,90"), "C4");
  // O HTML do servidor traz o espaço não separável como caractere (U+00A0), não como &nbsp;.
  const has = { preco: /R\$(\u00a0|&nbsp;| )29,90/.test(pubHtml), mensal: /R\$(\u00a0|&nbsp;| )59,90/.test(pubHtml), wa: pubHtml.includes("https://wa.me/5511999998888?text="), faq: pubHtml.includes("Qual é o prazo de entrega das placas?"), semSobre: !pubHtml.includes('id="sobre"') };
  check(Object.values(has).every(Boolean), "C4 conteúdo publicado", has);
  check(pubHtml.includes("<title>DirectPlaca | Revenda de placas — teste E2E</title>") && pubHtml.includes('property="og:title" content="DirectPlaca | Revenda de placas — teste E2E"'), "C4 SEO publicado");
  ok("C4: 'Publicar alterações' (com confirmação) → '● Publicada'; /revendedores passa a mostrar R$ 29,90, mensalidade R$ 59,90, botões wa.me/5511999998888, a nova pergunta e o SEO novo (title e og:title), sem a seção oculta");

  // ---------- copiar link ----------
  await page.click('[data-action="copy"]');
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  check(clip === `${APP}/revendedores` && (await page.$eval('[data-action="copy"]', (b) => b.textContent)) === "Link copiado", "C5 copiar", clip);
  ok(`C5: 'Copiar link' grava na área de transferência real: ${clip}`);

  // ---------- conteúdo extremo ----------
  const cur = (await stub("")).draft;
  const c = structuredClone(cur.content);
  const long = (n) => ("Texto muito longo com palavrasextremamentecompridassemespaço " + "x".repeat(n)).slice(0, n);
  c.hero.title = long(140);
  c.hero.titleHighlight = long(140);
  c.hero.text = long(600);
  c.hero.bullets = [long(60), long(60), long(60), long(60)];
  c.headerCta.cta.label = long(60);
  c.nav = c.nav.map((n) => ({ ...n, label: long(30) }));
  c.wholesale.title = long(160);
  c.wholesale.badge = long(80);
  c.wholesale.tiers = [{ ...c.wholesale.tiers[0], label: long(40), unitPriceCents: null, description: long(200), badge: long(30), highlight: true, ctaLabel: long(40) }];
  c.why.items = Array.from({ length: 9 }, (_, i) => ({ id: `w${i}`, icon: "star", title: long(80), text: long(300), enabled: true }));
  c.faq.items = Array.from({ length: 40 }, (_, i) => ({ id: `f${i}`, q: long(160), a: long(1200), enabled: true }));
  c.platform.screenshots = ["tela-dashboard", "tela-placas", "tela-clientes", "tela-directlab", "tela-avaliacao-google", "tela-dashboard"].map((k, i) => ({ id: `s${i}`, image: { kind: "builtin", key: k, alt: "tela" }, caption: long(160), enabled: true }));
  c.product.enabled = false;
  c.hero.image = null;
  c.contact = { ...c.contact, whatsappNumber: "", email: "", formUrl: "", preferred: "auto" };
  c.footer.text = long(300);
  const put = await api("PUT", "/api/admin/landing/draft", { content: c, expectedVersion: cur.version });
  const pubExtreme = await api("POST", "/api/admin/landing/publish", { expectedVersion: cur.version + 1 });
  check(put.status === 200 && pubExtreme.status === 200, "C6 publicar extremo", [put.text.slice(0, 200), pubExtreme.text.slice(0, 200)]);
  await waitPublic((h) => h.includes("palavrasextremamentecompridassemespaço"), "C6");
  const problems = [];
  for (const [w, h] of VIEWPORTS) {
    await page.setViewport({ width: w, height: h });
    await page.goto(`${APP}/revendedores`, { waitUntil: "networkidle0" });
    await page.evaluate(async () => {
      for (let y = 0; y < document.documentElement.scrollHeight; y += Math.round(innerHeight * 0.9)) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 40));
      }
    });
    await page.waitForNetworkIdle({ idleTime: 300, timeout: 15000 }).catch(() => null);
    const m = await page.evaluate(() => {
      const vw = innerWidth;
      const out = { overflow: document.documentElement.scrollWidth > vw + 0.5, cut: [], imgs: [], hidden: !!document.getElementById("produto"), navHidden: [...document.querySelectorAll('header nav a')].some((a) => a.getAttribute("href") === "#produto"), ctas: [...document.querySelectorAll("[data-landing-cta]")].map((a) => a.getAttribute("href")) };
      for (const el of document.querySelectorAll(".landing h1, .landing h2, .landing h3, .landing p, .landing a, .landing summary, .landing li")) {
        const r = el.getBoundingClientRect();
        if (!r.width) continue;
        if ((el.scrollWidth > el.clientWidth + 1 && !["hidden", "clip"].includes(getComputedStyle(el).overflowX)) || ((r.right > vw + 0.5 || r.left < -0.5) && !el.closest(".landing-phone-peek, .landing-hero")))
          out.cut.push(`${el.tagName}:${el.textContent.trim().slice(0, 20)}`);
      }
      for (const img of document.querySelectorAll(".landing img")) {
        const r = img.getBoundingClientRect();
        if (!img.complete || !img.naturalWidth) out.imgs.push(`não carregou ${img.alt}`);
        else if (Math.abs(img.naturalWidth / img.naturalHeight - r.width / r.height) / (img.naturalWidth / img.naturalHeight) > 0.03) out.imgs.push(`distorcida ${img.alt}`);
      }
      out.anchors = [...document.querySelectorAll('.landing a[href^="#"]')].map((a) => a.getAttribute("href").slice(1)).filter((id) => id && !document.getElementById(id));
      return out;
    });
    if (m.anchors.length) problems.push(`${w}x${h}: âncoras sem destino ${JSON.stringify(m.anchors)}`);
    if (m.overflow) problems.push(`${w}x${h}: rolagem horizontal`);
    if (m.cut.length) problems.push(`${w}x${h}: texto cortado ${JSON.stringify(m.cut.slice(0, 3))}`);
    if (m.imgs.length) problems.push(`${w}x${h}: ${JSON.stringify(m.imgs)}`);
    if (m.hidden || m.navHidden) problems.push(`${w}x${h}: seção oculta apareceu`);
    if (m.ctas.some((x) => x !== "#contato")) problems.push(`${w}x${h}: CTA sem contato deveria ir a #contato`);
    if (w === 390 || w === 1366) await page.screenshot({ path: `/tmp/cms-extremo-${w}.png` });
  }
  check(problems.length === 0, "C6 conteúdo extremo", problems);
  ok("C6: conteúdo extremo publicado (títulos/textos no limite, palavras sem espaço, 40 perguntas longas, 1 lote sem preço, 9 benefícios, 6 telas, seção Produto oculta, Hero sem imagem, sem WhatsApp) — em 11 resoluções: sem rolagem horizontal, sem texto cortado, imagens íntegras, seção oculta some também do menu e nenhum botão aponta para ela (âncoras sempre com destino), botões sem contato vão a #contato");
} finally {
  await stub("?reset=1");
  await browser.close();
}
if (failures) {
  console.log(`${failures} falha(s)`);
  process.exit(1);
}
console.log("E2E do CMS da landing OK");
