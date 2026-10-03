import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SaleStatusActions } from "@/components/sales/SaleStatusActions";
import { PageHeader, Tone, UUID_RE } from "@/components/ui/primitives";
import { requireAdminPage } from "@/lib/auth/session";
import { getSale } from "@/lib/db/operations";
import type { PlateStatus } from "@/lib/db/types";
import { ORDER_STATUS_LABEL, ORDER_STATUS_TONE, PLATE_STATUS_LABEL, PLATE_STATUS_TONE, SALE_PLATE_RELEASE_LABEL } from "@/lib/plates/labels";
import { formatBRL, formatInt } from "@/lib/utils/money";
import { formatDateTime } from "@/lib/utils/text";

export const metadata: Metadata = { title: "Venda" };

const STATUS_ORDER: PlateStatus[] = ["assigned", "active", "inactive", "blocked", "in_stock"];

export default async function SalePage({ params }: { params: Promise<{ id: string }> }) {
  const { supabase } = await requireAdminPage();
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const detail = await getSale(supabase, id);
  if (!detail) notFound();
  const { sale, items, plates } = detail;

  const linked = plates.filter((p) => !p.released_at);
  const returned = plates.filter((p) => p.release_reason === "returned_to_stock");
  const kept = plates.filter((p) => p.release_reason === "kept_with_reseller");
  const countByStatus = STATUS_ORDER.map((s) => ({ status: s, count: linked.filter((p) => p.status === s).length })).filter((c) => c.count > 0);
  const inUse = linked.filter((p) => p.status !== "assigned").map((p) => ({ code: p.public_code, label: PLATE_STATUS_LABEL[p.status] }));

  const history = [
    {
      at: sale.created_at,
      text:
        plates.length > 0
          ? `Venda registrada com ${formatInt(plates.length)} placa(s) reservada(s) para ${sale.reseller_name ?? "o revendedor"}.`
          : "Venda registrada, sem placas vinculadas.",
    },
    ...(sale.paid_at ? [{ at: sale.paid_at, text: "Marcada como paga." }] : []),
    ...(sale.cancelled_at
      ? [
          {
            at: sale.cancelled_at,
            text: [
              "Venda cancelada.",
              returned.length ? `${formatInt(returned.length)} placa(s) devolvida(s) ao estoque.` : "",
              kept.length ? `${formatInt(kept.length)} placa(s) em uso mantida(s) com o revendedor por ação administrativa.` : "",
            ]
              .filter(Boolean)
              .join(" "),
          },
        ]
      : []),
  ].sort((a, b) => a.at.localeCompare(b.at));

  return (
    <div className="max-w-5xl">
      <PageHeader
        title={`Venda #${sale.order_number}`}
        back={{ href: "/admin/sales", label: "Vendas" }}
        description={
          <>
            <Link href={`/admin/resellers/${sale.reseller_id}`} className="link">
              {sale.reseller_name}
            </Link>{" "}
            <span className="mx-1 text-line-strong">|</span> {formatInt(sale.plates)} placas{" "}
            <span className="mx-1 text-line-strong">|</span> Registrada em {formatDateTime(sale.created_at)}
          </>
        }
      />
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 space-y-4">
          <div className="card overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th className="text-right">Qtd.</th>
                  <th className="text-right">Unitário</th>
                  <th className="text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td>{item.description}</td>
                    <td className="text-right">{formatInt(item.quantity)}</td>
                    <td className="text-right">{formatBRL(item.unit_price)}</td>
                    <td className="text-right">{formatBRL(item.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {sale.notes && <p className="border-t border-line px-4 py-3 text-sm text-ink-soft">{sale.notes}</p>}
          </div>

          <section className="card" aria-labelledby="sale-plates">
            <div className="flex flex-wrap items-baseline justify-between gap-2 px-5 pt-5 pb-3">
              <h2 id="sale-plates" className="display text-lg">
                Placas da venda
              </h2>
              {plates.length > 0 && (
                <p className="text-sm text-ink-soft">
                  {linked.length > 0
                    ? countByStatus.map((c) => `${formatInt(c.count)} ${PLATE_STATUS_LABEL[c.status].toLowerCase()}`).join(", ")
                    : "Nenhuma placa vinculada no momento"}
                  {linked.length > 0 && linked.length !== sale.plates && ` de ${formatInt(sale.plates)}`}
                </p>
              )}
            </div>
            {plates.length === 0 ? (
              <p className="px-5 pb-5 text-sm text-ink-soft">
                Esta venda foi registrada antes da reserva automática de placas e não tem placas vinculadas.
              </p>
            ) : (
              <div className="max-h-[32rem] overflow-auto border-t border-line">
                <table className="data-table min-w-[620px]">
                  <thead>
                    <tr>
                      <th>Código</th>
                      <th>Status atual</th>
                      <th>Lote</th>
                      <th>Template</th>
                      <th>Na venda</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plates.map((p) => (
                      <tr key={p.plate_id}>
                        <td>
                          <Link href={`/admin/plates/${p.plate_id}`} className="plate-code text-ink hover:text-cyan hover:underline">
                            {p.public_code}
                          </Link>
                        </td>
                        <td>
                          <Tone tone={PLATE_STATUS_TONE[p.status]}>{PLATE_STATUS_LABEL[p.status]}</Tone>
                        </td>
                        <td>
                          {p.batch_id ? (
                            <Link href={`/admin/batches/${p.batch_id}`} className="link font-normal">
                              {p.batch_name}
                            </Link>
                          ) : (
                            <span className="text-ink-soft">—</span>
                          )}
                        </td>
                        <td>{p.template_name ?? <span className="text-ink-soft">—</span>}</td>
                        <td className="text-sm">
                          {p.release_reason ? (
                            <span className="text-ink-soft">
                              {SALE_PLATE_RELEASE_LABEL[p.release_reason]}
                              {p.released_at && ` em ${formatDateTime(p.released_at)}`}
                            </span>
                          ) : (
                            <span>Reservada em {formatDateTime(p.reserved_at)}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="card p-5" aria-labelledby="sale-history">
            <h2 id="sale-history" className="display text-lg">
              Histórico
            </h2>
            <ol className="mt-3 space-y-2 border-l border-line pl-4 text-sm">
              {history.map((h) => (
                <li key={`${h.at}-${h.text}`}>
                  <span className="text-ink-soft">{formatDateTime(h.at)}</span> <span className="ml-1">{h.text}</span>
                </li>
              ))}
            </ol>
          </section>
        </div>

        <aside className="card h-fit p-5">
          <Tone tone={ORDER_STATUS_TONE[sale.status]}>{ORDER_STATUS_LABEL[sale.status]}</Tone>
          <dl className="mt-4 space-y-2 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-ink-soft">Revendedor</dt>
              <dd className="text-right">{sale.reseller_name ?? "—"}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-soft">Quantidade</dt>
              <dd>{formatInt(sale.plates)} placas</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-soft">Subtotal</dt>
              <dd>{formatBRL(sale.subtotal)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-soft">Desconto</dt>
              <dd>{sale.discount > 0 ? `− ${formatBRL(sale.discount)}` : formatBRL(0)}</dd>
            </div>
            <div className="flex justify-between border-t border-line pt-3 text-base font-bold">
              <dt>Total</dt>
              <dd>{formatBRL(sale.total)}</dd>
            </div>
          </dl>
          {sale.paid_at && <p className="mt-3 text-xs text-ink-soft">Marcada como paga em {formatDateTime(sale.paid_at)}</p>}
          {sale.cancelled_at && <p className="mt-1 text-xs text-ink-soft">Cancelada em {formatDateTime(sale.cancelled_at)}</p>}
          <div className="mt-5 border-t border-line pt-4">
            <SaleStatusActions
              saleId={sale.id}
              orderNumber={sale.order_number}
              status={sale.status}
              reservedCount={linked.length - inUse.length}
              inUse={inUse}
            />
          </div>
        </aside>
      </div>
    </div>
  );
}
