import type { Metadata } from "next";
import { ResellerForm } from "@/components/resellers/ResellerForm";
import { PageHeader } from "@/components/ui/primitives";
import { requireAdminPage } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Novo revendedor" };

export default async function NewResellerPage() {
  await requireAdminPage();
  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Novo revendedor"
        back={{ href: "/admin/resellers", label: "Revendedores" }}
        description="Cria o acesso do revendedor ao painel dele. Ele verá apenas as próprias placas e clientes."
      />
      <div className="card p-5">
        <ResellerForm mode="create" />
      </div>
    </div>
  );
}
