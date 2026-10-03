-- =====================================================================
-- 018 · Clientes: nome de exibição e quarentena (sem exclusão física)
--
-- 1. Nome de exibição (só apresentação; nenhum dado é alterado):
--      empresa/comércio preenchido → é o nome principal
--      empresa vazia               → o nome da pessoa é usado
--    customer_display_name() é a MESMA regra de getCustomerDisplayName()
--    no TypeScript. As RPCs que devolviam c.name passam a devolver o nome
--    de exibição (mesmas assinaturas).
--
-- 2. Quarentena no lugar do DELETE:
--    · customers.archived_at / archived_by / archive_reason
--    · quarantine_customer() e restore_customer(), sempre amarradas a
--      current_reseller_id() — um revendedor só mexe nos próprios clientes
--    · DELETE físico de customers é recusado pelo banco (trigger) e o
--      privilégio de DELETE é revogado de anon/authenticated
--    · as colunas de quarentena só mudam pelas RPCs
--    · cliente em quarentena não recebe nova venda nem nova placa; o que
--      já existe (vendas, placas, histórico) continua intacto
--
-- Incremental; não altera migrations anteriores. Funções já existentes são
-- substituídas via CREATE OR REPLACE com as mesmas assinaturas.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Nome de exibição
-- ---------------------------------------------------------------------
create or replace function public.customer_display_name(p_name text, p_company_name text)
returns text
language sql
immutable
as $$
  select coalesce(nullif(btrim(p_company_name), ''), nullif(btrim(p_name), ''), p_name);
$$;

comment on function public.customer_display_name(text, text) is
  'Nome principal do cliente nas telas: empresa/comércio quando preenchida, senão o nome da pessoa. Espelha getCustomerDisplayName().';

-- ---------------------------------------------------------------------
-- 2. Colunas de quarentena
-- ---------------------------------------------------------------------
alter table public.customers add column if not exists archived_at timestamptz;
-- Sem FK de propósito: a trilha sobrevive à remoção do usuário (e uma FK com
-- SET NULL colidiria com a guarda de colunas abaixo).
alter table public.customers add column if not exists archived_by uuid;
alter table public.customers add column if not exists archive_reason text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'customers_archive_reason_check') then
    alter table public.customers add constraint customers_archive_reason_check
      check (archive_reason is null or char_length(archive_reason) <= 500);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'customers_archive_consistency_check') then
    alter table public.customers add constraint customers_archive_consistency_check
      check (archived_at is not null or (archived_by is null and archive_reason is null));
  end if;
end;
$$;

comment on column public.customers.archived_at is
  'Quarentena: preenchido = cliente fora das listas e das novas vendas. Nunca há exclusão física.';

create index if not exists customers_active_idx on public.customers (reseller_id) where archived_at is null;

-- ---------------------------------------------------------------------
-- 3. Guardas: sem DELETE físico; quarentena só pelas RPCs
-- ---------------------------------------------------------------------
create or replace function public.guard_customer_lifecycle()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Clientes não são excluídos: use a quarentena para retirá-lo das listas.'
      using errcode = '55000', detail = 'customer_delete_blocked';
  end if;

  if coalesce(current_setting('app.customer_quarantine', true), '') <> 'on' then
    if tg_op = 'INSERT' and (new.archived_at is not null or new.archived_by is not null or new.archive_reason is not null) then
      raise exception 'Cliente novo não nasce em quarentena' using errcode = '42501';
    end if;
    if tg_op = 'UPDATE' and (
         new.archived_at is distinct from old.archived_at
      or new.archived_by is distinct from old.archived_by
      or new.archive_reason is distinct from old.archive_reason
    ) then
      raise exception 'A quarentena do cliente só muda pelas ações Excluir e Restaurar' using errcode = '42501';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists trg_customers_lifecycle_guard on public.customers;
create trigger trg_customers_lifecycle_guard
  before insert or update or delete on public.customers
  for each row execute function public.guard_customer_lifecycle();

revoke delete on public.customers from anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. Cliente em quarentena não recebe nova venda nem nova placa
--    (o vínculo que já existe continua; restaurar o vínculo anterior no
--    cancelamento de venda usa o desvio app.allow_archived_customer)
-- ---------------------------------------------------------------------
create or replace function public.guard_archived_customer_link()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
begin
  if new.customer_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.customer_id is not distinct from old.customer_id then
    return new;
  end if;
  if coalesce(current_setting('app.allow_archived_customer', true), '') = 'on' then
    return new;
  end if;
  select public.customer_display_name(c.name, c.company_name) into v_name
  from public.customers c
  where c.id = new.customer_id and c.archived_at is not null;
  if found then
    raise exception 'O cliente "%" está em quarentena. Restaure-o em Clientes para usá-lo de novo.', v_name
      using errcode = '55000', detail = 'customer_archived';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_plates_archived_customer_guard on public.plates;
create trigger trg_plates_archived_customer_guard
  before insert or update of customer_id on public.plates
  for each row execute function public.guard_archived_customer_link();

drop trigger if exists trg_reseller_sales_archived_customer_guard on public.reseller_sales;
create trigger trg_reseller_sales_archived_customer_guard
  before insert or update of customer_id on public.reseller_sales
  for each row execute function public.guard_archived_customer_link();

-- ---------------------------------------------------------------------
-- 5. Quarentena e restauração (só o próprio revendedor)
-- ---------------------------------------------------------------------
create or replace function public.quarantine_customer(p_customer_id uuid, p_reason text default null)
returns setof public.customers
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reseller uuid := public.current_reseller_id();
  v_customer public.customers%rowtype;
begin
  if v_reseller is null then
    raise exception 'Somente revendedores ativos gerenciam clientes' using errcode = '42501';
  end if;
  select * into v_customer from public.customers c
  where c.id = p_customer_id and c.reseller_id = v_reseller
  for update;
  if not found then
    raise exception 'Cliente não encontrado' using errcode = 'P0002';
  end if;

  if v_customer.archived_at is null then
    perform set_config('app.customer_quarantine', 'on', true);
    update public.customers c set
      archived_at = now(),
      archived_by = auth.uid(),
      archive_reason = left(nullif(btrim(coalesce(p_reason, '')), ''), 500)
    where c.id = p_customer_id;
    perform set_config('app.customer_quarantine', 'off', true);
  end if;

  return query select * from public.customers c where c.id = p_customer_id;
end;
$$;

create or replace function public.restore_customer(p_customer_id uuid)
returns setof public.customers
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reseller uuid := public.current_reseller_id();
begin
  if v_reseller is null then
    raise exception 'Somente revendedores ativos gerenciam clientes' using errcode = '42501';
  end if;
  perform 1 from public.customers c
  where c.id = p_customer_id and c.reseller_id = v_reseller
  for update;
  if not found then
    raise exception 'Cliente não encontrado' using errcode = 'P0002';
  end if;

  perform set_config('app.customer_quarantine', 'on', true);
  update public.customers c set archived_at = null, archived_by = null, archive_reason = null
  where c.id = p_customer_id;
  perform set_config('app.customer_quarantine', 'off', true);

  return query select * from public.customers c where c.id = p_customer_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 6. Cancelamento de venda B2C: restaurar o cliente ANTERIOR da placa não
--    é uma nova atribuição, então vale mesmo se ele estiver em quarentena.
--    (mesma lógica da migration 017, com o desvio explícito)
-- ---------------------------------------------------------------------
create or replace function public.sync_reseller_sale_items_cancel()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_undone uuid[];
begin
  if new.status = 'cancelled' and old.status <> 'cancelled' then
    perform set_config('app.allow_archived_customer', 'on', true);
    with undo as (
      update public.plates p set customer_id = i.previous_customer_id
      from public.reseller_sale_items i
      where i.sale_id = new.id
        and i.cancelled_at is null
        and i.customer_linked
        and p.id = i.plate_id
        and p.reseller_id = new.reseller_id
        and p.status = 'assigned'
        and p.destination_url is null
        and p.destination_type is null
        and p.customer_id is not distinct from new.customer_id
      returning p.id
    )
    select array_agg(id) into v_undone from undo;
    perform set_config('app.allow_archived_customer', 'off', true);

    update public.reseller_sale_items i set
      cancelled_at = now(),
      customer_unlinked_at = case when i.plate_id = any(coalesce(v_undone, '{}'::uuid[])) then now() end
    where i.sale_id = new.id and i.cancelled_at is null;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- 7. Contagens de clientes: só os ativos (mesmas assinaturas)
-- ---------------------------------------------------------------------
create or replace function public.reseller_dashboard_metrics()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_reseller uuid := public.current_reseller_id();
  v_result   jsonb;
begin
  if v_reseller is null then
    raise exception 'Somente revendedores ativos' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'plates', count(*),
    'available', count(*) filter (where p.destination_url is null),
    'configured', count(*) filter (where p.destination_url is not null),
    'active', count(*) filter (where p.status = 'active'),
    'inactive', count(*) filter (where p.status = 'inactive'),
    'accesses', coalesce(sum(p.qr_access_count), 0)
  ) into v_result
  from public.plates p
  where p.reseller_id = v_reseller;

  return v_result || jsonb_build_object(
    'customers', (select count(*) from public.customers c where c.reseller_id = v_reseller and c.archived_at is null)
  );
end;
$$;

create or replace function public.admin_reseller_stats(p_reseller_id uuid default null)
returns table (
  reseller_id        uuid,
  user_id            uuid,
  company_name       text,
  contact_name       text,
  email              text,
  document           text,
  phone              text,
  active             boolean,
  created_at         timestamptz,
  plates_total       bigint,
  plates_available   bigint,
  plates_configured  bigint,
  plates_active      bigint,
  customers          bigint,
  accesses           bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    rp.id, rp.user_id, rp.company_name, pr.name, pr.email, rp.document, rp.phone, pr.active, rp.created_at,
    coalesce(pl.total, 0), coalesce(pl.available, 0), coalesce(pl.configured, 0), coalesce(pl.active, 0),
    coalesce(cu.total, 0), coalesce(pl.accesses, 0)
  from public.reseller_profiles rp
  join public.profiles pr on pr.id = rp.user_id
  left join lateral (
    select count(*) as total,
           count(*) filter (where p.destination_url is null) as available,
           count(*) filter (where p.destination_url is not null) as configured,
           count(*) filter (where p.status = 'active') as active,
           coalesce(sum(p.qr_access_count), 0)::bigint as accesses
    from public.plates p
    where p.reseller_id = rp.id
  ) pl on true
  left join lateral (
    select count(*) as total from public.customers c where c.reseller_id = rp.id and c.archived_at is null
  ) cu on true
  where public.is_admin()
    and (p_reseller_id is null or rp.id = p_reseller_id)
  order by rp.company_name;
$$;

-- ---------------------------------------------------------------------
-- 8. RPCs que exibem o cliente: nome de exibição (mesmas assinaturas).
--    O histórico mostra o cliente mesmo que ele esteja em quarentena.
-- ---------------------------------------------------------------------
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
  select s.id, s.status, s.total, s.sold_at, s.notes, s.customer_id,
         public.customer_display_name(c.name, c.company_name),
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

create or replace function public.reseller_qr_access_by_plate(
  p_from    timestamptz,
  p_to      timestamptz,
  p_limit   integer default 15,
  p_offset  integer default 0
)
returns table (
  plate_id       uuid,
  public_code    text,
  customer_name  text,
  qr_accesses    bigint,
  total_count    bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with counts as (
    select r.plate_id, count(*) as qr
    from public.redirects r
    join public.plates p on p.id = r.plate_id
    where r.source = 'qr'
      and r.created_at >= p_from and r.created_at < p_to
      and p.reseller_id = public.current_reseller_id()
    group by r.plate_id
  )
  select p.id, p.public_code, public.customer_display_name(c.name, c.company_name), k.qr, count(*) over ()
  from counts k
  join public.plates p on p.id = k.plate_id
  left join public.customers c on c.id = p.customer_id
  where public.current_reseller_id() is not null
  order by k.qr desc, p.public_code
  limit greatest(1, least(coalesce(p_limit, 15), 200))
  offset greatest(0, coalesce(p_offset, 0));
$$;

create or replace function public.admin_qr_access_by_plate(
  p_from   timestamptz,
  p_to     timestamptz,
  p_limit  integer default 10
)
returns table (
  plate_id       uuid,
  public_code    text,
  reseller_name  text,
  customer_name  text,
  qr_accesses    bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with counts as (
    select r.plate_id, count(*) as qr
    from public.redirects r
    where r.source = 'qr' and r.created_at >= p_from and r.created_at < p_to
    group by r.plate_id
  )
  select p.id, p.public_code, rp.company_name, public.customer_display_name(c.name, c.company_name), k.qr
  from counts k
  join public.plates p on p.id = k.plate_id
  left join public.reseller_profiles rp on rp.id = p.reseller_id
  left join public.customers c on c.id = p.customer_id
  where public.is_admin()
  order by k.qr desc, p.public_code
  limit greatest(1, least(coalesce(p_limit, 10), 100));
$$;

create or replace function public.reseller_sale_plate_setup(p_sale_id uuid)
returns table (
  plate_id        uuid,
  public_code     text,
  status          text,
  customer_id     uuid,
  customer_name   text,
  configured      boolean,
  cancelled_at    timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.public_code, p.status, p.customer_id, public.customer_display_name(c.name, c.company_name),
         p.destination_url is not null, i.cancelled_at
  from public.reseller_sale_items i
  join public.reseller_sales s on s.id = i.sale_id
  join public.plates p on p.id = i.plate_id
  left join public.customers c on c.id = p.customer_id
  where i.sale_id = p_sale_id
    and s.reseller_id = public.current_reseller_id()
    and public.current_reseller_id() is not null
    and p.reseller_id = s.reseller_id
  order by p.public_code;
$$;

-- ---------------------------------------------------------------------
-- 9. Permissões
-- ---------------------------------------------------------------------
revoke all on function public.quarantine_customer(uuid, text) from public, anon;
grant execute on function public.quarantine_customer(uuid, text) to authenticated;
revoke all on function public.restore_customer(uuid) from public, anon;
grant execute on function public.restore_customer(uuid) to authenticated;
grant execute on function public.customer_display_name(text, text) to anon, authenticated;

revoke all on function public.reseller_dashboard_metrics() from public, anon;
grant execute on function public.reseller_dashboard_metrics() to authenticated;
revoke all on function public.admin_reseller_stats(uuid) from public, anon;
grant execute on function public.admin_reseller_stats(uuid) to authenticated;
revoke all on function public.reseller_sales_list(text, integer, integer) from public, anon;
grant execute on function public.reseller_sales_list(text, integer, integer) to authenticated;
revoke all on function public.reseller_qr_access_by_plate(timestamptz, timestamptz, integer, integer) from public, anon;
grant execute on function public.reseller_qr_access_by_plate(timestamptz, timestamptz, integer, integer) to authenticated;
revoke all on function public.admin_qr_access_by_plate(timestamptz, timestamptz, integer) from public, anon;
grant execute on function public.admin_qr_access_by_plate(timestamptz, timestamptz, integer) to authenticated;
revoke all on function public.reseller_sale_plate_setup(uuid) from public, anon;
grant execute on function public.reseller_sale_plate_setup(uuid) to authenticated;

revoke all on function public.guard_customer_lifecycle() from public, anon, authenticated;
revoke all on function public.guard_archived_customer_link() from public, anon, authenticated;
revoke all on function public.sync_reseller_sale_items_cancel() from public, anon, authenticated;
