import Link from "next/link";
import { Panel } from "@/components/ui/kit";

/**
 * Falha ao carregar DirectLinks: mensagem amigável (o detalhe técnico fica no
 * log do servidor). Para o ADMIN, quando a estrutura não existe no banco,
 * diz qual migration aplicar — isso informa, não mascara a ausência.
 */
export function DirectLinkLoadFailed({ retryHref, missingSchema, isAdmin }: { retryHref: string; missingSchema: boolean; isAdmin: boolean }) {
  return (
    <Panel>
      <div className="px-[var(--ds-panel-px)] py-6" role="alert" data-directlink-load-error={missingSchema ? "missing_schema" : "unexpected"}>
        <p className="font-semibold">Não foi possível carregar os DirectLinks.</p>
        <p className="mt-1 text-sm text-ink-soft">Tente novamente.</p>
        {isAdmin && missingSchema && (
          <p className="mt-3 rounded-lg border border-line bg-paper px-4 py-3 text-sm">
            A estrutura do DirectLink não existe neste banco de dados. É necessário aplicar a migration{" "}
            <code className="font-mono text-[0.85em]">20261004120000_directlink.sql</code> (e as migrations seguintes) no Supabase.
          </p>
        )}
        <Link href={retryHref} className="btn mt-4">
          Tentar novamente
        </Link>
      </div>
    </Panel>
  );
}
