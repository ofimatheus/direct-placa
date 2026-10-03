import type { Metadata } from "next";
import Link from "next/link";
import { NewResellerSaleForm } from "@/components/reseller/NewResellerSaleForm";
import { PageTitle } from "@/components/ui/kit";
import { requireResellerContext } from "@/lib/auth/session";
import type { SellablePlateRow } from "@/lib/db/types";
import { compareCustomersByDisplayName } from "@/lib/customers";
import { httpErrorFromDb } from "@/lib/http";

export const metadata: Metadata = { title: "Nova venda" };

export default async function NewResellerSalePage() {
  const { supabase, resellerId } = await requireResellerContext();

  // Elegíveis = suas, ainda recebidas (não ativadas) e fora de outra venda ativa.
  const [platesResult, customersResult] = await Promise.all([
    supabase.rpc("reseller_sellable_plates", { p_search: null, p_limit: 500 }),
    // Só clientes ativos: os que estão em quarentena não entram em novas vendas.
    supabase.from("customers").select("id, name, company_name").eq("reseller_id", resellerId).is("archived_at", null),
  ]);
  if (platesResult.error) throw httpErrorFromDb(platesResult.error);
  if (customersResult.error) throw httpErrorFromDb(customersResult.error);

  return (
    <div className="space-y-6">
      <PageTitle
        title="Nova venda"
        subtitle="Escolha o cliente, as placas e o valor. As placas ficam vinculadas ao cliente; depois é só configurar o destino."
        action={
          <Link href="/reseller/sales" className="btn btn-ghost">
            Voltar
          </Link>
        }
      />
      <NewResellerSaleForm
        plates={(platesResult.data ?? []) as SellablePlateRow[]}
        customers={((customersResult.data ?? []) as { id: string; name: string; company_name: string | null }[]).sort(compareCustomersByDisplayName)}
      />
    </div>
  );
}
