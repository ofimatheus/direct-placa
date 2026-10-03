import Link from "next/link";
import { CopyButton } from "@/components/ui/CopyButton";
import { EmptyNote, Panel } from "@/components/ui/kit";
import { directLinkPublicUrl } from "@/lib/directlink/items";
import { DIRECTLINK_LIMIT_MESSAGE, type DirectLinkPageStatus } from "@/lib/directlink/limits";
import type { DirectLinkRow } from "@/lib/directlink/manage";
import { formatDate } from "@/lib/utils/text";
import { ActiveToggle } from "./ActiveToggle";

/** Gerenciamento: criar, editar, visualizar, copiar link e ativar/desativar. */
export function DirectLinkList({
  links,
  basePath,
  showOwner,
  pages = null,
}: {
  links: DirectLinkRow[];
  basePath: string;
  showOwner: boolean;
  /** Revendedor: páginas usadas e limite definido pelo ADMIN. null/limit null = sem limite. */
  pages?: DirectLinkPageStatus | null;
}) {
  const limited = pages !== null && pages.limit !== null;
  const atLimit = limited && pages.used >= (pages.limit ?? 0);
  return (
    <Panel
      title="Suas páginas"
      subtitle="Páginas públicas para abrir pelo QR Code. Desativar tira do ar; nada é apagado."
      action={
        <div className="flex flex-wrap items-center gap-3">
          {limited && (
            <span className={`text-sm font-semibold tabular-nums ${atLimit ? "text-danger" : "text-ink-soft"}`} data-directlink-pages="">
              {pages.used} de {pages.limit} páginas utilizadas
            </span>
          )}
          {atLimit ? (
            <span className="btn btn-primary cursor-not-allowed opacity-50" aria-disabled="true" data-directlink-create-disabled="">
              + Criar DirectLink
            </span>
          ) : (
            <Link href={`${basePath}/new`} className="btn btn-primary">
              + Criar DirectLink
            </Link>
          )}
        </div>
      }
    >
      {atLimit && (
        <p role="status" className="mx-[var(--ds-panel-px)] mb-4 rounded-lg border border-danger/25 bg-danger-soft px-4 py-3 text-sm" data-directlink-limit="">
          {DIRECTLINK_LIMIT_MESSAGE}
        </p>
      )}
      {links.length === 0 ? (
        <div className="border-t border-line">
          <EmptyNote icon="lab" title="Nenhum DirectLink ainda" text="Crie uma página com Instagram, WhatsApp, PIX, cardápio e localização para usar numa placa." />
        </div>
      ) : (
        <ul className="divide-y divide-line border-t border-line" data-directlink-list="">
          {links.map((link) => {
            const url = directLinkPublicUrl(link.public_code);
            return (
              <li key={link.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-[var(--ds-panel-px)] py-4">
                <div className="min-w-0 flex-1 basis-60">
                  <p className="flex flex-wrap items-center gap-2">
                    <Link href={`${basePath}/${link.id}`} className="font-semibold break-words hover:underline">
                      {link.title}
                    </Link>
                    <span className={`badge ${link.is_active ? "badge-green" : "badge-gray"}`}>{link.is_active ? "Ativo" : "Inativo"}</span>
                  </p>
                  <p className="mt-0.5 text-sm text-ink-soft">
                    {link.items} link{link.items === 1 ? "" : "s"} · Atualizado em {formatDate(link.updated_at)}
                    {showOwner && link.owner ? ` · ${link.owner}` : ""}
                  </p>
                  <p className="mt-0.5 font-mono text-xs break-all text-ink-soft">{url}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link href={`${basePath}/${link.id}`} className="btn btn-small">
                    Editar
                  </Link>
                  <a href={url} target="_blank" rel="noopener noreferrer" className="btn btn-small" aria-disabled={!link.is_active}>
                    Visualizar
                  </a>
                  <CopyButton value={url} label="Copiar link" copiedLabel="✓ Copiado" />
                  <ActiveToggle id={link.id} active={link.is_active} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
