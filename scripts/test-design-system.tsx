/**
 * Garantias do redesign (design system DirectPlaca): módulos dos menus
 * preservados, tons das badges, logo como asset único, NFC fora das métricas
 * e login com a própria tipografia.
 *   npm run test:design-system
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { renderToString } from "react-dom/server";

let failures = 0;
const ok = (label: string) => console.log(`OK ${label}`);
const check = (cond: unknown, label: string, detail?: unknown) => {
  if (!cond) {
    failures++;
    console.log(`FALHA ${label}`, detail ?? "");
  }
};
const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");

async function main() {
  const { ADMIN_NAV } = await import("@/components/admin/AdminNav");
  const { RESELLER_NAV, RESELLER_SECONDARY } = await import("@/components/reseller/ResellerNav");
  const { initialsOf } = await import("@/components/shell/AppShell");
  const { StatusBadge } = await import("@/components/ui/kit");
  const { Tone } = await import("@/components/ui/primitives");
  const { ORDER_STATUS_TONE, PLATE_STATUS_TONE, PLATE_STATUS_LABEL } = await import("@/lib/plates/labels");

  // M1: módulos preservados, na mesma ordem
  const admin = ADMIN_NAV.map((i) => `${i.label}=${i.href}`).join("|");
  check(
    admin ===
      "Dashboard=/admin/dashboard|Vendas=/admin/sales|Placas=/admin/plates|Lotes=/admin/batches|Templates=/admin/templates|Revendedores=/admin/resellers|Clientes=/admin/customers|Acessos=/admin/accesses|DirectLab=/admin/directlab|Landing Page=/admin/landing|Configurações=/admin/settings",
    "M1 menu ADMIN",
    admin,
  );
  const reseller = [...RESELLER_NAV, ...RESELLER_SECONDARY].map((i) => `${i.label}=${i.href}`).join("|");
  check(
    reseller ===
      "Dashboard=/reseller/dashboard|Minhas placas=/reseller/plates|Clientes=/reseller/customers|Vendas=/reseller/sales|Acessos=/reseller/accesses|DirectLab=/reseller/directlab|Minha conta=/reseller/account|Ajuda / suporte=/reseller/account#ajuda",
    "M1 menu revendedor",
    reseller,
  );
  for (const route of [...ADMIN_NAV, ...RESELLER_NAV].map((i) => i.href)) {
    check(existsSync(join(root, "src/app", route, "page.tsx")), `M1 rota ${route} existe`);
  }
  const shell = read("src/components/shell/AppShell.tsx");
  check(shell.includes('action="/auth/signout" method="post"'), "M1 Sair usa a mesma rota de antes");
  ok("M1: todos os módulos do ADMIN (11, com Landing Page) e do revendedor (7 + Ajuda) preservados, na mesma ordem e com rotas existentes; Sair inalterado");

  // M2: badges
  const badge = (status: Parameters<typeof StatusBadge>[0]["status"], audience?: "admin" | "reseller") => renderToString(<StatusBadge status={status} audience={audience} />);
  check(badge("assigned").includes("badge-blue") && badge("assigned").includes("Disponível"), "M2 revendedor: Disponível azul");
  check(badge("active").includes("badge-green") && badge("inactive").includes("badge-gray") && badge("blocked").includes("badge-red"), "M2 ativa/inativa/bloqueada");
  check(badge("assigned", "admin").includes("badge-amber") && badge("assigned", "admin").includes(PLATE_STATUS_LABEL.assigned), "M2 ADMIN: Reservada âmbar");
  const tone = (t: string) => renderToString(<Tone tone={t}>x</Tone>);
  check(tone(PLATE_STATUS_TONE.in_stock).includes("badge-blue") && tone(PLATE_STATUS_TONE.assigned).includes("badge-amber"), "M2 Tone ADMIN");
  check(tone(ORDER_STATUS_TONE.paid).includes("badge-green") && tone(ORDER_STATUS_TONE.cancelled).includes("badge-gray"), "M2 Tone vendas");
  ok("M2: badges suaves — Disponível azul, Reservada âmbar, Ativa verde, Inativa cinza, Bloqueada vermelha (status reais inalterados)");

  // M3: logo oficial como asset único
  const logo = join(root, "public/brand/directplaca-logo.png");
  const head = readFileSync(logo).subarray(0, 8).toString("hex");
  check(head === "89504e470d0a1a0a", "M3 logo é um PNG real");
  const refs: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(tsx?|css)$/.test(name) && readFileSync(p, "utf8").includes("directplaca-logo")) refs.push(p.replace(root + "/", ""));
    }
  };
  walk(join(root, "src"));
  check(refs.length === 1 && refs[0] === "src/components/shell/BrandLogo.tsx", "M3 logo referenciada num só lugar", refs);
  check(!/data:image\/png;base64/.test(read("src/components/shell/BrandLogo.tsx")), "M3 sem base64");
  ok("M3: logo em public/brand/directplaca-logo.png, referenciada só pelo BrandLogo (trocar o arquivo troca a logo), sem base64");

  // M4: NFC fora das métricas; privacidade do revendedor mantida
  const resellerDash = read("src/app/reseller/dashboard/page.tsx");
  const series = read("src/lib/db/qr-series.ts");
  check(!/nfc/i.test(resellerDash) && series.includes('.eq("source", "qr")'), "M4 NFC fora do dashboard");
  check(resellerDash.includes('supabase.rpc("reseller_sales_metrics"') && resellerDash.includes("o administrador da") && !/service_role|createAdminClient/.test(resellerDash), "M4 financeiro privado");
  ok("M4: métricas só de QR Code (série diária filtra source = 'qr'); financeiro do revendedor pelas mesmas RPCs privadas, sem service role");

  // M5: login com a própria tipografia; fonte do painel
  const css = read("src/app/globals.css");
  check(/--font-sans: "Inter Variable"/.test(css) && /\.login-root \{\s*\/\*[^*]*\*\/\s*font-family: "Archivo Variable"/.test(css), "M5 fontes");
  check(read("src/app/layout.tsx").includes('import "@fontsource-variable/inter";'), "M5 Inter local");
  ok("M5: painel em Inter (servida localmente); login mantém Archivo");

  check(initialsOf("Jorge LTDA") === "JO" || initialsOf("Jorge LTDA") === "J", "M6 iniciais sem LTDA", initialsOf("Jorge LTDA"));
  check(initialsOf("ofi.mateus@gmail.com") === "OM" && initialsOf("Revenda Teste") === "RT", "M6 iniciais", [initialsOf("ofi.mateus@gmail.com"), initialsOf("Revenda Teste")]);
  ok("M6: iniciais do avatar (e-mail do ADMIN e nome do revendedor)");

  if (failures) {
    console.log(`${failures} falha(s)`);
    process.exit(1);
  }
  console.log("Design system OK");
  process.exit(0);
}
main().catch((error) => {
  console.error(error);
  process.exit(1);
});
