import "server-only";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import type { ProfileRow } from "@/lib/db/types";

export interface Session {
  supabase: SupabaseClient;
  user: User;
  profile: ProfileRow;
}

/** Sessão atual validada no servidor (getUser consulta o Supabase Auth, não só o cookie). */
export async function getSession(): Promise<Session | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, name, email, role, active, created_at, updated_at")
    .eq("id", user.id)
    .maybeSingle<ProfileRow>();

  if (!profile || !profile.active) return null;
  return { supabase, user, profile };
}

export function homePathFor(profile: ProfileRow): string {
  return profile.role === "admin" ? "/admin/dashboard" : "/reseller/dashboard";
}

/** Para páginas: sem sessão → /login; sem papel ADMIN → /forbidden. */
export async function requireAdminPage(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.profile.role !== "admin") redirect("/forbidden");
  return session;
}

export async function requireResellerPage(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.profile.role !== "reseller") redirect(homePathFor(session.profile));
  return session;
}

export type ApiAuth = { ok: true; session: Session } | { ok: false; response: NextResponse };

/** Para Route Handlers: 401 sem sessão, 403 para quem não é ADMIN. */
export async function requireAdminApi(): Promise<ApiAuth> {
  const session = await getSession();
  if (!session) {
    return { ok: false, response: NextResponse.json({ error: "Faça login para continuar." }, { status: 401 }) };
  }
  if (session.profile.role !== "admin") {
    return {
      ok: false,
      response: NextResponse.json({ error: "Acesso restrito ao administrador." }, { status: 403 }),
    };
  }
  return { ok: true, session };
}

export type ResellerApiAuth =
  | { ok: true; session: Session; resellerId: string }
  | { ok: false; response: NextResponse };

/** Para Route Handlers do revendedor: 401 sem sessão, 403 se não for RESELLER ativo com cadastro. */
export async function requireResellerApi(): Promise<ResellerApiAuth> {
  const session = await getSession();
  if (!session) {
    return { ok: false, response: NextResponse.json({ error: "Faça login para continuar." }, { status: 401 }) };
  }
  if (session.profile.role !== "reseller") {
    return { ok: false, response: NextResponse.json({ error: "Acesso restrito a revendedores." }, { status: 403 }) };
  }
  const { data } = await session.supabase
    .from("reseller_profiles")
    .select("id")
    .eq("user_id", session.user.id)
    .maybeSingle<{ id: string }>();
  if (!data) {
    return { ok: false, response: NextResponse.json({ error: "Cadastro de revendedor não encontrado." }, { status: 403 }) };
  }
  return { ok: true, session, resellerId: data.id };
}

export type DirectLabApiAuth =
  | { ok: true; session: Session; role: "admin"; resellerId: null }
  | { ok: true; session: Session; role: "reseller"; resellerId: string }
  | { ok: false; response: NextResponse };

/**
 * DirectLab: ADMIN ou RESELLER ativo com cadastro. 401 sem sessão (inclui
 * usuário desativado), 403 para qualquer outro caso.
 */
export async function requireDirectLabApi(): Promise<DirectLabApiAuth> {
  const session = await getSession();
  if (!session) {
    return { ok: false, response: NextResponse.json({ error: "Faça login para continuar." }, { status: 401 }) };
  }
  if (session.profile.role === "admin") return { ok: true, session, role: "admin", resellerId: null };
  const reseller = await requireResellerApi();
  if (!reseller.ok) return reseller;
  return { ok: true, session: reseller.session, role: "reseller", resellerId: reseller.resellerId };
}

/** Para páginas do revendedor que precisam do id do cadastro. */
export async function requireResellerContext(): Promise<Session & { resellerId: string; companyName: string }> {
  const session = await requireResellerPage();
  const { data } = await session.supabase
    .from("reseller_profiles")
    .select("id, company_name")
    .eq("user_id", session.user.id)
    .maybeSingle<{ id: string; company_name: string }>();
  if (!data) redirect("/forbidden");
  return { ...session, resellerId: data.id, companyName: data.company_name };
}
