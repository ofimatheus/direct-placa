import Link from "next/link";

/** Primitivas visuais do painel (server-safe, sem estado). */

export function PageHeader({
  title,
  description,
  actions,
  back,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  back?: { href: string; label: string };
}) {
  return (
    <header className="page-header flex flex-wrap items-center justify-between gap-4">
      <div className="min-w-0">
        {back && (
          <Link href={back.href} className="link text-sm">
            {back.label}
          </Link>
        )}
        <h1 className={`display page-title ${back ? "mt-2" : ""}`}>{title}</h1>
        {description && <p className="page-subtitle mt-1.5 max-w-2xl text-ink-soft">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-3">{actions}</div>}
    </header>
  );
}

/** Cor de texto de status (mapas *_TONE) → badge suave do design system. */
function badgeFor(tone: string): string {
  if (tone.includes("text-ok")) return "badge-green";
  if (tone.includes("text-warn")) return "badge-amber";
  if (tone.includes("text-danger")) return "badge-red";
  if (tone.includes("text-cyan") || tone.includes("text-mat")) return "badge-blue";
  return "badge-gray";
}

export function Tone({ tone, children }: { tone: string; children: React.ReactNode }) {
  return <span className={`badge ${badgeFor(tone)}`}>{children}</span>;
}


export function EmptyState({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="card px-6 py-10 text-center">
      <p className="font-semibold">{title}</p>
      {children && <div className="mt-1 text-sm text-ink-soft">{children}</div>}
    </div>
  );
}

/** Paginação por links, preservando os filtros atuais da URL. */
export function Pagination({
  page,
  total,
  pageSize,
  basePath,
  params,
}: {
  page: number;
  total: number;
  pageSize: number;
  basePath: string;
  params: Record<string, string | undefined>;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return <p className="mt-3 text-sm text-ink-soft">{total} registro(s)</p>;
  const href = (target: number) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) if (value) search.set(key, value);
    search.set("page", String(target));
    return `${basePath}?${search.toString()}`;
  };
  return (
    <nav className="mt-4 flex items-center justify-between gap-3 text-sm" aria-label="Paginação">
      <span className="text-ink-soft">
        {total} registros, página {page} de {pages}
      </span>
      <span className="flex gap-2">
        {page > 1 ? (
          <Link className="btn btn-small" href={href(page - 1)}>
            Anterior
          </Link>
        ) : (
          <span className="btn btn-small opacity-40">Anterior</span>
        )}
        {page < pages ? (
          <Link className="btn btn-small" href={href(page + 1)}>
            Próxima
          </Link>
        ) : (
          <span className="btn btn-small opacity-40">Próxima</span>
        )}
      </span>
    </nav>
  );
}

export function parsePage(value: string | undefined): number {
  const page = Number.parseInt(value ?? "1", 10);
  return Number.isFinite(page) && page > 0 ? page : 1;
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
