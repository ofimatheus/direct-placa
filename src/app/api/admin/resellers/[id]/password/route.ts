import { requireAdminApi } from "@/lib/auth/session";
import { createPasswordResetHandler, supabasePasswordResetDeps } from "@/lib/auth/password-reset";

/**
 * ADMIN redefine a senha de um revendedor. Autorização no servidor
 * (requireAdminApi) e de novo no banco; a troca é feita pela API
 * administrativa do Supabase Auth com a service role, que nunca sai do servidor.
 */
export const POST = createPasswordResetHandler(requireAdminApi, (session) => supabasePasswordResetDeps(session.supabase));
