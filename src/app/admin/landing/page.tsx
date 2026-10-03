import type { Metadata } from "next";
import { headers } from "next/headers";
import { BUILTIN_IMAGE_DATA } from "@/components/landing/builtin-images";
import { LandingEditor, type LandingMedia } from "@/components/landing-cms/LandingEditor";
import { PageHeader } from "@/components/ui/primitives";
import { requireAdminPage } from "@/lib/auth/session";
import { getPublicEnv } from "@/lib/env";
import { landingOrigin } from "@/lib/landing/contact";
import { loadLandingAdminState } from "@/lib/landing/load";
import type { BuiltinImage } from "@/lib/landing/schema";

export const metadata: Metadata = { title: "Landing Page" };
export const dynamic = "force-dynamic";

/** CMS da landing pública de revendedores (somente ADMIN). */
export default async function AdminLandingPage() {
  const { supabase } = await requireAdminPage();
  const state = await loadLandingAdminState(supabase);
  let media: LandingMedia[] = [];
  if (state.installed) {
    const { data } = await supabase.rpc("admin_landing_media_list");
    media = ((data ?? []) as LandingMedia[]).map((m) => ({ id: m.id, path: m.path, mime: m.mime, width: m.width, height: m.height, bytes: m.bytes }));
  }
  // Endereço público real: domínio configurado no CMS → produção da Vercel → domínio desta requisição (nunca localhost fixo).
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? (host?.startsWith("localhost") ? "http" : "https");
  const origin = landingOrigin(state.published?.seo.siteUrl ?? state.draft.seo.siteUrl, host ? `${proto}://${host}` : null);
  const builtinThumbs = Object.fromEntries(Object.entries(BUILTIN_IMAGE_DATA).map(([k, v]) => [k, v.src])) as Record<BuiltinImage, string>;

  return (
    <div>
      <PageHeader title="Landing Page" description="Gerencie o conteúdo da página pública de revendedores." />
      <LandingEditor
        installed={state.installed}
        initialContent={state.draft}
        initialVersion={state.draftVersion}
        published={state.published}
        publishedAt={state.publishedAt}
        publicUrl={`${origin ?? ""}/revendedores`}
        mediaBase={getPublicEnv().supabaseUrl}
        media={media}
        builtinThumbs={builtinThumbs}
      />
    </div>
  );
}
