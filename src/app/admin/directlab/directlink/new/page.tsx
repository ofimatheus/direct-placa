import type { Metadata } from "next";
import { DirectLinkEditor } from "@/components/directlink/DirectLinkEditor";
import { PageHeader } from "@/components/ui/primitives";
import { requireAdminPage } from "@/lib/auth/session";
import { getPublicEnv } from "@/lib/env";

export const metadata: Metadata = { title: "Novo DirectLink" };

export default async function NewDirectLinkPage() {
  await requireAdminPage();
  return (
    <div className="space-y-[var(--ds-section-gap)]">
      <PageHeader title="Novo DirectLink" description="Monte a página e confira na prévia do celular." back={{ href: "/admin/directlab/directlink", label: "DirectLink" }} />
      <DirectLinkEditor role="admin" initial={null} supabaseUrl={getPublicEnv().supabaseUrl} basePath="/admin/directlab/directlink" />
    </div>
  );
}
