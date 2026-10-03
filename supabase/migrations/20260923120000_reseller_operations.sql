-- =====================================================================
-- 008 · Operação: configuração de placas pelo revendedor, redirect sem
--       efeitos colaterais, histórico automático de atribuições e
--       contadores de acesso
--
-- Incremental: não altera as migrations anteriores; substitui apenas
-- resolve_plate_redirect (via CREATE OR REPLACE) e o trigger de updated_at
-- da tabela plates.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Novas colunas em plates
-- ---------------------------------------------------------------------
alter table public.plates add column if not exists access_count       bigint not null default 0;
alter table public.plates add column if not exists last_access_at     timestamptz;

-- Novo status operacional: "inactive" (pausada pelo revendedor ou pelo ADMIN).
-- "blocked" continua sendo o bloqueio administrativo.
alter table public.plates drop constraint if exists plates_status_check;
alter table public.plates add constraint plates_status_check
  check (status in ('in_stock', 'assigned', 'active', 'inactive', 'blocked'));

-- Coerência de status. NOT VALID: vale para toda escrita nova sem exigir
-- que linhas antigas já estejam coerentes.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'plates_active_requires_destination') then
    alter table public.plates add constraint plates_active_requires_destination
      check (status <> 'active' or destination_url is not null) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'plates_status_reseller_check') then
    alter table public.plates add constraint plates_status_reseller_check
      check ((status <> 'in_stock' or reseller_id is null) and (status <> 'assigned' or reseller_id is not null)) not valid;
  end if;
end;
$$;

create index if not exists plates_status_idx on public.plates (status);
create index if not exists plates_created_at_idx on public.plates (created_at desc);
create index if not exists redirects_created_at_idx on public.redirects (created_at);

-- ---------------------------------------------------------------------
-- updated_at de plates: contadores de acesso não contam como alteração
-- ---------------------------------------------------------------------
create or replace function public.plates_set_updated_at()
returns trigger
language plpgsql
as $$
declare
  v_ignored constant text[] := array['updated_at', 'access_count', 'last_access_at'];
begin
  if (to_jsonb(new) - v_ignored) is distinct from (to_jsonb(old) - v_ignored) then
    new.updated_at = now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_plates_updated_at on public.plates;
create trigger trg_plates_updated_at
  before update on public.plates
  for each row execute function public.plates_set_updated_at();

-- ---------------------------------------------------------------------
-- Cliente da placa precisa ser do mesmo revendedor (vale até para ADMIN)
-- ---------------------------------------------------------------------
create or replace function public.guard_plate_customer()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
begin
  if new.customer_id is null then
    return new;
  end if;
  select c.reseller_id into v_owner from public.customers c where c.id = new.customer_id;
  if new.reseller_id is null or v_owner is distinct from new.reseller_id then
    raise exception 'O cliente precisa pertencer ao mesmo revendedor da placa'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_plates_customer_guard on public.plates;
create trigger trg_plates_customer_guard
  before insert or update of customer_id, reseller_id on public.plates
  for each row execute function public.guard_plate_customer();

-- ---------------------------------------------------------------------
-- Histórico de atribuições automático
-- Qualquer mudança de plates.reseller_id (RPC, painel ou SQL manual) fecha
-- a atribuição ativa e abre uma nova. O histórico nunca se perde.
-- ---------------------------------------------------------------------
create or replace function public.track_plate_assignment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    if new.reseller_id is not distinct from old.reseller_id then
      return null;
    end if;
    update public.plate_assignments
       set unassigned_at = now()
     where plate_id = new.id
       and unassigned_at is null;
  end if;

  if new.reseller_id is not null then
    insert into public.plate_assignments (plate_id, reseller_id, assigned_by)
    values (new.id, new.reseller_id, auth.uid());
  end if;
  return null;
end;
$$;

drop trigger if exists trg_plates_track_assignment on public.plates;
create trigger trg_plates_track_assignment
  after insert or update of reseller_id on public.plates
  for each row execute function public.track_plate_assignment();

-- Placas que já tinham revendedor sem registro de atribuição ativa.
insert into public.plate_assignments (plate_id, reseller_id, assigned_at)
select p.id, p.reseller_id, coalesce(p.updated_at, p.created_at)
from public.plates p
where p.reseller_id is not null
  and not exists (
    select 1 from public.plate_assignments a where a.plate_id = p.id and a.unassigned_at is null
  );

-- ---------------------------------------------------------------------
-- Contadores de acesso (derivados de redirects)
-- ---------------------------------------------------------------------
create or replace function public.count_plate_access()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.plates p set
    access_count = p.access_count + 1,
    last_access_at = new.created_at
  where p.id = new.plate_id;
  return null;
end;
$$;

drop trigger if exists trg_redirects_count_access on public.redirects;
create trigger trg_redirects_count_access
  after insert on public.redirects
  for each row execute function public.count_plate_access();

-- Backfill a partir do log já existente.
update public.plates p set
  access_count = s.total,
  last_access_at = s.last_at
from (
  select plate_id,
         count(*) as total,
         max(created_at) as last_at
  from public.redirects
  group by plate_id
) s
where s.plate_id = p.id
  and p.access_count = 0;

-- ---------------------------------------------------------------------
-- Redirect público (substitui a versão da migration 005)
--   · src=qr / src=nfc / outro só registram a origem em redirects.source
--     (analytics). O acesso NUNCA altera o estado físico da placa.
--   · Só placas "active" com destino válido redirecionam.
-- ---------------------------------------------------------------------
create or replace function public.resolve_plate_redirect(p_code text, p_source text)
returns table (outcome text, target_url text, code text)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_plate  public.plates%rowtype;
  v_code   text := upper(btrim(coalesce(p_code, '')));
  v_source text := case when p_source in ('qr', 'nfc') then p_source else 'unknown' end;
begin
  if v_code !~ '^[A-Z0-9]{4,12}$' then
    return query select 'not_found'::text, null::text, v_code;
    return;
  end if;

  select * into v_plate from public.plates p where p.public_code = v_code;
  if not found then
    return query select 'not_found'::text, null::text, v_code;
    return;
  end if;

  insert into public.redirects (plate_id, source) values (v_plate.id, v_source);

  if v_plate.status = 'blocked' then
    return query select 'blocked'::text, null::text, v_code;
    return;
  end if;
  if v_plate.status = 'inactive' then
    return query select 'inactive'::text, null::text, v_code;
    return;
  end if;
  if v_plate.status <> 'active' or v_plate.destination_url is null or v_plate.destination_url !~* '^https?://' then
    return query select 'unconfigured'::text, null::text, v_code;
    return;
  end if;

  return query select 'ok'::text, v_plate.destination_url, v_code;
end;
$$;

-- ---------------------------------------------------------------------
-- Validação de URL de destino (usada pelas RPCs)
-- ---------------------------------------------------------------------
create or replace function public.is_valid_destination_url(p_url text)
returns boolean
language sql
immutable
as $$
  select p_url is not null
     and char_length(p_url) <= 2048
     and p_url ~* '^https?://[a-z0-9.-]+\.[a-z]{2,}(:[0-9]{1,5})?([/?#][^[:space:]]*)?$';
$$;

-- ---------------------------------------------------------------------
-- RESELLER: configurar a própria placa
-- Sem UPDATE genérico na tabela: o revendedor só altera placas pela RPC,
-- e a RPC só toca em customer_id, destination_type, destination_url e status.
-- ---------------------------------------------------------------------
create or replace function public.configure_reseller_plate(
  p_plate_id          uuid,
  p_customer_id       uuid,
  p_destination_type  text,
  p_destination_url   text,
  p_status            text default null
)
returns setof public.plates
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_profile  public.profiles%rowtype;
  v_reseller uuid;
  v_plate    public.plates%rowtype;
  v_url      text := nullif(btrim(coalesce(p_destination_url, '')), '');
  v_type     text := nullif(btrim(coalesce(p_destination_type, '')), '');
  v_status   text;
begin
  -- 1. autenticado
  if v_uid is null then
    raise exception 'Faça login para continuar' using errcode = '42501';
  end if;
  -- 2 e 3. ativo e RESELLER
  select * into v_profile from public.profiles pr where pr.id = v_uid;
  if not found or not v_profile.active then
    raise exception 'Usuário inativo' using errcode = '42501';
  end if;
  if v_profile.role <> 'reseller' then
    raise exception 'Somente revendedores configuram placas por esta operação' using errcode = '42501';
  end if;
  v_reseller := public.current_reseller_id();
  if v_reseller is null then
    raise exception 'Cadastro de revendedor não encontrado' using errcode = '42501';
  end if;

  -- 4. a placa pertence ao revendedor (não revela se a placa existe para outro)
  select * into v_plate from public.plates p where p.id = p_plate_id for update;
  if not found or v_plate.reseller_id is distinct from v_reseller then
    raise exception 'Placa não encontrada' using errcode = 'P0002';
  end if;
  if v_plate.status = 'blocked' then
    raise exception 'Esta placa foi bloqueada pelo administrador' using errcode = '55000';
  end if;

  -- 5. cliente do mesmo revendedor
  if p_customer_id is not null and not exists (
    select 1 from public.customers c where c.id = p_customer_id and c.reseller_id = v_reseller
  ) then
    raise exception 'Cliente inválido para este revendedor' using errcode = '22023';
  end if;

  -- 6 e 7. tipo permitido e URL HTTP/HTTPS
  if v_url is null then
    v_type := null;
  else
    if not public.is_valid_destination_url(v_url) then
      raise exception 'Informe uma URL de destino válida, começando com http:// ou https://' using errcode = '22023';
    end if;
    if v_type is null then
      raise exception 'Escolha o tipo de destino' using errcode = '22023';
    end if;
  end if;
  if v_type is not null and v_type not in ('google_review', 'whatsapp', 'instagram', 'menu', 'pix', 'website', 'custom') then
    raise exception 'Tipo de destino não permitido' using errcode = '22023';
  end if;

  -- status operacional permitido ao revendedor: active / inactive
  if p_status is null then
    v_status := case when v_plate.status = 'active' and v_url is null then 'assigned' else v_plate.status end;
  elsif p_status = 'active' then
    if v_url is null then
      raise exception 'Informe o destino para ativar a placa' using errcode = '22023';
    end if;
    v_status := 'active';
  elsif p_status = 'inactive' then
    v_status := 'inactive';
  else
    raise exception 'Status não permitido para o revendedor' using errcode = '22023';
  end if;

  update public.plates p set
    customer_id = p_customer_id,
    destination_type = v_type,
    destination_url = v_url,
    status = v_status
  where p.id = p_plate_id;

  return query select * from public.plates p where p.id = p_plate_id;
end;
$$;

-- ---------------------------------------------------------------------
-- ADMIN: atribuir placas de estoque a um revendedor (transacional)
--   · por quantidade: as N placas em estoque mais antigas (opcionalmente de um lote)
--   · por seleção manual: todas precisam estar em estoque, senão nada é atribuído
-- O histórico (plate_assignments) é gravado pelo trigger.
-- ---------------------------------------------------------------------
create or replace function public.assign_plates_to_reseller(
  p_reseller_id  uuid,
  p_quantity     integer default null,
  p_plate_ids    uuid[] default null,
  p_batch_id     uuid default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids   uuid[];
  v_ready integer;
begin
  if not public.is_admin() then
    raise exception 'Somente ADMIN pode atribuir placas' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.reseller_profiles rp join public.profiles pr on pr.id = rp.user_id
    where rp.id = p_reseller_id and pr.active and pr.role = 'reseller'
  ) then
    raise exception 'Revendedor inválido ou inativo' using errcode = '22023';
  end if;
  if (p_quantity is null) = (p_plate_ids is null) then
    raise exception 'Informe a quantidade OU as placas selecionadas' using errcode = '22023';
  end if;

  if p_plate_ids is not null then
    select array_agg(distinct x) into v_ids from unnest(p_plate_ids) as x;
    if v_ids is null or cardinality(v_ids) = 0 or cardinality(v_ids) > 1000 then
      raise exception 'Selecione entre 1 e 1000 placas' using errcode = '22023';
    end if;
    perform 1 from public.plates p where p.id = any(v_ids) order by p.id for update;
    select count(*) into v_ready
    from public.plates p
    where p.id = any(v_ids) and p.reseller_id is null and p.status = 'in_stock';
    if v_ready <> cardinality(v_ids) then
      raise exception 'Algumas placas selecionadas não estão mais disponíveis em estoque' using errcode = '55000';
    end if;
  else
    if p_quantity < 1 or p_quantity > 1000 then
      raise exception 'A quantidade deve estar entre 1 e 1000' using errcode = '22023';
    end if;
    select array_agg(s.id) into v_ids
    from (
      select p.id
      from public.plates p
      where p.reseller_id is null
        and p.status = 'in_stock'
        and (p_batch_id is null or p.batch_id = p_batch_id)
      order by p.created_at, p.public_code
      limit p_quantity
      for update skip locked
    ) s;
    if coalesce(cardinality(v_ids), 0) < p_quantity then
      raise exception 'Há apenas % placas disponíveis em estoque', coalesce(cardinality(v_ids), 0)
        using errcode = '55000';
    end if;
  end if;

  update public.plates p set
    reseller_id = p_reseller_id,
    customer_id = null,
    status = 'assigned'
  where p.id = any(v_ids);

  return cardinality(v_ids);
end;
$$;

-- ---------------------------------------------------------------------
-- ADMIN: atribuir, trocar ou retirar o revendedor de UMA placa.
-- Ao trocar ou retirar, a configuração (cliente e destino) é zerada: o
-- cliente pertence ao revendedor anterior.
-- ---------------------------------------------------------------------
create or replace function public.set_plate_reseller(p_plate_id uuid, p_reseller_id uuid)
returns setof public.plates
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plate public.plates%rowtype;
begin
  if not public.is_admin() then
    raise exception 'Somente ADMIN pode alterar o revendedor de uma placa' using errcode = '42501';
  end if;

  select * into v_plate from public.plates p where p.id = p_plate_id for update;
  if not found then
    raise exception 'Placa não encontrada' using errcode = 'P0002';
  end if;

  if p_reseller_id is not distinct from v_plate.reseller_id then
    return query select * from public.plates p where p.id = p_plate_id;
    return;
  end if;

  if p_reseller_id is not null and not exists (
    select 1 from public.reseller_profiles rp join public.profiles pr on pr.id = rp.user_id
    where rp.id = p_reseller_id and pr.active and pr.role = 'reseller'
  ) then
    raise exception 'Revendedor inválido ou inativo' using errcode = '22023';
  end if;

  update public.plates p set
    reseller_id = p_reseller_id,
    customer_id = null,
    destination_type = null,
    destination_url = null,
    status = case
      when p.status = 'blocked' then 'blocked'
      when p_reseller_id is null then 'in_stock'
      else 'assigned'
    end
  where p.id = p_plate_id;

  return query select * from public.plates p where p.id = p_plate_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Métricas do painel do revendedor
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
    'accesses', coalesce(sum(p.access_count), 0)
  ) into v_result
  from public.plates p
  where p.reseller_id = v_reseller;

  return v_result || jsonb_build_object(
    'customers', (select count(*) from public.customers c where c.reseller_id = v_reseller)
  );
end;
$$;

-- ---------------------------------------------------------------------
-- Estatísticas por revendedor (lista e detalhe no ADMIN)
-- ---------------------------------------------------------------------
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
           coalesce(sum(p.access_count), 0)::bigint as accesses
    from public.plates p
    where p.reseller_id = rp.id
  ) pl on true
  left join lateral (
    select count(*) as total from public.customers c where c.reseller_id = rp.id
  ) cu on true
  where public.is_admin()
    and (p_reseller_id is null or rp.id = p_reseller_id)
  order by rp.company_name;
$$;

-- ---------------------------------------------------------------------
-- Permissões de execução
-- ---------------------------------------------------------------------
revoke all on function public.configure_reseller_plate(uuid, uuid, text, text, text) from public, anon;
grant execute on function public.configure_reseller_plate(uuid, uuid, text, text, text) to authenticated;

revoke all on function public.assign_plates_to_reseller(uuid, integer, uuid[], uuid) from public, anon;
grant execute on function public.assign_plates_to_reseller(uuid, integer, uuid[], uuid) to authenticated;

revoke all on function public.set_plate_reseller(uuid, uuid) from public, anon;
grant execute on function public.set_plate_reseller(uuid, uuid) to authenticated;

revoke all on function public.reseller_dashboard_metrics() from public, anon;
grant execute on function public.reseller_dashboard_metrics() to authenticated;

revoke all on function public.admin_reseller_stats(uuid) from public, anon;
grant execute on function public.admin_reseller_stats(uuid) to authenticated;
