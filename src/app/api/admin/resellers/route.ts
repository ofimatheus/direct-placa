import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminApi } from "@/lib/auth/session";
import { HttpError, errorResponse, readJson } from "@/lib/http";
import { createAdminClient } from "@/lib/supabase/admin";

const resellerFields = {
  company_name: z.string().trim().min(1, "Informe a empresa").max(120),
  contact_name: z.string().trim().min(1, "Informe o nome do responsável").max(120),
  document: z.string().trim().max(30).nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
};

const createSchema = z.object({
  ...resellerFields,
  email: z.string().trim().toLowerCase().email("E-mail inválido"),
  password: z.string().min(8, "A senha precisa de pelo menos 8 caracteres").max(72),
});

/**
 * Cadastra um revendedor: cria o usuário no Supabase Auth (já confirmado),
 * garante o profile como RESELLER e cria o reseller_profile. Se qualquer passo
 * depois do Auth falhar, o usuário criado é removido (sem cadastro pela metade).
 */
export async function POST(request: Request) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;
  try {
    const body = createSchema.parse(await readJson(request));
    const admin = createAdminClient();

    const { data: created, error: authError } = await admin.auth.admin.createUser({
      email: body.email,
      password: body.password,
      email_confirm: true,
      user_metadata: { name: body.contact_name },
    });
    if (authError || !created.user) {
      const exists = /already|registered|exists/i.test(authError?.message ?? "");
      throw new HttpError(exists ? 409 : 400, exists ? "Já existe um usuário com este e-mail." : `Não foi possível criar o acesso: ${authError?.message}`);
    }
    const userId = created.user.id;

    try {
      const { error: profileError } = await admin
        .from("profiles")
        .upsert({ id: userId, email: body.email, name: body.contact_name, role: "reseller", active: true });
      if (profileError) throw new Error(profileError.message);

      const { data: reseller, error: resellerError } = await admin
        .from("reseller_profiles")
        .insert({ user_id: userId, company_name: body.company_name, document: body.document || null, phone: body.phone || null })
        .select("id")
        .single<{ id: string }>();
      if (resellerError || !reseller) throw new Error(resellerError?.message ?? "Falha ao criar o revendedor.");

      return NextResponse.json({ resellerId: reseller.id }, { status: 201 });
    } catch (error) {
      await admin.auth.admin.deleteUser(userId);
      throw error;
    }
  } catch (error) {
    return errorResponse(error);
  }
}
