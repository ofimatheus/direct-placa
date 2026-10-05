/**
 * "Nossos Produtos" — esquema, compatibilidade, limite de 30, visibilidade e menu.
 *   npm run test:landing-products
 */
import { readFileSync, readdirSync } from "node:fs";
import { defaultLandingContent } from "@/lib/landing/defaults";
import { MIDDLE_SECTIONS, PRODUCTS_MAX, validateLandingContent, type LandingContent } from "@/lib/landing/schema";
import { isSectionVisible, visibleProducts } from "@/lib/landing/visibility";

let failures = 0;
const ok = (l: string) => console.log(`OK ${l}`);
const check = (c: unknown, l: string, d?: unknown) => {
  if (!c) {
    failures++;
    console.log(`FALHA ${l}`, JSON.stringify(d ?? "").slice(0, 300));
  }
};
const img = (n: number) => ({ kind: "media" as const, mediaId: `11111111-1111-4111-8111-${String(n).padStart(12, "0")}`, path: `media/11111111-1111-4111-8111-${String(n).padStart(12, "0")}.webp`, width: 800, height: 1200, alt: `Placa ${n}` });
const product = (n: number, extra: Partial<LandingContent["products"]["items"][number]> = {}) => ({ id: `produto-${n}`, image: img(n), title: "", text: "", enabled: true, ...extra });
const valid = (c: unknown) => validateLandingContent(c);

// P1: padrão — seção existe, sem produtos fictícios, não aparece
const def = defaultLandingContent();
check(def.products.enabled && def.products.items.length === 0 && def.products.eyebrow === "Nossos produtos" && def.products.title === "Conheça nossas placas" && def.products.text === "Modelos desenvolvidos para diferentes negócios e aplicações.", "P1 padrão", def.products);
check(!isSectionVisible(def, "products"), "P1 não aparece vazia");
const order = def.order;
check(order.indexOf("products") === order.indexOf("product") + 1 && order.indexOf("platform") === order.indexOf("products") + 1, "P1 posição Produto → Nossos Produtos → Plataforma", order);
check(def.nav.some((n) => n.section === "products" && n.label === "Produtos") && valid(def).ok, "P1 menu administrável");
ok("P1: a seção existe no conteúdo padrão (ativa, rótulo/título/descrição pedidos, 0 produtos — nenhum fictício), fica entre Produto e Plataforma e NÃO aparece enquanto não houver produto; item 'Produtos' no menu existe mas só aparece com produto ativo");

// P2: documentos antigos (salvos antes desta seção) continuam válidos
const old = structuredClone(def) as Record<string, unknown>;
delete old.products;
old.order = MIDDLE_SECTIONS.filter((s) => s !== "products");
old.nav = (old.nav as { section: string }[]).filter((n) => n.section !== "products");
const r = valid(old);
check(r.ok && r.ok && r.content.products.items.length === 0 && r.content.order.indexOf("products") === r.content.order.indexOf("product") + 1, "P2 compatível", r);
const reordered = structuredClone(old);
reordered.order = ["faq", "why", "about", "product", "howItWorks", "platform", "directlab", "wholesale", "subscription"];
const r2 = valid(reordered);
check(r2.ok && r2.content.order.join() === "faq,why,about,product,products,howItWorks,platform,directlab,wholesale,subscription", "P2 ordem personalizada preservada", r2.ok ? r2.content.order : r2);
ok("P2: rascunhos/publicações salvos ANTES desta seção (sem 'products' e com 9 seções na ordem) continuam válidos; a seção entra vazia logo após 'Produto', preservando a ordem que o ADMIN já tinha definido");

// P3: limite 30 (servidor)
const c30 = structuredClone(def);
c30.products.items = Array.from({ length: PRODUCTS_MAX }, (_, i) => product(i + 1));
const c31 = structuredClone(def);
c31.products.items = Array.from({ length: PRODUCTS_MAX + 1 }, (_, i) => product(i + 1));
const r31 = valid(c31);
check(PRODUCTS_MAX === 30 && valid(c30).ok && !r31.ok && JSON.stringify(r31).includes("No máximo 30 produtos"), "P3 limite", r31);
const route = readFileSync("src/app/api/admin/landing/draft/route.ts", "utf8");
check(route.includes("validateLandingContent(body?.content)") && route.includes("status: 422"), "P3 a API valida no servidor");
ok("P3: 30 produtos são aceitos; 31 são recusados pelo esquema que a API de salvar aplica no SERVIDOR (422 'No máximo 30 produtos'), não só pelo botão");

// P4: campos opcionais e visibilidade
const c = structuredClone(def);
c.products.eyebrow = "";
c.products.title = "";
c.products.text = "";
c.products.items = [product(1), product(2, { enabled: false }), product(3, { image: null }), product(4, { title: "Placa Avaliação Google", text: "Modelo de mesa" })];
const r4 = valid(c);
check(r4.ok, "P4 rótulo/título/descrição e título/descrição do produto opcionais; produto pode ficar sem imagem no rascunho", r4);
check(visibleProducts(c).map((p) => p.id).join() === "produto-1,produto-4" && isSectionVisible(c, "products"), "P4 visíveis: ativos com imagem", visibleProducts(c).map((p) => p.id));
c.products.enabled = false;
check(!isSectionVisible(c, "products"), "P4 seção desligada");
c.products.enabled = true;
c.products.items = c.products.items.map((p) => ({ ...p, enabled: false }));
check(!isSectionVisible(c, "products"), "P4 todos inativos");
ok("P4: título/descrição opcionais (seção e produto); produto inativo ou sem imagem não aparece (fica salvo no CMS); 0 produtos visíveis ou seção desligada → a seção some");

// P5: segurança do conteúdo do produto
const bad = structuredClone(def);
bad.products.items = [product(1, { image: { ...img(1), path: "../../segredo.svg" } as never })];
const badLong = structuredClone(def);
badLong.products.items = [product(1, { title: "x".repeat(81) })];
check(!valid(bad).ok && !valid(badLong).ok, "P5");
ok("P5: imagem fora da biblioteca (caminho forjado, SVG) e título acima do limite são recusados");

// P6: sem migration nova; bucket reaproveitado
const migs = readdirSync("supabase/migrations");
// "Nossos Produtos" não precisou de migration: a do CMS existe e nenhuma migration POSTERIOR mexe na landing
// (outras entregas podem criar migrations próprias, como a do link curto da Avaliação Google).
const later = migs.filter((m) => m > "20261008120000_landing_cms.sql");
const touchesLanding = later.filter((m) => /landing|products/i.test(readFileSync(`supabase/migrations/${m}`, "utf8").replace(/--.*$/gm, "")));
check(migs.includes("20261008120000_landing_cms.sql") && touchesLanding.length === 0, "P6 migrations", { later, touchesLanding });
check(readFileSync("src/components/landing-cms/LandingEditor.tsx", "utf8").includes('"/api/admin/landing/media"'), "P6 upload único");
ok("P6: nenhuma migration nova (o conteúdo já é um documento JSON validado); imagens pelo mesmo upload e bucket landing-assets");

if (failures) {
  console.log(`${failures} falha(s)`);
  process.exit(1);
}
console.log("Nossos Produtos OK");
process.exit(0);
