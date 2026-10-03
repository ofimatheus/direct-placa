import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ResellerPlateForm } from "@/components/reseller/ResellerPlateForm";
import { CopyButton } from "@/components/ui/CopyButton";
import { StatusBadge } from "@/components/ui/kit";
import { UUID_RE } from "@/components/ui/primitives";
import { requireResellerContext } from "@/lib/auth/session";
import { getCustomerDisplayName, getCustomerOptionLabel, getCustomerSecondaryName } from "@/lib/customers";
import { PLATE_COLUMNS, listCustomersOfReseller } from "@/lib/db/operations";
import type { PlateRow } from "@/lib/db/types";
import { DESTINATION_LABEL } from "@/lib/plates/destinations";
import { buildNfcUrl, buildQrUrl } from "@/lib/plates/urls";
import { buildQrMatrix, qrMatrixToSvg } from "@/lib/renderer/qr";
import { formatInt } from "@/lib/utils/money";

export const metadata: Metadata = { title: "Placa" };

export default async function ResellerPlatePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ venda?: string }>;
}) {
  const { supabase, resellerId } = await requireResellerContext();
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();

  // A RLS só devolve a placa se ela for deste revendedor.
  const { data: plate } = await supabase.from("plates").select(PLATE_COLUMNS).eq("id", id).maybeSingle<PlateRow>();
  if (!plate) notFound();
  // Seletor: clientes ativos + o cliente atual da placa (mesmo em quarentena, para o valor continuar visível).
  const customers = (await listCustomersOfReseller(supabase, resellerId, "all")).filter((c) => !c.archived_at || c.id === plate.customer_id);
  // Chegou aqui logo depois de registrar a venda (venda com uma placa).
  const { venda } = await searchParams;
  const fromSale = venda && UUID_RE.test(venda) ? venda : null;
  const customer = customers.find((c) => c.id === plate.customer_id) ?? null;

  const qrUrl = buildQrUrl(plate.public_code);
  const nfcUrl = buildNfcUrl(plate.public_code);
  const qrSvg = qrMatrixToSvg(buildQrMatrix(qrUrl, "M"), 4, "#131E2B", "#FFFFFF");

  const summary: { label: string; value: React.ReactNode }[] = [
    {
      label: "Cliente",
      value: customer ? (
        <span className="block min-w-0">
          <span className="block truncate">{getCustomerDisplayName(customer)}</span>
          {getCustomerSecondaryName(customer) && <span className="block truncate text-xs font-normal text-ink-soft">{getCustomerSecondaryName(customer)}</span>}
        </span>
      ) : (
        <span className="text-ink-soft">Sem cliente</span>
      ),
    },
    {
      label: "Destino",
      value: plate.destination_url ? (
        <span className="block min-w-0">
          {plate.destination_type ? DESTINATION_LABEL[plate.destination_type] : "Link"}
          <a href={plate.destination_url} target="_blank" rel="noreferrer" className="block truncate text-xs font-normal text-mat hover:underline">
            {plate.destination_url}
          </a>
        </span>
      ) : (
        <span className="text-ink-soft">Não configurado</span>
      ),
    },
    { label: "Status", value: <StatusBadge status={plate.status} /> },
    {
      label: "Acessos QR",
      value: <span className="tabular-nums">{formatInt(plate.qr_access_count)}</span>,
    },
  ];

  return (
    <div>
      <Link href="/reseller/plates" className="link text-sm">
        ← Minhas placas
      </Link>

      {fromSale && (
        <div role="status" className="mt-4 rounded-xl border border-ok/30 bg-ok/5 px-4 py-3 text-sm">
          <p className="font-semibold text-ok">Venda registrada.</p>
          <p className="mt-0.5 text-ink-soft">
            {plate.destination_url
              ? "Esta placa já está configurada."
              : customer
                ? `A placa já está vinculada a ${customer.name}. Agora configure o destino e salve para ativá-la.`
                : "Agora configure o destino e salve para ativar a placa."}{" "}
            <Link href={`/reseller/sales/${fromSale}`} className="link">
              Ver a venda
            </Link>
          </p>
        </div>
      )}

      <div className="mt-5 grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="space-y-4">
          <div className="card px-6 pt-6 pb-5 text-center">
            <div
              className="mx-auto w-44 [&>svg]:block [&>svg]:h-auto [&>svg]:w-full"
              role="img"
              aria-label={`QR Code da placa ${plate.public_code}`}
              dangerouslySetInnerHTML={{ __html: qrSvg }}
            />
            <p className="display plate-code mt-4 text-3xl">{plate.public_code}</p>
            <div className="mt-2">
              <StatusBadge status={plate.status} />
            </div>
          </div>
          <dl className="card divide-y divide-line text-sm">
            {[
              { label: "URL QR", url: qrUrl },
              { label: "URL NFC", url: nfcUrl },
            ].map(({ label, url }) => (
              <div key={label} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <dt className="text-xs font-semibold text-ink-soft">{label}</dt>
                  <dd className="truncate text-[0.8rem]" title={url}>
                    {url}
                  </dd>
                </div>
                <CopyButton value={url} />
              </div>
            ))}
          </dl>
          <p className="px-1 text-xs leading-relaxed text-ink-soft">A URL NFC serve para gravar a tag com um app externo.</p>
        </aside>

        <div className="min-w-0 space-y-6">
          <dl className="card grid grid-cols-2 gap-px overflow-hidden bg-line lg:grid-cols-4">
            {summary.map((item) => (
              <div key={item.label} className="min-w-0 bg-surface px-4 py-4">
                <dt className="text-xs font-semibold text-ink-soft">{item.label}</dt>
                <dd className="mt-1.5 font-semibold">{item.value}</dd>
              </div>
            ))}
          </dl>

          <section aria-labelledby="config-title">
            <h2 id="config-title" className="mb-3 text-base font-bold">
              Configuração
            </h2>
            <ResellerPlateForm
              plateId={plate.id}
              status={plate.status}
              customers={customers.map((c) => ({ id: c.id, name: getCustomerOptionLabel(c) }))}
              initial={{ customer_id: plate.customer_id, destination_type: plate.destination_type, destination_url: plate.destination_url }}
            />
          </section>
        </div>
      </div>
    </div>
  );
}
