import type { Metadata } from "next";
import { DIRECTLAB_SUBTITLE, DIRECTLAB_TITLE, DirectLabTools } from "@/components/directlab/DirectLabTools";
import { PageTitle } from "@/components/ui/kit";
import { requireResellerContext } from "@/lib/auth/session";
import { directLabQuotaStatus } from "@/lib/directlab/quota";
import { directLinkPageStatus } from "@/lib/directlink/manage";

export const metadata: Metadata = { title: "DirectLab" };

/** Hub do DirectLab: só o catálogo; cada ferramenta tem a própria página. */
export default async function ResellerDirectLabPage() {
  const { supabase } = await requireResellerContext();
  // Limites definidos pelo ADMIN para este revendedor (null se a migration ainda não estiver aplicada).
  const [quota, pages] = await Promise.all([directLabQuotaStatus(supabase), directLinkPageStatus(supabase)]);
  return (
    <div className="space-y-[var(--ds-header-mb)]">
      <PageTitle title={DIRECTLAB_TITLE} subtitle={DIRECTLAB_SUBTITLE} />
      <DirectLabTools role="reseller" quota={quota} pages={pages} />
    </div>
  );
}
