-- =====================================================================
-- 014 · Vendas finais do revendedor (financeiro PRIVADO)
--
-- Duas camadas comerciais que NÃO se misturam:
--
--   orders           ADMIN → revendedor. Faturamento da aplicação.
--   reseller_sales   revendedor → cliente final. Negócio DELE.
--
-- O ADMIN da aplicação não enxerga reseller_sales. Isso não é uma decisão
-- de interface: não existe policy de leitura para is_admin(), e os
-- privilégios de tabela são revogados até de service_role — então nem o
-- cliente administrativo consegue consultar. As RPCs são SECURITY DEFINER
-- e sempre se amarram a public.current_reseller_id(), derivado de
-- auth.uid().
--
-- Registrar a venda NÃO ativa a placa. O fluxo operacional continua:
--   registrar venda → configurar destino → ativar placa
--
-- Incremental e não destrutiva: não altera migrations anteriores, não
-- toca orders, order_plates, plates nem o dashboard financeiro do ADMIN.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Tabelas
-- ---------------------------------------------------------------------
create table if not exists public.reseller_sales (
  id           uuid primary key default gen_random_uuid(),
  reseller_id  uuid not null references public.reseller_profiles (id) on delete restrict,
  customer_id  uuid references public.customers (id) on delete restrict,
  status       text not null default 'pending',
  total        numeric(12,2) not null default 0,
  sold_at      date not null default current_date,
  notes        text,
  idempotency_key uuid,
  paid_at      timestamptz,
  cancelled_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint reseller_sales_status_check check (status in ('pending', 'paid', 'cancelled')),
  constraint reseller_sales_total_check check (total >= 0 and total <= 99999999.99),
  constraint reseller_sales_notes_check check (notes is null or char_length(notes) <= 1000)
);

create unique index if not exists reseller_sales_idempotency_key_key
  on public.reseller_sales (idempotency_key) where idempotency_key is not null;
create index if not exists reseller_sales_reseller_idx on public.reseller_sales (reseller_id, sold_at desc);
create index if not exists reseller_sales_status_idx on public.reseller_sales (reseller_id, status);
create index if not exists reseller_sales_paid_idx on public.reseller_sales (reseller_id, sold_at) where status = 'paid';
create index if not exists reseller_sales_customer_idx on public.reseller_sales (customer_id) where customer_id is not null;

drop trigger if exists trg_reseller_sales_updated_at on public.reseller_sales;
create trigger trg_reseller_sales_updated_at
  before update on public.reseller_sales
  for each row execute function public.set_updated_at();

comment on table public.reseller_sales is
  'Venda do revendedor para o cliente final. Financeiro PRIVADO do revendedor: o ADMIN da aplicação não tem policy nem privilégio de leitura.';

create table if not exists public.reseller_sale_items (
  id            uuid primary key default gen_random_uuid(),
  sale_id       uuid not null references public.reseller_sales (id) on delete restrict,
  plate_id      uuid not null references public.plates (id) on delete restrict,
  -- Espelha o cancelamento da venda. É o que sustenta o índice único
  -- parcial abaixo: uma placa só participa de UMA venda não cancelada.
  cancelled_at  timestamptz,
  created_at    timestamptz not null default now()
);

-- REGRA CRÍTICA: a mesma placa não entra em duas vendas finais ativas.
-- Mesmo padrão de order_plates_one_active_idx: a última barreira é o
-- índice, não a validação da RPC.
create unique index if not exists reseller_sale_items_one_active_idx
  on public.reseller_sale_items (plate_id) where cancelled_at is null;

create index if not exists reseller_sale_items_sale_idx on public.reseller_sale_items (sale_id);
create index if not exists reseller_sale_items_plate_idx on public.reseller_sale_items (plate_id, created_at desc);

-- ---------------------------------------------------------------------
-- 2. Guardas de integridade
-- ---------------------------------------------------------------------

-- 2a. O item precisa ser de placa do MESMO revendedor da venda.
create or replace function public.guard_reseller_sale_item()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sale  public.reseller_sales%rowtype;
  v_plate public.plates%rowtype;
begin
  select * into v_sale from public.reseller_sales s where s.id = new.sale_id;
  if v_sale.status = 'cancelled' then
    raise exception 'Venda cancelada não recebe placas' using errcode = '55000';
  end if;
  select * into v_plate from public.plates p where p.id = new.plate_id;
  if v_plate.reseller_id is distinct from v_sale.reseller_id then
    raise exception 'A placa % não pertence a este revendedor', coalesce(v_plate.public_code, '?')
      using errcode = '42501';
  end if;
  if new.cancelled_at is not null then
    raise exception 'O item da venda precisa nascer ativo' using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_reseller_sale_items_insert_guard on public.reseller_sale_items;
create trigger trg_reseller_sale_items_insert_guard
  before insert on public.reseller_sale_items
  for each row execute function public.guard_reseller_sale_item();

-- 2b. Histórico imutável: item não muda de venda nem de placa, e não se apaga.
create or replace function public.guard_reseller_sale_item_change()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'O histórico de placas da venda não pode ser apagado' using errcode = '55000';
  end if;
  if new.sale_id is distinct from old.sale_id or new.plate_id is distinct from old.plate_id then
    raise exception 'Venda e placa do item são imutáveis' using errcode = '55000';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_reseller_sale_items_change_guard on public.reseller_sale_items;
create trigger trg_reseller_sale_items_change_guard
  before update or delete on public.reseller_sale_items
  for each row execute function public.guard_reseller_sale_item_change();

-- 2c. Cliente informado pertence ao revendedor da venda; venda cancelada é final.
create or replace function public.guard_reseller_sale()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.customer_id is not null and not exists (
    select 1 from public.customers c
    where c.id = new.customer_id and c.reseller_id = new.reseller_id
  ) then
    raise exception 'O cliente informado não pertence a este revendedor' using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' then
    if new.reseller_id is distinct from old.reseller_id then
      raise exception 'O revendedor da venda é imutável' using errcode = '55000';
    end if;
    if old.status = 'cancelled' and new.status <> 'cancelled' then
      raise exception 'Uma venda cancelada não pode ser reaberta' using errcode = '55000';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_reseller_sales_guard on public.reseller_sales;
create trigger trg_reseller_sales_guard
  before insert or update on public.reseller_sales
  for each row execute function public.guard_reseller_sale();

-- 2d. Cancelar a venda libera as placas para uma nova venda do MESMO
--     revendedor — sem tocar em nada operacional da placa.
create or replace function public.sync_reseller_sale_items_cancel()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'cancelled' and old.status <> 'cancelled' then
    update public.reseller_sale_items i
    set cancelled_at = now()
    where i.sale_id = new.id and i.cancelled_at is null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_reseller_sales_cancel_items on public.reseller_sales;
create trigger trg_reseller_sales_cancel_items
  after update of status on public.reseller_sales
  for each row execute function public.sync_reseller_sale_items_cancel();

-- ---------------------------------------------------------------------
-- 3. RLS — privacidade financeira
--
-- Só o próprio revendedor lê. NÃO existe policy para is_admin(): o ADMIN
-- da aplicação não tem por onde ler estas tabelas.
-- ---------------------------------------------------------------------
alter table public.reseller_sales enable row level security;
alter table public.reseller_sale_items enable row level security;

drop policy if exists reseller_sales_select on public.reseller_sales;
create policy reseller_sales_select on public.reseller_sales
  for select to authenticated
  using (reseller_sales.reseller_id = public.current_reseller_id());

drop policy if exists reseller_sale_items_select on public.reseller_sale_items;
create policy reseller_sale_items_select on public.reseller_sale_items
  for select to authenticated
  using (exists (
    select 1 from public.reseller_sales s
    where s.id = reseller_sale_items.sale_id
      and s.reseller_id = public.current_reseller_id()
  ));

grant select on public.reseller_sales to authenticated;
grant select on public.reseller_sale_items to authenticated;
revoke insert, update, delete on public.reseller_sales from anon, authenticated;
revoke insert, update, delete on public.reseller_sale_items from anon, authenticated;

-- Nem o cliente service_role lê estas tabelas. Sem isto, bastaria um
-- createAdminClient() em qualquer rota para contornar a RLS — e a
-- privacidade viraria uma convenção de código em vez de uma garantia.
-- As RPCs abaixo continuam funcionando: SECURITY DEFINER roda como owner.
revoke all on public.reseller_sales from service_role;
revoke all on public.reseller_sale_items from service_role;

-- ---------------------------------------------------------------------
-- 4. Placas elegíveis para venda final
--
--   · pertencem ao revendedor logado
--   · estado interno 'assigned' (RESERVADA: recebida e ainda não ativada)
--   · sem participação em outra venda final não cancelada
-- ---------------------------------------------------------------------
create or replace function public.reseller_sellable_plates(
  p_search  text default null,
  p_limit   integer default 200
)
returns table (
  plate_id     uuid,
  public_code  text,
  status       text,
  batch_name   text,
  created_at   timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.public_code, p.status, b.name, p.created_at
  from public.plates p
  left join public.plate_batches b on b.id = p.batch_id
  where p.reseller_id = public.current_reseller_id()
    and public.current_reseller_id() is not null
    and p.status = 'assigned'
    and not exists (
      select 1 from public.reseller_sale_items i
      where i.plate_id = p.id and i.cancelled_at is null
    )
    and (
      coalesce(btrim(p_search), '') = ''
      or p.public_code like '%' || upper(regexp_replace(p_search, '[^A-Za-z0-9]', '', 'g')) || '%'
    )
  order by p.created_at, p.public_code
  limit greatest(1, least(coalesce(p_limit, 200), 500));
$$;

-- ---------------------------------------------------------------------
-- 5. Registrar venda final
--
--   Atômica e idempotente. NÃO altera status, destino, cliente nem
--   revendedor da placa: a ativação continua sendo um passo separado.
-- ---------------------------------------------------------------------
create or replace function public.create_reseller_sale(
  p_plate_ids        uuid[],
  p_total            numeric,
  p_customer_id      uuid default null,
  p_status           text default 'pending',
  p_sold_at          date default null,
  p_notes            text default null,
  p_idempotency_key  uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reseller uuid := public.current_reseller_id();
  v_sale     uuid;
  v_ids      uuid[];
  v_count    integer;
  v_codes    text;
begin
  if v_reseller is null then
    raise exception 'Somente revendedores ativos podem registrar vendas' using errcode = '42501';
  end if;
  if p_idempotency_key is null then
    raise exception 'idempotency_key é obrigatória' using errcode = '22023';
  end if;

  -- Clique duplo / retry: serializa pela chave e devolve a venda já criada.
  perform pg_advisory_xact_lock(hashtextextended('create_reseller_sale:' || p_idempotency_key::text, 0));
  select s.id into v_sale from public.reseller_sales s
  where s.idempotency_key = p_idempotency_key and s.reseller_id = v_reseller;
  if found then
    return v_sale;
  end if;

  if p_status is null or p_status not in ('pending', 'paid') then
    raise exception 'Status inicial inválido' using errcode = '22023';
  end if;
  if p_total is null or p_total < 0 then
    raise exception 'Informe o valor total da venda' using errcode = '22023';
  end if;

  select array_agg(distinct x) into v_ids
  from unnest(coalesce(p_plate_ids, '{}'::uuid[])) as x where x is not null;
  v_count := coalesce(cardinality(v_ids), 0);
  if v_count = 0 then
    raise exception 'Selecione ao menos uma placa' using errcode = '22023';
  end if;
  if v_count > 500 then
    raise exception 'Selecione no máximo 500 placas por venda' using errcode = '22023';
  end if;

  if p_customer_id is not null and not exists (
    select 1 from public.customers c where c.id = p_customer_id and c.reseller_id = v_reseller
  ) then
    raise exception 'O cliente informado não pertence a este revendedor' using errcode = '42501';
  end if;

  -- Trava as placas em ordem estável: duas vendas simultâneas do mesmo
  -- revendedor não disputam a mesma placa.
  perform 1 from public.plates p where p.id = any(v_ids) order by p.id for update;

  select string_agg(coalesce(p.public_code, 'inexistente'), ', ' order by p.public_code) into v_codes
  from unnest(v_ids) as x
  left join public.plates p on p.id = x
  where p.id is null
     or p.reseller_id is distinct from v_reseller
     or p.status <> 'assigned'
     or exists (
          select 1 from public.reseller_sale_items i
          where i.plate_id = p.id and i.cancelled_at is null
        );
  if v_codes is not null then
    raise exception 'Estas placas não estão disponíveis para venda: %. Atualize a lista e selecione outras.', v_codes
      using errcode = '55000', detail = 'plates_not_sellable';
  end if;

  insert into public.reseller_sales (reseller_id, customer_id, status, total, sold_at, notes, idempotency_key, paid_at)
  values (
    v_reseller, p_customer_id, p_status, round(p_total, 2),
    coalesce(p_sold_at, current_date),
    nullif(btrim(coalesce(p_notes, '')), ''),
    p_idempotency_key,
    case when p_status = 'paid' then now() end
  )
  returning id into v_sale;

  -- O índice único parcial é a última barreira: se a placa já estivesse em
  -- outra venda ativa, este INSERT falha (23505) e tudo é desfeito.
  insert into public.reseller_sale_items (sale_id, plate_id)
  select v_sale, x from unnest(v_ids) as x;

  return v_sale;
end;
$$;

-- ---------------------------------------------------------------------
-- 6. Mudar o status da venda final
--
--   pending ↔ paid livremente; qualquer um → cancelled (final).
--
--   Cancelar NUNCA devolve placa ao estoque do ADMIN, não muda revendedor,
--   não apaga destino, não reverte ativação e não desliga QR. A placa
--   sequer é tocada: só o registro financeiro sai dos indicadores. Se ela
--   ainda estiver apenas RESERVADA, volta a ser elegível para outra venda
--   do mesmo revendedor porque o item foi marcado como cancelado.
-- ---------------------------------------------------------------------
create or replace function public.set_reseller_sale_status(p_sale_id uuid, p_status text)
returns setof public.reseller_sales
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reseller uuid := public.current_reseller_id();
  v_sale     public.reseller_sales%rowtype;
begin
  if v_reseller is null then
    raise exception 'Somente revendedores ativos podem alterar vendas' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('pending', 'paid', 'cancelled') then
    raise exception 'Status inválido' using errcode = '22023';
  end if;

  select * into v_sale from public.reseller_sales s
  where s.id = p_sale_id and s.reseller_id = v_reseller
  for update;
  if not found then
    raise exception 'Venda não encontrada' using errcode = 'P0002';
  end if;
  if v_sale.status = 'cancelled' then
    raise exception 'Esta venda já está cancelada' using errcode = '55000';
  end if;
  if v_sale.status = p_status then
    return query select * from public.reseller_sales s where s.id = p_sale_id;
    return;
  end if;

  update public.reseller_sales s set
    status = p_status,
    paid_at = case when p_status = 'paid' then coalesce(s.paid_at, now()) else null end,
    cancelled_at = case when p_status = 'cancelled' then now() end
  where s.id = p_sale_id;

  return query select * from public.reseller_sales s where s.id = p_sale_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 7. Indicadores do painel do revendedor
--
--   Só vendas PAGAS entram. pending e cancelled ficam de fora — e uma
--   venda paga que for cancelada depois some dos números na hora, porque
--   tudo é calculado a partir do status atual.
-- ---------------------------------------------------------------------
create or replace function public.reseller_sales_metrics(p_month date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_reseller uuid := public.current_reseller_id();
  v_from     date;
  v_to       date;
  v_revenue  numeric(14,2);
  v_sales    bigint;
  v_plates   bigint;
begin
  if v_reseller is null then
    raise exception 'Somente revendedores ativos' using errcode = '42501';
  end if;

  v_from := date_trunc('month', coalesce(p_month, current_date))::date;
  v_to := (v_from + interval '1 month')::date;

  select coalesce(sum(s.total), 0), count(*)
  into v_revenue, v_sales
  from public.reseller_sales s
  where s.reseller_id = v_reseller
    and s.status = 'paid'
    and s.sold_at >= v_from and s.sold_at < v_to;

  select count(*)
  into v_plates
  from public.reseller_sale_items i
  join public.reseller_sales s on s.id = i.sale_id
  where s.reseller_id = v_reseller
    and s.status = 'paid'
    and s.sold_at >= v_from and s.sold_at < v_to
    and i.cancelled_at is null;

  return jsonb_build_object(
    'month', v_from,
    'revenue', v_revenue,
    'sales', v_sales,
    'plates', v_plates,
    -- Sem vendas pagas no período, o ticket médio é zero (e não divisão por zero).
    'average_ticket', case when v_sales > 0 then round(v_revenue / v_sales, 2) else 0 end
  );
end;
$$;

-- Série de faturamento dos últimos meses (gráfico simples).
create or replace function public.reseller_sales_revenue_series(p_months integer default 6)
returns table (month date, revenue numeric, sales bigint)
language sql
stable
security definer
set search_path = public
as $$
  with bounds as (
    select date_trunc('month', current_date)::date as last_month,
           greatest(1, least(coalesce(p_months, 6), 24)) as months
  ),
  months as (
    select generate_series(
      (select last_month - ((months - 1) || ' month')::interval from bounds),
      (select last_month from bounds),
      interval '1 month'
    )::date as month
  )
  select m.month,
         coalesce(sum(s.total), 0)::numeric,
         count(s.id)
  from months m
  left join public.reseller_sales s
    on s.reseller_id = public.current_reseller_id()
   and s.status = 'paid'
   and s.sold_at >= m.month
   and s.sold_at < (m.month + interval '1 month')::date
  where public.current_reseller_id() is not null
  group by m.month
  order by m.month;
$$;

-- Lista de vendas com cliente e quantidade de placas (tela e dashboard).
create or replace function public.reseller_sales_list(
  p_status  text default null,
  p_limit   integer default 50,
  p_offset  integer default 0
)
returns table (
  sale_id       uuid,
  status        text,
  total         numeric,
  sold_at       date,
  notes         text,
  customer_id   uuid,
  customer_name text,
  plate_count   bigint,
  created_at    timestamptz,
  total_count   bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select s.id, s.status, s.total, s.sold_at, s.notes, s.customer_id, c.name,
         (select count(*) from public.reseller_sale_items i where i.sale_id = s.id),
         s.created_at,
         count(*) over ()
  from public.reseller_sales s
  left join public.customers c on c.id = s.customer_id
  where s.reseller_id = public.current_reseller_id()
    and public.current_reseller_id() is not null
    and (p_status is null or s.status = p_status)
  order by s.sold_at desc, s.created_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 200))
  offset greatest(0, coalesce(p_offset, 0));
$$;

-- Detalhe: as placas de uma venda, com o estado ATUAL de cada uma.
create or replace function public.reseller_sale_plates(p_sale_id uuid)
returns table (
  plate_id      uuid,
  public_code   text,
  status        text,
  cancelled_at  timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.public_code, p.status, i.cancelled_at
  from public.reseller_sale_items i
  join public.reseller_sales s on s.id = i.sale_id
  join public.plates p on p.id = i.plate_id
  where i.sale_id = p_sale_id
    and s.reseller_id = public.current_reseller_id()
    and public.current_reseller_id() is not null
  order by p.public_code;
$$;

-- ---------------------------------------------------------------------
-- 8. Permissões (todas validam current_reseller_id() por dentro)
-- ---------------------------------------------------------------------
revoke all on function public.create_reseller_sale(uuid[], numeric, uuid, text, date, text, uuid) from public, anon;
grant execute on function public.create_reseller_sale(uuid[], numeric, uuid, text, date, text, uuid) to authenticated;

revoke all on function public.set_reseller_sale_status(uuid, text) from public, anon;
grant execute on function public.set_reseller_sale_status(uuid, text) to authenticated;

revoke all on function public.reseller_sellable_plates(text, integer) from public, anon;
grant execute on function public.reseller_sellable_plates(text, integer) to authenticated;

revoke all on function public.reseller_sales_metrics(date) from public, anon;
grant execute on function public.reseller_sales_metrics(date) to authenticated;

revoke all on function public.reseller_sales_revenue_series(integer) from public, anon;
grant execute on function public.reseller_sales_revenue_series(integer) to authenticated;

revoke all on function public.reseller_sales_list(text, integer, integer) from public, anon;
grant execute on function public.reseller_sales_list(text, integer, integer) to authenticated;

revoke all on function public.reseller_sale_plates(uuid) from public, anon;
grant execute on function public.reseller_sale_plates(uuid) to authenticated;

revoke all on function public.guard_reseller_sale() from public, anon, authenticated;
revoke all on function public.guard_reseller_sale_item() from public, anon, authenticated;
revoke all on function public.guard_reseller_sale_item_change() from public, anon, authenticated;
revoke all on function public.sync_reseller_sale_items_cancel() from public, anon, authenticated;
