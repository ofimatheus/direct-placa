import type { Metadata } from "next";
import { CustomerManager } from "@/components/reseller/CustomerManager";
import { requireResellerContext } from "@/lib/auth/session";
import { listCustomers } from "@/lib/db/operations";
import { CUSTOMER_TABS, compareCustomersByDisplayName, type CustomerTab } from "@/lib/customers";

export const metadata: Metadata = { title: "Clientes" };

export default async function ResellerCustomersPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { supabase, resellerId } = await requireResellerContext();
  const { status } = await searchParams;
  const tab: CustomerTab = CUSTOMER_TABS.some((t) => t.key === status) ? (status as CustomerTab) : "active";
  const { rows } = await listCustomers(supabase, { page: 1, resellerId, pageSize: 500 });
  return <CustomerManager customers={[...rows].sort(compareCustomersByDisplayName)} tab={tab} />;
}
