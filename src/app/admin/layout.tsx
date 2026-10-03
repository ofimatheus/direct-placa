import { AdminShell } from "@/components/admin/AdminNav";
import { requireAdminPage } from "@/lib/auth/session";

/**
 * Toda a árvore /admin passa por aqui: sem sessão → /login, sem papel ADMIN → /forbidden.
 * As rotas de API e a RLS fazem a mesma checagem por conta própria.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { profile } = await requireAdminPage();
  return <AdminShell email={profile.email}>{children}</AdminShell>;
}
