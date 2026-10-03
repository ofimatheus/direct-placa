import { NextResponse, type NextRequest } from "next/server";
import { createAnonClient } from "@/lib/supabase/admin";

/**
 * Redirect público de QR e NFC: https://go.meudominio.com/{public_code}?src=qr|nfc
 *
 * src=qr | src=nfc | outro valor só é registrado em redirects.source (analytics):
 * o acesso nunca altera a placa. Só placas ativas com destino redirecionam.
 *
 * Sempre 302 (temporário) com Cache-Control: no-store. NUNCA 301: navegadores
 * guardam 301 para sempre e a troca de destino (Google → WhatsApp) deixaria
 * de funcionar para quem já escaneou.
 */
export const dynamic = "force-dynamic";

interface Resolution {
  outcome: "ok" | "not_found" | "blocked" | "inactive" | "unconfigured";
  target_url: string | null;
  code: string;
}

const NO_STORE = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
  "X-Robots-Tag": "noindex, nofollow",
  "Referrer-Policy": "no-referrer",
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function page(status: number, title: string, message: string, code?: string) {
  const html = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:#EEF1EE;color:#1C2A39;font:16px/1.5 system-ui,sans-serif}
  main{max-width:26rem;padding:2rem;text-align:center}
  h1{font-size:1.35rem;margin:0 0 .5rem}
  p{margin:0;color:#52606D}
  code{display:inline-block;margin-top:1.25rem;padding:.35rem .7rem;border:1px solid #D3DAD4;border-radius:6px;background:#fff;font-weight:700;letter-spacing:.08em}
</style></head>
<body><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p>${code ? `<code>${escapeHtml(code)}</code>` : ""}</main></body></html>`;
  return new NextResponse(html, { status, headers: { ...NO_STORE, "Content-Type": "text/html; charset=utf-8" } });
}

function isSafeTarget(value: string | null): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const src = request.nextUrl.searchParams.get("src");

  const { data, error } = await createAnonClient().rpc("resolve_plate_redirect", { p_code: code, p_source: src ?? "unknown" });
  if (error) {
    console.error("resolve_plate_redirect:", error.message);
    return page(503, "Tente novamente em instantes", "Não foi possível abrir este link agora.");
  }

  const result = ((data ?? []) as Resolution[])[0];
  if (!result || result.outcome === "not_found") {
    return page(404, "Placa não encontrada", "Confira se o código está correto.");
  }
  if (result.outcome === "blocked" || result.outcome === "inactive") {
    return page(410, "Placa desativada", "Este link não está mais disponível.", result.code);
  }
  if (result.outcome === "unconfigured" || !isSafeTarget(result.target_url)) {
    return page(200, "Placa ainda não ativada", "Esta placa é válida, mas ainda não tem um destino ativo.", result.code);
  }

  return NextResponse.redirect(result.target_url, { status: 302, headers: NO_STORE });
}
