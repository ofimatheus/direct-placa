import { NextResponse } from "next/server";
import { getServerEnv, limits } from "@/lib/env.server";
import { findRunnableExports, runExportJob } from "@/lib/exports/worker";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 60;

/**
 * Varredura da fila de exportações (opcional). Conclui jobs mesmo que ninguém
 * esteja com a tela do lote aberta. Protegida por CRON_SECRET:
 *   Authorization: Bearer <CRON_SECRET>
 * A Vercel Cron envia esse cabeçalho automaticamente quando CRON_SECRET existe.
 */
export async function GET(request: Request) {
  const { cronSecret } = getServerEnv();
  if (!cronSecret) {
    return NextResponse.json({ error: "Defina CRON_SECRET para habilitar esta rota." }, { status: 503 });
  }
  if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  try {
    const startedAt = Date.now();
    const ids = await findRunnableExports(createAdminClient(), 5);
    const results: Record<string, string> = {};
    for (const id of ids) {
      const remaining = limits.exportTimeBudgetMs - (Date.now() - startedAt);
      if (remaining < 5_000) break;
      results[id] = await runExportJob(id, remaining);
    }
    return NextResponse.json({ processed: results });
  } catch (error) {
    console.error("[cron exports]", error);
    return NextResponse.json({ error: "Falha ao processar a fila de exportações." }, { status: 500 });
  }
}
