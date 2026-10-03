import { Segmented } from "@/components/ui/kit";

/** Abas de Configurações do ADMIN. */
export function SettingsTabs({ active }: { active: "geral" | "integracoes" }) {
  return (
    <Segmented
      label="Seções de configurações"
      active={active}
      items={[
        { key: "geral", label: "Geral e branding", href: "/admin/settings" },
        { key: "integracoes", label: "Integrações", href: "/admin/settings/integrations" },
      ]}
    />
  );
}
