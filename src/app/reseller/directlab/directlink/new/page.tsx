import type { Metadata } from "next";
import Link from "next/link";
import { DirectLinkEditor } from "@/components/directlink/DirectLinkEditor";
import { Panel, PageTitle } from "@/components/ui/kit";
import { requireResellerContext } from "@/lib/auth/session";
import { DIRECTLINK_LIMIT_MESSAGE, directLinkPageStatus } from "@/lib/directlink/manage";
import { getPublicEnv } from "@/lib/env";

export const metadata: Metadata = { title: "Novo DirectLink" };

export default async function NewDirectLinkPage() {
  const { supabase } = await requireResellerContext();
  // A trava real é do banco (gatilho em direct_links); aqui só evita montar uma página que não poderá ser salva.
  const pages = await directLinkPageStatus(supabase);
  const atLimit = pages !== null && pages.limit !== null && pages.used >= pages.limit;
  return (
    <div className="space-y-[var(--ds-section-gap)]">
      <PageTitle title="Novo DirectLink" subtitle="Monte a página e confira na prévia do celular." />
      {atLimit ? (
        <Panel>
          <div className="px-[var(--ds-panel-px)] py-6" role="status" data-directlink-limit="">
            <p className="font-semibold tabular-nums">
              {pages.used} de {pages.limit} páginas utilizadas
            </p>
            <p className="mt-1 text-sm text-ink-soft">{DIRECTLINK_LIMIT_MESSAGE}</p>
            <Link href="/reseller/directlab/directlink" className="btn mt-4">
              Voltar aos DirectLinks
            </Link>
          </div>
        </Panel>
      ) : (
        <DirectLinkEditor role="reseller" initial={null} supabaseUrl={getPublicEnv().supabaseUrl} basePath="/reseller/directlab/directlink" />
      )}
    </div>
  );
}
