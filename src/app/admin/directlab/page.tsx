import type { Metadata } from "next";
import { DIRECTLAB_SUBTITLE, DIRECTLAB_TITLE, DirectLabTools } from "@/components/directlab/DirectLabTools";
import { PageHeader } from "@/components/ui/primitives";
import { requireAdminPage } from "@/lib/auth/session";

export const metadata: Metadata = { title: "DirectLab" };

export default async function AdminDirectLabPage() {
  await requireAdminPage();
  return (
    <div>
      <PageHeader title={DIRECTLAB_TITLE} description={DIRECTLAB_SUBTITLE} />
      <DirectLabTools role="admin" />
    </div>
  );
}
