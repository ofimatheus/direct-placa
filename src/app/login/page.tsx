import type { Metadata } from "next";
import { LoginScreen } from "@/components/login/LoginScreen";
import { loadLoginBranding } from "@/lib/branding/load";
import { signIn } from "./actions";

export const metadata: Metadata = { title: "Entrar" };

const ERRORS: Record<string, string> = {
  "1": "E-mail ou senha incorretos.",
  inactive: "Este acesso está desativado. Fale com o administrador.",
};

/**
 * Login. A autenticação (server action signIn) é a mesma de antes; só o
 * visual mudou. O branding vem do banco quando disponível e cai no padrão
 * DirectPlaca em qualquer falha — a tela nunca depende dele para funcionar.
 */
export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const error = params.error ? (ERRORS[params.error] ?? null) : null;
  const branding = await loadLoginBranding();
  return <LoginScreen branding={branding} formAction={signIn} error={error} next={params.next} />;
}
