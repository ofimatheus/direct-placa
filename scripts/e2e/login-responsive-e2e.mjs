/**
 * Card de login responsivo: 12 resoluções num Chromium real (mesmos
 * pré-requisitos de login-e2e.mjs). Confere overflow, card inteiro na tela
 * no notebook, campos/botão visíveis e alvos de toque no celular.
 */
import puppeteer from "puppeteer-core";

const APP = process.env.APP_URL ?? "http://localhost:3100";
const SHOTS = process.env.SHOTS_DIR ?? "/tmp";
const VIEWPORTS = [
  [1920, 1080], [1440, 960], [1440, 900], [1366, 768], [1280, 720], [1024, 768], [768, 1024],
  [430, 932], [412, 915], [390, 844], [375, 812], [360, 800], [320, 568],
];
let failures = 0;
const problems = [];
const fail = (m) => { failures++; problems.push(m); };

async function launch() {
  if (process.env.CHROME_PATH) return puppeteer.launch({ executablePath: process.env.CHROME_PATH, headless: true, args: ["--no-sandbox"] });
  const chromium = (await import("@sparticuz/chromium")).default;
  return puppeteer.launch({ args: chromium.args, executablePath: await chromium.executablePath(), headless: true });
}

const browser = await launch();
const page = await browser.newPage();
const rows = [];
try {
  for (const [w, h] of VIEWPORTS) {
    await page.setViewport({ width: w, height: h });
    await page.goto(`${APP}/login`, { waitUntil: "networkidle0" });
    const m = await page.evaluate(() => {
      const r = (el) => el.getBoundingClientRect();
      const card = r(document.querySelector(".login-card"));
      const inputs = [...document.querySelectorAll(".login-input")].map((el) => ({ ...r(el).toJSON(), font: parseFloat(getComputedStyle(el).fontSize) }));
      const button = r(document.querySelector(".login-button"));
      return {
        overflow: document.documentElement.scrollWidth > innerWidth,
        card: { top: card.top, bottom: card.bottom, left: card.left, right: card.right, width: card.width, height: card.height },
        inputs, button: button.toJSON(), vh: innerHeight, vw: innerWidth,
      };
    });
    const tag = `${w}x${h}`;
    if (m.overflow) fail(`${tag}: rolagem horizontal`);
    if (m.card.left < 0 || m.card.right > m.vw + 0.5) fail(`${tag}: card sai da largura da tela`);
    if (w >= 1024) {
      if (m.card.top < 0 || m.card.bottom > m.vh + 0.5) fail(`${tag}: card não cabe na altura (topo ${Math.round(m.card.top)}, base ${Math.round(m.card.bottom)} de ${m.vh})`);
      if (m.button.bottom > m.vh || m.inputs.some((i) => i.bottom > m.vh)) fail(`${tag}: campo ou botão fora da tela`);
      if (h <= 940 && m.card.width > 460.5) fail(`${tag}: card largo demais no notebook (${Math.round(m.card.width)} px)`);
    } else {
      if (m.inputs.some((i) => i.height < 44) || m.button.height < 44) fail(`${tag}: área de toque abaixo de 44 px`);
      if (m.inputs.some((i) => i.font < 16)) fail(`${tag}: fonte do campo abaixo de 16 px (o iOS aplicaria zoom)`);
      if (m.inputs.some((i) => i.right > m.vw || i.left < 0)) fail(`${tag}: campo cortado na largura`);
    }
    rows.push(`${tag.padEnd(10)} card ${Math.round(m.card.width)}×${Math.round(m.card.height)} (topo ${Math.round(m.card.top)}, base ${Math.round(m.card.bottom)}/${m.vh}) campo ${Math.round(m.inputs[0].height)}px botão ${Math.round(m.button.height)}px`);
    if ([1920, 1366, 1280, 320].includes(w) || (w === 1440 && h === 960) || (w === 390)) await page.screenshot({ path: `${SHOTS}/loginr-${w}x${h}.png` });
  }
} finally {
  await browser.close();
}
console.log(rows.join("\n"));
if (failures) {
  console.log(`${failures} problema(s):\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
console.log("OK LR1: 13 resoluções (1920×1080 a 320×568) sem rolagem horizontal; card sempre dentro da largura");
console.log("OK LR2: notebook (1440×900, 1366×768, 1280×720, 1024×768): card inteiro na tela, sem rolar, com campos e botão visíveis e largura ≤ 460 px");
console.log("OK LR3: celular: campos e botão com área de toque ≥ 44 px e fonte de 16 px (sem zoom automático do iOS)");
console.log("E2E do login responsivo OK");
