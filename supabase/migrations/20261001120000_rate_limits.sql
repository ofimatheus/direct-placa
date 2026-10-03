-- =====================================================================
-- 020 · Rate limit por usuário autenticado (DirectLab / Google Places)
--
-- Por que uma tabela: na Vercel cada requisição pode cair numa instância
-- diferente; um contador em memória não protegeria a cota (nem o custo) da
-- Google Places API. Aqui ficam SÓ contadores — usuário, balde, início da
-- janela e quantidade. Nenhum link, estabelecimento ou histórico de
-- conversões é gravado. Janelas antigas do mesmo usuário/balde são apagadas
-- a cada chamada.
--
-- Acesso: somente pela RPC consume_rate_limit(), amarrada a auth.uid().
-- A tabela não tem leitura nem escrita direta para anon/authenticated.
--
-- Incremental e idempotente; não altera migrations anteriores.
-- =====================================================================

create table if not exists public.rate_limit_counters (
  user_id       uuid        not null,
  bucket        text        not null,
  window_start  timestamptz not null,
  hits          integer     not null default 0,
  primary key (user_id, bucket, window_start),
  constraint rate_limit_counters_bucket_check check (bucket ~ '^[a-z0-9_:.-]{1,64}$'),
  constraint rate_limit_counters_hits_check check (hits >= 0)
);

comment on table public.rate_limit_counters is
  'Contadores de rate limit por usuário (janela fixa). Só números: nenhum conteúdo das requisições é gravado.';

alter table public.rate_limit_counters enable row level security;
revoke all on public.rate_limit_counters from anon, authenticated;

-- Consome 1 unidade do balde na janela atual. Janela fixa: simples e
-- previsível. Devolve se foi permitido e, se não, quantos segundos faltam.
create or replace function public.consume_rate_limit(
  p_bucket          text,
  p_max             integer,
  p_window_seconds  integer
)
returns table (allowed boolean, hits integer, retry_after_seconds integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_window  integer := greatest(1, least(coalesce(p_window_seconds, 60), 86400));
  v_max     integer := greatest(1, least(coalesce(p_max, 1), 100000));
  v_start   timestamptz;
  v_hits    integer;
begin
  if v_uid is null then
    raise exception 'Faça login para continuar' using errcode = '42501';
  end if;
  if p_bucket is null or p_bucket !~ '^[a-z0-9_:.-]{1,64}$' then
    raise exception 'Balde de rate limit inválido' using errcode = '22023';
  end if;

  v_start := to_timestamp(floor(extract(epoch from now()) / v_window) * v_window);

  -- Limpeza das janelas vencidas deste usuário/balde (a tabela não cresce).
  delete from public.rate_limit_counters c
  where c.user_id = v_uid and c.bucket = p_bucket and c.window_start < v_start;

  insert into public.rate_limit_counters as c (user_id, bucket, window_start, hits)
  values (v_uid, p_bucket, v_start, 1)
  on conflict (user_id, bucket, window_start) do update set hits = c.hits + 1
  returning c.hits into v_hits;

  allowed := v_hits <= v_max;
  hits := v_hits;
  retry_after_seconds := case when allowed then 0
    else greatest(1, ceil(extract(epoch from (v_start + make_interval(secs => v_window) - now())))::integer) end;
  return next;
end;
$$;

revoke all on function public.consume_rate_limit(text, integer, integer) from public, anon;
grant execute on function public.consume_rate_limit(text, integer, integer) to authenticated;
