"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Icon, type IconName } from "@/components/ui/icons";
import { BrandLogo } from "./BrandLogo";

export interface NavItem {
  href: string;
  label: string;
  icon: IconName;
}

export interface ShellUser {
  /** Nome exibido (empresa do revendedor ou e-mail do ADMIN). */
  name: string;
  /** Papel exibido abaixo do nome. */
  role: string;
  /** Link do bloco do usuário (conta/configurações). */
  href: string;
}

interface Props {
  home: string;
  nav: NavItem[];
  /** Links secundários acima do "Sair" (ex.: Ajuda / suporte). */
  secondary?: NavItem[];
  user: ShellUser;
  /** "top": bloco do usuário logo abaixo da logo (revendedor); "bottom": no rodapé (ADMIN). */
  userPlacement: "top" | "bottom";
  children: React.ReactNode;
}

export function initialsOf(name: string): string {
  const clean = name.includes("@") ? name.split("@")[0]!.replace(/[._-]+/g, " ") : name;
  const words = clean
    .replace(/\b(ltda|me|eireli|s\/?a|epp)\b\.?/gi, "")
    .split(/\s+/)
    .filter((w) => /\p{L}|\d/u.test(w));
  const letters = words.length >= 2 ? words[0]![0]! + words[1]![0]! : (words[0] ?? "?").slice(0, 2);
  return letters.toUpperCase();
}

function Avatar({ name, size = "size-10" }: { name: string; size?: string }) {
  return (
    <span className={`grid ${size} shrink-0 place-items-center rounded-full bg-[#1d6bff] text-sm font-bold text-white`} aria-hidden>
      {initialsOf(name)}
    </span>
  );
}

function useActive() {
  const pathname = usePathname() ?? "";
  return (href: string) => {
    const base = href.split("#")[0]!;
    return pathname === base || pathname.startsWith(`${base}/`);
  };
}

function UserBlock({ user, onNavigate }: { user: ShellUser; onNavigate?: () => void }) {
  return (
    <Link
      href={user.href}
      onClick={onNavigate}
      className="flex min-w-0 items-center gap-[calc(var(--ds-nav-gap)*0.75)] rounded-2xl bg-white/[0.06] px-[calc(var(--ds-nav-px)*0.75)] py-[calc(var(--ds-nav-h)*0.25)] text-left transition-colors hover:bg-white/[0.1]"
      data-shell-user=""
    >
      <Avatar name={user.name} size="size-[var(--ds-avatar)]" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[length:var(--ds-user-font)] font-semibold text-white" title={user.name}>
          {user.name}
        </span>
        <span className="block text-xs text-white/60">{user.role}</span>
      </span>
      <Icon name="chevron-right" className="size-3.5 shrink-0 text-white/50" />
    </Link>
  );
}

function SidebarBody({ home, nav, secondary = [], user, userPlacement, onNavigate }: Omit<Props, "children"> & { onNavigate?: () => void }) {
  const isActive = useActive();
  const item = (entry: NavItem, primary: boolean) => {
    const active = primary && isActive(entry.href);
    return (
      <Link
        key={entry.href}
        href={entry.href}
        onClick={onNavigate}
        aria-current={active ? "page" : undefined}
        className={`shell-nav-item flex items-center rounded-xl font-medium transition-colors ${
          active
            ? "bg-gradient-to-r from-[#0b63de] to-[#1a74f0] text-white shadow-[0_6px_16px_rgb(11_99_222/0.35)]"
            : "text-white/75 hover:bg-white/[0.07] hover:text-white"
        }`}
      >
        <Icon name={entry.icon} className="shell-nav-icon" />
        <span className="min-w-0">{entry.label}</span>
      </Link>
    );
  };
  return (
    <div className="flex h-full flex-col bg-[var(--color-navy)] text-white">
      <div className="px-[calc(var(--ds-side-px)+0.5rem)] pt-[var(--ds-side-top)] pb-[calc(var(--ds-side-top)*0.85)]">
        <Link href={home} onClick={onNavigate} className="inline-block rounded-md" aria-label="DirectPlaca — início">
          <BrandLogo className="h-[var(--ds-logo-h)] w-auto" />
        </Link>
      </div>
      {userPlacement === "top" && (
        <div className="px-[var(--ds-side-px)] pb-[calc(var(--ds-side-top)*0.7)]">
          <UserBlock user={user} onNavigate={onNavigate} />
        </div>
      )}
      <nav className="flex-1 space-y-1 overflow-y-auto px-[var(--ds-side-px)]" aria-label="Principal">
        {nav.map((entry) => item(entry, true))}
      </nav>
      <div className="mx-[calc(var(--ds-side-px)+0.5rem)] border-t border-[var(--color-navy-line)]" />
      <div className="space-y-1 px-[var(--ds-side-px)] py-[calc(var(--ds-side-top)*0.5)]">
        {secondary.map((entry) => item(entry, false))}
        {userPlacement === "bottom" && (
          <div className="pb-1">
            <UserBlock user={user} onNavigate={onNavigate} />
          </div>
        )}
        <form action="/auth/signout" method="post">
          <button type="submit" className="shell-nav-item flex w-full items-center rounded-xl font-medium text-white/75 transition-colors hover:bg-white/[0.07] hover:text-white">
            <Icon name="logout" className="shell-nav-icon" />
            Sair
          </button>
        </form>
      </div>
    </div>
  );
}

/**
 * Estrutura dos painéis (ADMIN e revendedor): mesma identidade, módulos
 * diferentes. Desktop (≥1024 px): sidebar navy fixa + barra superior.
 * Abaixo disso: barra navy com a logo e gaveta com o mesmo menu.
 */
export function AppShell(props: Props) {
  const { home, user, children } = props;
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const menuButton = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButton.current?.focus();
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    const trigger = menuButton.current;
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener("keydown", onKey);
      trigger?.focus();
    };
  }, [open]);

  return (
    <div className="min-h-screen lg:flex" data-app-shell="">
      <aside className="sticky top-0 hidden h-screen w-[var(--ds-sidebar-w)] shrink-0 lg:block" data-shell-sidebar="">
        <SidebarBody {...props} />
      </aside>

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between bg-[var(--color-navy)] px-4 lg:hidden">
          <Link href={home} aria-label="DirectPlaca — início">
            <BrandLogo className="h-8 w-auto" />
          </Link>
          <button
            ref={menuButton}
            type="button"
            className="grid size-10 place-items-center rounded-lg text-white hover:bg-white/10"
            aria-label="Abrir menu"
            aria-expanded={open}
            aria-controls="shell-drawer"
            onClick={() => setOpen(true)}
          >
            <Icon name="menu" className="size-6" />
          </button>
        </header>

        <header className="hidden h-[var(--ds-topbar-h)] items-center justify-end gap-3 border-b border-line bg-surface px-[var(--ds-page-px)] lg:flex" data-shell-topbar="">
          <Link href={user.href} className="flex items-center gap-3 rounded-full py-1 pr-1 pl-3 hover:bg-paper" title={`${user.name} — ${user.role}`}>
            <span className="max-w-56 truncate text-right text-sm leading-tight">
              <span className="block truncate font-semibold">{user.name}</span>
              <span className="block text-xs text-ink-soft">{user.role}</span>
            </span>
            <span className="grid size-[var(--ds-avatar)] place-items-center rounded-full bg-brand-soft text-sm font-bold text-mat">{initialsOf(user.name)}</span>
          </Link>
        </header>

        <main className="mx-auto w-full max-w-[1440px] px-[var(--ds-page-px)] pt-[var(--ds-page-pt)] pb-[var(--ds-page-pb)]">{children}</main>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu" id="shell-drawer">
          <button type="button" className="absolute inset-0 bg-[#0d1a2a]/55" aria-label="Fechar menu" tabIndex={-1} onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-[288px] max-w-[86vw] shadow-2xl">
            <button
              ref={closeButton}
              type="button"
              className="absolute top-5 right-3 z-10 grid size-9 place-items-center rounded-lg text-white/80 hover:bg-white/10 hover:text-white"
              aria-label="Fechar menu"
              onClick={() => setOpen(false)}
            >
              <Icon name="close" className="size-5" />
            </button>
            <SidebarBody {...props} onNavigate={() => setOpen(false)} />
          </div>
        </div>
      )}
    </div>
  );
}
