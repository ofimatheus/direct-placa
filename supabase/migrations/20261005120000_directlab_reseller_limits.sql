-- =====================================================================
-- 024 · DirectLab: limites por revendedor, definidos pelo ADMIN
--
--   · Avaliação Google: utilizações POR DIA (dia de Brasília). Padrão 10.
--   · DirectLink: quantidade máxima de páginas que o revendedor pode
--     possuir (total, não diário). Padrão 3.
--   · ADMIN: sem limite (como antes).
--
-- Guarda só o limite ATUAL (sem histórico nem auditoria). Revendedor sem
-- linha em reseller_directlab_limits usa os padrões.
--
-- Reduzir um limite nunca apaga nem desativa nada: só bloqueia NOVAS
-- utilizações/páginas enquanto o uso estiver no limite ou acima.
--
-- Substitui (CREATE OR REPLACE) directlab_consume e directlab_quota_status
-- da migration 021 para lerem o limite do revendedor. A migration 021 não é
-- alterada; a proteção curta (10/min) e a virada à meia-noite de Brasília
-- continuam iguais.
--
-- Incremental e idempotente.
-- =====================================================================

create table if not exists public.reseller_directlab_limits (
  reseller_id          uuid primary key references public.reseller_profiles (id) on delete cascade,
  google_review_daily  integer not null,
  directlink_pages     integer not null,
  updated_at           timestamptz not null default now(),
  constraint reseller_directlab_limits_google_check check (google_review_daily between 0 and 1000),
  constraint reseller_directlab_limits_pages_check check (directlink_pages between 0 and 1000)
);

comment on table public.reseller_directlab_limits is
  'Limites do DirectLab por revendedor (só o valor atual). Sem linha = padrões (10/dia e 3 páginas).';

-- Sem acesso direto: só as funções abaixo leem/escrevem.
alter table public.reseller_directlab_limits enable row level security;
revoke all on public.reseller_directlab_limits from anon, authenticated;

-- Padrões (uma fonte só).
create or replace function public.directlab_default_limits()
returns table (google_review_daily integer, directlink_pages integer)
language sql
immutable
as $$
  select 10, 3;
$$;

-- Limites efetivos de um revendedor (padrão quando não personalizado). Uso interno.
create or replace function public.directlab_effective_limits(p_reseller uuid)
returns table (google_review_daily integer, directlink_pages integer, customized boolean)
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(l.google_review_daily, d.google_review_daily),
         coalesce(l.directlink_pages, d.directlink_pages),
         l.reseller_id is not null
  from public.directlab_default_limits() d
  left join public.reseller_directlab_limits l on l.reseller_id = p_reseller;
$$;
revoke all on function public.directlab_effective_limits(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Avaliação Google: consumo com o limite diário do revendedor
-- ---------------------------------------------------------------------
create or replace function public.directlab_consume(p_kind text)
returns table (
  allowed              boolean,
  reason               text,
  used_today           integer,
  daily_limit          integer,
  retry_after_seconds  integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_admin     boolean;
  v_reseller  uuid;
  v_limits    record;
  v_limit     integer;
  v_now       timestamptz := now();
  v_today     date;
  v_minute    bigint;
  v_hits      integer;
begin
  if v_uid is null then
    raise exception 'Faça login para continuar' using errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('burst', 'daily') then
    raise exception 'Tipo de contador inválido' using errcode = '22023';
  end if;

  v_admin := public.is_admin();
  v_reseller := case when v_admin then null else public.current_reseller_id() end;
  if not v_admin and v_reseller is null then
    raise exception 'Somente ADMIN ou revendedor ativo usam o DirectLab' using errcode = '42501';
  end if;

  select * into v_limits from public.directlab_limits();
  v_today := public.directlab_usage_day(v_now);
  if not v_admin then
    select e.google_review_daily into v_limit from public.directlab_effective_limits(v_reseller) e;
  end if;

  if p_kind = 'burst' then
    v_minute := floor(extract(epoch from v_now) / v_limits.burst_window_seconds)::bigint;
    delete from public.directlab_usage u
    where u.user_id = v_uid and u.kind = 'burst' and u.period <> v_minute::text;

    insert into public.directlab_usage as u (user_id, kind, period, hits)
    values (v_uid, 'burst', v_minute::text, 1)
    on conflict (user_id, kind, period) do update set hits = u.hits + 1
    returning u.hits into v_hits;

    allowed := v_hits <= v_limits.burst_max;
    reason := case when allowed then null else 'burst' end;
    retry_after_seconds := case when allowed then 0
      else greatest(1, ((v_minute + 1) * v_limits.burst_window_seconds - extract(epoch from v_now))::integer) end;
    if v_admin then
      used_today := null;
      daily_limit := null;
    else
      select coalesce(max(u.hits), 0) into used_today
      from public.directlab_usage u where u.user_id = v_uid and u.kind = 'daily' and u.period = v_today::text;
      daily_limit := v_limit;
    end if;
    return next;
    return;
  end if;

  -- p_kind = 'daily'
  if v_admin then
    allowed := true; reason := null; used_today := null; daily_limit := null; retry_after_seconds := 0;
    return next;
    return;
  end if;

  delete from public.directlab_usage u
  where u.user_id = v_uid and u.kind = 'daily' and u.period < (v_today - 7)::text;

  daily_limit := v_limit;
  v_hits := null;
  -- Incremento condicional e atômico: só grava se ainda houver cota. Reduzir
  -- o limite abaixo do já usado não mexe no contador — só recusa as próximas.
  if v_limit >= 1 then
    insert into public.directlab_usage as u (user_id, kind, period, hits)
    values (v_uid, 'daily', v_today::text, 1)
    on conflict (user_id, kind, period) do update set hits = u.hits + 1
      where u.hits < v_limit
    returning u.hits into v_hits;
  end if;

  if v_hits is null then
    allowed := false;
    reason := 'daily';
    select coalesce(max(u.hits), 0) into used_today
    from public.directlab_usage u where u.user_id = v_uid and u.kind = 'daily' and u.period = v_today::text;
    retry_after_seconds := greatest(1, extract(epoch from (((v_today + 1)::timestamp at time zone 'America/Sao_Paulo') - v_now))::integer);
  else
    allowed := true;
    reason := null;
    used_today := v_hits;
    retry_after_seconds := 0;
  end if;
  return next;
end;
$$;

create or replace function public.directlab_quota_status()
returns table (role text, used_today integer, daily_limit integer)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_reseller uuid;
begin
  if v_uid is null then
    raise exception 'Faça login para continuar' using errcode = '42501';
  end if;
  if public.is_admin() then
    role := 'admin'; used_today := null; daily_limit := null;
    return next;
    return;
  end if;
  v_reseller := public.current_reseller_id();
  if v_reseller is null then
    raise exception 'Somente ADMIN ou revendedor ativo usam o DirectLab' using errcode = '42501';
  end if;
  role := 'reseller';
  select coalesce(max(u.hits), 0) into used_today
  from public.directlab_usage u
  where u.user_id = v_uid and u.kind = 'daily' and u.period = public.directlab_usage_day(now())::text;
  select e.google_review_daily into daily_limit from public.directlab_effective_limits(v_reseller) e;
  return next;
end;
$$;

revoke all on function public.directlab_consume(text) from public, anon;
grant execute on function public.directlab_consume(text) to authenticated;
revoke all on function public.directlab_quota_status() from public, anon;
grant execute on function public.directlab_quota_status() to authenticated;

-- ---------------------------------------------------------------------
-- DirectLink: quantidade máxima de páginas por revendedor
-- ---------------------------------------------------------------------
-- Vale para QUALQUER inserção (hoje só directlink_save insere; insert direto
-- é revogado de authenticated). reseller_id vem da sessão, nunca do payload.
create or replace function public.directlink_enforce_page_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit integer;
  v_count integer;
begin
  if new.reseller_id is null then
    return new; -- página da plataforma (ADMIN): sem limite
  end if;
  -- Serializa criações do mesmo revendedor (duas ao mesmo tempo não furam o limite).
  perform pg_advisory_xact_lock(hashtextextended('directlink.pages:' || new.reseller_id::text, 0));
  select e.directlink_pages into v_limit from public.directlab_effective_limits(new.reseller_id) e;
  select count(*) into v_count from public.direct_links d where d.reseller_id = new.reseller_id;
  if v_count >= v_limit then
    raise exception 'Você atingiu o limite de páginas DirectLink definido para sua conta. Entre em contato com o administrador para aumentar o limite.'
      using errcode = '55000', hint = 'directlink_page_limit';
  end if;
  return new;
end;
$$;

drop trigger if exists direct_links_page_limit on public.direct_links;
create trigger direct_links_page_limit
  before insert on public.direct_links
  for each row execute function public.directlink_enforce_page_limit();

/** Páginas do usuário atual: revendedor → usadas e limite; ADMIN → sem limite (null). */
create or replace function public.directlink_page_status()
returns table (role text, used integer, page_limit integer)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_reseller uuid;
begin
  if auth.uid() is null then
    raise exception 'Faça login para continuar' using errcode = '42501';
  end if;
  if public.is_admin() then
    role := 'admin';
    select count(*)::integer into used from public.direct_links d where d.reseller_id is null;
    page_limit := null;
    return next;
    return;
  end if;
  v_reseller := public.current_reseller_id();
  if v_reseller is null then
    raise exception 'Somente ADMIN ou revendedor ativo usam o DirectLink' using errcode = '42501';
  end if;
  role := 'reseller';
  select count(*)::integer into used from public.direct_links d where d.reseller_id = v_reseller;
  select e.directlink_pages into page_limit from public.directlab_effective_limits(v_reseller) e;
  return next;
end;
$$;
revoke all on function public.directlink_page_status() from public, anon;
grant execute on function public.directlink_page_status() to authenticated;

-- ---------------------------------------------------------------------
-- ADMIN: ler e definir os limites de um revendedor
-- ---------------------------------------------------------------------
create or replace function public.admin_directlab_limits(p_reseller_id uuid)
returns table (
  google_review_daily  integer,
  directlink_pages     integer,
  customized           boolean,
  google_used_today    integer,
  directlink_count     integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user uuid;
begin
  if not public.is_admin() then
    raise exception 'Somente ADMIN' using errcode = '42501';
  end if;
  select r.user_id into v_user from public.reseller_profiles r where r.id = p_reseller_id;
  if not found then
    raise exception 'Revendedor não encontrado' using errcode = 'P0002';
  end if;
  select e.google_review_daily, e.directlink_pages, e.customized
    into google_review_daily, directlink_pages, customized
  from public.directlab_effective_limits(p_reseller_id) e;
  select coalesce(max(u.hits), 0) into google_used_today
  from public.directlab_usage u
  where u.user_id = v_user and u.kind = 'daily' and u.period = public.directlab_usage_day(now())::text;
  select count(*)::integer into directlink_count from public.direct_links d where d.reseller_id = p_reseller_id;
  return next;
end;
$$;

create or replace function public.admin_set_directlab_limits(
  p_reseller_id          uuid,
  p_google_review_daily  integer,
  p_directlink_pages     integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Somente ADMIN' using errcode = '42501';
  end if;
  if not exists (select 1 from public.reseller_profiles r where r.id = p_reseller_id) then
    raise exception 'Revendedor não encontrado' using errcode = 'P0002';
  end if;
  if p_google_review_daily is null or p_google_review_daily not between 0 and 1000 then
    raise exception 'Limite da Avaliação Google deve ficar entre 0 e 1000 por dia' using errcode = '22023';
  end if;
  if p_directlink_pages is null or p_directlink_pages not between 0 and 1000 then
    raise exception 'Limite do DirectLink deve ficar entre 0 e 1000 páginas' using errcode = '22023';
  end if;
  -- Só o valor atual (sem histórico). Não mexe em contadores nem em páginas existentes.
  insert into public.reseller_directlab_limits as l (reseller_id, google_review_daily, directlink_pages, updated_at)
  values (p_reseller_id, p_google_review_daily, p_directlink_pages, now())
  on conflict (reseller_id) do update
    set google_review_daily = excluded.google_review_daily,
        directlink_pages = excluded.directlink_pages,
        updated_at = now();
end;
$$;

revoke all on function public.admin_directlab_limits(uuid) from public, anon;
grant execute on function public.admin_directlab_limits(uuid) to authenticated;
revoke all on function public.admin_set_directlab_limits(uuid, integer, integer) from public, anon;
grant execute on function public.admin_set_directlab_limits(uuid, integer, integer) to authenticated;
