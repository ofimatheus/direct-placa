"use client";

import { AppShell, type NavItem } from "@/components/shell/AppShell";

/** Módulos do ADMIN (mesma ordem de antes, agora com ícones). */
export const ADMIN_NAV: NavItem[] = [
  { href: "/admin/dashboard", label: "Dashboard", icon: "home" },
  { href: "/admin/sales", label: "Vendas", icon: "sales" },
  { href: "/admin/plates", label: "Placas", icon: "plate" },
  { href: "/admin/batches", label: "Lotes", icon: "layers" },
  { href: "/admin/templates", label: "Templates", icon: "template" },
  { href: "/admin/resellers", label: "Revendedores", icon: "store" },
  { href: "/admin/customers", label: "Clientes", icon: "customers" },
  { href: "/admin/accesses", label: "Acessos", icon: "chart" },
  { href: "/admin/directlab", label: "DirectLab", icon: "lab" },
  { href: "/admin/landing", label: "Landing Page", icon: "globe" },
  { href: "/admin/settings", label: "Configurações", icon: "settings" },
];

export function AdminShell({ email, children }: { email: string; children: React.ReactNode }) {
  return (
    <AppShell home="/admin/dashboard" nav={ADMIN_NAV} user={{ name: email, role: "Administrador", href: "/admin/settings" }} userPlacement="bottom">
      {children}
    </AppShell>
  );
}
