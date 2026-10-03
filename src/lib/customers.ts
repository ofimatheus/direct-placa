import { z } from "zod";

const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v ? v : null));

export const customerSchema = z.object({
  name: z.string().trim().min(1, "Informe o nome do cliente").max(120),
  company_name: optional(120),
  phone: optional(40),
  email: z
    .string()
    .trim()
    .max(160)
    .nullable()
    .optional()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || z.string().email().safeParse(v).success, "E-mail inválido"),
  notes: optional(1000),
});

export type CustomerInput = z.infer<typeof customerSchema>;

/**
 * Nome de exibição do cliente — regra ÚNICA do sistema (espelhada em SQL por
 * public.customer_display_name): empresa/comércio preenchida é o nome
 * principal; sem empresa, usa o nome da pessoa. Só apresentação: o cadastro
 * continua com os dois campos separados.
 */
export interface CustomerNameFields {
  name: string;
  company_name?: string | null;
}

export function getCustomerDisplayName(customer: CustomerNameFields): string {
  const company = customer.company_name?.trim();
  if (company) return company;
  return customer.name?.trim() || customer.name;
}

/** Linha secundária (responsável), só quando a empresa é o nome principal e há uma pessoa diferente. */
export function getCustomerSecondaryName(customer: CustomerNameFields): string | null {
  const company = customer.company_name?.trim();
  const name = customer.name?.trim();
  return company && name && name.toLocaleLowerCase("pt-BR") !== company.toLocaleLowerCase("pt-BR") ? name : null;
}

const fold = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .trim();

/** Busca por pessoa OU empresa, sem diferenciar maiúsculas e acentos. */
export function customerMatchesSearch(customer: CustomerNameFields, term: string): boolean {
  const needle = fold(term);
  if (!needle) return true;
  return fold(customer.name ?? "").includes(needle) || fold(customer.company_name ?? "").includes(needle);
}

export function compareCustomersByDisplayName(a: CustomerNameFields, b: CustomerNameFields): number {
  return getCustomerDisplayName(a).localeCompare(getCustomerDisplayName(b), "pt-BR", { sensitivity: "base" });
}

/** Rótulo para seletores: nome principal + responsável quando couber. */
export function getCustomerOptionLabel(customer: CustomerNameFields & { archived_at?: string | null }): string {
  const secondary = getCustomerSecondaryName(customer);
  const base = secondary ? `${getCustomerDisplayName(customer)} (${secondary})` : getCustomerDisplayName(customer);
  return customer.archived_at ? `${base} — em quarentena` : base;
}

/** Abas da tela Clientes (a quarentena substitui a exclusão física). */
export type CustomerTab = "active" | "quarantine" | "all";
export const CUSTOMER_TABS: { key: CustomerTab; label: string }[] = [
  { key: "active", label: "Ativos" },
  { key: "quarantine", label: "Quarentena" },
  { key: "all", label: "Todos" },
];
