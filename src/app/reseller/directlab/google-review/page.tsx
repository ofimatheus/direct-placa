import type { Metadata } from "next";
import { GoogleReviewTool } from "@/components/directlab/GoogleReviewTool";
import { PageHeader } from "@/components/ui/primitives";
import { requireResellerContext } from "@/lib/auth/session";
import { directLabQuotaStatus } from "@/lib/directlab/quota";

export const metadata: Metadata = { title: "Avaliação Google" };

export default async function ResellerGoogleReviewPage() {
  const { supabase } = await requireResellerContext();
  // Uso do dia com o limite definido pelo ADMIN para este revendedor.
  const quota = await directLabQuotaStatus(supabase);
  return (
    <div className="max-w-3xl">
      <PageHeader title="Avaliação Google" description="Gere o link direto para o cliente avaliar o estabelecimento." back={{ href: "/reseller/directlab", label: "DirectLab" }} />
      <GoogleReviewTool role="reseller" quota={quota} />
    </div>
  );
}
