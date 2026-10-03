import type { Metadata } from "next";
import Link from "next/link";
import { TemplateEditor } from "@/components/templates/TemplateEditor";
import { requireAdminPage } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Novo template" };

export default async function NewTemplatePage() {
  await requireAdminPage();
  return (
    <div>
      <Link href="/admin/templates" className="text-sm font-semibold text-cyan hover:underline">
        Templates
      </Link>
      <h1 className="display mt-2 text-4xl">Novo template</h1>
      <p className="mb-8 mt-1 max-w-2xl text-ink-soft">
        Envie a arte base (PNG ou JPG) e posicione o QR e o código. As dimensões são lidas da própria imagem.
      </p>
      <TemplateEditor mode={{ kind: "create" }} />
    </div>
  );
}
