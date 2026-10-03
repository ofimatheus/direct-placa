-- DirectLab · cota diária (migration 021): 10/dia por revendedor, ADMIN sem
-- cota diária, proteção curta para todos, virada no dia de Brasília e
-- proteção contra chamada direta. Rodar num banco de TESTE.
--   psql -d placas_test -v dblink_conn='dbname=placas_test host=/tmp' -f supabase/tests/directlab_quota.sql
\set ON_ERROR_STOP 1
create extension if not exists dblink with schema extensions;
\if :{?dblink_conn}
\else
select 'dbname=' || current_database() as dblink_conn \gset
\endif
select set_config('test.conn', :'dblink_conn', false) as dblink_conn_em_uso;

insert into auth.users (id, email) values
  ('e4000000-0000-0000-0000-00000000000a', 'dq-admin@teste.com'),
  ('e4000000-0000-0000-0000-0000000000a1', 'dq-r1@teste.com'),
  ('e4000000-0000-0000-0000-0000000000a2', 'dq-r2@teste.com'),
  ('e4000000-0000-0000-0000-0000000000a3', 'dq-r3@teste.com'),
  ('e4000000-0000-0000-0000-0000000000f0', 'dq-sem-cadastro@teste.com');
update public.profiles set role = 'admin' where email = 'dq-admin@teste.com';
insert into public.reseller_profiles (id, user_id, company_name) values
  ('e4100000-0000-0000-0000-000000000001', 'e4000000-0000-0000-0000-0000000000a1', 'Cota Um'),
  ('e4100000-0000-0000-0000-000000000002', 'e4000000-0000-0000-0000-0000000000a2', 'Cota Dois'),
  ('e4100000-0000-0000-0000-000000000003', 'e4000000-0000-0000-0000-0000000000a3', 'Cota Três');

-- Executa directlab_consume como um usuário (cada chamada numa transação própria, como a API).
create function pg_temp.consume(p_user uuid, p_kind text) returns record language plpgsql as $$
declare r record;
begin
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  execute 'set local role authenticated';
  select * into r from public.directlab_consume(p_kind);
  execute 'reset role';
  return r;
end $$;
create function pg_temp.status(p_user uuid) returns record language plpgsql as $$
declare r record;
begin
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  execute 'set local role authenticated';
  select * into r from public.directlab_quota_status();
  execute 'reset role';
  return r;
end $$;
create function pg_temp.daily_hits(p_user uuid) returns integer language sql as $$
  select coalesce(max(hits), 0) from public.directlab_usage
  where user_id = p_user and kind = 'daily' and period = public.directlab_usage_day(now())::text
$$;

-- ===================== Q1: revendedor com 0/10 =====================
do $$
declare s record; r record;
begin
  s := pg_temp.status('e4000000-0000-0000-0000-0000000000a1');
  if s.role <> 'reseller' or s.used_today <> 0 or s.daily_limit <> 10 then raise exception 'FALHA Q1 status: %', s; end if;
  r := pg_temp.consume('e4000000-0000-0000-0000-0000000000a1', 'daily');
  if not r.allowed or r.used_today <> 1 or r.daily_limit <> 10 then raise exception 'FALHA Q1 consumo: %', r; end if;
  raise notice 'OK Q1: revendedor começa com 0 de 10; a primeira utilização passa (1 de 10)';
end $$;

-- ===================== Q2–Q4: 9/10 → 10ª permitida → 11ª recusada =====================
do $$
declare s record; r record;
begin
  update public.directlab_usage set hits = 9
  where user_id = 'e4000000-0000-0000-0000-0000000000a1' and kind = 'daily';
  s := pg_temp.status('e4000000-0000-0000-0000-0000000000a1');
  if s.used_today <> 9 then raise exception 'FALHA Q2: %', s; end if;
  raise notice 'OK Q2: revendedor com 9 de 10 utilizações';

  r := pg_temp.consume('e4000000-0000-0000-0000-0000000000a1', 'daily');
  if not r.allowed or r.used_today <> 10 then raise exception 'FALHA Q3: %', r; end if;
  raise notice 'OK Q3: a 10ª utilização é permitida (10 de 10)';

  r := pg_temp.consume('e4000000-0000-0000-0000-0000000000a1', 'daily');
  if r.allowed or r.reason <> 'daily' or r.used_today <> 10 or r.retry_after_seconds < 1 or r.retry_after_seconds > 86400 then
    raise exception 'FALHA Q4: %', r; end if;
  r := pg_temp.consume('e4000000-0000-0000-0000-0000000000a1', 'daily');
  if r.allowed or pg_temp.daily_hits('e4000000-0000-0000-0000-0000000000a1') <> 10 then raise exception 'FALHA Q4: recusa consumiu cota'; end if;
  raise notice 'OK Q4: a 11ª é recusada (motivo daily, liberação na próxima meia-noite de Brasília); recusas não consomem cota';
end $$;

-- ===================== Q5: outro revendedor independente =====================
do $$
declare r record;
begin
  r := pg_temp.consume('e4000000-0000-0000-0000-0000000000a2', 'daily');
  if not r.allowed or r.used_today <> 1 then raise exception 'FALHA Q5: %', r; end if;
  if pg_temp.daily_hits('e4000000-0000-0000-0000-0000000000a1') <> 10 then raise exception 'FALHA Q5: mexeu no contador do A'; end if;
  raise notice 'OK Q5: o contador do revendedor B é independente do A (A em 10/10, B em 1/10)';
end $$;

-- ===================== Q6: ADMIN sem cota diária =====================
do $$
declare r record; s record; i int;
begin
  for i in 1..25 loop
    r := pg_temp.consume('e4000000-0000-0000-0000-00000000000a', 'daily');
    if not r.allowed or r.daily_limit is not null then raise exception 'FALHA Q6: ADMIN barrado na chamada %: %', i, r; end if;
  end loop;
  if exists (select 1 from public.directlab_usage where user_id = 'e4000000-0000-0000-0000-00000000000a' and kind = 'daily') then
    raise exception 'FALHA Q6: ADMIN ganhou contador diário'; end if;
  s := pg_temp.status('e4000000-0000-0000-0000-00000000000a');
  if s.role <> 'admin' or s.daily_limit is not null then raise exception 'FALHA Q6 status: %', s; end if;
  raise notice 'OK Q6: ADMIN faz 25 utilizações no dia sem cota diária (sem limite e sem contador)';
end $$;

-- ===================== Q7: proteção curta vale para todos =====================
do $$
declare r record; i int;
begin
  for i in 1..10 loop
    r := pg_temp.consume('e4000000-0000-0000-0000-00000000000a', 'burst');
    if not r.allowed then raise exception 'FALHA Q7: ADMIN barrado na %ª do minuto', i; end if;
  end loop;
  r := pg_temp.consume('e4000000-0000-0000-0000-00000000000a', 'burst');
  if r.allowed or r.reason <> 'burst' or r.retry_after_seconds not between 1 and 60 then raise exception 'FALHA Q7 ADMIN: %', r; end if;
  for i in 1..10 loop perform pg_temp.consume('e4000000-0000-0000-0000-0000000000a3', 'burst'); end loop;
  r := pg_temp.consume('e4000000-0000-0000-0000-0000000000a3', 'burst');
  if r.allowed or r.reason <> 'burst' or r.used_today <> 0 or r.daily_limit <> 10 then raise exception 'FALHA Q7 revendedor: %', r; end if;
  if pg_temp.daily_hits('e4000000-0000-0000-0000-0000000000a3') <> 0 then raise exception 'FALHA Q7: rajada consumiu cota diária'; end if;
  raise notice 'OK Q7: proteção curta (10/min) continua para revendedor E ADMIN; a rajada não gasta a cota diária';
end $$;

-- ===================== Q8: o limite recomeça no dia seguinte (Brasília) =====================
do $$
declare r record;
begin
  if public.directlab_usage_day('2026-10-02 02:59:59+00') <> '2026-10-01'
     or public.directlab_usage_day('2026-10-02 03:00:00+00') <> '2026-10-02'
    then raise exception 'FALHA Q8: virada do dia fora de Brasília'; end if;
  -- R3 esgotou "ontem": 10/10 no dia anterior.
  insert into public.directlab_usage values
    ('e4000000-0000-0000-0000-0000000000a3', 'daily', (public.directlab_usage_day(now()) - 1)::text, 10);
  r := pg_temp.consume('e4000000-0000-0000-0000-0000000000a3', 'daily');
  if not r.allowed or r.used_today <> 1 then raise exception 'FALHA Q8: não recomeçou: %', r; end if;
  -- Registros antigos (mais de 7 dias) são limpos.
  insert into public.directlab_usage values ('e4000000-0000-0000-0000-0000000000a3', 'daily', (public.directlab_usage_day(now()) - 30)::text, 10);
  perform pg_temp.consume('e4000000-0000-0000-0000-0000000000a3', 'daily');
  if exists (select 1 from public.directlab_usage where user_id = 'e4000000-0000-0000-0000-0000000000a3' and period = (public.directlab_usage_day(now()) - 30)::text)
    then raise exception 'FALHA Q8: registro antigo não foi limpo'; end if;
  raise notice 'OK Q8: o dia vira à meia-noite de Brasília (02:59 UTC = dia anterior; 03:00 UTC = novo dia); cota de ontem não afeta hoje; antigos são limpos';
end $$;

-- ===================== Q9: chamada direta não fura a regra =====================
do $$
declare r record;
begin
  set local role anon;
  begin perform public.directlab_consume('daily'); raise exception 'FALHA Q9: anon consumiu'; exception when insufficient_privilege then null; end;
  begin perform public.directlab_quota_status(); raise exception 'FALHA Q9: anon leu'; exception when insufficient_privilege then null; end;
  reset role;

  perform set_config('request.jwt.claim.sub', 'e4000000-0000-0000-0000-0000000000a1', true);
  set local role authenticated;
  begin delete from public.directlab_usage; raise exception 'FALHA Q9: zerou a tabela'; exception when insufficient_privilege then null; end;
  begin update public.directlab_usage set hits = 0; raise exception 'FALHA Q9: alterou a tabela'; exception when insufficient_privilege then null; end;
  begin insert into public.directlab_usage values (auth.uid(), 'daily', '2099-01-01', 0); raise exception 'FALHA Q9: inseriu'; exception when insufficient_privilege then null; end;
  begin perform public.directlab_consume('outro'); raise exception 'FALHA Q9: tipo inválido'; exception when invalid_parameter_value then null; end;
  -- A RPC genérica da migration 020 não alcança a cota do DirectLab (nem com janela de 1 s).
  perform public.consume_rate_limit('daily', 100000, 1);
  perform public.consume_rate_limit('directlab.google.day', 100000, 1);
  r := public.directlab_consume('daily');
  reset role;
  if r.allowed or pg_temp.daily_hits('e4000000-0000-0000-0000-0000000000a1') <> 10 then raise exception 'FALHA Q9: cota contornada: %', r; end if;

  perform set_config('request.jwt.claim.sub', 'e4000000-0000-0000-0000-0000000000f0', true);
  set local role authenticated;
  begin perform public.directlab_consume('daily'); raise exception 'FALHA Q9: usuário sem cadastro consumiu'; exception when insufficient_privilege then null; end;
  reset role;
  raise notice 'OK Q9: sem login, escrita direta na tabela, tipo inválido, a RPC genérica antiga e usuário sem cadastro de revendedor não furam a cota';
end $$;

-- ===================== Q10: concorrência real na última utilização =====================
-- Preparação confirmada ANTES da disputa (se ficasse na mesma transação, a
-- linha travada impediria a conexão A de consumir: impasse entre sessões).
update public.directlab_usage set hits = 9 where user_id = 'e4000000-0000-0000-0000-0000000000a2' and kind = 'daily';
do $$
declare
  conn text := current_setting('test.conn');
  r_a boolean; r_b boolean; busy int;
  prep text := 'set role authenticated; set request.jwt.claim.sub = ''e4000000-0000-0000-0000-0000000000a2''; ';
begin
  perform extensions.dblink_connect('dq_a', conn);
  perform extensions.dblink_connect('dq_b', conn);
  perform extensions.dblink_exec('dq_a', 'begin');
  perform extensions.dblink_exec('dq_a', prep);
  select t.allowed into r_a from extensions.dblink('dq_a', 'select allowed from public.directlab_consume(''daily'')') as t(allowed boolean);
  perform extensions.dblink_exec('dq_b', prep);
  perform extensions.dblink_send_query('dq_b', 'select allowed from public.directlab_consume(''daily'')');
  perform pg_sleep(0.4);
  busy := extensions.dblink_is_busy('dq_b');
  perform extensions.dblink_exec('dq_a', 'commit');
  select t.allowed into r_b from extensions.dblink_get_result('dq_b') as t(allowed boolean);
  perform extensions.dblink_disconnect('dq_a');
  perform extensions.dblink_disconnect('dq_b');
  if not r_a or r_b or busy <> 1 or pg_temp.daily_hits('e4000000-0000-0000-0000-0000000000a2') <> 10 then
    raise exception 'FALHA Q10: a=% b=% esperou=% total=%', r_a, r_b, busy, pg_temp.daily_hits('e4000000-0000-0000-0000-0000000000a2'); end if;
  raise notice 'OK Q10: duas conexões reais disputando a última utilização (9/10): a segunda espera e é recusada; total fica em 10';
end $$;
