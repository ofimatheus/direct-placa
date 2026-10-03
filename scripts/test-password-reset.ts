/**
 * Redefinição de senha pelo ADMIN, sem Supabase real: o handler da rota é o
 * mesmo usado em produção; só a camada administrativa (Auth + RPCs) é simulada.
 *   npm run test:password-reset
 */
import { NextResponse } from "next/server";
import type { ApiAuth, Session } from "@/lib/auth/session";
import { createPasswordResetHandler, type PasswordResetDeps } from "@/lib/auth/password-reset";
import { HttpError } from "@/lib/http";
import { generateTemporaryPassword, passwordProblems } from "@/lib/passwords";

const RESELLER = "3f2b6c1e-8d4a-4f7b-9c2e-5a1d7e9b0c34";
const USER = "7a9e2d4c-1b3f-4e8a-a6c5-0d2f8b4e6a17";
const SECRET = "Nova-Senha-Forte-2026";

// Captura TUDO que for logado durante os testes.
const logged: string[] = [];
for (const level of ["log", "info", "warn", "error", "debug"] as const) {
  const original = console[level].bind(console);
  console[level] = (...args: unknown[]) => {
    logged.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
    if (level === "log") original(...args);
  };
}

let failures = 0;
const ok = (label: string) => console.log(`OK ${label}`);
const fail = (label: string, detail?: unknown) => {
  failures++;
  console.log(`FALHA ${label}`, detail ?? "");
};

function fakeDeps(options: { resolve?: () => Promise<string>; setPassword?: () => Promise<void> } = {}) {
  const calls = { resolve: [] as string[], setPassword: [] as [string, string][], record: [] as unknown[][] };
  const deps: PasswordResetDeps = {
    async resolveTarget(id) {
      calls.resolve.push(id);
      return options.resolve ? options.resolve() : USER;
    },
    async setPassword(userId, password) {
      calls.setPassword.push([userId, password]);
      if (options.setPassword) await options.setPassword();
    },
    async recordReset(id, temporary) {
      calls.record.push([id, temporary]);
      return "2026-09-29T12:00:00.000Z";
    },
  };
  return { deps, calls };
}

const admin = async (): Promise<ApiAuth> => ({ ok: true, session: {} as Session });
const reseller = async (): Promise<ApiAuth> => ({ ok: false, response: NextResponse.json({ error: "Acesso restrito ao administrador." }, { status: 403 }) });
const anonymous = async (): Promise<ApiAuth> => ({ ok: false, response: NextResponse.json({ error: "Faça login para continuar." }, { status: 401 }) });

async function call(auth: () => Promise<ApiAuth>, deps: PasswordResetDeps, body: unknown, id = RESELLER) {
  const handler = createPasswordResetHandler(auth, () => deps);
  const response = await handler(new Request(`http://localhost/api/admin/resellers/${id}/password`, { method: "POST", body: JSON.stringify(body) }), {
    params: Promise.resolve({ id }),
  });
  return { status: response.status, text: await response.text() };
}

async function main() {
  // 1. usuário comum / revendedor / sem sessão não chegam a nada
  for (const [label, auth, expected] of [["revendedor", reseller, 403], ["sem sessão", anonymous, 401]] as const) {
    const { deps, calls } = fakeDeps();
    const res = await call(auth, deps, { password: SECRET, confirm: SECRET });
    if (res.status !== expected || calls.resolve.length || calls.setPassword.length || calls.record.length) fail(`W1 ${label}`, res);
    else ok(`W1: ${label} recebe ${expected} e nenhuma camada administrativa é chamada`);
  }

  // 2. senhas inválidas: recusadas ANTES de qualquer chamada
  const invalid: [string, unknown][] = [
    ["curta", { password: "Ab1", confirm: "Ab1" }],
    ["sem número", { password: "SomenteLetrasAqui", confirm: "SomenteLetrasAqui" }],
    ["sem letra", { password: "12345678901234", confirm: "12345678901234" }],
    ["confirmação diferente", { password: SECRET, confirm: SECRET + "x" }],
    ["repetitiva", { password: "aaaaaaaa11", confirm: "aaaaaaaa11" }],
    ["corpo ausente", {}],
  ];
  for (const [label, body] of invalid) {
    const { deps, calls } = fakeDeps();
    const res = await call(admin, deps, body);
    if (res.status !== 400 || calls.resolve.length || calls.setPassword.length) fail(`W2 ${label}`, res);
  }
  ok(`W2: ${invalid.length} senhas inválidas recusadas com 400 antes de tocar no Auth`);

  // 3. o banco recusa (ex.: sessão de ADMIN revogada no meio do caminho)
  {
    const { deps, calls } = fakeDeps({ resolve: () => Promise.reject(new HttpError(403, "Somente ADMIN pode redefinir senhas")) });
    const res = await call(admin, deps, { password: SECRET, confirm: SECRET });
    if (res.status !== 403 || calls.setPassword.length || calls.record.length) fail("W3", res);
    else ok("W3: se o banco não confirma o ADMIN, a senha não é trocada nem registrada");
  }

  // 4. id inválido
  {
    const { deps, calls } = fakeDeps();
    const res = await call(admin, deps, { password: SECRET, confirm: SECRET }, "nao-e-uuid");
    if (res.status !== 400 || calls.resolve.length) fail("W4", res);
    else ok("W4: id de revendedor inválido é recusado");
  }

  // 5. ADMIN válido
  {
    const { deps, calls } = fakeDeps();
    const res = await call(admin, deps, { password: SECRET, confirm: SECRET, temporary: true });
    const recorded = JSON.stringify(calls.record);
    if (res.status !== 200) fail("W5 status", res);
    else if (calls.setPassword.length !== 1 || calls.setPassword[0]![0] !== USER || calls.setPassword[0]![1] !== SECRET) fail("W5 Auth", calls.setPassword);
    else if (recorded !== JSON.stringify([[RESELLER, true]])) fail("W5 auditoria", recorded);
    else if (res.text.includes(SECRET)) fail("W5 resposta devolveu a senha");
    else ok("W5: ADMIN válido redefine: Auth recebe a senha; a auditoria recebe só revendedor e se é temporária");
  }

  // 6. falha no Auth: nada registrado, mensagem sem a senha
  {
    const { deps, calls } = fakeDeps({ setPassword: () => Promise.reject(new HttpError(502, "Não foi possível redefinir a senha agora.")) });
    const res = await call(admin, deps, { password: SECRET, confirm: SECRET });
    if (res.status !== 502 || calls.record.length || res.text.includes(SECRET)) fail("W6", res);
    else ok("W6: se o Auth falha, nenhum evento é registrado e o erro não contém a senha");
  }

  // 7. senha temporária
  const samples = Array.from({ length: 500 }, () => generateTemporaryPassword());
  const bad = samples.filter((p) => passwordProblems(p).length > 0 || p.length !== 16 || /[0O1lI]/.test(p));
  if (bad.length || new Set(samples).size !== samples.length) fail("W7", bad.slice(0, 3));
  else ok("W7: 500 senhas temporárias: todas válidas, com 16 caracteres, sem ambíguos e sem repetição");

  // 8. nada foi logado com a senha
  const leaked = logged.filter((line) => line.includes(SECRET) || samples.some((p) => line.includes(p)));
  if (leaked.length) fail("W8", leaked);
  else ok(`W8: nenhuma das ${logged.length} linhas de log contém a senha`);

  if (failures) {
    console.log(`${failures} falha(s)`);
    process.exit(1);
  }
  console.log("Redefinição de senha OK");
}

void main();
