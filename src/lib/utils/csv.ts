type Cell = string | number | boolean | null | undefined;

/** Neutraliza injeção de fórmulas ao abrir o CSV em Excel/Sheets. */
function neutralize(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function escapeCell(cell: Cell): string {
  if (cell === null || cell === undefined) return "";
  const value = neutralize(String(cell));
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** CSV RFC 4180 com BOM UTF-8 (acentos corretos no Excel). */
export function toCsv(header: string[], rows: Cell[][]): string {
  const lines = [header, ...rows].map((row) => row.map(escapeCell).join(","));
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}
