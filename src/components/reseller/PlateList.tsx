import Link from "next/link";
import { StatusBadge } from "@/components/ui/kit";
import type { ResellerPlateItem } from "@/lib/db/operations";
import { DESTINATION_LABEL } from "@/lib/plates/destinations";
import { formatInt } from "@/lib/utils/money";

function hostOf(url: string | null): string {
  if (!url) return "";
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return "";
  }
}

const actionLabel = (p: ResellerPlateItem) =>
  p.status === "assigned"
    ? "Configurar"
    : p.status === "blocked"
      ? "Ver"
      : "Editar";

/**
 * Desktop/tablet: tabela (com rolagem própria se faltar largura — nunca cortada).
 * Celular: linhas empilhadas, sem rolagem horizontal.
 */
export function PlateList({
  plates,
  showActions = false,
}: {
  plates: ResellerPlateItem[];
  showActions?: boolean;
}) {
  return (
    <>
      <div className="table-scroll hidden md:block">
        <table className="data-table data-table-compact">
          <thead>
            <tr>
              <th className="pl-5">Código</th>
              <th>Cliente</th>
              <th>Destino</th>
              <th>Status</th>
              <th className="text-right">QR Code</th>
              {showActions && <th className="pr-5 text-right">Ações</th>}
            </tr>
          </thead>
          <tbody>
            {plates.map((p) => (
              <tr key={p.id}>
                <td className="pl-5">
                  <Link
                    href={`/reseller/plates/${p.id}`}
                    className="plate-code text-[0.95rem] text-ink hover:text-mat"
                  >
                    {p.public_code}
                  </Link>
                </td>
                <td className="max-w-44 truncate">
                  {p.customer_name ?? <span className="text-ink-soft">—</span>}
                </td>
                <td className="max-w-56">
                  {p.destination_type ? (
                    <span className="block truncate">
                      {DESTINATION_LABEL[p.destination_type]}
                      <span className="block truncate text-xs text-ink-soft">
                        {hostOf(p.destination_url)}
                      </span>
                    </span>
                  ) : (
                    <span className="text-ink-soft">—</span>
                  )}
                </td>
                <td>
                  <StatusBadge status={p.status} />
                </td>
                <td className="text-right font-semibold tabular-nums">
                  {formatInt(p.qr_access_count)}
                </td>
                {showActions && (
                  <td className="pr-5 text-right">
                    <Link
                      href={`/reseller/plates/${p.id}`}
                      className={`btn btn-small btn-ghost ${p.status === "assigned" ? "text-mat" : ""}`}
                    >
                      {actionLabel(p)}
                    </Link>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="divide-y divide-line md:hidden">
        {plates.map((p) => (
          <li key={p.id}>
            <Link
              href={`/reseller/plates/${p.id}`}
              className="flex min-h-16 items-center gap-3 px-4 py-3 active:bg-paper"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="plate-code">{p.public_code}</span>
                  <StatusBadge status={p.status} />
                </div>
                <p className="mt-1 truncate text-sm text-ink-soft">
                  {[
                    p.customer_name,
                    p.destination_type
                      ? DESTINATION_LABEL[p.destination_type]
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" | ") || "Toque para configurar"}
                </p>
              </div>
              <span className="text-right text-xs text-ink-soft">
                <span className="block text-sm font-bold text-ink tabular-nums">
                  {formatInt(p.qr_access_count)}
                </span>
                acessos QR
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
