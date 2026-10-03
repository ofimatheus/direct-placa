import type { BatchLifecycleStatus } from "@/lib/db/types";

const LABELS: Record<BatchLifecycleStatus, { text: string; className: string }> = {
  active: { text: "Ativo", className: "bg-emerald-50 text-emerald-700 ring-emerald-600/20" },
  quarantine: { text: "Quarentena", className: "bg-amber-50 text-amber-800 ring-amber-600/20" },
  archived: { text: "Arquivado", className: "bg-slate-100 text-slate-600 ring-slate-500/20" },
};

export function BatchLifecycleBadge({ status }: { status: BatchLifecycleStatus }) {
  const { text, className } = LABELS[status];
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${className}`}>
      {text}
    </span>
  );
}
