import type { DirectLinkItemType } from "@/lib/directlink/items";

/** Ícones de traço simples por tipo (desenhos genéricos, sem logos de marcas). */
const PATHS: Record<DirectLinkItemType, React.ReactNode> = {
  instagram: (
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.2" cy="6.8" r="0.6" fill="currentColor" />
    </>
  ),
  whatsapp: <path d="M4 20l1.3-3.9A8.5 8.5 0 1 1 8 19zM9 8.5c.3 2.6 2.9 5.3 5.6 5.8l1.2-1.3 2 1-.4 1.6c-3.9.6-9.4-4.9-8.8-8.8L10.2 6.4l1 2-1.2 1.2" />,
  pix: (
    <>
      <path d="M12 3.2 20.8 12 12 20.8 3.2 12z" />
      <path d="M8.5 12h7M12 8.5v7" />
    </>
  ),
  youtube: (
    <>
      <rect x="3" y="6" width="18" height="12" rx="3.5" />
      <path d="m10.5 9.5 4 2.5-4 2.5z" fill="currentColor" />
    </>
  ),
  facebook: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M13.2 20.4V13h2.3l.4-2.6h-2.7V8.9c0-.8.3-1.3 1.4-1.3h1.4V5.4" />
    </>
  ),
  site: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5c2.4 2.4 3.5 5.2 3.5 8.5S14.4 18.1 12 20.5M12 3.5C9.6 5.9 8.5 8.7 8.5 12s1.1 6.1 3.5 8.5" />
    </>
  ),
  menu: <path d="M7 3v8a2 2 0 0 0 2 2v8M5 3v5M9 3v5M16.5 21V3c-2 1-3 3.5-3 7s1 3.5 3 3.5" />,
  maps: (
    <>
      <path d="M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0 1 13 0c0 4.8-6.5 11-6.5 11z" />
      <circle cx="12" cy="10" r="2.3" />
    </>
  ),
  phone: <path d="M6.6 3.5 9.2 4l1.3 3.6-1.9 1.3a11 11 0 0 0 6.5 6.5l1.3-1.9 3.6 1.3.5 2.6a2 2 0 0 1-2.1 2.1A16.5 16.5 0 0 1 4.5 5.6a2 2 0 0 1 2.1-2.1z" />,
  email: (
    <>
      <rect x="3" y="5.5" width="18" height="13" rx="2.5" />
      <path d="m4 7.5 8 6 8-6" />
    </>
  ),
  link: <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 11 18.7l1-1" />,
};

export function ItemIcon({ type, className = "size-5" }: { type: DirectLinkItemType; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      {PATHS[type]}
    </svg>
  );
}
