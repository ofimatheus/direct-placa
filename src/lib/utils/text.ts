/** Nome de arquivo seguro preservando maiúsculas: "Lote Setembro 2026" → "Lote-Setembro-2026". */
export function fileSlug(value: string, fallback = "lote"): string {
  const slug = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || fallback;
}

/** Chave interna do template: "Avaliação Google - Preto" → "avaliacao-google-preto". */
export function keySlug(value: string): string {
  return fileSlug(value, "").toLowerCase().slice(0, 60);
}

/** Sanitização enquanto o usuário digita a chave (mantém o hífen final para permitir continuar digitando). */
export function keyInput(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-/, "")
    .slice(0, 60);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}

const dateTimeFormat = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "America/Sao_Paulo",
});

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  return dateTimeFormat.format(new Date(value));
}

/**
 * Data sem hora. `sold_at` é uma coluna DATE ("2026-09-28"): construir um
 * Date a partir dela cairia em UTC e poderia mostrar o dia anterior no
 * fuso do Brasil, então a formatação é textual.
 */
export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const [date = ""] = value.split("T");
  const [year, month, day] = date.split("-");
  if (!year || !month || !day) return value;
  return `${day}/${month}/${year}`;
}
