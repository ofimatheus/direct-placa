import type { Metadata } from "next";
import { DirectLinkList } from "@/components/directlink/DirectLinkList";
import { DirectLinkLoadFailed } from "@/components/directlink/DirectLinkLoadFailed";
import { PageHeader } from "@/components/ui/primitives";
import { requireAdminPage } from "@/lib/auth/session";
import { DirectLinkLoadError, listDirectLinks, type DirectLinkRow } from "@/lib/directlink/manage";

export const metadata: Metadata = { title: "DirectLink" };

export default async function DirectLinkListPage() {
  const { supabase } = await requireAdminPage();
  let links: DirectLinkRow[] = [];
  let failure: DirectLinkLoadError | null = null;
  try {
    links = await listDirectLinks(supabase, "admin");
  } catch (error) {
    if (!(error instanceof DirectLinkLoadError)) throw error;
    failure = error;
  }
  return (
    <div className="space-y-[var(--ds-section-gap)]">
      <PageHeader title="DirectLink" description="Páginas públicas simples para abrir pelo QR Code." back={{ href: "/admin/directlab", label: "DirectLab" }} />
      {failure ? (
        <DirectLinkLoadFailed retryHref="/admin/directlab/directlink" missingSchema={failure.missingSchema} isAdmin={true} />
      ) : (
        <DirectLinkList links={links} basePath="/admin/directlab/directlink" showOwner={true} />
      )}
    </div>
  );
}
