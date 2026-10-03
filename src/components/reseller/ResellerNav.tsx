"use client";

import { AppShell, type NavItem } from "@/components/shell/AppShell";

/** Módulos do revendedor (mesma ordem de antes). */
export const RESELLER_NAV: NavItem[] = [
  { href: "/reseller/dashboard", label: "Dashboard", icon: "home" },
  { href: "/reseller/plates", label: "Minhas placas", icon: "plates" },
  { href: "/reseller/customers", label: "Clientes", icon: "customers" },
  { href: "/reseller/sales", label: "Vendas", icon: "sales" },
  { href: "/reseller/accesses", label: "Acessos", icon: "chart" },
  { href: "/reseller/directlab", label: "DirectLab", icon: "lab" },
  { href: "/reseller/account", label: "Minha conta", icon: "account" },
];

export const RESELLER_SECONDARY: NavItem[] = [{ href: "/reseller/account#ajuda", label: "Ajuda / suporte", icon: "help" }];

export function ResellerShell({ company, children }: { company: string; children: React.ReactNode }) {
  return (
    <AppShell
      home="/reseller/dashboard"
      nav={RESELLER_NAV}
      secondary={RESELLER_SECONDARY}
      user={{ name: company, role: "Revendedor", href: "/reseller/account" }}
      userPlacement="top"
    >
      {children}
    </AppShell>
  );
}
