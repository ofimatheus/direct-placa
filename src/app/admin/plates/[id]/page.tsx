import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminPlatePanel } from "@/components/plates/AdminPlatePanel";
import { CopyButton } from "@/components/ui/CopyButton";
import { PageHeader, Tone, UUID_RE } from "@/components/ui/primitives";
import { requireAdminPage } from "@/lib/auth/session";
import { getPlateDetail, listCustomersOfReseller, listResellerOptions } from "@/lib/db/operations";
import { getCustomerDisplayName, getCustomerOptionLabel, getCustomerSecondaryName } from "@/lib/customers";
import { DESTINATION_LABEL } from "@/lib/plates/destinations";
import { PLATE_STATUS_LABEL, PLATE_STATUS_TONE } from "@/lib/plates/labels";
import { buildNfcUrl, buildQrUrl } from "@/lib/plates/urls";
import { buildQrMatrix, qrMatrixToSvg } from "@/lib/renderer/qr";
import { formatInt } from "@/lib/utils/money";
import { formatDateTime } from "@/lib/utils/text";

export const metadata: Metadata = { title: "Placa" };

export default async function PlatePage({ params }: { params: Promise<{ id: string }> }) {
  const { supabase } = await requireAdminPage();
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const detail = await getPlateDetail(supabase, id);
  if (!detail) notFound();
  const { plate, batch, template, reseller, customer, history, sale } = detail;

  const [resellers, customers] = await Promise.all([
    listResellerOptions(supabase),
    plate.reseller_id ? listCustomersOfReseller(supabase, plate.reseller_id, "all") : Promise.resolve([]),
  ]);
  const qrUrl = buildQrUrl(plate.public_code);
  const nfcUrl = buildNfcUrl(plate.public_code);
  const qrSvg = qrMatrixToSvg(buildQrMatrix(qrUrl, "M"), 4, "#1C2A39", "#FFFFFF");

  const info: [string, React.ReactNode][] = [
    ["Revendedor", reseller ? <Link key="r" href={`/admin/resellers/${reseller.id}`} className="link">{reseller.company_name}</Link> : "Em estoque"],
    [
      "Venda",
      sale ? (
        <Link key="s" href={`/admin/sales/${sale.id}`} className="link">
          Venda #{sale.order_number}
        </Link>
      ) : plate.reseller_id ? (
        "Atribuição avulsa (sem venda)"
      ) : (
        "—"
      ),
    ],
    ["Cliente", customer ? [getCustomerDisplayName(customer), getCustomerSecondaryName(customer)].filter(Boolean).join(" · ") : "—"],
    [
      "Destino",
      plate.destination_url ? (
        <span key="d" className="break-all">
          <span className="font-semibold">{plate.destination_type ? DESTINATION_LABEL[plate.destination_type] : "Link"}</span>{" "}
          <a href={plate.destination_url} target="_blank" rel="noreferrer" className="link font-normal">
            {plate.destination_url}
          </a>
        </span>
      ) : (
        "Não configurado"
      ),
    ],
    ["Lote", batch ? <Link key="b" href={`/admin/batches/${batch.id}`} className="link">{batch.name}</Link> : "—"],
    ["Template", template ? <Link key="t" href={`/admin/templates/${template.id}`} className="link">{`${template.name} v${template.version_number}`}</Link> : "—"],
    ["Criada em", formatDateTime(plate.created_at)],
  ];

  return (
    <div>
      <PageHeader
        back={{ href: "/admin/plates", label: "Placas" }}
        title={<span className="plate-code">{plate.public_code}</span>}
        actions={<Tone tone={PLATE_STATUS_TONE[plate.status]}>{PLATE_STATUS_LABEL[plate.status]}</Tone>}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
        <div className="space-y-6">
          <section className="card grid gap-5 p-5 sm:grid-cols-[160px_minmax(0,1fr)]">
            <div
              className="mx-auto w-40 overflow-hidden rounded-md border border-line [&>svg]:block [&>svg]:h-auto [&>svg]:w-full"
              role="img"
              aria-label={`QR Code da placa ${plate.public_code}`}
              dangerouslySetInnerHTML={{ __html: qrSvg }}
            />
            <dl className="min-w-0 space-y-3 text-sm">
              <div>
                <dt className="text-ink-soft">URL do QR</dt>
                <dd className="mt-1 flex items-center gap-2">
                  <code className="min-w-0 truncate">{qrUrl}</code>
                  <CopyButton value={qrUrl} label="Copiar URL QR" />
                </dd>
              </div>
              <div>
                <dt className="text-ink-soft">URL do NFC</dt>
                <dd className="mt-1 flex items-center gap-2">
                  <code className="min-w-0 truncate">{nfcUrl}</code>
                  <CopyButton value={nfcUrl} label="Copiar URL NFC" />
                </dd>
              </div>
            </dl>
          </section>

          <section className="card p-5">
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[140px_minmax(0,1fr)]">
              {info.map(([label, value]) => (
                <div key={label} className="contents">
                  <dt className="text-ink-soft">{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="card p-5">
            <h2 className="display text-base">Acessos por QR Code</h2>
            <p className="mt-2 text-3xl font-bold">{formatInt(plate.qr_access_count)}</p>
            <p className="mt-1 text-sm text-ink-soft">
              {plate.last_qr_access_at ? `Último em ${formatDateTime(plate.last_qr_access_at)}` : "Nenhum acesso por QR Code ainda."}
            </p>
          </section>

          <section className="card overflow-x-auto">
            <h2 className="display px-5 pt-5 pb-2 text-base">Histórico de revendedores</h2>
            {history.length === 0 ? (
              <p className="px-5 pb-5 text-sm text-ink-soft">Esta placa nunca foi atribuída.</p>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Revendedor</th>
                    <th>Origem</th>
                    <th>Atribuída em</th>
                    <th>Saída</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((h) => (
                    <tr key={h.id}>
                      <td>{h.reseller_name ?? "—"}</td>
                      <td>
                        {h.order_id ? (
                          <Link href={`/admin/sales/${h.order_id}`} className="link font-normal">
                            Venda #{h.order_number ?? "?"}
                          </Link>
                        ) : (
                          <span className="text-ink-soft">Avulsa</span>
                        )}
                      </td>
                      <td>{formatDateTime(h.assigned_at)}</td>
                      <td>
                        {h.unassigned_at ? (
                          <>
                            {formatDateTime(h.unassigned_at)}
                            {h.ended_reason === "order_cancelled" && (
                              <span className="block text-xs text-ink-soft">Devolvida ao estoque: venda cancelada</span>
                            )}
                          </>
                        ) : (
                          <span className="font-semibold text-ok">Atual</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>

        <AdminPlatePanel
          plateId={plate.id}
          status={plate.status}
          resellerId={plate.reseller_id}
          sale={sale}
          resellers={resellers.filter((r) => r.active || r.id === plate.reseller_id)}
          customers={customers.filter((c) => !c.archived_at || c.id === plate.customer_id).map((c) => ({ id: c.id, name: getCustomerOptionLabel(c) }))}
          destination={{
            customer_id: plate.customer_id,
            destination_type: plate.destination_type,
            destination_url: plate.destination_url,
          }}
        />
      </div>
    </div>
  );
}
