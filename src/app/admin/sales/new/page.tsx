import type { Metadata } from "next";
import Link from "next/link";
import { NewSaleForm } from "@/components/sales/NewSaleForm";
import { EmptyState, PageHeader } from "@/components/ui/primitives";
import { requireAdminPage } from "@/lib/auth/session";
import { countStockPlates, listAvailableStock, listResellerOptions } from "@/lib/db/operations";

export const metadata: Metadata = { title: "Nova venda" };

export default async function NewSalePage({ searchParams }: { searchParams: Promise<{ reseller?: string }> }) {
  const { supabase } = await requireAdminPage();
  const { reseller } = await searchParams;
  const [allResellers, availableTotal, stock] = await Promise.all([
    listResellerOptions(supabase),
    countStockPlates(supabase),
    listAvailableStock(supabase),
  ]);
  const resellers = allResellers.filter((r) => r.active);

  return (
    <div>
      <PageHeader
        title="Nova venda"
        back={{ href: "/admin/sales", label: "Vendas" }}
        description="Registrar a venda já reserva as placas para o revendedor."
      />
      {resellers.length === 0 ? (
        <EmptyState title="Nenhum revendedor ativo">
          <Link href="/admin/resellers/new" className="link">
            Cadastre um revendedor
          </Link>{" "}
          para registrar vendas.
        </EmptyState>
      ) : availableTotal === 0 ? (
        <EmptyState title="Não há placas disponíveis no estoque">
          Uma venda reserva placas físicas.{" "}
          <Link href="/admin/batches" className="link">
            Gere um lote
          </Link>{" "}
          para ter placas disponíveis.
        </EmptyState>
      ) : (
        <NewSaleForm
          resellers={resellers}
          defaultResellerId={resellers.some((r) => r.id === reseller) ? reseller : undefined}
          availableTotal={availableTotal}
          stock={stock}
        />
      )}
    </div>
  );
}
