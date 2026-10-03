"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/ui/Modal";

interface Initial {
  company_name: string;
  contact_name: string;
  document: string | null;
  phone: string | null;
  active: boolean;
}

type Props = { mode: "create" } | { mode: "edit"; resellerId: string; initial: Initial; email: string };

export function ResellerForm(props: Props) {
  const router = useRouter();
  const initial = props.mode === "edit" ? props.initial : { company_name: "", contact_name: "", document: "", phone: "", active: true };
  const [form, setForm] = useState({
    company_name: initial.company_name,
    contact_name: initial.contact_name,
    document: initial.document ?? "",
    phone: initial.phone ?? "",
    email: "",
    password: "",
  });
  const [state, setState] = useState<{ busy: boolean; error?: string; ok?: string }>({ busy: false });
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);

  async function request(url: string, method: string, body: unknown) {
    const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    const json = response ? ((await response.json().catch(() => ({}))) as { error?: string; resellerId?: string; details?: { message: string }[] }) : {};
    if (!response?.ok) {
      const details = Array.isArray(json.details) ? json.details.map((d) => d.message).join(" ") : "";
      throw new Error([json.error ?? "Não foi possível salvar.", details].filter(Boolean).join(" "));
    }
    return json;
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setState({ busy: true });
    try {
      const fields = {
        company_name: form.company_name,
        contact_name: form.contact_name,
        document: form.document || null,
        phone: form.phone || null,
      };
      if (props.mode === "create") {
        const json = await request("/api/admin/resellers", "POST", { ...fields, email: form.email, password: form.password });
        router.push(`/admin/resellers/${json.resellerId}`);
        return;
      }
      await request(`/api/admin/resellers/${props.resellerId}`, "PATCH", fields);
      setState({ busy: false, ok: "Dados salvos." });
      router.refresh();
    } catch (error) {
      setState({ busy: false, error: error instanceof Error ? error.message : "Erro ao salvar." });
    }
  }

  function toggleActive() {
    if (props.mode !== "edit") return;
    if (props.initial.active) {
      setConfirmDeactivate(true);
      return;
    }
    void applyActive(true);
  }

  async function applyActive(next: boolean) {
    if (props.mode !== "edit") return;
    setConfirmDeactivate(false);
    setState({ busy: true });
    try {
      await request(`/api/admin/resellers/${props.resellerId}`, "PATCH", { active: next });
      setState({ busy: false, ok: next ? "Revendedor ativado." : "Revendedor desativado." });
      router.refresh();
    } catch (error) {
      setState({ busy: false, error: error instanceof Error ? error.message : "Erro ao salvar." });
    }
  }

  const field = (key: keyof typeof form, label: string, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className="block">
      <span className="field-label">{label}</span>
      <input className="input" value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} {...extra} />
    </label>
  );

  return (
    <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
      {field("company_name", "Empresa", { required: true, maxLength: 120 })}
      {field("contact_name", "Responsável", { required: true, maxLength: 120 })}
      {field("document", "CNPJ/CPF (opcional)", { maxLength: 30 })}
      {field("phone", "Telefone (opcional)", { maxLength: 40 })}
      {props.mode === "create" ? (
        <>
          {field("email", "E-mail de acesso", { type: "email", required: true, autoComplete: "off" })}
          {field("password", "Senha inicial", { type: "password", required: true, minLength: 8, autoComplete: "new-password" })}
          <p className="text-sm text-ink-soft sm:col-span-2">Informe a senha inicial ao revendedor. Ele entra em /login com este e-mail.</p>
        </>
      ) : (
        <p className="text-sm text-ink-soft sm:col-span-2">E-mail de acesso: {props.email}</p>
      )}
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <button type="submit" className="btn btn-primary" disabled={state.busy}>
          {props.mode === "create" ? (state.busy ? "Cadastrando..." : "Cadastrar revendedor") : "Salvar dados"}
        </button>
        {props.mode === "edit" && (
          <button type="button" className="btn" disabled={state.busy} onClick={toggleActive}>
            {props.initial.active ? "Desativar revendedor" : "Ativar revendedor"}
          </button>
        )}
        {state.error && (
          <span role="alert" className="text-sm text-danger">
            {state.error}
          </span>
        )}
        {state.ok && (
          <span role="status" className="text-sm text-ok">
            {state.ok}
          </span>
        )}
      </div>
      <ConfirmDialog
        open={confirmDeactivate}
        title="Desativar revendedor"
        description="Ele perde o acesso ao painel. As placas continuam funcionando."
        confirmLabel="Desativar revendedor"
        tone="danger"
        onCancel={() => setConfirmDeactivate(false)}
        onConfirm={() => applyActive(false)}
      />
    </form>
  );
}
