import type { SupabaseClient } from "@supabase/supabase-js";

export interface QrDayPoint {
  /** AAAA-MM-DD no fuso de São Paulo. */
  day: string;
  count: number;
}

/** Teto de leituras agregadas no servidor (o total exibido vem de countQrAccesses e é sempre exato). */
export const QR_SERIES_CAP = 10_000;

const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" });

/**
 * Leituras de QR Code por dia (só source = 'qr'; o NFC não entra nas métricas).
 * Usa o cliente do usuário: a RLS de redirects limita às placas visíveis para
 * ele. Sem migration: lê só created_at e agrega aqui.
 */
export async function qrDailySeries(sb: SupabaseClient, days = 30, now = new Date()): Promise<{ points: QrDayPoint[]; partial: boolean }> {
  const keys: string[] = [];
  for (let i = days - 1; i >= 0; i--) keys.push(dayKey.format(new Date(now.getTime() - i * 86_400_000)));
  const from = new Date(now.getTime() - days * 86_400_000);

  const { data, error } = await sb
    .from("redirects")
    .select("created_at")
    .eq("source", "qr")
    .gte("created_at", from.toISOString())
    .order("created_at", { ascending: false })
    .limit(QR_SERIES_CAP);
  if (error) return { points: keys.map((day) => ({ day, count: 0 })), partial: true };

  const counts = new Map(keys.map((k) => [k, 0]));
  for (const row of (data ?? []) as { created_at: string }[]) {
    const key = dayKey.format(new Date(row.created_at));
    if (counts.has(key)) counts.set(key, counts.get(key)! + 1);
  }
  return { points: keys.map((day) => ({ day, count: counts.get(day) ?? 0 })), partial: (data ?? []).length >= QR_SERIES_CAP };
}
