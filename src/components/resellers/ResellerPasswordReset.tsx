"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CopyButton } from "@/components/ui/CopyButton";
import { ConfirmDialog } from "@/components/ui/Modal";
import { generateTemporaryPassword, passwordProblems } from "@/lib/passwords";

interface Props {
  resellerId: string;
  resellerName: string;
  disabled?: boolean;
}

/**
 * Acesso e segurança: o ADMIN define uma nova senha para o revendedor.
 * A senha atual nunca é exibida (o sistema não a conhece). A senha nova só
 * existe neste formulário até ser enviada; a temporária gerada fica visível
 * apenas até o ADMIN concluir, para copiar e repassar.
 */
export function ResellerPasswordReset({ resellerId, resellerName, disabled }: Props) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [visible, setVisible] = useState(false);
  const [generated, setGenerated] = useState<string | null>(null);
  const [dialog, setDialog] = useState(false);
  const [state, setState] = useState<{ busy: boolean; error?: string; done?: "temporary" | "custom" }>({ busy: false });

  const problems = password ? passwordProblems(password) : [];
  const mismatch = confirm.length > 0 && confirm !== password;
  const valid = password.length > 0 && problems.length === 0 && confirm === password;
  const temporary = generated !== null && password === generated;

  function generate() {
    const next = generateTemporaryPassword();
    setGenerated(next);
    setPassword(next);
    setConfirm(next);
    setVisible(true);
    setState({ busy: false });
  }

  async function submit() {
    setState({ busy: true });
    const response = await fetch(`/api/admin/resellers/${resellerId}/password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password, confirm, temporary }),
    }).catch(() => null);
    const body = response ? ((await response.json().catch(() => ({}))) as { error?: string; details?: { message: string }[] }) : {};
    if (!response?.ok) {
      const details = Array.isArray(body.details) ? body.details.map((d) => d.message).join(" ") : "";
      setState({ busy: false, error: [body.error ?? "Falha de conexão. Tente de novo.", details].filter(Boolean).join(" ") });
      return;
    }
    setDialog(false);
    setPassword("");
    setConfirm("");
    setVisible(false);
    if (!temporary) setGenerated(null);
    setState({ busy: false, done: temporary ? "temporary" : "custom" });
    router.refresh();
  }

  if (disabled) return <p className="text-sm text-ink-soft">Ative o revendedor para redefinir a senha de acesso.</p>;

  return (
    <div className="space-y-4">
      {state.done && (
        <div role="status" className="rounded-md border border-ok/30 bg-ok/5 px-4 py-3 text-sm">
          <p className="font-semibold text-ok">Senha redefinida.</p>
          {state.done === "temporary" && generated ? (
            <>
              <p className="mt-1 text-ink-soft">
                Copie a senha temporária agora e envie ao revendedor por um canal seguro. Ela não fica salva no sistema e
                não será exibida de novo.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <code className="rounded-md border border-line bg-surface px-3 py-1.5 font-mono text-base tracking-wide">{generated}</code>
                <CopyButton value={generated} label="Copiar senha" />
                <button
                  type="button"
                  className="btn btn-small"
                  onClick={() => {
                    setGenerated(null);
                    setState({ busy: false });
                  }}
                >
                  Concluir
                </button>
              </div>
            </>
          ) : (
            <p className="mt-1 text-ink-soft">Informe a nova senha ao revendedor por um canal seguro.</p>
          )}
        </div>
      )}

      <form
        className="grid gap-4 sm:grid-cols-2"
        autoComplete="off"
        onSubmit={(event) => {
          event.preventDefault();
          if (valid) {
            setState({ busy: false });
            setDialog(true);
          }
        }}
      >
        <label className="block">
          <span className="field-label">Nova senha</span>
          <input
            className="input font-mono"
            type={visible ? "text" : "password"}
            autoComplete="new-password"
            spellCheck={false}
            maxLength={72}
            value={password}
            aria-invalid={problems.length > 0}
            onChange={(event) => {
              setPassword(event.target.value);
              if (state.done) setState({ busy: false });
            }}
          />
        </label>
        <label className="block">
          <span className="field-label">Confirmar nova senha</span>
          <input
            className="input font-mono"
            type={visible ? "text" : "password"}
            autoComplete="new-password"
            spellCheck={false}
            maxLength={72}
            value={confirm}
            aria-invalid={mismatch}
            onChange={(event) => setConfirm(event.target.value)}
          />
        </label>

        <div className="space-y-1 text-sm sm:col-span-2">
          {problems.map((problem) => (
            <p key={problem} className="text-warn">
              {problem}
            </p>
          ))}
          {mismatch && <p className="text-danger">A confirmação não confere com a nova senha.</p>}
          {!password && (
            <p className="text-ink-soft">
              Mínimo de 10 caracteres, com letras e números. A senha atual não pode ser visualizada: só substituída.
            </p>
          )}
          {generated && password === generated && !state.done && (
            <p className="text-ink-soft">
              Senha temporária gerada. Ela só aparece aqui: copie antes de salvar.{" "}
              <CopyButton value={generated} label="Copiar senha" />
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
          <button type="button" className="btn" onClick={generate} disabled={state.busy}>
            Gerar senha temporária
          </button>
          <button type="button" className="btn btn-small" onClick={() => setVisible((v) => !v)} disabled={!password}>
            {visible ? "Ocultar" : "Mostrar"}
          </button>
          <button type="submit" className="btn btn-primary sm:ml-auto" disabled={!valid || state.busy}>
            Salvar nova senha
          </button>
        </div>
      </form>

      <ConfirmDialog
        open={dialog}
        title={`Redefinir a senha de ${resellerName}`}
        description={
          <>
            A senha atual deixa de valer para novos acessos. O revendedor precisará usar a nova senha no próximo login.
            {temporary && " Como é uma senha temporária, ela fica marcada para troca futura."}
          </>
        }
        confirmLabel="Redefinir senha"
        tone="danger"
        busy={state.busy}
        error={state.error}
        onCancel={() => {
          if (!state.busy) {
            setDialog(false);
            setState({ busy: false });
          }
        }}
        onConfirm={submit}
      />
    </div>
  );
}
