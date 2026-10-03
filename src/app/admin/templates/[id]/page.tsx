import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { TemplateEditor } from "@/components/templates/TemplateEditor";
import { TemplateMetaForm } from "@/components/templates/TemplateMetaForm";
import { requireAdminPage } from "@/lib/auth/session";
import { getTemplateDetail } from "@/lib/db/queries";
import { inputFromVersion } from "@/lib/templates/layout";
import { formatBytes, formatDateTime } from "@/lib/utils/text";

export const metadata: Metadata = { title: "Template" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function TemplatePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string }>;
}) {
  const { supabase } = await requireAdminPage();
  const { id } = await params;
  const { from } = await searchParams;
  if (!UUID_RE.test(id)) notFound();

  const detail = await getTemplateDetail(supabase, id);
  if (!detail) notFound();
  const { template, versions, batchesByVersion } = detail;
  const current = versions.find((v) => v.id === template.current_version_id);
  if (!current) notFound();

  const base = (from && versions.find((v) => v.id === from)) || current;
  const basedOn = base.id !== current.id ? base.version_number : undefined;

  return (
    <div className="space-y-12">
      <div>
        <Link href="/admin/templates" className="text-sm font-semibold text-cyan hover:underline">
          Templates
        </Link>
        <h1 className="display mt-2 text-4xl">
          {template.name} <span className="text-ink-soft">v{current.version_number}</span>
        </h1>
        {template.description && <p className="mt-1 max-w-2xl text-ink-soft">{template.description}</p>}
      </div>

      <section className="max-w-3xl">
        <h2 className="display mb-4 border-b border-line pb-2 text-lg">Identificação</h2>
        <TemplateMetaForm
          templateId={template.id}
          initial={{
            name: template.name,
            internal_key: template.internal_key,
            description: template.description,
            active: template.active,
          }}
        />
      </section>

      <section>
        <h2 className="display mb-4 border-b border-line pb-2 text-lg">Arte e posicionamento</h2>
        <TemplateEditor
          key={from ?? "current"}
          mode={{
            kind: "edit",
            templateId: template.id,
            current: {
              versionNumber: current.version_number,
              locked: current.locked_at !== null,
              batchCount: batchesByVersion[current.id] ?? 0,
            },
            basedOn,
          }}
          initialImage={{
            ref: { kind: "version", versionId: base.id },
            src: `/api/admin/templates/versions/${base.id}/image`,
            width: base.canvas_width,
            height: base.canvas_height,
            description: `${base.base_image_mime_type === "image/png" ? "PNG" : "JPG"}, ${formatBytes(Number(base.base_image_size_bytes))}`,
          }}
          initialLayout={inputFromVersion(base)}
        />
      </section>

      <section className="max-w-5xl">
        <h2 className="display mb-4 border-b border-line pb-2 text-lg">Versões</h2>
        <div className="overflow-x-auto rounded-md border border-line bg-surface">
          <table className="w-full min-w-[720px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-line text-ink-soft">
                <th className="px-4 py-2 font-semibold">Versão</th>
                <th className="px-4 py-2 font-semibold">Situação</th>
                <th className="px-4 py-2 font-semibold">Lotes</th>
                <th className="px-4 py-2 font-semibold">Arte</th>
                <th className="px-4 py-2 font-semibold">Criada</th>
                <th className="px-4 py-2 font-semibold">
                  <span className="sr-only">Ações</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {versions.map((version) => (
                <tr key={version.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-3 font-semibold">
                    v{version.version_number}
                    {version.id === current.id && <span className="ml-2 font-normal text-ok">atual</span>}
                  </td>
                  <td className="px-4 py-3">
                    {version.locked_at ? `Bloqueada em ${formatDateTime(version.locked_at)}` : "Editável"}
                  </td>
                  <td className="px-4 py-3">{batchesByVersion[version.id] ?? 0}</td>
                  <td className="px-4 py-3 text-ink-soft" title={version.base_image_sha256}>
                    {version.canvas_width} × {version.canvas_height} px, {version.base_image_sha256.slice(0, 10)}
                  </td>
                  <td className="px-4 py-3 text-ink-soft">{formatDateTime(version.created_at)}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-4 whitespace-nowrap">
                      <a
                        href={`/api/admin/templates/versions/${version.id}/preview`}
                        target="_blank"
                        rel="noreferrer"
                        className="font-semibold text-cyan hover:underline"
                      >
                        Prévia fiel
                      </a>
                      {version.id !== current.id && (
                        <Link href={`/admin/templates/${template.id}?from=${version.id}`} className="font-semibold text-cyan hover:underline">
                          Usar como base
                        </Link>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
