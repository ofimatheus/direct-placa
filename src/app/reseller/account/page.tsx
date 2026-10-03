import type { Metadata } from "next";
import { Icon } from "@/components/reseller/icons";
import { PageTitle, Panel } from "@/components/ui/kit";
import { requireResellerContext } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Minha conta" };

/** Somente leitura nesta versão: troca de e-mail e senha é feita pelo administrador. */
export default async function ResellerAccountPage() {
  const { supabase, resellerId, companyName, profile } = await requireResellerContext();
  const { data } = await supabase.from("reseller_profiles").select("phone").eq("id", resellerId).maybeSingle<{ phone: string | null }>();

  const rows: [string, string][] = [
    ["Empresa", companyName],
    ["Responsável", profile.name ?? "—"],
    ["E-mail", profile.email],
    ["Telefone", data?.phone ?? "—"],
  ];

  return (
    <div className="max-w-2xl space-y-6">
      <PageTitle title="Minha conta" subtitle="Dados do seu acesso ao painel." />
      <Panel title="Minha conta">
        <dl className="divide-y divide-line border-t border-line">
          {rows.map(([label, value]) => (
            <div key={label} className="grid gap-1 px-5 py-4 sm:grid-cols-[140px_minmax(0,1fr)]">
              <dt className="text-sm text-ink-soft">{label}</dt>
              <dd className="font-semibold break-words">{value}</dd>
            </div>
          ))}
        </dl>
        <div className="border-t border-line px-5 py-4">
          <form action="/auth/signout" method="post">
            <button className="btn">
              <Icon name="logout" /> Sair
            </button>
          </form>
        </div>
      </Panel>
      <section id="ajuda" className="card scroll-mt-24 p-5">
        <h2 className="flex items-center gap-2 text-base font-bold">
          <Icon name="help" className="size-[18px] text-ink-soft" /> Ajuda / suporte
        </h2>
        <p className="mt-2 text-sm text-ink-soft">
          Para alterar e-mail, senha ou dados da empresa, ou para receber mais placas, fale com o administrador da plataforma que criou
          seu acesso.
        </p>
      </section>
    </div>
  );
}
