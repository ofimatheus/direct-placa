import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ExportsPanel } from "@/components/batches/ExportsPanel";
import { PlatesTable } from "@/components/batches/PlatesTable";
import { requireAdminPage } from "@/lib/auth/session";
import { getBatchDetail, type ProductionStatus } from "@/lib/db/queries";
import { toExportView } from "@/lib/db/types";
import { formatDateTime } from "@/lib/utils/text";

export const metadata: Metadata = { title: "Lote" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PRODUCTION_LABEL: Record<ProductionStatus, { label: string; tone: string }> = {
  not_started: { label: "Artes não geradas", tone: "text-ink-soft" },
  in_progress: { label: "Gerando artes", tone: "text-warn" },
  done: { label: "Artes geradas", tone: "text-ok" },
};

export default async function BatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { supabase } = await requireAdminPage();
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();

  const detail = await getBatchDetail(supabase, id);
  if (!detail) notFound();
  const { batch, template, version, plates, stats, production, exports } = detail;
  const productionInfo = PRODUCTION_LABEL[production];

  const figures = [
    { label: "Quantidade", value: stats.total },
    { label: "QR", value: stats.qr },
    { label: "Com revendedor", value: stats.withReseller },
    { label: "Ativas", value: stats.active },
  ];

  return (
    <div className="max-w-6xl space-y-10">
      <header>
        <Link href="/admin/batches" className="text-sm font-semibold text-cyan hover:underline">
          Lotes
        </Link>
        <h1 className="display mt-2 text-4xl sm:text-5xl">{batch.name}</h1>
        {batch.description && <p className="mt-2 max-w-2xl text-ink-soft">{batch.description}</p>}
        <p className="mt-3 text-ink-soft">
          Template:{" "}
          {template && version ? (
            <Link href={`/admin/templates/${template.id}`} className="font-semibold text-ink hover:text-cyan hover:underline">
              {template.name} v{version.version_number}
            </Link>
          ) : (
            <span className="font-semibold text-ink">sem template</span>
          )}
          <span className="mx-2 text-line-strong" aria-hidden>
            |
          </span>
          Criado em {formatDateTime(batch.created_at)}
        </p>
      </header>

      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-3 lg:grid-cols-5">
        {figures.map((figure) => (
          <div key={figure.label} className="bg-surface px-4 py-4">
            <dt className="text-sm text-ink-soft">{figure.label}</dt>
            <dd className="display mt-1 text-3xl">{figure.value}</dd>
          </div>
        ))}
        <div className="bg-surface px-4 py-4">
          <dt className="text-sm text-ink-soft">Status de produção</dt>
          <dd className={`mt-2 text-lg font-bold ${productionInfo.tone}`}>{productionInfo.label}</dd>
        </div>
      </dl>

      <ExportsPanel batchId={batch.id} initial={exports.map(toExportView)} canGenerateArt={!!version} />

      <PlatesTable plates={plates} hasTemplate={!!version} />
    </div>
  );
}
