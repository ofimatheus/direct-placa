/**
 * Nome de exibição do cliente, quarentena (varredura do código) e branding
 * do login: resolução, fallback com Supabase fora do ar e validação de upload
 * com imagens reais (PNG/JPG/WEBP) e arquivos inválidos.
 *   npm run test:customers-branding
 */
import { createServer } from "node:http";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import {
  CUSTOMER_TABS,
  compareCustomersByDisplayName,
  customerMatchesSearch,
  getCustomerDisplayName,
  getCustomerOptionLabel,
  getCustomerSecondaryName,
} from "@/lib/customers";
import { DEFAULT_BRANDING, brandingPublicUrl, resolveBranding, splitBrandName } from "@/lib/branding/defaults";
import { validateBrandingImage } from "@/lib/branding/image";
import { loadLoginBranding } from "@/lib/branding/load";

let failures = 0;
const ok = (label: string) => console.log(`OK ${label}`);
const check = (condition: unknown, label: string, detail?: unknown) => {
  if (!condition) {
    failures++;
    console.log(`FALHA ${label}`, detail ?? "");
  }
  return Boolean(condition);
};
async function rejects(promise: Promise<unknown>, status: number, label: string) {
  try {
    await promise;
    check(false, `${label}: deveria ter sido recusado`);
  } catch (error) {
    check((error as { status?: number }).status === status, `${label}: status`, error);
  }
}

function image(width: number, height: number, mime: "image/png" | "image/jpeg" | "image/webp"): Buffer {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#1d6bff";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#22d3ee";
  ctx.fillRect(width / 4, height / 4, width / 2, height / 2);
  if (mime === "image/png") return canvas.encodeSync("png");
  return canvas.encodeSync(mime === "image/jpeg" ? "jpeg" : "webp");
}

async function main() {
  // ---------------- C: nome de exibição do cliente ----------------
  const adega = { name: "João da Silva", company_name: "Adega Monster" };
  const ana = { name: "Ana Beatriz", company_name: null };
  const bia = { name: "Bia", company_name: "   " };
  check(getCustomerDisplayName(adega) === "Adega Monster", "C1 empresa é o nome principal");
  check(getCustomerSecondaryName(adega) === "João da Silva", "C1 responsável como linha secundária");
  check(getCustomerDisplayName(ana) === "Ana Beatriz" && getCustomerSecondaryName(ana) === null, "C2 sem empresa usa o nome");
  check(getCustomerDisplayName(bia) === "Bia", "C2 empresa em branco usa o nome");
  check(getCustomerSecondaryName({ name: "Adega", company_name: "adega" }) === null, "C2 não repete o mesmo nome");
  ok("C1–C2: empresa preenchida é o nome principal (responsável como secundário); empresa vazia usa o nome");

  check(customerMatchesSearch(adega, "joao") && customerMatchesSearch(adega, "MONSTER") && customerMatchesSearch(adega, "adéga"), "C3 busca");
  check(!customerMatchesSearch(ana, "monster"), "C3 busca não deveria achar");
  ok("C3: a busca encontra por responsável e por empresa, sem diferenciar maiúsculas nem acentos");

  const sorted = [ana, adega, bia].sort(compareCustomersByDisplayName).map(getCustomerDisplayName);
  check(sorted.join("|") === "Adega Monster|Ana Beatriz|Bia", "C4 ordenação", sorted);
  check(getCustomerOptionLabel(adega) === "Adega Monster (João da Silva)", "C4 rótulo do seletor");
  check(getCustomerOptionLabel({ ...ana, archived_at: "2026-09-30" }).endsWith("em quarentena"), "C4 rótulo de quarentena");
  check(CUSTOMER_TABS.map((t) => t.label).join("|") === "Ativos|Quarentena|Todos", "C4 abas");
  ok("C4: seletores ordenados pelo nome de exibição; abas Ativos | Quarentena | Todos");

  // ---------------- C5: nenhuma rota apaga cliente ----------------
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(tsx?|jsx?)$/.test(name)) {
        const code = readFileSync(path, "utf8");
        // .from("customers") ... .delete() no mesmo encadeamento
        for (const match of code.matchAll(/from\(\s*["']customers["']\s*\)([\s\S]{0,200}?)(;|\n\s*\n)/g)) {
          if (/\.delete\(/.test(match[1]!)) offenders.push(path);
        }
      }
    }
  };
  walk(join(process.cwd(), "src"));
  const deleteRoute = readFileSync(join(process.cwd(), "src/app/api/reseller/customers/[id]/route.ts"), "utf8");
  check(offenders.length === 0, "C5 DELETE físico no código", offenders);
  check(/export async function DELETE[\s\S]*quarantineCustomerResponse/.test(deleteRoute), "C5 DELETE antigo não foi substituído pela quarentena");
  ok("C5: nenhuma rota faz DELETE físico de cliente; o DELETE antigo agora move para a quarentena");

  // ---------------- B: resolução do branding ----------------
  const base = "https://proj.supabase.co";
  check(resolveBranding(null, base) === DEFAULT_BRANDING, "B1 sem configuração");
  const empty = resolveBranding({ brand_name: null, show_brand_name: null, eyebrow: null, title: "  ", subtitle: null, logo_path: null, banner_path: null }, base);
  check(empty.brandName === "DirectPlaca" && empty.title === "Entrar" && empty.logoUrl === null && empty.showBrandName, "B1 campos vazios usam o padrão", empty);
  const custom = resolveBranding(
    { brand_name: "Minha Marca", show_brand_name: false, eyebrow: "Área", title: "Olá", subtitle: "Sub", logo_path: "logo/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1.png", banner_path: "banner/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1.webp" },
    base,
  );
  check(
    custom.brandName === "Minha Marca" && !custom.showBrandName && custom.title === "Olá" &&
      custom.logoUrl === "https://proj.supabase.co/storage/v1/object/public/branding/logo/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1.png" &&
      custom.bannerUrl?.endsWith("/branding/banner/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1.webp"),
    "B1 personalizado",
    custom,
  );
  check(brandingPublicUrl(base, "../../secret.png") === null && brandingPublicUrl(base, "https://evil.com/x.png") === null, "B1 caminho fora do padrão");
  ok("B1: sem configuração ou com campos vazios usa o padrão DirectPlaca; caminho de imagem fora do padrão é ignorado");

  check(splitBrandName("DirectPlaca").join("|") === "Direct|Placa", "B2 DirectPlaca");
  check(splitBrandName("Minha Marca").join("|") === "Minha |Marca", "B2 com espaço");
  check(splitBrandName("placas").join("|") === "placas|", "B2 uma palavra");
  ok("B2: nome da marca em duas cores (Direct + Placa)");

  // ---------------- B3: carregamento nunca quebra ----------------
  const env = { url: process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY };
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  check((await loadLoginBranding()) === DEFAULT_BRANDING, "B3 sem variáveis de ambiente");

  let mode: "ok" | "error" | "hang" = "ok";
  const seen: string[] = [];
  const server = createServer((req, res) => {
    seen.push(`${req.method} ${req.url}`);
    if (mode === "hang") return; // nunca responde
    if (mode === "error") {
      res.writeHead(500).end("{}");
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" }).end(
      JSON.stringify([{ brand_name: "Marca Teste", show_brand_name: true, eyebrow: null, title: "Bem-vindo", subtitle: null, logo_path: null, banner_path: null }]),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  process.env.NEXT_PUBLIC_SUPABASE_URL = `http://127.0.0.1:${port}`;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-test";

  const loaded = await loadLoginBranding();
  check(loaded.brandName === "Marca Teste" && loaded.title === "Bem-vindo" && loaded.subtitle === DEFAULT_BRANDING.subtitle, "B3 personalizado", loaded);
  check(seen.some((s) => s.startsWith("POST /rest/v1/rpc/public_login_branding")), "B3 leitura deveria usar só a RPC pública", seen);
  mode = "error";
  check((await loadLoginBranding()) === DEFAULT_BRANDING, "B3 erro 500");
  mode = "hang";
  const started = Date.now();
  const hung = await loadLoginBranding();
  const elapsed = Date.now() - started;
  check(hung === DEFAULT_BRANDING && elapsed < 4000, `B3 timeout (${elapsed} ms)`);
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:1";
  check((await loadLoginBranding()) === DEFAULT_BRANDING, "B3 conexão recusada");
  server.closeAllConnections();
  server.close();
  if (env.url) process.env.NEXT_PUBLIC_SUPABASE_URL = env.url;
  if (env.key) process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = env.key;
  ok(`B3: login lê só a RPC pública; com Supabase fora do ar, erro 500, conexão recusada ou travado (${elapsed} ms) usa o padrão sem quebrar`);

  // ---------------- U: validação de upload ----------------
  const png = image(400, 400, "image/png");
  const jpg = image(1600, 900, "image/jpeg");
  const webp = image(1920, 1080, "image/webp");
  const logo = await validateBrandingImage(png, "logo", { filename: "logo.png", mime: "image/png" });
  const bannerJpg = await validateBrandingImage(jpg, "banner", { filename: "fundo.jpeg", mime: "image/jpeg" });
  const bannerWebp = await validateBrandingImage(webp, "banner", { filename: "fundo.webp", mime: "image/webp" });
  check(logo.ext === "png" && logo.width === 400, "U1 PNG", logo);
  check(bannerJpg.ext === "jpg" && bannerJpg.width === 1600, "U1 JPG", bannerJpg);
  check(bannerWebp.ext === "webp" && bannerWebp.width === 1920 && bannerWebp.height === 1080, "U1 WEBP", bannerWebp);
  ok("U1: PNG, JPG e WEBP válidos são aceitos (tipo e dimensões lidos dos bytes)");

  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  await rejects(validateBrandingImage(svg, "logo", { filename: "logo.svg", mime: "image/svg+xml" }), 415, "U2 SVG");
  await rejects(validateBrandingImage(Buffer.from("MZ executável disfarçado ".repeat(20)), "logo", { filename: "logo.png", mime: "image/png" }), 415, "U2 falso PNG");
  await rejects(validateBrandingImage(png, "logo", { filename: "logo.jpg", mime: "image/jpeg" }), 415, "U2 extensão e tipo mentem");
  await rejects(validateBrandingImage(png, "logo", { filename: "logo.webp" }), 415, "U2 extensão diferente do conteúdo");
  await rejects(validateBrandingImage(image(2200, 400, "image/png"), "logo", { filename: "g.png" }), 422, "U2 logo grande demais em pixels");
  await rejects(validateBrandingImage(image(600, 300, "image/png"), "banner", { filename: "b.png" }), 422, "U2 banner pequeno demais");
  await rejects(validateBrandingImage(Buffer.alloc(1024 * 1024 + 1, 1), "logo"), 413, "U2 logo acima de 1 MB");
  await rejects(validateBrandingImage(Buffer.alloc(4 * 1024 * 1024 + 1, 1), "banner"), 413, "U2 banner acima de 4 MB");
  const corrupted = Buffer.from(png);
  corrupted.fill(0, 60);
  await rejects(validateBrandingImage(corrupted, "logo", { filename: "c.png" }), 422, "U2 PNG corrompido");
  await rejects(validateBrandingImage(Buffer.alloc(0), "logo"), 422, "U2 vazio");
  ok("U2: SVG, arquivo disfarçado, extensão/tipo que não batem com os bytes, tamanho, dimensões e arquivo corrompido são recusados");

  if (failures) {
    console.log(`${failures} falha(s)`);
    process.exit(1);
  }
  console.log("Clientes e branding OK");
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
