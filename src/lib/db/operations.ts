import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { httpErrorFromDb } from "@/lib/http";
import type {
  AvailablePlateRow,
  AvailableStockRow,
  CustomerRow,
  DestinationType,
  OrderItemRow,
  OrderRow,
  OrderStatus,
  PlateAssignmentRow,
  PlateRow,
  PlateStatus,
  ResellerStatsRow,
  SalePlateRow,
} from "./types";
import { compareCustomersByDisplayName, getCustomerDisplayName } from "@/lib/customers";

/**
 * Consultas da operação. Mesmo padrão de queries.ts: consultas simples,
 * junção em TypeScript e RLS sempre aplicada (cliente do usuário).
 */

export const PAGE_SIZE = 50;

type DbResult = { data: unknown; error: { code?: string; message: string; details?: string | null } | null; count?: number | null };

function list<T>(result: DbResult): T[] {
  if (result.error) throw httpErrorFromDb(result.error);
  return (result.data ?? []) as T[];
}

function one<T>(result: DbResult): T | null {
  if (result.error) throw httpErrorFromDb(result.error);
  return (result.data ?? null) as T | null;
}

const uniq = <T,>(values: (T | null | undefined)[]) => [...new Set(values.filter((v): v is T => v !== null && v !== undefined))];

export const PLATE_COLUMNS =
  "id, public_code, reseller_id, customer_id, batch_id, destination_type, destination_url, status, qr_access_count, last_qr_access_at, created_at, updated_at";
const CUSTOMER_COLUMNS = "id, reseller_id, name, company_name, phone, email, notes, created_at, updated_at, archived_at, archive_reason";
const ORDER_COLUMNS =
  "id, order_number, reseller_id, status, subtotal, discount, total, notes, paid_at, cancelled_at, created_by, created_at, updated_at";

async function namesById(sb: SupabaseClient, table: string, column: string, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = list<Record<string, string>>(await sb.from(table).select(`id, ${column}`).in("id", ids));
  return new Map(rows.map((r) => [r.id!, r[column]!]));
}

/** Nomes de exibição dos clientes (empresa quando houver; senão o nome). Inclui clientes em quarentena: é histórico. */
async function customerNamesById(sb: SupabaseClient, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = list<{ id: string; name: string; company_name: string | null }>(
    await sb.from("customers").select("id, name, company_name").in("id", ids),
  );
  return new Map(rows.map((r) => [r.id, getCustomerDisplayName(r)]));
}

// ---------------------------------------------------------------------
// Revendedores
// ---------------------------------------------------------------------
export async function getResellerStats(sb: SupabaseClient, resellerId?: string): Promise<ResellerStatsRow[]> {
  const rows = list<ResellerStatsRow>(await sb.rpc("admin_reseller_stats", { p_reseller_id: resellerId ?? null }));
  return rows.map((r) => ({
    ...r,
    plates_total: Number(r.plates_total),
    plates_available: Number(r.plates_available),
    plates_configured: Number(r.plates_configured),
    plates_active: Number(r.plates_active),
    customers: Number(r.customers),
    accesses: Number(r.accesses),
  }));
}

export interface ResellerOption {
  id: string;
  name: string;
  active: boolean;
}

export async function listResellerOptions(sb: SupabaseClient): Promise<ResellerOption[]> {
  return (await getResellerStats(sb)).map((r) => ({ id: r.reseller_id, name: r.company_name, active: r.active }));
}

/** Vendas pagas por revendedor (faturamento e quantidade). */
export async function paidSalesByReseller(sb: SupabaseClient, resellerId?: string) {
  let query = sb.from("orders").select("reseller_id, total").eq("status", "paid");
  if (resellerId) query = query.eq("reseller_id", resellerId);
  const rows = list<{ reseller_id: string; total: number }>(await query);
  const map = new Map<string, { revenue: number; sales: number }>();
  for (const row of rows) {
    const entry = map.get(row.reseller_id) ?? { revenue: 0, sales: 0 };
    entry.revenue += Number(row.total);
    entry.sales += 1;
    map.set(row.reseller_id, entry);
  }
  return map;
}

// ---------------------------------------------------------------------
// Placas (ADMIN)
// ---------------------------------------------------------------------
/** Abas de Admin › Placas: operacionais, em quarentena (da placa OU do lote) e todas. */
export type PlateView = "operational" | "quarantine" | "all";

export interface PlateFilters {
  code?: string;
  reseller?: string; // uuid | "none"
  status?: PlateStatus;
  batch?: string;
  configured?: "yes" | "no";
  customer?: string;
  /** Padrão: "all" (comportamento anterior para quem não informa). */
  view?: PlateView;
}

/** Máximo de placas por ação em massa (o banco confere o mesmo limite). */
export const BULK_MAX = 5000;

export interface PlateListItem {
  id: string;
  public_code: string;
  status: PlateStatus;
  destination_type: DestinationType | null;
  destination_url: string | null;
  qr_access_count: number;
  created_at: string;
  reseller_id: string | null;
  reseller_name: string | null;
  customer_name: string | null;
  batch_id: string | null;
  batch_name: string | null;
  /** "plate" = placa em quarentena; "batch" = lote em quarentena; null = operacional. */
  quarantine_state: "plate" | "batch" | null;
  quarantined_at: string | null;
  quarantine_reason: string | null;
}

/** A migration da quarentena (029) ainda não foi aplicada? (a tela segue funcionando como antes) */
function quarantineMissing(error: { code?: string; message?: string } | null): boolean {
  return !!error && (error.code === "42703" || error.code === "PGRST204" || /quarantine_state|quarantined_at|quarantine_reason/.test(error.message ?? ""));
}

/**
 * Consulta de placas com TODOS os filtros da tela (inclusive a aba). Usada
 * pela listagem, pelos contadores das abas e por "selecionar todas do filtro",
 * para que a seleção em massa use exatamente os mesmos critérios da tela.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function plateQuery(sb: SupabaseClient, columns: string, filters: PlateFilters, withQuarantine: boolean, head = false): any {
  let query = sb.from("plates").select(columns, { count: "exact", head });
  const code = filters.code?.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (code) query = query.ilike("public_code", `%${code}%`);
  if (filters.reseller === "none") query = query.is("reseller_id", null);
  else if (filters.reseller) query = query.eq("reseller_id", filters.reseller);
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.batch) query = query.eq("batch_id", filters.batch);
  if (filters.customer) query = query.eq("customer_id", filters.customer);
  if (filters.configured === "yes") query = query.not("destination_url", "is", null);
  if (filters.configured === "no") query = query.is("destination_url", null);
  if (withQuarantine && filters.view === "operational") query = query.is("quarantine_state", null);
  if (withQuarantine && filters.view === "quarantine") query = query.not("quarantine_state", "is", null);
  return query;
}

export async function listPlates(
  sb: SupabaseClient,
  filters: PlateFilters,
  page: number,
): Promise<{ rows: PlateListItem[]; total: number; quarantineInstalled: boolean }> {
  const from = (page - 1) * PAGE_SIZE;
  const run = (withQuarantine: boolean) =>
    plateQuery(sb, withQuarantine ? `${PLATE_COLUMNS}, quarantined_at, quarantine_reason, quarantine_state` : PLATE_COLUMNS, filters, withQuarantine)
      .order("created_at", { ascending: false })
      .order("public_code")
      .range(from, from + PAGE_SIZE - 1);
  let quarantineInstalled = true;
  let result = await run(true);
  if (quarantineMissing(result.error)) {
    quarantineInstalled = false;
    result = await run(false);
  }
  const plates = list<PlateRow>(result);

  const [resellers, customers, batches] = await Promise.all([
    namesById(sb, "reseller_profiles", "company_name", uniq(plates.map((p) => p.reseller_id))),
    customerNamesById(sb, uniq(plates.map((p) => p.customer_id))),
    namesById(sb, "plate_batches", "name", uniq(plates.map((p) => p.batch_id))),
  ]);

  return {
    quarantineInstalled,
    total: result.count ?? plates.length,
    rows: (plates as (PlateRow & { quarantine_state?: string | null; quarantined_at?: string | null; quarantine_reason?: string | null })[]).map((p) => ({
      id: p.id,
      public_code: p.public_code,
      status: p.status,
      destination_type: p.destination_type,
      destination_url: p.destination_url,
      qr_access_count: Number(p.qr_access_count),
      created_at: p.created_at,
      reseller_id: p.reseller_id,
      reseller_name: p.reseller_id ? (resellers.get(p.reseller_id) ?? null) : null,
      customer_name: p.customer_id ? (customers.get(p.customer_id) ?? null) : null,
      batch_id: p.batch_id,
      batch_name: p.batch_id ? (batches.get(p.batch_id) ?? null) : null,
      quarantine_state: p.quarantine_state === "plate" || p.quarantine_state === "batch" ? p.quarantine_state : null,
      quarantined_at: p.quarantined_at ?? null,
      quarantine_reason: p.quarantine_reason ?? null,
    })),
  };
}

/** Contadores das abas (com os demais filtros aplicados). */
export async function countPlateViews(sb: SupabaseClient, filters: PlateFilters): Promise<Record<PlateView, number> | null> {
  const counts = await Promise.all(
    (["operational", "quarantine", "all"] as const).map(async (view) => {
      const { count, error } = await plateQuery(sb, "id", { ...filters, view }, true, true);
      if (quarantineMissing(error)) return null;
      if (error) throw httpErrorFromDb(error);
      return count ?? 0;
    }),
  );
  if (counts.some((c) => c === null)) return null;
  return { operational: counts[0]!, quarantine: counts[1]!, all: counts[2]! };
}

/** "Selecionar todas do filtro": ids de TODAS as placas que a tela mostra com estes filtros (até BULK_MAX). */
export async function listPlateIds(sb: SupabaseClient, filters: PlateFilters): Promise<{ ids: string[]; total: number; truncated: boolean }> {
  const { data, error, count } = await plateQuery(sb, "id", filters, true)
    .order("created_at", { ascending: false })
    .order("public_code")
    .range(0, BULK_MAX - 1);
  if (error) throw httpErrorFromDb(error);
  const ids = ((data ?? []) as { id: string }[]).map((r) => r.id);
  return { ids, total: count ?? ids.length, truncated: (count ?? 0) > ids.length };
}

export async function listBatchOptions(sb: SupabaseClient): Promise<{ id: string; name: string }[]> {
  return list<{ id: string; name: string }>(
    await sb.from("plate_batches").select("id, name").order("created_at", { ascending: false }).limit(200),
  );
}

export interface PlateDetail {
  plate: PlateRow;
  batch: { id: string; name: string; template_version_id: string | null } | null;
  template: { id: string; name: string; version_number: number } | null;
  reseller: { id: string; company_name: string } | null;
  customer: CustomerRow | null;
  history: (PlateAssignmentRow & { reseller_name: string | null; order_number: number | null })[];
  /** Venda válida à qual a placa pertence agora (vínculo ativo em order_plates). */
  sale: { id: string; order_number: number } | null;
}

export async function getPlateDetail(sb: SupabaseClient, plateId: string): Promise<PlateDetail | null> {
  const plate = one<PlateRow>(await sb.from("plates").select(PLATE_COLUMNS).eq("id", plateId).maybeSingle());
  if (!plate) return null;

  const [batch, reseller, customer, history] = await Promise.all([
    plate.batch_id
      ? sb.from("plate_batches").select("id, name, template_version_id").eq("id", plate.batch_id).maybeSingle().then(one<PlateDetail["batch"]>)
      : Promise.resolve(null),
    plate.reseller_id
      ? sb.from("reseller_profiles").select("id, company_name").eq("id", plate.reseller_id).maybeSingle().then(one<PlateDetail["reseller"]>)
      : Promise.resolve(null),
    plate.customer_id
      ? sb.from("customers").select(CUSTOMER_COLUMNS).eq("id", plate.customer_id).maybeSingle().then(one<CustomerRow>)
      : Promise.resolve(null),
    sb
      .from("plate_assignments")
      .select("id, plate_id, reseller_id, assigned_by, assigned_at, unassigned_at, order_id, ended_reason")
      .eq("plate_id", plateId)
      .order("assigned_at", { ascending: false })
      .then(list<PlateAssignmentRow>),
  ]);

  let template: PlateDetail["template"] = null;
  if (batch?.template_version_id) {
    const version = one<{ template_id: string; version_number: number }>(
      await sb.from("plate_template_versions").select("template_id, version_number").eq("id", batch.template_version_id).maybeSingle(),
    );
    if (version) {
      const tpl = one<{ id: string; name: string }>(
        await sb.from("plate_templates").select("id, name").eq("id", version.template_id).maybeSingle(),
      );
      if (tpl) template = { id: tpl.id, name: tpl.name, version_number: version.version_number };
    }
  }

  const activeLink = one<{ order_id: string }>(
    await sb.from("order_plates").select("order_id").eq("plate_id", plateId).is("released_at", null).maybeSingle(),
  );
  const orderIds = uniq([...history.map((h) => h.order_id), activeLink?.order_id]);
  const [historyNames, orderNumbers] = await Promise.all([
    namesById(sb, "reseller_profiles", "company_name", uniq(history.map((h) => h.reseller_id))),
    orderIds.length
      ? sb.from("orders").select("id, order_number").in("id", orderIds).then(list<{ id: string; order_number: number }>)
      : Promise.resolve([]),
  ]);
  const numberOf = new Map(orderNumbers.map((o) => [o.id, Number(o.order_number)]));
  return {
    plate: { ...plate, qr_access_count: Number(plate.qr_access_count) },
    batch,
    template,
    reseller,
    customer,
    history: history.map((h) => ({
      ...h,
      reseller_name: historyNames.get(h.reseller_id) ?? null,
      order_number: h.order_id ? (numberOf.get(h.order_id) ?? null) : null,
    })),
    sale: activeLink ? { id: activeLink.order_id, order_number: numberOf.get(activeLink.order_id) ?? 0 } : null,
  };
}

/**
 * Clientes do revendedor, ordenados pelo nome de exibição.
 * scope "active" (padrão) = só os fora da quarentena, para seletores de venda e de placa.
 */
export async function listCustomersOfReseller(
  sb: SupabaseClient,
  resellerId: string,
  scope: "active" | "quarantine" | "all" = "active",
): Promise<CustomerRow[]> {
  let query = sb.from("customers").select(CUSTOMER_COLUMNS).eq("reseller_id", resellerId);
  if (scope === "active") query = query.is("archived_at", null);
  if (scope === "quarantine") query = query.not("archived_at", "is", null);
  return list<CustomerRow>(await query).sort(compareCustomersByDisplayName);
}

export async function listStockPlates(sb: SupabaseClient, limit = 300) {
  // Estoque vendável: placas em quarentena (da placa ou do lote) ficam de fora.
  const run = (withQuarantine: boolean) => {
    let q = sb.from("plates").select("id, public_code, batch_id").is("reseller_id", null).eq("status", "in_stock");
    if (withQuarantine) q = q.is("quarantine_state", null);
    return q.order("created_at").order("public_code").limit(limit);
  };
  let result = await run(true);
  if (quarantineMissing(result.error)) result = await run(false);
  const plates = list<{ id: string; public_code: string; batch_id: string | null }>(result);
  const batches = await namesById(sb, "plate_batches", "name", uniq(plates.map((p) => p.batch_id)));
  return plates.map((p) => ({ ...p, batch_name: p.batch_id ? (batches.get(p.batch_id) ?? null) : null }));
}

export async function countStockPlates(sb: SupabaseClient): Promise<number> {
  const run = (withQuarantine: boolean) => {
    let q = sb.from("plates").select("id", { count: "exact", head: true }).is("reseller_id", null).eq("status", "in_stock");
    if (withQuarantine) q = q.is("quarantine_state", null);
    return q;
  };
  let result = await run(true);
  if (quarantineMissing(result.error)) result = await run(false);
  if (result.error) throw httpErrorFromDb(result.error);
  return result.count ?? 0;
}

/**
 * Placas realmente disponíveis para uma venda (admin_available_plates): mesma
 * regra da reserva no banco — em estoque, sem revendedor e sem vínculo com venda.
 */
export async function listAvailablePlates(
  sb: SupabaseClient,
  options: { q?: string; batchId?: string | null; limit: number; offset: number },
): Promise<{ rows: AvailablePlateRow[]; total: number }> {
  const rows = list<AvailablePlateRow & { total_count: number }>(
    await sb.rpc("admin_available_plates", {
      p_search: options.q?.trim() || null,
      p_batch_id: options.batchId || null,
      p_limit: options.limit,
      p_offset: options.offset,
    }),
  );
  return {
    total: rows.length ? Number(rows[0]!.total_count) : 0,
    rows: rows.map(({ total_count: _total, ...row }) => row),
  };
}

/** Estoque disponível por lote (para a venda automática escolher o lote). */
export async function listAvailableStock(sb: SupabaseClient): Promise<AvailableStockRow[]> {
  return list<AvailableStockRow>(await sb.rpc("admin_available_stock")).map((r) => ({ ...r, available: Number(r.available) }));
}

// ---------------------------------------------------------------------
// Vendas (tabela orders)
// ---------------------------------------------------------------------
export interface SaleListItem extends OrderRow {
  reseller_name: string | null;
  plates: number;
}

async function withSaleDetails(sb: SupabaseClient, orders: OrderRow[]): Promise<SaleListItem[]> {
  const ids = orders.map((o) => o.id);
  const [items, resellers] = await Promise.all([
    ids.length
      ? sb.from("order_items").select("order_id, kind, quantity").in("order_id", ids).then(list<Pick<OrderItemRow, "order_id" | "kind" | "quantity">>)
      : Promise.resolve([]),
    namesById(sb, "reseller_profiles", "company_name", uniq(orders.map((o) => o.reseller_id))),
  ]);
  return orders.map((o) => ({
    ...o,
    subtotal: Number(o.subtotal),
    discount: Number(o.discount),
    total: Number(o.total),
    reseller_name: resellers.get(o.reseller_id) ?? null,
    plates: items.filter((i) => i.order_id === o.id && i.kind === "plates").reduce((sum, i) => sum + i.quantity, 0),
  }));
}

export async function listSales(
  sb: SupabaseClient,
  options: { page: number; status?: OrderStatus; resellerId?: string; limit?: number },
): Promise<{ rows: SaleListItem[]; total: number }> {
  const size = options.limit ?? PAGE_SIZE;
  let query = sb.from("orders").select(ORDER_COLUMNS, { count: "exact" });
  if (options.status) query = query.eq("status", options.status);
  if (options.resellerId) query = query.eq("reseller_id", options.resellerId);
  const from = (options.page - 1) * size;
  const result = await query.order("created_at", { ascending: false }).range(from, from + size - 1);
  const orders = list<OrderRow>(result);
  return { rows: await withSaleDetails(sb, orders), total: result.count ?? orders.length };
}

export async function getSale(sb: SupabaseClient, orderId: string) {
  const order = one<OrderRow>(await sb.from("orders").select(ORDER_COLUMNS).eq("id", orderId).maybeSingle());
  if (!order) return null;
  const [detail] = await withSaleDetails(sb, [order]);
  const items = list<OrderItemRow>(
    await sb.from("order_items").select("id, order_id, kind, description, quantity, unit_price, total").eq("order_id", orderId).order("created_at"),
  );
  const plates = list<SalePlateRow>(await sb.rpc("admin_order_plates", { p_order_id: orderId }));
  return {
    sale: detail!,
    items: items.map((i) => ({ ...i, unit_price: Number(i.unit_price), total: Number(i.total) })),
    /** Placas vinculadas (ativas primeiro), com o status atual de cada uma. */
    plates,
  };
}

// ---------------------------------------------------------------------
// Clientes
// ---------------------------------------------------------------------
export interface CustomerListItem extends CustomerRow {
  reseller_name: string | null;
  plates: number;
}

export async function listCustomers(
  sb: SupabaseClient,
  options: { page: number; q?: string; resellerId?: string; pageSize?: number },
): Promise<{ rows: CustomerListItem[]; total: number }> {
  const size = options.pageSize ?? PAGE_SIZE;
  let query = sb.from("customers").select(CUSTOMER_COLUMNS, { count: "exact" });
  if (options.resellerId) query = query.eq("reseller_id", options.resellerId);
  const q = options.q?.trim().replace(/[%,()]/g, " ");
  if (q) query = query.or(`name.ilike.%${q}%,company_name.ilike.%${q}%`);
  const from = (options.page - 1) * size;
  const result = await query.order("name").range(from, from + size - 1);
  const customers = list<CustomerRow>(result);

  const ids = customers.map((c) => c.id);
  const [plates, resellers] = await Promise.all([
    ids.length ? sb.from("plates").select("customer_id").in("customer_id", ids).then(list<{ customer_id: string }>) : Promise.resolve([]),
    namesById(sb, "reseller_profiles", "company_name", uniq(customers.map((c) => c.reseller_id))),
  ]);

  return {
    total: result.count ?? customers.length,
    rows: customers.map((c) => ({
      ...c,
      reseller_name: resellers.get(c.reseller_id) ?? null,
      plates: plates.filter((p) => p.customer_id === c.id).length,
    })),
  };
}

// ---------------------------------------------------------------------
// Painel do revendedor (a RLS limita tudo às placas e clientes dele)
// ---------------------------------------------------------------------
export type ResellerPlateFilter = "all" | "available" | "configured" | "active" | "inactive";
export type ResellerPlateItem = PlateRow & { customer_name: string | null };

/** Remove caracteres com significado na sintaxe de filtros do PostgREST. */
function cleanSearch(value: string | undefined): string {
  return (value ?? "").trim().replace(/[%,()*\\"']/g, " ").replace(/\s+/g, " ").slice(0, 80);
}

async function withCustomerNames(sb: SupabaseClient, plates: PlateRow[]): Promise<ResellerPlateItem[]> {
  const customers = await customerNamesById(sb, uniq(plates.map((p) => p.customer_id)));
  return plates.map((p) => ({
    ...p,
    qr_access_count: Number(p.qr_access_count),
    customer_name: p.customer_id ? (customers.get(p.customer_id) ?? null) : null,
  }));
}

/** Lista paginada com filtro e busca por código, cliente ou destino. */
export async function listResellerPlates(
  sb: SupabaseClient,
  options: { filter: ResellerPlateFilter; page: number; q?: string; pageSize?: number },
): Promise<{ rows: ResellerPlateItem[]; total: number }> {
  const size = options.pageSize ?? PAGE_SIZE;
  let query = sb.from("plates").select(PLATE_COLUMNS, { count: "exact" });
  if (options.filter === "available") query = query.is("destination_url", null);
  if (options.filter === "configured") query = query.not("destination_url", "is", null);
  if (options.filter === "active") query = query.eq("status", "active");
  if (options.filter === "inactive") query = query.eq("status", "inactive");

  const q = cleanSearch(options.q);
  if (q) {
    const customerIds = list<{ id: string }>(
      await sb.from("customers").select("id").or(`name.ilike.%${q}%,company_name.ilike.%${q}%`).limit(200),
    ).map((c) => c.id);
    const conditions = [`public_code.ilike.%${q.toUpperCase().replace(/[^A-Z0-9]/g, "") || q}%`, `destination_url.ilike.%${q}%`];
    if (customerIds.length) conditions.push(`customer_id.in.(${customerIds.join(",")})`);
    query = query.or(conditions.join(","));
  }

  const from = (options.page - 1) * size;
  const result = await query.order("public_code").range(from, from + size - 1);
  const plates = list<PlateRow>(result);
  return { rows: await withCustomerNames(sb, plates), total: result.count ?? plates.length };
}

/** As 5 placas do dashboard: primeiro as disponíveis (sem destino), depois as alteradas mais recentemente. */
export async function listResellerHighlights(sb: SupabaseClient, limit = 5): Promise<ResellerPlateItem[]> {
  const available = list<PlateRow>(
    await sb.from("plates").select(PLATE_COLUMNS).is("destination_url", null).neq("status", "blocked").order("public_code").limit(limit),
  );
  const rest =
    available.length < limit
      ? list<PlateRow>(
          await sb
            .from("plates")
            .select(PLATE_COLUMNS)
            .not("destination_url", "is", null)
            .order("updated_at", { ascending: false })
            .limit(limit - available.length),
        )
      : [];
  return withCustomerNames(sb, [...available, ...rest]);
}

/**
 * Acessos por QR Code — a métrica oficial. O NFC continua funcionando e sendo
 * registrado em redirects.source, mas não entra nas métricas. Com o cliente
 * do revendedor, a RLS de redirects já restringe às placas dele.
 */
export async function countQrAccesses(
  sb: SupabaseClient,
  options: { from?: Date; to?: Date; plateId?: string } = {},
): Promise<number> {
  let query = sb.from("redirects").select("id", { count: "exact", head: true }).eq("source", "qr");
  if (options.plateId) query = query.eq("plate_id", options.plateId);
  if (options.from) query = query.gte("created_at", options.from.toISOString());
  if (options.to) query = query.lt("created_at", options.to.toISOString());
  const { count, error } = await query;
  if (error) throw httpErrorFromDb(error);
  return count ?? 0;
}
