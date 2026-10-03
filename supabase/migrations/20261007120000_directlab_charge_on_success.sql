-- =====================================================================
-- 026 · DirectLab / Avaliação Google: cobrar só o link GERADO COM SUCESSO
--
-- Regra: UMA utilização = UM link oficial de avaliação gerado e entregue.
-- Pesquisar, resolver link, listar candidatos, selecionar, erro do Google,
-- link inválido, nada encontrado, ambiguidade → 0 utilizações.
--
-- A aplicação:
--   1. (opcional) directlab_generation_check(place_id): consulta SEM consumir,
--      antes da chamada final ao Google (evita gastar uma chamada que será
--      recusada);
--   2. obtém e valida o link oficial no Google;
--   3. directlab_charge_generation(place_id): cobrança ATÔMICA; só então
--      entrega o link. Se a cobrança for recusada, o link não é entregue.
--
-- Sem cobrança dupla: cada geração registra (usuário, dia de Brasília,
-- md5 do Place ID). Gerar de novo o MESMO local no MESMO dia (refresh/retry)
-- não cobra outra vez. Locais diferentes sempre contam. Só o hash é guardado
-- (nenhum nome ou ID legível), e registros com mais de 7 dias são apagados.
--
-- O contador continua o mesmo (directlab_usage, migration 021), com o limite
-- do revendedor (migration 024). ADMIN: sem cota. A proteção curta (10/min)
-- não muda. Migrations anteriores não são alteradas; incremental e idempotente.
-- =====================================================================

create table if not exists public.directlab_generations (
  user_id     uuid        not null,
  period      text        not null,
  place_hash  text        not null,
  created_at  timestamptz not null default now(),
  primary key (user_id, period, place_hash),
  constraint directlab_generations_hash_check check (place_hash ~ '^[0-9a-f]{32}$')
);

comment on table public.directlab_generations is
  'Gerações cobradas por dia (Brasília): só o md5 do Place ID, para não cobrar duas vezes o mesmo local no mesmo dia.';

alter table public.directlab_generations enable row level security;
revoke all on public.directlab_generations from anon, authenticated;

create or replace function public.directlab_place_id_ok(p_place_id text)
returns boolean
language sql
immutable
as $$
  -- (o regex do Postgres limita repetições a 255: tamanho checado à parte)
  select coalesce(length(p_place_id) between 10 and 512 and p_place_id ~ '^[A-Za-z0-9_-]+$', false);
$$;

/**
 * Consulta SEM consumir: este usuário pode gerar o link deste local agora?
 * (já gerado hoje → sim, sem custo; senão, precisa de cota livre).
 */
create or replace function public.directlab_generation_check(p_place_id text)
returns table (
  allowed              boolean,
  already_generated    boolean,
  used_today           integer,
  daily_limit          integer,
  retry_after_seconds  integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_reseller  uuid;
  v_today     date;
begin
  if v_uid is null then
    raise exception 'Faça login para continuar' using errcode = '42501';
  end if;
  if not public.directlab_place_id_ok(p_place_id) then
    raise exception 'Place ID inválido' using errcode = '22023';
  end if;
  if public.is_admin() then
    allowed := true; already_generated := false; used_today := null; daily_limit := null; retry_after_seconds := 0;
    return next;
    return;
  end if;
  v_reseller := public.current_reseller_id();
  if v_reseller is null then
    raise exception 'Somente ADMIN ou revendedor ativo usam o DirectLab' using errcode = '42501';
  end if;

  v_today := public.directlab_usage_day(now());
  select e.google_review_daily into daily_limit from public.directlab_effective_limits(v_reseller) e;
  select coalesce(max(u.hits), 0) into used_today
  from public.directlab_usage u where u.user_id = v_uid and u.kind = 'daily' and u.period = v_today::text;
  already_generated := exists (
    select 1 from public.directlab_generations g
    where g.user_id = v_uid and g.period = v_today::text and g.place_hash = md5(p_place_id));
  allowed := already_generated or used_today < daily_limit;
  retry_after_seconds := case when allowed then 0
    else greatest(1, extract(epoch from (((v_today + 1)::timestamp at time zone 'America/Sao_Paulo') - now()))::integer) end;
  return next;
end;
$$;

/**
 * Cobrança ATÔMICA de uma geração bem-sucedida. Chamada pela aplicação SÓ
 * depois que o link oficial foi obtido e validado.
 *   charged = true  → 1 utilização descontada agora;
 *   charged = false → já gerado hoje (sem custo) ou ADMIN;
 *   allowed = false → sem cota (o link NÃO deve ser entregue).
 */
create or replace function public.directlab_charge_generation(p_place_id text)
returns table (
  allowed              boolean,
  charged              boolean,
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
  v_reseller  uuid;
  v_today     date;
  v_hash      text;
  v_claimed   integer;
  v_hits      integer;
begin
  if v_uid is null then
    raise exception 'Faça login para continuar' using errcode = '42501';
  end if;
  if not public.directlab_place_id_ok(p_place_id) then
    raise exception 'Place ID inválido' using errcode = '22023';
  end if;
  if public.is_admin() then
    allowed := true; charged := false; used_today := null; daily_limit := null; retry_after_seconds := 0;
    return next;
    return;
  end if;
  v_reseller := public.current_reseller_id();
  if v_reseller is null then
    raise exception 'Somente ADMIN ou revendedor ativo usam o DirectLab' using errcode = '42501';
  end if;

  v_today := public.directlab_usage_day(now());
  v_hash := md5(p_place_id);
  select e.google_review_daily into daily_limit from public.directlab_effective_limits(v_reseller) e;

  delete from public.directlab_generations g
  where g.user_id = v_uid and g.period < (v_today - 7)::text;

  -- 1) Reserva a geração deste local hoje. Se outra transação estiver
  --    reservando o mesmo local, esta espera; se já existir, não cobra de novo.
  insert into public.directlab_generations (user_id, period, place_hash)
  values (v_uid, v_today::text, v_hash)
  on conflict (user_id, period, place_hash) do nothing;
  get diagnostics v_claimed = row_count;

  if v_claimed = 0 then
    allowed := true;
    charged := false;
    select coalesce(max(u.hits), 0) into used_today
    from public.directlab_usage u where u.user_id = v_uid and u.kind = 'daily' and u.period = v_today::text;
    retry_after_seconds := 0;
    return next;
    return;
  end if;

  -- 2) Incremento condicional e atômico (mesmo contador e limite de antes).
  v_hits := null;
  if daily_limit >= 1 then
    insert into public.directlab_usage as u (user_id, kind, period, hits)
    values (v_uid, 'daily', v_today::text, 1)
    on conflict (user_id, kind, period) do update set hits = u.hits + 1
      where u.hits < daily_limit
    returning u.hits into v_hits;
  end if;

  if v_hits is null then
    -- Sem cota: desfaz a reserva; nada é cobrado e o link não deve ser entregue.
    delete from public.directlab_generations g
    where g.user_id = v_uid and g.period = v_today::text and g.place_hash = v_hash;
    allowed := false;
    charged := false;
    select coalesce(max(u.hits), 0) into used_today
    from public.directlab_usage u where u.user_id = v_uid and u.kind = 'daily' and u.period = v_today::text;
    retry_after_seconds := greatest(1, extract(epoch from (((v_today + 1)::timestamp at time zone 'America/Sao_Paulo') - now()))::integer);
  else
    allowed := true;
    charged := true;
    used_today := v_hits;
    retry_after_seconds := 0;
  end if;
  return next;
end;
$$;

revoke all on function public.directlab_generation_check(text) from public, anon;
grant execute on function public.directlab_generation_check(text) to authenticated;
revoke all on function public.directlab_charge_generation(text) from public, anon;
grant execute on function public.directlab_charge_generation(text) to authenticated;
