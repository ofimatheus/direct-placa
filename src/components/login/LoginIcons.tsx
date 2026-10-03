const base = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

export const MailIcon = (p: { className?: string }) => (
  <svg viewBox="0 0 24 24" aria-hidden className={p.className} {...base}>
    <rect x="3" y="5" width="18" height="14" rx="2.5" />
    <path d="m4 7 8 6 8-6" />
  </svg>
);
export const LockIcon = (p: { className?: string }) => (
  <svg viewBox="0 0 24 24" aria-hidden className={p.className} {...base}>
    <rect x="5" y="10.5" width="14" height="10" rx="2.5" />
    <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
  </svg>
);
export const EyeIcon = (p: { className?: string; off?: boolean }) => (
  <svg viewBox="0 0 24 24" aria-hidden className={p.className} {...base}>
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
    <circle cx="12" cy="12" r="3" />
    {p.off && <path d="m4 4 16 16" />}
  </svg>
);
export const ArrowIcon = (p: { className?: string }) => (
  <svg viewBox="0 0 24 24" aria-hidden className={p.className} {...base} strokeWidth={2}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);
export const ShieldIcon = (p: { className?: string }) => (
  <svg viewBox="0 0 24 24" aria-hidden className={p.className} {...base}>
    <path d="M12 3 5 6v5.5c0 4.4 3 8.2 7 9.5 4-1.3 7-5.1 7-9.5V6z" />
    <path d="m9 12 2 2 4-4" />
  </svg>
);
export const PlateIcon = (p: { className?: string }) => (
  <svg viewBox="0 0 24 24" aria-hidden className={p.className} fill="currentColor">
    <path d="M6.2 6.5A2 2 0 0 1 8.1 5h7.8a2 2 0 0 1 1.9 1.5L19 11h.5A1.5 1.5 0 0 1 21 12.5V17a1 1 0 0 1-1 1h-1v1.5a1 1 0 0 1-1 1h-1a1 1 0 0 1-1-1V18H8v1.5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V18H4a1 1 0 0 1-1-1v-4.5A1.5 1.5 0 0 1 4.5 11H5zM7.1 11h9.8l-.9-3.5H8zM7 13.2a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6m10 0a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6" />
  </svg>
);
export const PeopleIcon = (p: { className?: string }) => (
  <svg viewBox="0 0 24 24" aria-hidden className={p.className} fill="currentColor">
    <circle cx="9" cy="8" r="3.2" />
    <circle cx="16.5" cy="9" r="2.6" />
    <path d="M3 18.2c0-3 2.7-5.2 6-5.2s6 2.2 6 5.2v.8H3zM15.2 19v-.8c0-1.7-.6-3.2-1.6-4.3a6 6 0 0 1 2.9-.7c2.5 0 4.5 1.7 4.5 4v1.8z" />
  </svg>
);
export const ChartIcon = (p: { className?: string }) => (
  <svg viewBox="0 0 24 24" aria-hidden className={p.className} fill="currentColor">
    <rect x="4" y="13" width="4" height="7" rx="1" />
    <rect x="10" y="9" width="4" height="11" rx="1" />
    <rect x="16" y="4" width="4" height="16" rx="1" />
  </svg>
);
