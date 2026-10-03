import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

/**
 * 1. Domínio de redirect (ex.: go.meudominio.com): /A7K482 é reescrito para /go/A7K482.
 *    Nesse host só se servem o redirect e as páginas públicas do DirectLink
 *    (/link/<código>), que também são abertas por QR Code.
 * 2. Demais rotas: renova a sessão do Supabase e protege /admin e /reseller.
 */
function goHostname(): string | null {
  const base = process.env.NEXT_PUBLIC_GO_BASE_URL;
  if (!base) return null;
  try {
    const url = new URL(base);
    return url.pathname === "/" || url.pathname === "" ? url.host : null;
  } catch {
    return null;
  }
}

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const goHost = goHostname();

  const isDirectLink = /^\/link\/[A-Za-z0-9]{7}\/?$/.test(path);

  if (goHost && request.headers.get("host") === goHost) {
    if (isDirectLink) return NextResponse.next();
    const match = /^\/([A-Za-z0-9]{4,12})\/?$/.exec(path);
    if (!match) return new NextResponse("Not found", { status: 404 });
    const url = request.nextUrl.clone();
    url.pathname = `/go/${match[1]}`;
    return NextResponse.rewrite(url);
  }

  // O redirect público não usa sessão: resposta mais rápida.
  if (path.startsWith("/go/")) return NextResponse.next();
  // DirectLink público: sem sessão.
  if (isDirectLink) return NextResponse.next();
  // Landing pública de revendedores (e sua imagem social): sem sessão.
  if (path === "/revendedores" || path.startsWith("/revendedores/")) return NextResponse.next();

  return updateSession(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|fonts/|.*\\.(?:png|jpg|jpeg|svg|ico|ttf|woff2?)$).*)"],
};
