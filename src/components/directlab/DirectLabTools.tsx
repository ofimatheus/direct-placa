import Link from "next/link";
import { Icon, type IconName } from "@/components/ui/icons";
import type { DirectLabRole } from "@/lib/directlab/apply";
import type { QuotaSnapshot } from "@/lib/directlab/types";
import type { DirectLinkPageStatus } from "@/lib/directlink/limits";

export const DIRECTLAB_TITLE = "DirectLab";
export const DIRECTLAB_SUBTITLE = "Ferramentas inteligentes para links e placas";

interface Tool {
  key: string;
  title: string;
  text: string;
  href: string;
  icon: IconName;
  status: string | null;
  exhausted: boolean;
}

/**
 * Hub do DirectLab: catálogo de ferramentas (cada uma é um "aplicativo" com
 * página própria). Compartilhado por ADMIN e revendedor. Nova ferramenta =
 * novo item nesta lista + a página dela.
 *
 * `quota` e `pages` vêm do banco (limites do revendedor definidos pelo ADMIN);
 * ADMIN não tem limite.
 */
export function DirectLabTools({
  role,
  quota = null,
  pages = null,
}: {
  role: DirectLabRole;
  quota?: QuotaSnapshot | null;
  pages?: DirectLinkPageStatus | null;
}) {
  const base = `/${role}/directlab`;
  const tools: Tool[] = [
    {
      key: "google-review",
      title: "Avaliação Google",
      text: "Gere links diretos para o cliente avaliar o estabelecimento no Google.",
      href: `${base}/google-review`,
      icon: "star",
      status: role === "admin" ? "Sem limite diário" : quota ? `${quota.used} de ${quota.limit} utilizações hoje` : null,
      exhausted: role !== "admin" && !!quota && quota.used >= quota.limit,
    },
    {
      key: "directlink",
      title: "DirectLink",
      text: "Crie uma página pública para links, PIX e redes — para abrir pelo QR Code.",
      href: `${base}/directlink`,
      icon: "link",
      status: role === "admin" ? "Sem limite de páginas" : pages && pages.limit !== null ? `${pages.used} de ${pages.limit} páginas` : null,
      exhausted: role !== "admin" && !!pages && pages.limit !== null && pages.used >= pages.limit,
    },
  ];
  return (
    <nav className="grid max-w-4xl gap-[var(--ds-grid-gap)] sm:grid-cols-2" aria-label="Ferramentas do DirectLab" data-directlab-hub="">
      {tools.map((tool) => (
        <Link
          key={tool.key}
          href={tool.href}
          className="card group flex min-h-[13.5rem] flex-col p-[calc(var(--ds-card-px)*1.25)] transition-[border-color,box-shadow,transform] hover:-translate-y-0.5 hover:border-[#bcd3f5] hover:shadow-[0_10px_28px_rgb(16_24_40/0.09)] focus-visible:border-mat"
          data-directlab-card={tool.key}
        >
          <span className="icon-tile size-14 rounded-2xl" aria-hidden>
            <Icon name={tool.icon} className="size-7" />
          </span>
          <span className="display mt-4 block text-xl">{tool.title}</span>
          <span className="mt-1.5 block text-[0.95rem] leading-relaxed text-ink-soft">{tool.text}</span>
          <span className="mt-auto flex flex-wrap items-end justify-between gap-x-4 gap-y-2 pt-5">
            <span
              className={`text-sm font-semibold tabular-nums ${tool.exhausted ? "text-danger" : role === "admin" ? "text-ink-soft" : "text-mat"}`}
              data-directlab-card-status=""
            >
              {tool.status ?? ""}
            </span>
            <span className="inline-flex items-center gap-1 text-sm font-semibold text-mat">
              Abrir
              <Icon name="chevron-right" className="size-4 transition-transform group-hover:translate-x-0.5" />
            </span>
          </span>
        </Link>
      ))}
    </nav>
  );
}
