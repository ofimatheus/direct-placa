/**
 * Landing de revendedores: lógica da configuração (contato, preços, domínio).
 *   npm run test:landing-config
 */
import { readFileSync } from "node:fs";
import { LANDING_CONFIG, contactTarget, formatCents, landingSiteUrl } from "@/config/landing-config";

let failures = 0;
const ok = (l: string) => console.log(`OK ${l}`);
const check = (c: unknown, l: string, d?: unknown) => {
  if (!c) {
    failures++;
    console.log(`FALHA ${l}`, JSON.stringify(d ?? ""));
  }
};
const contact = LANDING_CONFIG.contact as { whatsappNumber: string | null; formUrl: string | null; email: string | null; whatsappMessage: string };

// Padrão entregue: nada configurado → seção #contato; nenhum preço inventado.
check(JSON.stringify(contactTarget()) === '{"href":"#contato","external":false,"unconfigured":true}', "C1 padrão", contactTarget());
check(LANDING_CONFIG.wholesaleTiers.every((t) => t.unitPriceCents === null) && LANDING_CONFIG.platform.monthlyPriceCents === null && !LANDING_CONFIG.platform.firstPeriodIncluded.enabled, "C1 sem valores");
ok("C1: como entregue, nenhum preço/mensalidade/período definido e os botões levam a #contato");

// Prioridade: WhatsApp → formulário → e-mail
contact.email = "comercial@exemplo.com";
check(contactTarget().href === "mailto:comercial@exemplo.com?subject=Revenda%20DirectPlaca", "C2 e-mail", contactTarget());
contact.formUrl = "https://forms.exemplo.com/revenda";
check(contactTarget().href === "https://forms.exemplo.com/revenda" && contactTarget().external, "C2 formulário", contactTarget());
contact.whatsappNumber = "+55 (11) 99999-8888";
const wa = contactTarget();
check(wa.href.startsWith("https://wa.me/5511999998888?text=") && decodeURIComponent(wa.href.split("text=")[1]!) === contact.whatsappMessage && !wa.unconfigured, "C2 WhatsApp", wa);
contact.whatsappNumber = "123";
check(contactTarget().href === "https://forms.exemplo.com/revenda", "C2 número inválido cai no formulário");
contact.formUrl = "javascript:alert(1)";
check(contactTarget().href.startsWith("mailto:"), "C2 formulário não-https é ignorado");
ok("C2: prioridade WhatsApp → formulário → e-mail; número formatado vira wa.me/5511999998888 com a mensagem; número curto e URL não-https são ignorados");

check(formatCents(1290) === "R$\u00a012,90" && formatCents(100000) === "R$\u00a01.000,00", "C3", [formatCents(1290), formatCents(100000)]);
ok("C3: preços em centavos viram R$ 12,90 / R$ 1.000,00");

check(landingSiteUrl() === undefined, "C4 sem domínio");
process.env.VERCEL_PROJECT_PRODUCTION_URL = "directplaca.vercel.app";
check(landingSiteUrl()?.toString() === "https://directplaca.vercel.app/", "C4 Vercel", landingSiteUrl()?.toString());
ok("C4: sem siteUrl, usa o domínio de produção da Vercel quando existir (SEO/Open Graph)");

const page = readFileSync("src/components/landing/LandingPage.tsx", "utf8");
check(!/R\$\s?\d/.test(page) && !/wa\.me|whatsapp\.com/.test(page), "C5 nada fixo na página");
check(!/"use client"/.test(page) && !/"use client"/.test(readFileSync("src/components/landing/PlateIllustration.tsx", "utf8")), "C5 server components");
ok("C5: nenhum preço ou contato fixo nos componentes (tudo vem da configuração); landing 100% Server Components");

if (failures) {
  console.log(`${failures} falha(s)`);
  process.exit(1);
}
console.log("Configuração da landing OK");
process.exit(0);
