-- =====================================================================
-- 009 · Base comercial: pedidos ADMIN → REVENDEDOR e métricas
-- Sem gateway de pagamento nesta etapa: o ADMIN registra a venda e
-- marca como paga manualmente.
-- =====================================================================

create table if not exists public.orders (
  id            uuid primary key default gen_random_uuid(),
  order_number  bigint generated always as identity,
  reseller_id   uuid not null references public.reseller_profiles (id) on delete restrict,
  status        text not null default 'pending',
  subtotal      numeric(12, 2) not null default 0,
  discount      numeric(12, 2) not null default 0,
  total         numeric(12, 2) not null default 0,
  notes         text,
  paid_at       timestamptz,
  cancelled_at  timestamptz,
  created_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint orders_order_number_key unique (order_number),
  constraint orders_status_check check (status in ('draft', 'pending', 'paid', 'cancelled')),
  constraint orders_amounts_check check (
    subtotal >= 0 and discount >= 0 and discount <= subtotal and total = subtotal - discount
  ),
  constraint orders_paid_at_check check (status <> 'paid' or paid_at is not null)
);

create table if not exists public.order_items (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references public.orders (id) on delete cascade,
  kind         text not null default 'plates',
  description  text not null,
  quantity     integer not null,
  unit_price   numeric(12, 2) not null,
  total        numeric(12, 2) not null,
  created_at   timestamptz not null default now(),
  constraint order_items_kind_check check (kind in ('plates', 'other')),
  constraint order_items_description_check check (char_length(btrim(description)) between 1 and 200),
  constraint order_items_quantity_check check (quantity > 0),
  constraint order_items_unit_price_check check (unit_price >= 0),
  constraint order_items_total_check check (total = quantity * unit_price)
);

create index if not exists orders_paid_idx on public.orders (paid_at) where status = 'paid';
create index if not exists orders_reseller_idx on public.orders (reseller_id, status);
create index if not exists orders_created_idx on public.orders (created_at desc);
create index if not exists order_items_order_idx on public.order_items (order_id);

drop trigger if exists trg_orders_updated_at on public.orders;
create trigger trg_orders_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

-- Itens só mudam enquanto o pedido está em rascunho/pendente.
create or replace function public.guard_order_items()
returns trigger
language plpgsql
as $$
declare
  v_status text;
begin
  select o.status into v_status from public.orders o where o.id = coalesce(new.order_id, old.order_id);
  if v_status is not null and v_status not in ('draft', 'pending') then
    raise exception 'Itens de pedidos pagos ou cancelados não podem ser alterados' using errcode = '55000';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_order_items_guard on public.order_items;
create trigger trg_order_items_guard
  before insert or update or delete on public.order_items
  for each row execute function public.guard_order_items();

-- Subtotal e total do pedido sempre derivados dos itens.
create or replace function public.recalc_order_totals()
returns trigger
language plpgsql
as $$
declare
  v_order uuid := coalesce(new.order_id, old.order_id);
  v_subtotal numeric(12, 2);
begin
  select coalesce(sum(i.total), 0) into v_subtotal from public.order_items i where i.order_id = v_order;
  update public.orders o set subtotal = v_subtotal, total = v_subtotal - o.discount where o.id = v_order;
  return null;
end;
$$;

drop trigger if exists trg_order_items_totals on public.order_items;
create trigger trg_order_items_totals
  after insert or update or delete on public.order_items
  for each row execute function public.recalc_order_totals();

alter table public.orders enable row level security;
alter table public.order_items enable row level security;

drop policy if exists orders_select on public.orders;
create policy orders_select on public.orders
  for select to authenticated
  using (public.is_admin() or reseller_id = public.current_reseller_id());

drop policy if exists orders_admin_write on public.orders;
create policy orders_admin_write on public.orders
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists order_items_select on public.order_items;
create policy order_items_select on public.order_items
  for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.orders o
      where o.id = order_items.order_id and o.reseller_id = public.current_reseller_id()
    )
  );

drop policy if exists order_items_admin_write on public.order_items;
create policy order_items_admin_write on public.order_items
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------
-- Registrar venda (atômico): pedido + item de placas + status inicial
-- ---------------------------------------------------------------------
create or replace function public.create_order(
  p_reseller_id  uuid,
  p_quantity     integer,
  p_unit_price   numeric,
  p_discount     numeric default 0,
  p_notes        text default null,
  p_status       text default 'pending',
  p_description  text default 'Placas QR Code + NFC'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_unit     numeric(12, 2) := round(coalesce(p_unit_price, -1), 2);
  v_discount numeric(12, 2) := round(coalesce(p_discount, 0), 2);
  v_subtotal numeric(12, 2);
  v_order    uuid;
begin
  if not public.is_admin() then
    raise exception 'Somente ADMIN pode registrar vendas' using errcode = '42501';
  end if;
  if not exists (select 1 from public.reseller_profiles rp where rp.id = p_reseller_id) then
    raise exception 'Revendedor não encontrado' using errcode = '22023';
  end if;
  if p_quantity is null or p_quantity < 1 or p_quantity > 100000 then
    raise exception 'A quantidade deve estar entre 1 e 100.000' using errcode = '22023';
  end if;
  if v_unit < 0 then
    raise exception 'Informe um preço unitário válido' using errcode = '22023';
  end if;
  if p_status not in ('draft', 'pending', 'paid') then
    raise exception 'Status inicial inválido' using errcode = '22023';
  end if;

  v_subtotal := p_quantity * v_unit;
  if v_discount < 0 or v_discount > v_subtotal then
    raise exception 'O desconto deve estar entre zero e o subtotal' using errcode = '22023';
  end if;

  insert into public.orders (reseller_id, status, subtotal, discount, total, notes, created_by)
  values (
    p_reseller_id,
    case when p_status = 'draft' then 'draft' else 'pending' end,
    v_subtotal, v_discount, v_subtotal - v_discount,
    nullif(btrim(coalesce(p_notes, '')), ''),
    auth.uid()
  )
  returning id into v_order;

  insert into public.order_items (order_id, kind, description, quantity, unit_price, total)
  values (v_order, 'plates', coalesce(nullif(btrim(p_description), ''), 'Placas QR Code + NFC'), p_quantity, v_unit, v_subtotal);

  if p_status = 'paid' then
    update public.orders o set status = 'paid', paid_at = now() where o.id = v_order;
  end if;

  return v_order;
end;
$$;

-- ---------------------------------------------------------------------
-- Mudar status do pedido com transições controladas
--   draft → pending | paid | cancelled
--   pending → paid | cancelled
--   paid → cancelled
-- ---------------------------------------------------------------------
create or replace function public.set_order_status(p_order_id uuid, p_status text)
returns setof public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
begin
  if not public.is_admin() then
    raise exception 'Somente ADMIN pode alterar vendas' using errcode = '42501';
  end if;
  select * into v_order from public.orders o where o.id = p_order_id for update;
  if not found then
    raise exception 'Pedido não encontrado' using errcode = 'P0002';
  end if;

  if not (
    (v_order.status = 'draft' and p_status in ('pending', 'paid', 'cancelled'))
    or (v_order.status = 'pending' and p_status in ('paid', 'cancelled'))
    or (v_order.status = 'paid' and p_status = 'cancelled')
  ) then
    raise exception 'Não é possível mudar o pedido de % para %', v_order.status, p_status using errcode = '55000';
  end if;

  update public.orders o set
    status = p_status,
    paid_at = case when p_status = 'paid' then now() else o.paid_at end,
    cancelled_at = case when p_status = 'cancelled' then now() else o.cancelled_at end
  where o.id = p_order_id;

  return query select * from public.orders o where o.id = p_order_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Métricas do dashboard ADMIN
--   Faturamento   = SUM(orders.total) dos pedidos pagos no período (por paid_at)
--   Vendas        = quantidade de pedidos pagos no período
--   Placas vendidas = soma das quantidades dos itens de placas desses pedidos
--   Estoque/ativas/etc. = situação atual (não dependem do período)
-- ---------------------------------------------------------------------
create or replace function public.admin_dashboard_metrics(p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_sales   jsonb;
  v_plates  jsonb;
begin
  if not public.is_admin() then
    raise exception 'Somente ADMIN' using errcode = '42501';
  end if;

  with paid as (
    select o.id, o.total from public.orders o
    where o.status = 'paid' and o.paid_at >= p_from and o.paid_at < p_to
  )
  select jsonb_build_object(
    'revenue', coalesce((select sum(total) from paid), 0),
    'sales', (select count(*) from paid),
    'plates_sold', coalesce((
      select sum(i.quantity) from public.order_items i join paid on paid.id = i.order_id where i.kind = 'plates'
    ), 0),
    'accesses', (select count(*) from public.redirects r where r.created_at >= p_from and r.created_at < p_to)
  ) into v_sales;

  select jsonb_build_object(
    'plates_produced', count(*),
    'plates_in_stock', count(*) filter (where p.reseller_id is null and p.status = 'in_stock'),
    'plates_with_resellers', count(*) filter (where p.reseller_id is not null),
    'plates_configured', count(*) filter (where p.destination_url is not null),
    'plates_active', count(*) filter (where p.status = 'active')
  ) into v_plates
  from public.plates p;

  return v_sales || v_plates || jsonb_build_object(
    'resellers_active', (
      select count(*) from public.reseller_profiles rp join public.profiles pr on pr.id = rp.user_id
      where pr.active and pr.role = 'reseller'
    )
  );
end;
$$;

-- Série de faturamento com buckets vazios preenchidos (fuso de São Paulo).
create or replace function public.admin_revenue_series(p_from timestamptz, p_to timestamptz, p_bucket text)
returns table (bucket_start timestamp, revenue numeric, sales bigint)
language sql
stable
security definer
set search_path = public
as $$
  with buckets as (
    select generate_series(
      date_trunc(p_bucket, p_from at time zone 'America/Sao_Paulo'),
      date_trunc(p_bucket, (p_to - interval '1 microsecond') at time zone 'America/Sao_Paulo'),
      ('1 ' || p_bucket)::interval
    ) as b
  )
  select b.b, coalesce(sum(o.total), 0), count(o.id)
  from buckets b
  left join public.orders o
    on o.status = 'paid'
   and o.paid_at >= p_from and o.paid_at < p_to
   and date_trunc(p_bucket, o.paid_at at time zone 'America/Sao_Paulo') = b.b
  where public.is_admin() and p_bucket in ('hour', 'day', 'month')
  group by b.b
  order by b.b;
$$;

create or replace function public.admin_top_resellers(p_from timestamptz, p_to timestamptz, p_limit integer default 5)
returns table (reseller_id uuid, company_name text, revenue numeric, sales bigint, plates bigint)
language sql
stable
security definer
set search_path = public
as $$
  select rp.id, rp.company_name, sum(o.total), count(distinct o.id),
         coalesce(sum(i.quantity) filter (where i.kind = 'plates'), 0)
  from public.orders o
  join public.reseller_profiles rp on rp.id = o.reseller_id
  left join lateral (
    select sum(oi.quantity) as quantity, 'plates'::text as kind
    from public.order_items oi where oi.order_id = o.id and oi.kind = 'plates'
  ) i on true
  where public.is_admin()
    and o.status = 'paid' and o.paid_at >= p_from and o.paid_at < p_to
  group by rp.id, rp.company_name
  order by sum(o.total) desc
  limit greatest(1, least(p_limit, 50));
$$;

revoke all on function public.create_order(uuid, integer, numeric, numeric, text, text, text) from public, anon;
grant execute on function public.create_order(uuid, integer, numeric, numeric, text, text, text) to authenticated;
revoke all on function public.set_order_status(uuid, text) from public, anon;
grant execute on function public.set_order_status(uuid, text) to authenticated;
revoke all on function public.admin_dashboard_metrics(timestamptz, timestamptz) from public, anon;
grant execute on function public.admin_dashboard_metrics(timestamptz, timestamptz) to authenticated;
revoke all on function public.admin_revenue_series(timestamptz, timestamptz, text) from public, anon;
grant execute on function public.admin_revenue_series(timestamptz, timestamptz, text) to authenticated;
revoke all on function public.admin_top_resellers(timestamptz, timestamptz, integer) from public, anon;
grant execute on function public.admin_top_resellers(timestamptz, timestamptz, integer) to authenticated;
