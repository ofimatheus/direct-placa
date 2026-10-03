import type { Metadata } from "next";
import { LandingPage } from "@/components/landing/LandingPage";
import { getPublicEnv } from "@/lib/env";
import { landingOrigin } from "@/lib/landing/contact";
import { loadPublishedLanding } from "@/lib/landing/load";
import { landingMetadata } from "@/lib/landing/metadata";

/**
 * Landing pública de revendedores. Conteúdo = versão PUBLICADA no CMS
 * (Admin > Landing Page). Página estática regenerada (ISR): publicar chama
 * revalidatePath("/revendedores"), e a nova versão aparece em seguida.
 */
export const revalidate = 300;

export async function generateMetadata(): Promise<Metadata> {
  const { content } = await loadPublishedLanding();
  return landingMetadata(content, landingOrigin(content.seo.siteUrl), getPublicEnv().supabaseUrl);
}

export default async function RevendedoresPage() {
  const { content } = await loadPublishedLanding();
  return <LandingPage content={content} mediaBase={getPublicEnv().supabaseUrl} />;
}
