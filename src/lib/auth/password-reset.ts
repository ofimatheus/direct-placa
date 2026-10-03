import "server-only";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { ApiAuth, Session } from "@/lib/auth/session";
import { HttpError, errorResponse, httpErrorFromDb, readJson } from "@/lib/http";
import { passwordResetBodySchema } from "@/lib/passwords";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Redefinição da senha de um revendedor pelo ADMIN.
 *
 * Ordem e responsabilidades (cada passo revalida por conta própria):
 *   1. a rota exige sessão ADMIN (requireAdminApi) → 401/403
 *   2. valida a senha (política + confirmação), antes de qualquer chamada
 *   3. admin_reseller_auth_user: o BANCO revalida is_admin() e devolve o
 *      usuário de Auth do revendedor (só revendedores)
 *   4. Supabase Auth, API administrativa (service role, só no servidor),
 *      troca a senha — o único lugar por onde a senha passa
 *   5. admin_record_password_reset: grava "Senha redefinida pelo
 *      administrador" (sem a senha) e prepara must_change_password
 *
 * A senha nunca é persistida, retornada nem logada.
 */
export interface PasswordResetDeps {
  resolveTarget(resellerId: string): Promise<string>;
  setPassword(userId: string, password: string): Promise<void>;
  recordReset(resellerId: string, temporary: boolean): Promise<string>;
}

export async function resetResellerPassword(deps: PasswordResetDeps, resellerId: string, rawBody: unknown): Promise<{ changedAt: string }> {
  const body = passwordResetBodySchema.parse(rawBody);
  const userId = await deps.resolveTarget(resellerId);
  await deps.setPassword(userId, body.password);
  const changedAt = await deps.recordReset(resellerId, body.temporary);
  return { changedAt };
}

export function supabasePasswordResetDeps(userClient: SupabaseClient): PasswordResetDeps {
  return {
    async resolveTarget(resellerId) {
      const { data, error } = await userClient.rpc("admin_reseller_auth_user", { p_reseller_id: resellerId });
      if (error) throw httpErrorFromDb(error, "Não foi possível validar o revendedor.");
      return data as string;
    },
    async setPassword(userId, password) {
      let failure: { status?: number; code?: string; message?: string } | null = null;
      try {
        const { error } = await createAdminClient().auth.admin.updateUserById(userId, { password });
        failure = error ? { status: error.status, code: error.code, message: error.message } : null;
      } catch {
        failure = { status: 502 };
      }
      if (!failure) return;
      // Loga só metadados do erro — nunca o corpo da requisição.
      console.error("Falha ao redefinir senha no Supabase Auth", { status: failure.status, code: failure.code });
      if (failure.code === "weak_password" || failure.status === 422) {
        throw new HttpError(422, `O servidor de autenticação recusou a nova senha${failure.message ? `: ${failure.message}` : "."}`);
      }
      throw new HttpError(502, "Não foi possível redefinir a senha agora. Tente de novo em instantes.");
    },
    async recordReset(resellerId, temporary) {
      const { data, error } = await userClient.rpc("admin_record_password_reset", { p_reseller_id: resellerId, p_temporary: temporary });
      if (error) {
        // A senha JÁ foi trocada: o erro precisa dizer isso com clareza.
        throw new HttpError(500, "A senha foi redefinida, mas o registro de auditoria falhou. Avise o suporte técnico.");
      }
      return data as string;
    },
  };
}

type RouteContext = { params: Promise<{ id: string }> };

/** Fábrica do handler (a rota só conecta as dependências reais; os testes usam dependências simuladas). */
export function createPasswordResetHandler(getAuth: () => Promise<ApiAuth>, makeDeps: (session: Session) => PasswordResetDeps) {
  return async function POST(request: Request, { params }: RouteContext): Promise<Response> {
    const auth = await getAuth();
    if (!auth.ok) return auth.response;
    try {
      const { id } = await params;
      z.string().uuid().parse(id);
      const result = await resetResellerPassword(makeDeps(auth.session), id, await readJson(request));
      return NextResponse.json({ ok: true, changed_at: result.changedAt }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      return errorResponse(error);
    }
  };
}
