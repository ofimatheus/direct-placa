import type { Metadata } from "next";
import Link from "next/link";
import { BatchLifecycleActions } from "@/components/batches/BatchLifecycleActions";
import { BatchLifecycleBadge } from "@/components/batches/BatchLifecycleBadge";
import { CreateBatchForm } from "@/components/batches/CreateBatchForm";
import { Segmented } from "@/components/ui/kit";
import { requireAdminPage } from "@/lib/auth/session";
import { countBatchesByLifecycle, listBatches, listTemplateOptions } from "@/lib/db/queries";
import type { BatchLifecycleStatus } from "@/lib/db/types";
import { formatDateTime } from "@/lib/utils/text";

export const metadata: Metadata = { title: "Lotes" };

type Filter = BatchLifecycleStatus | "all";
const FILTERS: Filter[] = ["active", "quarantine", "archived", "all"];

function parseFilter(value: string | undefined): Filter {
  return FILTERS.includes(value as Filter) ? (value as Filter) : "active";
}

export default async function BatchesPage({
  searchParams,
}: {
  searchParams: Promise<{ estado?: string }>;
}) {
  const { supabase } = await requireAdminPage();
  const { estado } = await searchParams;
  // A tela abre nos ATIVOS: lote em quarentena ou arquivado precisa ser
  // procurado, não aparecer por acidente numa listagem de trabalho.
  const filter = parseFilter(estado);

  const [batches, templates, counts] = await Promise.all([
    listBatches(supabase, filter),
    listTemplateOptions(supabase),
    countBatchesByLifecycle(supabase),
  ]);

  const tabs = [
    { key: "active", label: `Ativos (${counts.active})`, href: "/admin/batches" },
    { key: "quarantine", label: `Quarentena (${counts.quarantine})`, href: "/admin/batches?estado=quarantine" },
    { key: "archived", label: `Arquivados (${counts.archived})`, href: "/admin/batches?estado=archived" },
    { key: "all", label: `Todos (${counts.all})`, href: "/admin/batches?estado=all" },
  ];

  return (
    <div className="max-w-6xl space-y-10">
      <header>
        <h1 className="display text-4xl">Lotes</h1>
        <p className="mt-1 max-w-2xl text-ink-soft">
          Cada lote gera placas com código exclusivo. O QR e o NFC apontam para a URL intermediária; o destino final é
          definido depois, sem reimprimir.
        </p>
      </header>

      <section className="rounded-lg border border-line bg-surface p-5">
        <h2 className="display mb-4 text-lg">Novo lote</h2>
        {templates.length === 0 ? (
          <p className="text-ink-soft">
            Para gerar um lote, primeiro{" "}
            <Link href="/admin/templates/new" className="font-semibold text-cyan hover:underline">
              crie um template ativo
            </Link>
            .
          </p>
        ) : (
          <CreateBatchForm templates={templates} />
        )}
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="display text-lg">Lotes gerados</h2>
          <Segmented items={tabs} active={filter} label="Filtrar lotes por estado" />
        </div>

        <p className="text-sm text-ink-soft">
          Lote não se exclui: os QRs podem já estar impressos. A <strong>quarentena</strong> retira o lote de circulação
          (exige o lote inteiro livre) e o <strong>arquivamento</strong> é organização histórica (exige estoque zerado).
          Nada é apagado em nenhum dos dois.
        </p>

        {batches.length === 0 ? (
          <p className="text-ink-soft">
            {filter === "active"
              ? "Nenhum lote ativo."
              : filter === "quarantine"
                ? "Nenhum lote em quarentena."
                : filter === "archived"
                  ? "Nenhum lote arquivado."
                  : "Nenhum lote ainda."}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-line bg-surface">
            <table className="w-full min-w-[860px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-line text-ink-soft">
                  <th className="px-4 py-2 font-semibold">Lote</th>
                  <th className="px-4 py-2 font-semibold">Estado</th>
                  <th className="px-4 py-2 font-semibold">Template</th>
                  <th className="px-4 py-2 text-right font-semibold">Placas</th>
                  <th className="px-4 py-2 text-right font-semibold">Em estoque</th>
                  <th className="px-4 py-2 font-semibold">Criado</th>
                  <th className="px-4 py-2 text-right font-semibold">Ações</th>
                </tr>
              </thead>
              <tbody>
                {batches.map(({ batch, templateName, versionNumber, summary }) => (
                  <tr key={batch.id} className="border-b border-line last:border-0">
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/batches/${batch.id}`}
                        className="font-semibold text-ink hover:text-cyan hover:underline"
                      >
                        {batch.name}
                      </Link>
                      {batch.lifecycle_status !== "active" && batch.lifecycle_reason && (
                        <p className="mt-0.5 max-w-xs text-xs text-ink-soft">{batch.lifecycle_reason}</p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <BatchLifecycleBadge status={batch.lifecycle_status} />
                    </td>
                    <td className="px-4 py-3">
                      {templateName ? `${templateName} v${versionNumber}` : <span className="text-ink-soft">Sem template</span>}
                    </td>
                    <td className="px-4 py-3 text-right">{batch.quantity}</td>
                    <td className="px-4 py-3 text-right">
                      {summary ? summary.available_stock : <span className="text-ink-soft">—</span>}
                    </td>
                    <td className="px-4 py-3 text-ink-soft">{formatDateTime(batch.created_at)}</td>
                    <td className="px-4 py-3">
                      <BatchLifecycleActions
                        batchId={batch.id}
                        batchName={batch.name}
                        status={batch.lifecycle_status}
                        committed={summary?.committed ?? 0}
                        availableStock={summary?.available_stock ?? 0}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
