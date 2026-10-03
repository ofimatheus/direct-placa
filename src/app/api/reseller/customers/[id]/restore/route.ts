import { restoreCustomerResponse } from "@/lib/customer-quarantine";

/** Restaura o cliente da Quarentena (volta às listas e às novas vendas). */
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  return restoreCustomerResponse(context);
}
