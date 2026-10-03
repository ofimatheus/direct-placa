import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { DirectLinkView } from "@/components/directlink/DirectLinkView";
import { directLinkAssetUrl } from "@/lib/directlink/items";
import { loadPublicDirectLink } from "@/lib/directlink/load";

export const dynamic = "force-dynamic";
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#0d1a2a" };

type Props = { params: Promise<{ code: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { code } = await params;
  const page = await loadPublicDirectLink(code);
  return {
    title: { absolute: page ? page.title : "Página não encontrada" },
    description: page?.description ?? undefined,
    robots: { index: false, follow: false },
  };
}

/**
 * DirectLink público (sem login). Lê só a RPC public_direct_link; página
 * inativa ou inexistente → 404. Sem métricas nesta versão.
 */
export default async function DirectLinkPublicPage({ params }: Props) {
  const { code } = await params;
  const page = await loadPublicDirectLink(code);
  if (!page) notFound();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  return (
    <DirectLinkView
      title={page.title}
      description={page.description}
      bannerUrl={directLinkAssetUrl(supabaseUrl, page.banner_path)}
      logoUrl={directLinkAssetUrl(supabaseUrl, page.logo_path)}
      items={page.items}
    />
  );
}
