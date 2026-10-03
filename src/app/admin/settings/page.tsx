import type { Metadata } from "next";
import { BrandingEditor } from "@/components/settings/BrandingEditor";
import { SettingsTabs } from "@/components/settings/SettingsTabs";
import { PageHeader } from "@/components/ui/primitives";
import type { BrandingRow } from "@/lib/branding/defaults";
import { requireAdminPage } from "@/lib/auth/session";
import { getGoBaseUrl, getPublicEnv } from "@/lib/env";
import { limits } from "@/lib/env.server";
import { buildNfcUrl, buildQrUrl } from "@/lib/plates/urls";
import { RENDERER_VERSION } from "@/lib/renderer/draw";

export const metadata: Metadata = { title: "Configurações" };

/** Configurações de ambiente (somente leitura; alteradas nas variáveis de ambiente do deploy). */
export default async function SettingsPage() {
  const { profile, supabase } = await requireAdminPage();
  const brandingResult = await supabase
    .from("branding_settings")
    .select("brand_name, show_brand_name, eyebrow, title, subtitle, logo_path, banner_path")
    .maybeSingle<BrandingRow>();
  const mb = (bytes: number) => `${Math.round(bytes / 1024 / 1024)} MB`;
  const rows: [string, string][] = [
    ["URL intermediária (NEXT_PUBLIC_GO_BASE_URL)", getGoBaseUrl()],
    ["Exemplo de URL do QR", buildQrUrl("A7K482")],
    ["Exemplo de URL do NFC", buildNfcUrl("A7K482")],
    ["Versão do renderer", String(RENDERER_VERSION)],
    ["Tamanho máximo da arte", mb(limits.templateMaxUploadBytes)],
    ["Dimensão máxima da arte", `${limits.templateMaxDimension} px`],
    ["Tamanho máximo de cada parte de ZIP", mb(limits.exportPartMaxBytes)],
    ["Sua conta", `${profile.email} (administrador)`],
  ];
  return (
    <div className="max-w-6xl space-y-10">
      <div className="max-w-3xl">
      <PageHeader
        title="Configurações"
        description="Valores definidos nas variáveis de ambiente do deploy. Para alterá-los, edite o ambiente na Vercel e publique novamente."
      />
      <div className="mb-[var(--ds-section-gap)]">
        <SettingsTabs active="geral" />
      </div>
      <dl className="card divide-y divide-line">
        {rows.map(([label, value]) => (
          <div key={label} className="grid gap-1 px-5 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] sm:gap-4">
            <dt className="text-sm text-ink-soft">{label}</dt>
            <dd className="break-all text-sm font-semibold">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-4 rounded-md border border-warn/40 bg-surface px-4 py-3 text-sm">
        A URL intermediária está gravada em cada QR impresso e em cada tag NFC. Depois que houver placas em uso, não altere esse valor.
      </p>
      </div>

      <section className="card p-5 sm:p-6" aria-labelledby="branding-title">
        <h2 id="branding-title" className="display text-lg">
          Personalização da tela de login
        </h2>
        <p className="mb-5 mt-1 text-sm text-ink-soft">
          Banner, logo e textos de /login. Vale na hora, sem novo deploy. O formulário de login e a segurança não mudam.
        </p>
        <BrandingEditor initial={brandingResult.data ?? null} supabaseUrl={getPublicEnv().supabaseUrl} available={!brandingResult.error} />
      </section>
    </div>
  );
}
