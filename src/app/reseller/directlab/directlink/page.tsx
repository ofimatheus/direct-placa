import type { Metadata } from "next";
import { DirectLinkList } from "@/components/directlink/DirectLinkList";
import { DirectLinkLoadFailed } from "@/components/directlink/DirectLinkLoadFailed";
import { PageHeader } from "@/components/ui/primitives";
import { requireResellerContext } from "@/lib/auth/session";
import { DirectLinkLoadError, directLinkPageStatus, listDirectLinks, type DirectLinkRow } from "@/lib/directlink/manage";

export const metadata: Metadata = { title: "DirectLink" };

export default async function DirectLinkListPage() {
  const { supabase } = await requireResellerContext();
  let links: DirectLinkRow[] = [];
  let failure: DirectLinkLoadError | null = null;
  try {
    links = await listDirectLinks(supabase, "reseller");
  } catch (error) {
    if (!(error instanceof DirectLinkLoadError)) throw error;
    failure = error;
  }
  const pages = failure ? null : await directLinkPageStatus(supabase);
  return (
    <div className="space-y-[var(--ds-section-gap)]">
      <PageHeader title="DirectLink" description="Páginas públicas simples para abrir pelo QR Code." back={{ href: "/reseller/directlab", label: "DirectLab" }} />
      {failure ? (
        <DirectLinkLoadFailed retryHref="/reseller/directlab/directlink" missingSchema={failure.missingSchema} isAdmin={false} />
      ) : (
        <DirectLinkList links={links} basePath="/reseller/directlab/directlink" showOwner={false} pages={pages} />
      )}
    </div>
  );
}
