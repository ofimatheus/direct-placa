import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DirectLinkEditor } from "@/components/directlink/DirectLinkEditor";
import { PageHeader } from "@/components/ui/primitives";
import { requireAdminPage } from "@/lib/auth/session";
import { getDirectLink } from "@/lib/directlink/manage";
import { getPublicEnv } from "@/lib/env";

export const metadata: Metadata = { title: "Editar DirectLink" };

/** Edição: a RLS só devolve o DirectLink se ele for do usuário (ou se for ADMIN). */
export default async function EditDirectLinkPage({ params }: { params: Promise<{ id: string }> }) {
  const { supabase } = await requireAdminPage();
  const { id } = await params;
  const link = await getDirectLink(supabase, id);
  if (!link) notFound();
  return (
    <div className="space-y-[var(--ds-section-gap)]">
      <PageHeader title={link.title} description="Monte a página e confira na prévia do celular." back={{ href: "/admin/directlab/directlink", label: "DirectLink" }} />
      <DirectLinkEditor role="admin" initial={link} supabaseUrl={getPublicEnv().supabaseUrl} basePath="/admin/directlab/directlink" />
    </div>
  );
}
