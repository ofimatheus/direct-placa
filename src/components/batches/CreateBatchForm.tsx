"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface TemplateOption {
  id: string;
  name: string;
  versionNumber: number;
}

/**
 * A idempotency_key nasce com o formulário. Clique duplo ou reenvio após
 * falha de rede mandam a MESMA chave, e o banco devolve o mesmo lote.
 * Só quando o servidor recusa o pedido (4xx) uma chave nova é gerada.
 */
export function CreateBatchForm({ templates }: { templates: TemplateOption[] }) {
  const router = useRouter();
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [form, setForm] = useState({ name: "", quantity: "100", templateId: templates[0]?.id ?? "", description: "" });
  const [state, setState] = useState<{ busy: boolean; error?: string }>({ busy: false });

  const quantity = Number.parseInt(form.quantity, 10);
  const quantityValid = Number.isInteger(quantity) && quantity >= 1 && quantity <= 1000;
  const selected = templates.find((t) => t.id === form.templateId);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (state.busy || !quantityValid) return;
    setState({ busy: true });
    try {
      const response = await fetch("/api/admin/batches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          description: form.description || null,
          quantity,
          template_id: form.templateId,
          idempotency_key: idempotencyKey,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as { batchId?: string; error?: string };
      if (!response.ok || !body.batchId) {
        if (response.status >= 400 && response.status < 500) setIdempotencyKey(crypto.randomUUID());
        setState({ busy: false, error: body.error ?? "Não foi possível criar o lote." });
        return;
      }
      router.push(`/admin/batches/${body.batchId}`);
    } catch {
      // Falha de rede: mantém a chave para que um novo clique não duplique o lote.
      setState({ busy: false, error: "Falha de conexão. Tente de novo: o lote não será duplicado." });
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-4 md:grid-cols-[2fr_1fr_2fr_auto] md:items-end">
      <label className="block">
        <span className="field-label">Nome do lote</span>
        <input
          className="input"
          value={form.name}
          placeholder="Lote Setembro 2026"
          required
          maxLength={120}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
      </label>
      <label className="block">
        <span className="field-label">Quantidade</span>
        <input
          className="input"
          type="number"
          min={1}
          max={1000}
          required
          value={form.quantity}
          onChange={(e) => setForm({ ...form, quantity: e.target.value })}
          aria-invalid={!quantityValid}
        />
      </label>
      <label className="block">
        <span className="field-label">Template</span>
        <select className="input" value={form.templateId} onChange={(e) => setForm({ ...form, templateId: e.target.value })}>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} v{t.versionNumber}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" className="btn btn-primary" disabled={state.busy || !quantityValid || !form.name.trim()}>
        {state.busy ? "Gerando placas..." : "Gerar lote"}
      </button>
      <label className="block md:col-span-3">
        <span className="field-label">Descrição (opcional)</span>
        <input className="input" value={form.description} maxLength={1000} onChange={(e) => setForm({ ...form, description: e.target.value })} />
      </label>
      <div className="text-sm md:col-span-4">
        {!quantityValid && <p className="text-danger">A quantidade deve estar entre 1 e 1000.</p>}
        {state.error && (
          <p role="alert" className="text-danger">
            {state.error}
          </p>
        )}
        {selected && quantityValid && !state.error && (
          <p className="text-ink-soft">
            Serão criadas {quantity} placas com códigos exclusivos. A versão v{selected.versionNumber} de {selected.name} ficará
            travada neste lote.
          </p>
        )}
      </div>
    </form>
  );
}
