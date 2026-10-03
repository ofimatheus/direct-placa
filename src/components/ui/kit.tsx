import Link from "next/link";
import type { PlateStatus } from "@/lib/db/types";
import { PLATE_STATUS_LABEL, RESELLER_STATUS_LABEL } from "@/lib/plates/labels";
import { Icon } from "@/components/ui/icons";

/**
 * Design system DirectPlaca (ADMIN e revendedor): cabeçalhos, cards, KPIs,
 * status, filtros, busca, estados vazios e feedback. Sem estado próprio —
 * serve a Server e Client Components.
 */

export function PageTitle({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-4">
      <div className="min-w-0">
        <h1 className="display page-title">{title}</h1>
        {subtitle && <p className="page-subtitle mt-1.5 text-ink-soft">{subtitle}</p>}
      </div>
      {action}
    </header>
  );
}

export function Panel({
  title,
  subtitle,
  action,
  children,
  footer,
  className = "",
}: {
  title?: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`card overflow-hidden ${className}`}>
      {(title || action) && (
        <div className="panel-head flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            {title && <h2 className="display panel-title">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-sm text-ink-soft">{subtitle}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
      {footer && <div className="panel-foot border-t border-line">{footer}</div>}
    </section>
  );
}

/**
 * Card de KPI: ícone em quadro azul suave, rótulo, valor em destaque e dica.
 * Com href, o card inteiro é um link (seta no canto).
 */
export function StatCard({
  label,
  value,
  hint,
  icon,
  href,
  footnote,
}: {
  label: string;
  value: string;
  hint?: string;
  icon: React.ComponentProps<typeof Icon>["name"];
  href?: string;
  footnote?: React.ReactNode;
}) {
  const body = (
    <div className="kpi-body">
      <span className="icon-tile kpi-icon" aria-hidden>
        <Icon name={icon} />
      </span>
      <p className={`kpi-label leading-snug font-semibold text-ink ${href ? "pr-9" : ""}`}>{label}</p>
      <p className="kpi-value" data-kpi-value="">
        {value}
      </p>
      {(hint || footnote) && (
        <div className="kpi-hint min-w-0">
          {hint && <p className="leading-snug text-ink-soft">{hint}</p>}
          {footnote}
        </div>
      )}
      {href && (
        <span className="absolute top-[var(--ds-card-py)] right-[var(--ds-card-px)] grid size-8 place-items-center rounded-lg bg-paper text-ink-soft transition-colors group-hover:bg-brand-soft group-hover:text-mat" aria-hidden>
          <Icon name="chevron-right" className="size-4" />
        </span>
      )}
    </div>
  );
  const className = "card kpi-card group relative block min-w-0";
  return href ? (
    <Link href={href} className={`${className} transition-[border-color,box-shadow] hover:border-[#bcd3f5] hover:shadow-[0_6px_20px_rgb(16_24_40/0.07)]`}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}

/**
 * Grade de KPIs: 4 colunas quando o conteúdo tem largura real para isso,
 * 2 em espaço médio e 1 no celular (container query — independe da sidebar).
 */
export function KpiGrid({ children, label }: { children: React.ReactNode; label?: string }) {
  return (
    <div className="kpi-grid-wrap">
      <div className="kpi-grid" role={label ? "group" : undefined} aria-label={label} data-kpi-grid="">
        {children}
      </div>
    </div>
  );
}

/** Tom suave por status (apresentação; os status reais não mudam). */
export const PLATE_BADGE_CLASS: Record<PlateStatus, string> = {
  in_stock: "badge-blue",
  assigned: "badge-blue",
  active: "badge-green",
  inactive: "badge-gray",
  blocked: "badge-red",
};

/**
 * Status da placa como badge. audience "reseller" (padrão) usa os rótulos do
 * revendedor (assigned = Disponível); "admin" usa os do ADMIN
 * (in_stock = Disponível, assigned = Reservada, em âmbar).
 */
export function StatusBadge({ status, audience = "reseller" }: { status: PlateStatus; audience?: "reseller" | "admin" }) {
  const label = audience === "admin" ? PLATE_STATUS_LABEL[status] : RESELLER_STATUS_LABEL[status];
  const tone = audience === "admin" && status === "assigned" ? "badge-amber" : PLATE_BADGE_CLASS[status];
  return <span className={`badge ${tone}`}>{label}</span>;
}

/** Filtros como links (a URL guarda o estado; funciona sem JavaScript). */
export function Segmented({ items, active, label }: { items: { key: string; label: string; href: string }[]; active: string; label: string }) {
  return (
    <nav className="flex max-w-full flex-wrap gap-1 rounded-xl border border-line bg-surface p-1" aria-label={label}>
      {items.map((item) => (
        <Link
          key={item.key}
          href={item.href}
          aria-current={item.key === active ? "true" : undefined}
          className={`segmented-item rounded-lg font-semibold whitespace-nowrap transition-colors ${
            item.key === active ? "bg-mat text-white shadow-[0_2px_8px_rgb(11_99_222/0.3)]" : "text-ink-soft hover:bg-paper hover:text-ink"
          }`}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

/** Busca por GET. `hidden` preserva outros parâmetros (ex.: filtro atual). */
export function SearchForm({
  action,
  name = "q",
  defaultValue,
  placeholder,
  hidden = {},
}: {
  action: string;
  name?: string;
  defaultValue?: string;
  placeholder: string;
  hidden?: Record<string, string | undefined>;
}) {
  return (
    <form method="get" action={action} className="relative w-full sm:max-w-sm" role="search">
      {Object.entries(hidden).map(([key, value]) => (value ? <input key={key} type="hidden" name={key} value={value} /> : null))}
      <Icon name="search" className="pointer-events-none absolute top-1/2 left-3.5 size-[18px] -translate-y-1/2 text-ink-soft" />
      <input className="input pl-10" type="search" name={name} defaultValue={defaultValue} placeholder={placeholder} aria-label={placeholder} />
    </form>
  );
}

export function EmptyNote({
  icon = "plates",
  title,
  text,
  action,
}: {
  icon?: React.ComponentProps<typeof Icon>["name"];
  title: string;
  text?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <span className="icon-tile size-12 rounded-full" aria-hidden>
        <Icon name={icon} className="size-5" />
      </span>
      <p className="mt-3 font-bold">{title}</p>
      {text && <p className="mt-1 max-w-sm text-sm text-ink-soft">{text}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Feedback({ kind, title, detail }: { kind: "success" | "error"; title: string; detail?: string }) {
  return (
    <div
      role={kind === "error" ? "alert" : "status"}
      className={`rounded-xl border px-3.5 py-2.5 text-sm ${kind === "error" ? "border-[#f5c2bd] bg-danger-soft text-danger" : "border-[#bfe3cc] bg-ok-soft text-ok"}`}
    >
      <p className="font-semibold">{title}</p>
      {detail && <p className="mt-0.5 opacity-90">{detail}</p>}
    </div>
  );
}

/** Nota informativa (ícone "i" em azul suave), como nas referências dos dashboards. */
export function InfoNote({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <p className={`flex items-start gap-2.5 rounded-xl bg-brand-soft/70 px-4 py-3 text-sm text-[#24466f] ${className}`}>
      <Icon name="info" className="mt-0.5 size-[18px] shrink-0 text-mat" />
      <span className="min-w-0">{children}</span>
    </p>
  );
}
