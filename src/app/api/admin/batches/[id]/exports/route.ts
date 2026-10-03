import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminApi } from "@/lib/auth/session";
import { listExports, requireBatch } from "@/lib/db/queries";
import { toExportView } from "@/lib/db/types";
import { isRunnable, requestExport, scheduleExportJobs } from "@/lib/exports/worker";
import { errorResponse, readJson } from "@/lib/http";

// O trabalho pesado roda em after(), depois da resposta; o limite vale para a função inteira.
export const maxDuration = 60;

const requestSchema = z.object({ kind: z.enum(["csv", "qr_zip", "art_png_zip", "art_pdf"]) });

/** Lista as exportações do lote. Usado pelo polling da tela: também retoma jobs parados. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  try {
    const { id } = await params;
    z.string().uuid().parse(id);
    const exports = await listExports(auth.session.supabase, id);
    scheduleExportJobs(exports.filter((job) => isRunnable(job)).map((job) => job.id));
    return NextResponse.json({ exports: exports.map(toExportView) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

/** Solicita uma exportação (CSV, QR Codes ou artes) e agenda o processamento. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  try {
    const { id } = await params;
    z.string().uuid().parse(id);
    const { kind } = requestSchema.parse(await readJson(request));
    const batch = await requireBatch(auth.session.supabase, id);
    const { job, created } = await requestExport(auth.session.supabase, batch, kind, auth.session.user.id);
    if (isRunnable(job)) scheduleExportJobs([job.id]);
    return NextResponse.json({ export: toExportView(job), created }, { status: created ? 202 : 200 });
  } catch (error) {
    return errorResponse(error);
  }
}
