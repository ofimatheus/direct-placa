/**
 * CMS da landing — esquema, conteúdo padrão (= landing original), contato,
 * SEO, carregador com fallback, validação de imagens e rotas do ADMIN.
 *   npm run test:landing-cms
 */
import { readFileSync } from "node:fs";
import { createCanvas } from "@napi-rs/canvas";
import { validateBrandingImage } from "@/lib/branding/image";
import { ctaTarget, landingMediaUrl, landingOrigin, resolveContact, whatsappUrl } from "@/lib/landing/contact";
import { defaultLandingContent } from "@/lib/landing/defaults";
import { loadPublishedLandingFrom } from "@/lib/landing/load";
import { landingMetadata } from "@/lib/landing/metadata";
import { mediaPathsIn, validateLandingContent, type LandingContent } from "@/lib/landing/schema";
import { parseMoneyToCents } from "@/lib/reseller-sales";

let failures = 0;
const ok = (l: string) => console.log(`OK ${l}`);
const check = (c: unknown, l: string, d?: unknown) => {
  if (!c) {
    failures++;
    console.log(`FALHA ${l}`, JSON.stringify(d ?? "").slice(0, 300));
  }
};
const logs: string[] = [];
for (const lvl of ["warn", "error"] as const) console[lvl] = (...a: unknown[]) => void logs.push(a.map((x) => JSON.stringify(x)).join(" "));
const clone = (): LandingContent => structuredClone(defaultLandingContent());

async function main() {
  // ---------- 1. Conteúdo padrão = landing original ----------
  const def = defaultLandingContent();
  check(validateLandingContent(def).ok, "D1 padrão válido");
  const old = readFileSync("/tmp/old-landing.tsx", "utf8");
  const json = JSON.stringify(def);
  const oldTexts = [...old.matchAll(/(?:title|text|eyebrow|q|a): "([^"]{12,})"/g)].map((m) => m[1]!);
  const jsxTexts = [...old.matchAll(/>\s*([A-ZÀ-Ú][^<>{}]{14,}?)\s*</g)].map((m) => m[1]!.trim()).filter((t) => !/className|=/.test(t));
  // Exclusões justificadas: pergunta condicional (só aparece com resposta configurada, antes e agora),
  // o link "Entrar" (continua fixo no cabeçalho, não é conteúdo) e o aviso de desenvolvimento (agora aponta para o CMS).
  const notContent = (t: string) => t === "Preciso ter empresa para revender?" || t === "Entrar" || t.startsWith("Configure o WhatsApp, formulário ou e-mail");
  const missing = [...new Set([...oldTexts, ...jsxTexts])].filter((t) => !notContent(t) && !json.includes(t.replace(/\s+/g, " ")));
  check(oldTexts.length >= 20 && missing.length === 0, "D1 todos os textos da landing original estão no padrão", { total: oldTexts.length + jsxTexts.length, missing });
  check(def.wholesale.tiers.length === 4 && def.wholesale.tiers.every((t, i) => (i < 3 ? t.unitPriceCents === null && !t.custom : t.custom)) && def.subscription.monthlyPriceCents === null, "D1 preços como estavam");
  ok(`D1: conteúdo padrão é válido e contém todos os textos da landing original (${oldTexts.length + jsxTexts.length} verificados; exceto a pergunta condicional, o link fixo "Entrar" e o aviso de desenvolvimento) (nada some ao aplicar a migration); lotes e mensalidade como estavam`);

  // ---------- 2. Esquema protege o layout ----------
  const bad = (mut: (c: LandingContent) => void) => {
    const c = clone();
    mut(c);
    return !validateLandingContent(c).ok;
  };
  check(bad((c) => (c.hero.title = "x".repeat(141))), "S título longo demais");
  check(bad((c) => (c.hero.title = "")), "S título vazio");
  check(bad((c) => (c.wholesale.tiers = [])), "S 0 lotes");
  check(bad((c) => (c.wholesale.tiers = Array.from({ length: 7 }, () => c.wholesale.tiers[0]!))), "S 7 lotes");
  check(bad((c) => (c.wholesale.tiers[0]!.unitPriceCents = 12.5)), "S preço com fração de centavo");
  check(bad((c) => (c.wholesale.tiers[0]!.unitPriceCents = -1)), "S preço negativo");
  check(bad((c) => (c.hero.primaryCta = { label: "x", action: "url", url: "javascript:alert(1)" })), "S javascript:");
  check(bad((c) => (c.hero.primaryCta = { label: "x", action: "url", url: "http://exemplo.com" })), "S http");
  check(bad((c) => (c.footer.socials = [{ id: "x", network: "instagram", url: "data:text/html,oi", enabled: true }])), "S data:");
  check(bad((c) => (c.contact.whatsappNumber = "11 9999-8888")), "S whatsapp com máscara");
  check(bad((c) => (c.order = [...c.order.slice(1), c.order[1]!])), "S ordem repetida");
  check(bad((c) => (c.faq.items = Array.from({ length: 41 }, (_, i) => ({ id: `f${i}`, q: "?", a: "!", enabled: true })))), "S 41 perguntas");
  check(bad((c) => ((c.hero as unknown as Record<string, unknown>).image = { kind: "media", mediaId: "x", path: "../../etc/passwd", width: 1, height: 1, alt: "" })), "S caminho de mídia");
  const one = clone();
  one.wholesale.tiers = [one.wholesale.tiers[0]!];
  check(validateLandingContent(one).ok, "S 1 lote é válido");
  check(parseMoneyToCents("1.234,56") === 123456 && parseMoneyToCents("12,9") === 1290 && parseMoneyToCents("0,1") === 10 && parseMoneyToCents("abc") === null, "S dinheiro em centavos");
  ok("S: esquema recusa título vazio/longo demais, 0 ou 7+ lotes, fração de centavo, preço negativo, javascript:/http:/data:, WhatsApp com máscara, ordem repetida, 41+ perguntas e caminho de mídia forjado; '1.234,56' → 123456 centavos sem float");

  // ---------- 3. Contato / WhatsApp / botões ----------
  const c = clone();
  check(resolveContact(c.contact).channel === "none" && ctaTarget(c.hero.primaryCta, c.contact).href === "#contato", "W sem contato");
  c.contact.email = "comercial@exemplo.com";
  c.contact.formUrl = "https://forms.exemplo.com/x";
  check(resolveContact(c.contact).channel === "form", "W formulário antes do e-mail");
  c.contact.whatsappNumber = "5511999998888";
  c.contact.whatsappMessage = "Olá! Quero revender & saber preços?";
  const wa = whatsappUrl(c.contact.whatsappNumber, c.contact.whatsappMessage);
  check(wa === "https://wa.me/5511999998888?text=Ol%C3%A1!%20Quero%20revender%20%26%20saber%20pre%C3%A7os%3F", "W URL do WhatsApp", wa);
  check(resolveContact(c.contact).channel === "whatsapp" && resolveContact(c.contact).description === "WhatsApp +5511999998888", "W WhatsApp primeiro");
  c.contact.preferred = "email";
  check(resolveContact(c.contact).target.href.startsWith("mailto:comercial@exemplo.com"), "W preferido");
  check(ctaTarget({ label: "x", action: "whatsapp" }, c.contact).href === wa && ctaTarget({ label: "x", action: "section", section: "wholesale" }, c.contact).href === "#atacado", "W destinos");
  check(whatsappUrl("123", "x") === null, "W número curto");
  ok("W: sem contato → #contato; automático = WhatsApp → formulário → e-mail; canal preferido respeitado; WhatsApp vira https://wa.me/5511999998888?text=… com a mensagem codificada; botões de seção viram âncoras");

  // ---------- 4. SEO ----------
  const s = clone();
  s.seo = { ...s.seo, title: "Título SEO publicado", description: "Descrição SEO publicada.", siteUrl: "https://www.exemplo.com.br", ogTitle: "", ogDescription: "", index: false };
  const md = landingMetadata(s, landingOrigin(s.seo.siteUrl), "https://proj.supabase.co");
  check((md.title as { absolute: string }).absolute === "Título SEO publicado" && md.description === "Descrição SEO publicada." && (md.openGraph as { title: string }).title === "Título SEO publicado", "M SEO", md);
  check(md.metadataBase?.toString() === "https://www.exemplo.com.br/" && JSON.stringify(md.robots) === '{"index":false,"follow":false}', "M robots/base", md);
  s.seo.ogImage = { kind: "media", mediaId: "11111111-1111-4111-8111-111111111111", path: "media/11111111-1111-4111-8111-111111111111.png", width: 1200, height: 630, alt: "x" };
  const md2 = landingMetadata(s, null, "https://proj.supabase.co");
  check(JSON.stringify(md2.openGraph).includes("https://proj.supabase.co/storage/v1/object/public/landing-assets/media/11111111-1111-4111-8111-111111111111.png"), "M imagem social", md2.openGraph);
  check(landingOrigin("") === null && landingOrigin("", "https://painel.exemplo.com") === "https://painel.exemplo.com", "M origem");
  ok("M: SEO publicado vira metadados (título, descrição, Open Graph, robots, domínio, imagem social enviada); vazio usa padrões; sem domínio, usa o da requisição (nunca localhost fixo)");

  // ---------- 5. Carregador: publicado / padrão / fallback ----------
  const pub = clone();
  pub.hero.title = "Título publicado";
  const fake = (r: { data?: unknown; error?: { code: string; message: string } | null }) => ({ rpc: async () => ({ data: r.data ?? null, error: r.error ?? null }) }) as never;
  const a = await loadPublishedLandingFrom(fake({ data: [{ content: pub, published_at: "2026-10-01T18:32:00Z" }] }));
  check(a.source === "published" && a.content.hero.title === "Título publicado" && a.publishedAt === "2026-10-01T18:32:00Z", "L publicado");
  const b = await loadPublishedLandingFrom(fake({ data: [] }));
  check(b.source === "default" && b.content.hero.title === def.hero.title, "L nada publicado → padrão");
  const notInstalled = await loadPublishedLandingFrom(fake({ error: { code: "PGRST202", message: "x" } }));
  check(notInstalled.source === "default" && logs.some((l) => l.includes("landing_cms_not_installed")), "L migration ausente → padrão");
  let threw = false;
  try {
    await loadPublishedLandingFrom(fake({ error: { code: "57P01", message: "banco caiu" } }));
  } catch {
    threw = true;
  }
  check(threw && logs.some((l) => l.includes("landing_published_load_failed") && l.includes("57P01")), "L erro em produção é lançado (ISR mantém a última versão)");
  process.env.NEXT_PHASE = "phase-production-build";
  const atBuild = await loadPublishedLandingFrom(fake({ error: { code: "57P01", message: "banco caiu" } }));
  delete process.env.NEXT_PHASE;
  check(atBuild.source === "fallback" && atBuild.content.hero.title === def.hero.title, "L build → padrão");
  const corrupt = { ...pub, hero: { ...pub.hero, title: "" } };
  let threw2 = false;
  try {
    await loadPublishedLandingFrom(fake({ data: [{ content: corrupt }] }));
  } catch {
    threw2 = true;
  }
  check(threw2, "L publicado inválido não é exibido");
  ok("L: público lê o publicado; sem publicação ou sem a migration → conteúdo padrão (não fica vazio); erro do banco em produção é registrado e lançado (a página continua servindo a última versão gerada); no build → padrão; conteúdo inválido nunca é exibido");

  // ---------- 6. Imagens: tipo pelos bytes ----------
  const canvas = createCanvas(320, 200);
  const g = canvas.getContext("2d");
  g.fillStyle = "#0b63de";
  g.fillRect(0, 0, 320, 200);
  const result = async (bytes: Buffer, mime?: string, filename = "foto.png") => {
    try {
      const r = await validateBrandingImage(bytes, "landing", { filename, mime });
      return `${r.mime} ${r.width}x${r.height}`;
    } catch (e) {
      return `recusado ${(e as { status?: number }).status}`;
    }
  };
  check((await result(canvas.toBuffer("image/png"), "image/png", "foto.png")) === "image/png 320x200", "I png");
  check((await result(canvas.toBuffer("image/jpeg"), "image/jpeg", "foto.jpg")) === "image/jpeg 320x200", "I jpg");
  check((await result(canvas.toBuffer("image/webp"), "image/webp", "foto.webp")) === "image/webp 320x200", "I webp");
  check((await result(canvas.toBuffer("image/png"), "image/jpeg", "foto.jpg")).startsWith("recusado 415"), "I extensão diferente do conteúdo");
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><script>alert(1)</script></svg>');
  check((await result(svg, "image/svg+xml", "logo.svg")).startsWith("recusado 415"), "I svg recusado");
  check((await result(svg, "image/png")).startsWith("recusado 415"), "I svg disfarçado de png recusado");
  check((await result(Buffer.from("GIF89a" + "x".repeat(100)), "image/gif")).startsWith("recusado 415"), "I gif recusado");
  check((await result(Buffer.from("isto não é imagem"), "image/jpeg")).startsWith("recusado 415"), "I texto recusado");
  check((await result(Buffer.alloc(4 * 1024 * 1024 + 1, 1), "image/png")).startsWith("recusado 413"), "I acima de 4 MB");
  const tiny = createCanvas(20, 20);
  check((await result(tiny.toBuffer("image/png"))).startsWith("recusado"), "I pequena demais");
  ok("I: imagens validadas pelos BYTES: PNG/JPG/WEBP aceitos; SVG (inclusive disfarçado de .png), GIF, texto, extensão que não bate com o conteúdo, > 4 MB e < 64 px recusados");

  // ---------- 7. Rotas e mídia em uso ----------
  const routes = ["draft/route.ts", "publish/route.ts", "discard/route.ts", "media/route.ts", "media/[id]/route.ts"].map((f) => readFileSync(`src/app/api/admin/landing/${f}`, "utf8"));
  check(routes.every((r) => r.includes("await requireAdminApi()")), "R todas exigem ADMIN");
  check(routes[0]!.includes("validateLandingContent") && routes[1]!.includes("validateLandingContent") && routes[1]!.includes('revalidatePath("/revendedores")'), "R valida e revalida");
  check(readFileSync("src/app/preview/revendedores/page.tsx", "utf8").includes("await requireAdminPage()") && readFileSync("src/app/admin/landing/page.tsx", "utf8").includes("await requireAdminPage()"), "R páginas só ADMIN");
  const withMedia = clone();
  withMedia.about.image = { kind: "media", mediaId: "22222222-2222-4222-8222-222222222222", path: "media/22222222-2222-4222-8222-222222222222.webp", width: 10, height: 10, alt: "" };
  check(JSON.stringify(mediaPathsIn(withMedia)) === '["media/22222222-2222-4222-8222-222222222222.webp"]' && landingMediaUrl("https://p.supabase.co/", "media/a b.png") === "https://p.supabase.co/storage/v1/object/public/landing-assets/media/a%20b.png", "R mídia");
  ok("R: as 5 rotas de API e as páginas do módulo e da pré-visualização exigem ADMIN no servidor; salvar e publicar validam o conteúdo; publicar revalida /revendedores");

  if (failures) {
    console.log(`${failures} falha(s)`);
    process.exit(1);
  }
  console.log("CMS da landing OK");
  process.exit(0);
}
main().catch((e) => {
  console.log("erro:", e instanceof Error ? e.stack : e);
  process.exit(1);
});
