"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

function safeNext(value: FormDataEntryValue | null): string | null {
  const next = typeof value === "string" ? value : "";

  // Só caminhos internos: evita open redirect após o login.
  return next.startsWith("/") && !next.startsWith("//") ? next : null;
}

export async function signIn(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = safeNext(formData.get("next"));

  const supabase = await createClient();

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  console.error("ERRO LOGIN SUPABASE:", error);

  if (error || !data.user) {
    redirect(
      `/login?error=1${next ? `&next=${encodeURIComponent(next)}` : ""}`
    );
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, active")
    .eq("id", data.user.id)
    .maybeSingle();

  if (!profile?.active) {
    await supabase.auth.signOut();
    redirect("/login?error=inactive");
  }

  redirect(
    next ??
      (profile.role === "admin"
        ? "/admin/dashboard"
        : "/reseller/dashboard")
  );
}