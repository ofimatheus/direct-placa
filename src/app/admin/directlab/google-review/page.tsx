import type { Metadata } from "next";
import { GoogleReviewTool } from "@/components/directlab/GoogleReviewTool";
import { PageHeader } from "@/components/ui/primitives";
import { requireAdminPage } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Avaliação Google" };

export default async function AdminGoogleReviewPage() {
  await requireAdminPage();
  return (
    <div className="max-w-3xl">
      <PageHeader title="Avaliação Google" description="Gere o link direto para o cliente avaliar o estabelecimento." back={{ href: "/admin/directlab", label: "DirectLab" }} />
      <GoogleReviewTool role="admin" />
    </div>
  );
}
