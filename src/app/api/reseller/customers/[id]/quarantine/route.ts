import { quarantineBodySchema, quarantineCustomerResponse } from "@/lib/customer-quarantine";
import { errorResponse, readJson } from "@/lib/http";

/** Move o cliente para a Quarentena (sai das listas e das novas vendas; histórico intacto). */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  let reason: string | null = null;
  try {
    reason = quarantineBodySchema.parse(await readJson(request)).reason || null;
  } catch (error) {
    return errorResponse(error);
  }
  return quarantineCustomerResponse(context, reason);
}
