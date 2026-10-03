import type { Metadata } from "next";
import Link from "next/link";
import { PlateList } from "@/components/reseller/PlateList";
import { EmptyNote, PageTitle, Panel, SearchForm, Segmented } from "@/components/ui/kit";
import { Pagination, parsePage } from "@/components/ui/primitives";
import { requireResellerContext } from "@/lib/auth/session";
import { PAGE_SIZE, listResellerPlates, type ResellerPlateFilter } from "@/lib/db/operations";

export const metadata: Metadata = { title: "Minhas placas" };

const FILTERS: { key: ResellerPlateFilter; label: string }[] = [
  { key: "all", label: "Todas" },
  { key: "available", label: "Disponíveis" },
  { key: "active", label: "Ativas" },
  { key: "inactive", label: "Inativas" },
];

const EMPTY: Record<string, { title: string; text: string }> = {
  available: { title: "Sem placas disponíveis", text: "Todas as suas placas já estão configuradas." },
  active: { title: "Nenhuma placa ativa", text: "Configure uma placa para que ela comece a redirecionar." },
  inactive: { title: "Nenhuma placa inativa", text: "Placas que você desativar aparecem aqui." },
  all: { title: "Você ainda não recebeu placas", text: "Assim que o administrador atribuir placas a você, elas aparecem aqui." },
};

export default async function ResellerPlatesPage({ searchParams }: { searchParams: Promise<{ filter?: string; q?: string; page?: string }> }) {
  const { supabase } = await requireResellerContext();
  const params = await searchParams;
  const filter = FILTERS.find((f) => f.key === params.filter)?.key ?? "all";
  const page = parsePage(params.page);
  const [{ rows, total }, firstAvailable] = await Promise.all([
    listResellerPlates(supabase, { filter, page, q: params.q }),
    supabase.from("plates").select("id").is("destination_url", null).eq("status", "assigned").order("public_code").limit(1).maybeSingle<{ id: string }>(),
  ]);
  const filterHref = (key: ResellerPlateFilter) => {
    const search = new URLSearchParams();
    if (key !== "all") search.set("filter", key);
    if (params.q) search.set("q", params.q);
    const qs = search.toString();
    return qs ? `/reseller/plates?${qs}` : "/reseller/plates";
  };
  const empty = params.q
    ? { title: "Nenhuma placa encontrada", text: `Nada corresponde a "${params.q}". Tente outro código, cliente ou destino.` }
    : EMPTY[filter]!;

  return (
    <div className="space-y-6">
      <PageTitle
        title="Minhas placas"
        subtitle="Gerencie todas as placas atribuídas a você."
        action={
          firstAvailable.data ? (
            <Link href={`/reseller/plates/${firstAvailable.data.id}`} className="btn btn-primary">
              + Configurar placa
            </Link>
          ) : undefined
        }
      />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <SearchForm
          action="/reseller/plates"
          defaultValue={params.q}
          placeholder="Buscar por código, cliente ou destino..."
          hidden={{ filter: filter === "all" ? undefined : filter }}
        />
        <Segmented items={FILTERS.map((f) => ({ key: f.key, label: f.label, href: filterHref(f.key) }))} active={filter} label="Filtrar placas" />
      </div>

      <Panel>
        {rows.length === 0 ? (
          <EmptyNote title={empty.title} text={empty.text} icon={filter === "available" && !params.q ? "active" : "plates"} />
        ) : (
          <PlateList plates={rows} showActions />
        )}
      </Panel>
      <Pagination page={page} total={total} pageSize={PAGE_SIZE} basePath="/reseller/plates" params={{ filter: filter === "all" ? undefined : filter, q: params.q }} />
    </div>
  );
}
