import { z } from "zod";

/**
 * Política de senha definida pelo ADMIN para um revendedor. Compartilhada
 * entre o formulário (feedback imediato) e a API (validação que vale).
 * O Supabase Auth pode ter regras próprias adicionais configuradas no painel.
 */
export const PASSWORD_MIN_LENGTH = 10;
/** Limite do bcrypt usado pelo Supabase Auth. */
export const PASSWORD_MAX_LENGTH = 72;

export function passwordProblems(password: string): string[] {
  const problems: string[] = [];
  if (password.length < PASSWORD_MIN_LENGTH) problems.push(`Use pelo menos ${PASSWORD_MIN_LENGTH} caracteres.`);
  if (password.length > PASSWORD_MAX_LENGTH) problems.push(`Use no máximo ${PASSWORD_MAX_LENGTH} caracteres.`);
  if (!/[A-Za-zÀ-ÿ]/.test(password)) problems.push("Inclua ao menos uma letra.");
  if (!/\d/.test(password)) problems.push("Inclua ao menos um número.");
  if (password !== password.trim()) problems.push("Não comece nem termine com espaço.");
  if (password.length >= PASSWORD_MIN_LENGTH && new Set(password).size < 5) problems.push("Evite repetir poucos caracteres.");
  return problems;
}

/** Corpo aceito pela API. Nunca é logado nem persistido. */
export const passwordResetBodySchema = z
  .object({
    password: z.string().max(200),
    confirm: z.string().max(200),
    /** true quando é a senha temporária gerada pelo sistema (prepara "trocar no primeiro acesso"). */
    temporary: z.boolean().default(false),
  })
  .superRefine((body, ctx) => {
    for (const message of passwordProblems(body.password)) ctx.addIssue({ code: "custom", path: ["password"], message });
    if (body.password !== body.confirm) ctx.addIssue({ code: "custom", path: ["confirm"], message: "A confirmação não confere com a nova senha." });
  });

const UPPER = "ABCDEFGHJKMNPQRSTUVWXYZ";
const LOWER = "abcdefghijkmnpqrstuvwxyz";
const DIGITS = "23456789";
const SYMBOLS = "!@#$%*-_+?";
const ALL = UPPER + LOWER + DIGITS + SYMBOLS;

/** Índice uniforme em [0, max) com rejeição (sem viés de módulo), via Web Crypto. */
function randomIndex(max: number): number {
  const limit = Math.floor(0x1_0000_0000 / max) * max;
  const buffer = new Uint32Array(1);
  for (;;) {
    globalThis.crypto.getRandomValues(buffer);
    if (buffer[0]! < limit) return buffer[0]! % max;
  }
}

/**
 * Senha temporária forte: 16 caracteres sem ambíguos (0/O, 1/l/I), com pelo
 * menos uma maiúscula, minúscula, número e símbolo. Gerada no navegador do
 * ADMIN, exibida só naquele momento e nunca guardada pelo sistema.
 */
export function generateTemporaryPassword(length = 16): string {
  const size = Math.max(12, Math.min(length, PASSWORD_MAX_LENGTH));
  const chars = [UPPER, LOWER, DIGITS, SYMBOLS].map((set) => set[randomIndex(set.length)]!);
  while (chars.length < size) chars.push(ALL[randomIndex(ALL.length)]!);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomIndex(i + 1);
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }
  const password = chars.join("");
  // Garantia defensiva: nunca devolve algo que a própria política recusaria.
  return passwordProblems(password).length === 0 ? password : generateTemporaryPassword(length);
}
