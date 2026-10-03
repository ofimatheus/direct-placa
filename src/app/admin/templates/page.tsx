import type { Metadata } from "next";
import Link from "next/link";
import { requireAdminPage } from "@/lib/auth/session";
import { listTemplates } from "@/lib/db/queries";
import { formatDateTime } from "@/lib/utils/text";

export const metadata: Metadata = { title: "Templates" };

export default async function TemplatesPage() {
  const { supabase } = await requireAdminPage();
  const items = await listTemplates(supabase);

  return (
    <div className="max-w-6xl">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="display text-4xl">Templates</h1>
          <p className="mt-1 max-w-2xl text-ink-soft">
            A arte base de cada modelo de placa e a posição do QR e do código. Versões usadas em lotes ficam bloqueadas para
            reimpressão idêntica.
          </p>
        </div>
        <Link href="/admin/templates/new" className="btn btn-primary">
          Novo template
        </Link>
      </header>

      {items.length === 0 ? (
        <div className="mt-10 max-w-xl rounded-lg border border-dashed border-line-strong p-8">
          <p className="font-semibold">Nenhum template ainda</p>
          <p className="mt-1 text-ink-soft">Envie a arte base de uma placa e posicione o QR e o código para criar o primeiro modelo.</p>
          <Link href="/admin/templates/new" className="btn btn-primary mt-4">
            Criar template
          </Link>
        </div>
      ) : (
        <div className="mt-8 overflow-x-auto rounded-md border border-line bg-surface">
          <table className="w-full min-w-[760px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-line text-ink-soft">
                <th className="px-4 py-2 font-semibold">Template</th>
                <th className="px-4 py-2 font-semibold">Versão atual</th>
                <th className="px-4 py-2 font-semibold">Versões</th>
                <th className="px-4 py-2 font-semibold">Lotes</th>
                <th className="px-4 py-2 font-semibold">Arte</th>
                <th className="px-4 py-2 font-semibold">Situação</th>
                <th className="px-4 py-2 font-semibold">Atualizado</th>
              </tr>
            </thead>
            <tbody>
              {items.map(({ template, current, versionCount, batchCount }) => (
                <tr key={template.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-3">
                    <Link href={`/admin/templates/${template.id}`} className="font-semibold text-ink hover:text-cyan hover:underline">
                      {template.name}
                    </Link>
                    <p className="text-xs text-ink-soft">{template.internal_key}</p>
                  </td>
                  <td className="px-4 py-3">
                    {current ? (
                      <>
                        v{current.version_number}{" "}
                        <span className="text-ink-soft">{current.locked_at ? "bloqueada" : "editável"}</span>
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-3">{versionCount}</td>
                  <td className="px-4 py-3">{batchCount}</td>
                  <td className="px-4 py-3 text-ink-soft">{current ? `${current.canvas_width} × ${current.canvas_height} px` : "—"}</td>
                  <td className={`px-4 py-3 font-semibold ${template.active ? "text-ok" : "text-ink-soft"}`}>
                    {template.active ? "Ativo" : "Inativo"}
                  </td>
                  <td className="px-4 py-3 text-ink-soft">{formatDateTime(template.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
