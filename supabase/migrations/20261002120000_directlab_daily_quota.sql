-- =====================================================================
-- 021 · DirectLab: cota diária por revendedor + proteção curta
--
-- Regras (decididas AQUI, no banco — o chamador não informa limite nem janela):
--   · proteção curta (anti-rajada): 10 operações por minuto, para TODOS
--     (revendedor e ADMIN), como já era;
--   · cota diária: 10 utilizações por dia para REVENDEDOR; ADMIN não tem
--     cota diária. O dia é o dia civil de Brasília (America/Sao_Paulo):
--     o contador recomeça à meia-noite de Brasília.
--
-- Uma "utilização" é consumida pela aplicação imediatamente antes da primeira
-- chamada à Google Places API de uma operação (uma vez por operação).
-- Entradas inválidas nunca chegam aqui.
--
-- Tabela própria (directlab_usage), sem nenhum acesso direto: só estas
-- funções a escrevem. Ela NÃO é tocada pela RPC genérica consume_rate_limit
-- (migration 020), que continua existindo sem alterações.
--
-- Guarda só números: usuário, tipo, período e quantidade. Nenhum link,
-- estabelecimento ou histórico. Períodos antigos são apagados.
--
-- Incremental e idempotente; não altera migrations anteriores.
-- =====================================================================

create table if not exists public.directlab_usage (
  user_id  uuid    not null,
  kind     text    not null,
  period   text    not null,
  hits     integer not null default 0,
  primary key (user_id, kind, period),
  constraint directlab_usage_kind_check check (kind in ('burst', 'daily')),
  constraint directlab_usage_hits_check check (hits >= 0)
);

comment on table public.directlab_usage is
  'Contadores do DirectLab: burst = janela de 1 minuto (todos); daily = dia de Brasília (só revendedor). Só números.';

alter table public.directlab_usage enable row level security;
revoke all on public.directlab_usage from anon, authenticated;

-- Dia civil de Brasília de um instante (o contador diário vira à meia-noite de Brasília).
create or replace function public.directlab_usage_day(p_at timestamptz)
returns date
language sql
stable
as $$
  select (p_at at time zone 'America/Sao_Paulo')::date;
$$;

-- Constantes da regra (uma fonte só; a aplicação espelha os números só para exibição).
create or replace function public.directlab_limits()
returns table (burst_max integer, burst_window_seconds integer, reseller_daily_max integer)
language sql
immutable
as $$
  select 10, 60, 10;
$$;

/**
 * Consome uma unidade do contador pedido para o usuário autenticado.
 *   p_kind = 'burst' → proteção curta (todos os papéis)
 *   p_kind = 'daily' → cota diária (revendedor: até 10/dia; ADMIN: sempre permitido, sem contar)
 * Chamada negada NÃO consome a cota diária. Atômico sob concorrência.
 */
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
      daily_limit := v_limits.reseller_daily_max;
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

  -- Incremento condicional: só grava se ainda houver cota (duas chamadas
  -- simultâneas não passam juntas do limite).
  insert into public.directlab_usage as u (user_id, kind, period, hits)
  values (v_uid, 'daily', v_today::text, 1)
  on conflict (user_id, kind, period) do update set hits = u.hits + 1
    where u.hits < v_limits.reseller_daily_max
  returning u.hits into v_hits;

  daily_limit := v_limits.reseller_daily_max;
  if v_hits is null then
    allowed := false;
    reason := 'daily';
    used_today := v_limits.reseller_daily_max;
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

/** Situação da cota diária do usuário (para exibir "7 de 10 utilizações hoje"). Não consome nada. */
create or replace function public.directlab_quota_status()
returns table (role text, used_today integer, daily_limit integer)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Faça login para continuar' using errcode = '42501';
  end if;
  if public.is_admin() then
    role := 'admin'; used_today := null; daily_limit := null;
    return next;
    return;
  end if;
  if public.current_reseller_id() is null then
    raise exception 'Somente ADMIN ou revendedor ativo usam o DirectLab' using errcode = '42501';
  end if;
  role := 'reseller';
  select coalesce(max(u.hits), 0) into used_today
  from public.directlab_usage u
  where u.user_id = v_uid and u.kind = 'daily' and u.period = public.directlab_usage_day(now())::text;
  daily_limit := (select l.reseller_daily_max from public.directlab_limits() l);
  return next;
end;
$$;

revoke all on function public.directlab_consume(text) from public, anon;
grant execute on function public.directlab_consume(text) to authenticated;
revoke all on function public.directlab_quota_status() from public, anon;
grant execute on function public.directlab_quota_status() to authenticated;
grant execute on function public.directlab_usage_day(timestamptz) to authenticated;
grant execute on function public.directlab_limits() to authenticated;
