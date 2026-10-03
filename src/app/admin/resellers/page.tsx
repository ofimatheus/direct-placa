import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, PageHeader, Tone } from "@/components/ui/primitives";
import { requireAdminPage } from "@/lib/auth/session";
import { getResellerStats, paidSalesByReseller } from "@/lib/db/operations";
import { formatBRL, formatInt } from "@/lib/utils/money";

export const metadata: Metadata = { title: "Revendedores" };

export default async function ResellersPage() {
  const { supabase } = await requireAdminPage();
  const [resellers, sales] = await Promise.all([getResellerStats(supabase), paidSalesByReseller(supabase)]);

  return (
    <div>
      <PageHeader
        title="Revendedores"
        actions={
          <Link href="/admin/resellers/new" className="btn btn-primary">
            Novo revendedor
          </Link>
        }
      />
      {resellers.length === 0 ? (
        <EmptyState title="Nenhum revendedor cadastrado">Cadastre o primeiro para atribuir placas e registrar vendas.</EmptyState>
      ) : (
        <div className="card overflow-x-auto">
          <table className="data-table min-w-[780px]">
            <thead>
              <tr>
                <th>Nome / Empresa</th>
                <th className="text-right">Placas</th>
                <th className="text-right">Disponíveis</th>
                <th className="text-right">Ativas</th>
                <th className="text-right">Clientes</th>
                <th className="text-right">Faturamento</th>
                <th>Situação</th>
              </tr>
            </thead>
            <tbody>
              {resellers.map((r) => (
                <tr key={r.reseller_id}>
                  <td>
                    <Link href={`/admin/resellers/${r.reseller_id}`} className="font-semibold hover:text-cyan hover:underline">
                      {r.company_name}
                    </Link>
                    <p className="text-xs text-ink-soft">{r.contact_name ?? r.email}</p>
                  </td>
                  <td className="text-right">{formatInt(r.plates_total)}</td>
                  <td className="text-right">{formatInt(r.plates_available)}</td>
                  <td className="text-right">{formatInt(r.plates_active)}</td>
                  <td className="text-right">{formatInt(r.customers)}</td>
                  <td className="text-right font-semibold">{formatBRL(sales.get(r.reseller_id)?.revenue ?? 0)}</td>
                  <td>
                    <Tone tone={r.active ? "text-ok" : "text-ink-soft"}>{r.active ? "Ativo" : "Inativo"}</Tone>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-3 text-xs text-ink-soft">Faturamento considera apenas vendas marcadas como pagas.</p>
    </div>
  );
}
