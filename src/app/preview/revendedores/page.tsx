import type { Metadata } from "next";
import { LandingPage } from "@/components/landing/LandingPage";
import { requireAdminPage } from "@/lib/auth/session";
import { getPublicEnv } from "@/lib/env";
import { loadLandingAdminState } from "@/lib/landing/load";

/**
 * Pré-visualização do RASCUNHO da landing. Só ADMIN (conferido no servidor e
 * no banco); público e revendedor são redirecionados. Nunca é indexada nem
 * guardada em cache.
 */
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Pré-visualização da landing", robots: { index: false, follow: false } };

export default async function LandingPreviewPage() {
  const { supabase } = await requireAdminPage();
  const state = await loadLandingAdminState(supabase);
  return <LandingPage content={state.draft} mediaBase={getPublicEnv().supabaseUrl} preview={{ publishedAt: state.publishedAt }} />;
}
