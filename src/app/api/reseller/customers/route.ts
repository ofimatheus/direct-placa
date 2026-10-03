import { NextResponse } from "next/server";
import { requireResellerApi } from "@/lib/auth/session";
import { customerSchema } from "@/lib/customers";
import { errorResponse, httpErrorFromDb, readJson } from "@/lib/http";

/** Cria cliente do revendedor logado. reseller_id vem da sessão; a RLS impede qualquer outro valor. */
export async function POST(request: Request) {
  const auth = await requireResellerApi();
  if (!auth.ok) return auth.response;
  try {
    const body = customerSchema.parse(await readJson(request));
    const { data, error } = await auth.session.supabase
      .from("customers")
      .insert({ ...body, reseller_id: auth.resellerId })
      .select("id, name, company_name, phone, email, notes, created_at")
      .single();
    if (error) throw httpErrorFromDb(error);
    return NextResponse.json({ customer: data }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
