/**
 * Limites por revendedor e DirectLink no ADMIN — lado do servidor.
 *   npm run test:directlab-limits
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DIRECTLAB_ERRORS } from "@/lib/directlab/errors";
import { DirectLinkLoadError, directLinkPageStatus, listDirectLinks } from "@/lib/directlink/manage";
import { httpErrorFromDb } from "@/lib/http";

let failures = 0;
const ok = (l: string) => console.log(`OK ${l}`);
const check = (c: unknown, l: string, d?: unknown) => {
  if (!c) {
    failures++;
    console.log(`FALHA ${l}`, d ?? "");
  }
};
const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");

/** Supabase falso: devolve `result` em qualquer consulta/RPC. */
function fakeSb(result: { data?: unknown; error?: { code: string; message: string } | null }) {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "order", "limit", "in", "eq"]) chain[m] = () => chain;
  chain.then = (resolve: (v: unknown) => unknown) => resolve({ data: result.data ?? null, error: result.error ?? null });
  return { from: () => chain, rpc: async () => ({ data: result.data ?? null, error: result.error ?? null }) } as never;
}

async function main() {
  // T1: causa do erro relatado — o caminho do stack trace com a tabela ausente dá exatamente a mensagem vista.
  for (const code of ["PGRST205", "42P01"]) {
    const e = httpErrorFromDb({ code, message: "x", details: null, hint: null } as never);
    check(e.status === 500 && e.message === "Erro ao acessar o banco de dados.", `T1 ${code}`, e);
  }
  const rls = httpErrorFromDb({ code: "42501", message: "permission denied", details: null, hint: null } as never);
  check(rls.status === 403 && rls.message !== "Erro ao acessar o banco de dados.", "T1 RLS daria outra mensagem", rls);
  ok("T1: tabela ausente (PGRST205/42P01) → exatamente 'Erro ao acessar o banco de dados.' (o erro relatado); uma recusa de RLS daria 403 com outra mensagem");

  // T2: listDirectLinks classifica a falha e registra o detalhe só no servidor.
  const logged: unknown[] = [];
  const orig = console.error;
  console.error = (...a: unknown[]) => void logged.push(a);
  try {
    let err: unknown = null;
    try {
      await listDirectLinks(fakeSb({ error: { code: "PGRST205", message: "Could not find the table 'public.direct_links' in the schema cache" } }), "admin");
    } catch (e) {
      err = e;
    }
    check(err instanceof DirectLinkLoadError && err.missingSchema && err.code === "PGRST205", "T2 ausente", err);
    let err2: unknown = null;
    try {
      await listDirectLinks(fakeSb({ error: { code: "XX000", message: "falha interna" } }), "reseller");
    } catch (e) {
      err2 = e;
    }
    check(err2 instanceof DirectLinkLoadError && !err2.missingSchema, "T2 inesperado", err2);
    check(logged.length === 2 && JSON.stringify(logged[0]).includes("PGRST205"), "T2 log técnico no servidor", logged);
    const rows = await listDirectLinks(fakeSb({ data: [] }), "admin");
    check(Array.isArray(rows) && rows.length === 0, "T2 lista vazia normal");
  } finally {
    console.error = orig;
  }
  ok("T2: listDirectLinks separa 'estrutura ausente no banco' de erro inesperado e registra o código técnico só no log do servidor");

  // T3: status de páginas (revendedor / ADMIN / indisponível).
  check(JSON.stringify(await directLinkPageStatus(fakeSb({ data: [{ role: "reseller", used: 2, page_limit: 3 }] }))) === '{"used":2,"limit":3}', "T3 revendedor");
  check(JSON.stringify(await directLinkPageStatus(fakeSb({ data: [{ role: "admin", used: 9, page_limit: null }] }))) === '{"used":9,"limit":null}', "T3 ADMIN");
  check((await directLinkPageStatus(fakeSb({ error: { code: "PGRST202", message: "x" } }))) === null, "T3 indisponível");
  ok("T3: status de páginas: revendedor '2 de 3', ADMIN sem limite (null), RPC ausente → null (nada exibido)");

  // T4: mensagens pedidas.
  check(DIRECTLAB_ERRORS.daily_limit.message === "Você atingiu o limite diário definido para sua conta. Entre em contato com o administrador para aumentar o limite." && DIRECTLAB_ERRORS.daily_limit.status === 429, "T4 Google");
  const mig = read("supabase/migrations/20261005120000_directlab_reseller_limits.sql");
  check(mig.includes("'Você atingiu o limite de páginas DirectLink definido para sua conta. Entre em contato com o administrador para aumentar o limite.'") && mig.includes("errcode = '55000'"), "T4 DirectLink no banco");
  check(httpErrorFromDb({ code: "55000", message: "Você atingiu o limite de páginas DirectLink definido para sua conta. Entre em contato com o administrador para aumentar o limite.", details: null, hint: null } as never).status === 409, "T4 409");
  ok("T4: mensagens pedidas — Google (429) e DirectLink (vem do banco, 409 pela API existente)");

  // T5: rota do ADMIN e ausência de confiança no navegador.
  const route = read("src/app/api/admin/resellers/[id]/directlab-limits/route.ts");
  check(route.includes("requireAdminApi()") && route.includes('rpc("admin_set_directlab_limits"') && route.includes("min(0).max(1000)"), "T5 rota");
  check(!/p_reseller|p_limit|p_max/.test(read("src/lib/directlab/quota.ts")) && !/p_reseller|p_limit/.test(read("src/lib/directlink/manage.ts")), "T5 sem limite/revendedor vindos do cliente");
  check(mig.includes("before insert on public.direct_links") && mig.includes("pg_advisory_xact_lock"), "T5 trava no banco");
  ok("T5: só ADMIN salva limites (rota + banco); revendedor e limites nunca vêm do navegador; página nova travada por gatilho no banco");

  // T6: migrations antigas intactas e sem auditoria.
  check(!/audit|history/i.test(mig.replace(/--.*$/gm, "")), "T6 sem auditoria");
  check(existsSync(join(root, "supabase/migrations/20261002120000_directlab_daily_quota.sql")) && read("supabase/migrations/20261002120000_directlab_daily_quota.sql").includes("select 10, 60, 10;"), "T6 021 intacta");
  ok("T6: migration nova sem tabela de auditoria/histórico; a 021 continua como estava");

  // T7: hub sem o formulário; ferramentas em páginas próprias.
  for (const who of ["admin", "reseller"]) {
    const hub = read(`src/app/${who}/directlab/page.tsx`);
    check(!hub.includes("GoogleReviewTool") && hub.includes("DirectLabTools"), `T7 hub ${who}`);
    check(read(`src/app/${who}/directlab/google-review/page.tsx`).includes(`<GoogleReviewTool role="${who}"`), `T7 ferramenta ${who}`);
  }
  check(!read("src/components/directlab/DirectLabTools.tsx").includes("GoogleReviewTool"), "T7 componente do hub");
  ok("T7: /admin/directlab e /reseller/directlab só com o catálogo; Avaliação Google em /<papel>/directlab/google-review");

  if (failures) {
    console.log(`${failures} falha(s)`);
    process.exit(1);
  }
  console.log("Limites do DirectLab OK");
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
