import type { Metadata } from "next";
import { GooglePlacesCard, type GooglePlacesView } from "@/components/settings/GooglePlacesCard";
import { SettingsTabs } from "@/components/settings/SettingsTabs";
import { PageHeader } from "@/components/ui/primitives";
import { requireAdminPage } from "@/lib/auth/session";
import { hasServiceRoleKey, readGooglePlacesEnvKey } from "@/lib/env.server";

export const metadata: Metadata = { title: "Integrações" };
export const dynamic = "force-dynamic";

interface StatusRow {
  custom_configured: boolean;
  key_last4: string | null;
  configured_at: string | null;
  last_test_status: string | null;
  last_test_source: string | null;
  last_test_at: string | null;
}

/**
 * Integrações (somente ADMIN). O navegador recebe só metadados: se há chave,
 * os últimos 4 caracteres, datas e o resultado do último teste — nunca a
 * chave do ADMIN nem a do ambiente.
 */
export default async function IntegrationsPage() {
  const { supabase } = await requireAdminPage();
  const { data, error } = await supabase.rpc("admin_google_places_status");
  const row = (Array.isArray(data) ? data[0] : data) as StatusRow | undefined;
  const view: GooglePlacesView = {
    available: !error,
    customConfigured: Boolean(row?.custom_configured),
    last4: row?.custom_configured ? (row.key_last4 ?? null) : null,
    configuredAt: row?.configured_at ?? null,
    lastTestStatus: row?.last_test_status ?? null,
    lastTestSource: row?.last_test_source ?? null,
    lastTestAt: row?.last_test_at ?? null,
    envAvailable: readGooglePlacesEnvKey() !== null,
    serverCanReadCustom: hasServiceRoleKey(),
  };
  return (
    <div className="max-w-3xl">
      <PageHeader title="Configurações" description="Conexões com serviços externos usados pelo DirectPlaca." />
      <div className="mb-[var(--ds-section-gap)]">
        <SettingsTabs active="integracoes" />
      </div>
      <GooglePlacesCard initial={view} />
    </div>
  );
}
