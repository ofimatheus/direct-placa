"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { keyInput } from "@/lib/utils/text";

interface Props {
  templateId: string;
  initial: { name: string; internal_key: string; description: string | null; active: boolean };
}

/** Dados de identificação do template. Não afetam a arte, então não criam versão. */
export function TemplateMetaForm({ templateId, initial }: Props) {
  const router = useRouter();
  const [form, setForm] = useState({ ...initial, description: initial.description ?? "" });
  const [state, setState] = useState<{ kind: "idle" | "busy" | "ok" | "error"; message?: string }>({ kind: "idle" });

  async function patch(body: Record<string, unknown>, success: string) {
    setState({ kind: "busy" });
    const response = await fetch(`/api/admin/templates/${templateId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) {
      setState({ kind: "error", message: json.error ?? "Não foi possível salvar." });
      return false;
    }
    setState({ kind: "ok", message: success });
    router.refresh();
    return true;
  }

  return (
    <form
      className="grid gap-4 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        void patch(
          { name: form.name, internal_key: form.internal_key.replace(/-+$/, ""), description: form.description || null },
          "Dados salvos.",
        );
      }}
    >
      <label className="block">
        <span className="field-label">Nome</span>
        <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
      </label>
      <label className="block">
        <span className="field-label">Chave interna</span>
        <input
          className="input"
          value={form.internal_key}
          onChange={(e) => setForm({ ...form, internal_key: keyInput(e.target.value) })}
          required
        />
      </label>
      <label className="block sm:col-span-2">
        <span className="field-label">Descrição</span>
        <input className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
      </label>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <button type="submit" className="btn" disabled={state.kind === "busy"}>
          Salvar dados
        </button>
        <button
          type="button"
          className="btn"
          disabled={state.kind === "busy"}
          onClick={async () => {
            const next = !form.active;
            if (await patch({ active: next }, next ? "Template ativado." : "Template desativado.")) {
              setForm((f) => ({ ...f, active: next }));
            }
          }}
        >
          {form.active ? "Desativar template" : "Ativar template"}
        </button>
        <span className="text-sm text-ink-soft">
          {form.active ? "Disponível para novos lotes." : "Inativo: não aparece na criação de lotes. Lotes antigos não são afetados."}
        </span>
        {state.message && (
          <span role={state.kind === "error" ? "alert" : "status"} className={`text-sm ${state.kind === "error" ? "text-danger" : "text-ok"}`}>
            {state.message}
          </span>
        )}
      </div>
    </form>
  );
}
