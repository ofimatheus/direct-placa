import { createClient } from "@supabase/supabase-js";
import { getPublicEnv } from "@/lib/env";
import { resolveReviewShortLink } from "@/lib/directlab/short-link";

/**
 * Link curto da Avaliação Google (/r/<código>), gravado em tags NFC.
 *   código → consulta só o destino no banco (public_review_link) → 302.
 * Sem login, sem chamada ao Google, sem cota, sem registro de acesso.
 * 302 (nunca 301): o destino pode ser corrigido sem cache permanente.
 */
export const dynamic = "force-dynamic";

const PAGE = (title: string, text: string) => `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>${title}</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif;background:#f5f8fb;color:#0d1a2a}main{max-width:26rem;margin:1.5rem;padding:2rem;border:1px solid #e3e8ef;border-radius:1rem;background:#fff;text-align:center}h1{font-size:1.15rem;margin:0}p{margin:.6rem 0 0;color:#5b6b80;font-size:.95rem}</style>
</head><body><main><h1>${title}</h1><p>${text}</p></main></body></html>`;

const HEADERS = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow", "Referrer-Policy": "no-referrer" };

export async function GET(_request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const env = getPublicEnv();
  const sb = createClient(env.supabaseUrl, env.supabaseAnonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const result = await resolveReviewShortLink(code, async (c) => {
    const { data, error } = await sb.rpc("public_review_link", { p_code: c });
    if (error) {
      console.error("review_short_link_lookup_failed", { code: error.code });
      throw error;
    }
    return typeof data === "string" ? data : null;
  });
  if (result.status === 302) return new Response(null, { status: 302, headers: { ...HEADERS, Location: result.location } });
  if (result.status === 503)
    return new Response(PAGE("Indisponível no momento", "Não foi possível abrir este link agora. Tente de novo em instantes."), {
      status: 503,
      headers: { ...HEADERS, "Content-Type": "text/html; charset=utf-8", "Retry-After": "30" },
    });
  return new Response(PAGE("Link não encontrado ou indisponível.", "Confira o endereço ou fale com quem forneceu este link."), {
    status: 404,
    headers: { ...HEADERS, "Content-Type": "text/html; charset=utf-8" },
  });
}
