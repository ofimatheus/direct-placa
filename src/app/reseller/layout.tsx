import { ResellerShell } from "@/components/reseller/ResellerNav";
import { requireResellerContext } from "@/lib/auth/session";

/** Área do revendedor: só RESELLER ativo com cadastro. A RLS limita tudo às placas e clientes dele. */
export default async function ResellerLayout({ children }: { children: React.ReactNode }) {
  const { companyName } = await requireResellerContext();
  return (
    <div className="theme-reseller">
      <ResellerShell company={companyName}>{children}</ResellerShell>
    </div>
  );
}
