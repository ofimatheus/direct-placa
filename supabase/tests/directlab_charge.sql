-- DirectLab · cobrança só no sucesso (migration 026).
--   psql -d placas_test -v dblink_conn='dbname=placas_test host=/tmp' -f supabase/tests/directlab_charge.sql
\set ON_ERROR_STOP 1
create extension if not exists dblink with schema extensions;
\if :{?dblink_conn}
\else
select 'dbname=' || current_database() as dblink_conn \gset
\endif
select set_config('test.conn', :'dblink_conn', false) as dblink_conn_em_uso;

insert into auth.users (id, email) values
  ('c8000000-0000-0000-0000-00000000000a', 'ch-admin@teste.com'),
  ('c8000000-0000-0000-0000-0000000000a1', 'ch-r1@teste.com'),
  ('c8000000-0000-0000-0000-0000000000a2', 'ch-r2@teste.com'),
  ('c8000000-0000-0000-0000-0000000000a3', 'ch-r3@teste.com'),
  ('c8000000-0000-0000-0000-0000000000f0', 'ch-sem@teste.com');
update public.profiles set role = 'admin' where email = 'ch-admin@teste.com';
insert into public.reseller_profiles (id, user_id, company_name) values
  ('c8100000-0000-0000-0000-000000000001', 'c8000000-0000-0000-0000-0000000000a1', 'Cobra Um'),
  ('c8100000-0000-0000-0000-000000000002', 'c8000000-0000-0000-0000-0000000000a2', 'Cobra Dois'),
  ('c8100000-0000-0000-0000-000000000003', 'c8000000-0000-0000-0000-0000000000a3', 'Cobra Três');
-- R1 com limite 3 por dia (definido pelo ADMIN).
insert into public.reseller_directlab_limits (reseller_id, google_review_daily, directlink_pages) values ('c8100000-0000-0000-0000-000000000001', 3, 3);

create function pg_temp.check_(p_user uuid, p_place text) returns record language plpgsql as $$
declare r record; begin perform set_config('request.jwt.claim.sub', p_user::text, true); execute 'set local role authenticated';
select * into r from public.directlab_generation_check(p_place); execute 'reset role'; return r; end $$;
create function pg_temp.charge(p_user uuid, p_place text) returns record language plpgsql as $$
declare r record; begin perform set_config('request.jwt.claim.sub', p_user::text, true); execute 'set local role authenticated';
select * into r from public.directlab_charge_generation(p_place); execute 'reset role'; return r; end $$;
create function pg_temp.hits(p_user uuid) returns integer language sql as $$
  select coalesce(max(hits), 0) from public.directlab_usage where user_id = p_user and kind = 'daily' and period = public.directlab_usage_day(now())::text $$;
create function pg_temp.gens(p_user uuid) returns integer language sql as $$
  select count(*)::int from public.directlab_generations where user_id = p_user $$;

-- ===================== CH1: consultar não consome =====================
do $$
declare r record; i int;
begin
  for i in 1..5 loop r := pg_temp.check_('c8000000-0000-0000-0000-0000000000a1', 'ChIJplaceAaaaaaaaaaaaA'); end loop;
  if not r.allowed or r.already_generated or r.used_today <> 0 or r.daily_limit <> 3 or pg_temp.hits('c8000000-0000-0000-0000-0000000000a1') <> 0 or pg_temp.gens('c8000000-0000-0000-0000-0000000000a1') <> 0 then
    raise exception 'FALHA CH1: %', r; end if;
  raise notice 'OK CH1: consultar se pode gerar (5x) não consome nada: continua 0 de 3';
end $$;

-- ===================== CH2: sucesso cobra exatamente 1 =====================
do $$
declare r record;
begin
  r := pg_temp.charge('c8000000-0000-0000-0000-0000000000a1', 'ChIJplaceAaaaaaaaaaaaA');
  if not r.allowed or not r.charged or r.used_today <> 1 or pg_temp.hits('c8000000-0000-0000-0000-0000000000a1') <> 1 then raise exception 'FALHA CH2: %', r; end if;
  if exists (select 1 from public.directlab_generations where place_hash !~ '^[0-9a-f]{32}$' or place_hash = 'ChIJplaceAaaaaaaaaaaaA') then raise exception 'FALHA CH2: guardou o ID legível'; end if;
  raise notice 'OK CH2: link gerado com sucesso cobra exatamente 1 (1 de 3); só o hash do local é guardado';
end $$;

-- ===================== CH3: retry/refresh do mesmo local não cobra de novo =====================
do $$
declare r record; c record; i int;
begin
  for i in 1..3 loop r := pg_temp.charge('c8000000-0000-0000-0000-0000000000a1', 'ChIJplaceAaaaaaaaaaaaA'); end loop;
  c := pg_temp.check_('c8000000-0000-0000-0000-0000000000a1', 'ChIJplaceAaaaaaaaaaaaA');
  if not r.allowed or r.charged or r.used_today <> 1 or pg_temp.hits('c8000000-0000-0000-0000-0000000000a1') <> 1 or not c.already_generated then raise exception 'FALHA CH3: % %', r, c; end if;
  raise notice 'OK CH3: gerar de novo o MESMO local no mesmo dia (3 retries) não cobra: continua 1 de 3';
end $$;

-- ===================== CH4–CH5: locais diferentes contam; limite bloqueia sem deixar resto =====================
do $$
declare r record; c record; old record;
begin
  perform pg_temp.charge('c8000000-0000-0000-0000-0000000000a1', 'ChIJplaceBbbbbbbbbbbbB');
  perform pg_temp.charge('c8000000-0000-0000-0000-0000000000a1', 'ChIJplaceCccccccccccccC');
  if pg_temp.hits('c8000000-0000-0000-0000-0000000000a1') <> 3 then raise exception 'FALHA CH4'; end if;
  raise notice 'OK CH4: cada local diferente conta 1 (3 de 3)';
  c := pg_temp.check_('c8000000-0000-0000-0000-0000000000a1', 'ChIJplaceDdddddddddddD');
  r := pg_temp.charge('c8000000-0000-0000-0000-0000000000a1', 'ChIJplaceDdddddddddddD');
  old := pg_temp.charge('c8000000-0000-0000-0000-0000000000a1', 'ChIJplaceBbbbbbbbbbbbB');
  if c.allowed or c.retry_after_seconds < 1 or r.allowed or r.charged or r.used_today <> 3 or pg_temp.hits('c8000000-0000-0000-0000-0000000000a1') <> 3
     or pg_temp.gens('c8000000-0000-0000-0000-0000000000a1') <> 3 or not old.allowed or old.charged then
    raise exception 'FALHA CH5: check=% charge=% antigo=%', c, r, old; end if;
  raise notice 'OK CH5: no limite, local novo é recusado (na consulta e na cobrança) sem cobrar nem deixar reserva; um local já gerado hoje continua liberado sem custo';
end $$;

-- ===================== CH6: novo dia =====================
do $$
declare r record;
begin
  insert into public.directlab_generations values ('c8000000-0000-0000-0000-0000000000a2', (public.directlab_usage_day(now()) - 1)::text, md5('ChIJplaceAaaaaaaaaaaaA'), now() - interval '1 day');
  insert into public.directlab_usage values ('c8000000-0000-0000-0000-0000000000a2', 'daily', (public.directlab_usage_day(now()) - 1)::text, 10);
  r := pg_temp.charge('c8000000-0000-0000-0000-0000000000a2', 'ChIJplaceAaaaaaaaaaaaA');
  if not r.allowed or not r.charged or r.used_today <> 1 then raise exception 'FALHA CH6: %', r; end if;
  insert into public.directlab_generations values ('c8000000-0000-0000-0000-0000000000a2', (public.directlab_usage_day(now()) - 30)::text, md5('x'), now() - interval '30 days');
  perform pg_temp.charge('c8000000-0000-0000-0000-0000000000a2', 'ChIJplaceEeeeeeeeeeeeE');
  if exists (select 1 from public.directlab_generations where user_id = 'c8000000-0000-0000-0000-0000000000a2' and period = (public.directlab_usage_day(now()) - 30)::text) then raise exception 'FALHA CH6 limpeza'; end if;
  raise notice 'OK CH6: no dia seguinte (Brasília) o mesmo local volta a contar e o contador recomeça; registros antigos são apagados';
end $$;

-- ===================== CH7: ADMIN ilimitado =====================
do $$
declare r record; i int;
begin
  for i in 1..30 loop
    r := pg_temp.charge('c8000000-0000-0000-0000-00000000000a', 'ChIJadminPlace' || lpad(i::text, 6, '0'));
    if not r.allowed or r.charged or r.daily_limit is not null then raise exception 'FALHA CH7: %', r; end if;
  end loop;
  if pg_temp.hits('c8000000-0000-0000-0000-00000000000a') <> 0 or pg_temp.gens('c8000000-0000-0000-0000-00000000000a') <> 0 then raise exception 'FALHA CH7 contador'; end if;
  raise notice 'OK CH7: ADMIN gera 30 links sem limite, sem contador e sem registro';
end $$;

-- ===================== CH8: chamadas diretas =====================
do $$
declare r record; i int;
begin
  set local role anon;
  begin perform public.directlab_charge_generation('ChIJplaceAaaaaaaaaaaaA'); raise exception 'FALHA CH8 anon'; exception when insufficient_privilege then null; end;
  begin perform public.directlab_generation_check('ChIJplaceAaaaaaaaaaaaA'); raise exception 'FALHA CH8 anon check'; exception when insufficient_privilege then null; end;
  reset role;
  perform set_config('request.jwt.claim.sub', 'c8000000-0000-0000-0000-0000000000a3', true);
  set local role authenticated;
  begin perform 1 from public.directlab_generations; raise exception 'FALHA CH8 leu'; exception when insufficient_privilege then null; end;
  begin delete from public.directlab_generations; raise exception 'FALHA CH8 apagou'; exception when insufficient_privilege then null; end;
  begin insert into public.directlab_generations values (auth.uid(), '2099-01-01', md5('x'), now()); raise exception 'FALHA CH8 inseriu'; exception when insufficient_privilege then null; end;
  begin perform public.directlab_charge_generation('x'); raise exception 'FALHA CH8 id'; exception when invalid_parameter_value then null; end;
  -- Chamar a cobrança direto só gasta a PRÓPRIA cota e para no limite (10).
  for i in 1..15 loop perform public.directlab_charge_generation('ChIJdireto' || lpad(i::text, 8, '0')); end loop;
  reset role;
  if pg_temp.hits('c8000000-0000-0000-0000-0000000000a3') <> 10 then raise exception 'FALHA CH8 limite: %', pg_temp.hits('c8000000-0000-0000-0000-0000000000a3'); end if;
  perform set_config('request.jwt.claim.sub', 'c8000000-0000-0000-0000-0000000000f0', true);
  set local role authenticated;
  begin perform public.directlab_charge_generation('ChIJplaceAaaaaaaaaaaaA'); raise exception 'FALHA CH8 sem cadastro'; exception when insufficient_privilege then null; end;
  reset role;
  raise notice 'OK CH8: anon, escrita direta na tabela, Place ID inválido e usuário sem cadastro são recusados; chamar a cobrança direto só gasta a própria cota e para no limite';
end $$;

-- ===================== CH9: concorrência — mesmo local ao mesmo tempo =====================
select 1 from public.reseller_directlab_limits limit 0; -- (sem preparação extra: R2 está em 2 de 10)
do $$
declare
  conn text := current_setting('test.conn');
  a record; b_charged boolean; busy int; before int; after int;
  prep text := 'set role authenticated; set request.jwt.claim.sub = ''c8000000-0000-0000-0000-0000000000a2''; ';
begin
  before := pg_temp.hits('c8000000-0000-0000-0000-0000000000a2');
  perform extensions.dblink_connect('ch_a', conn);
  perform extensions.dblink_connect('ch_b', conn);
  perform extensions.dblink_exec('ch_a', 'begin');
  perform extensions.dblink_exec('ch_a', prep);
  select * into a from extensions.dblink('ch_a', 'select allowed, charged from public.directlab_charge_generation(''ChIJmesmoLocal0000001'')') as t(allowed boolean, charged boolean);
  perform extensions.dblink_exec('ch_b', prep);
  perform extensions.dblink_send_query('ch_b', 'select charged from public.directlab_charge_generation(''ChIJmesmoLocal0000001'')');
  perform pg_sleep(0.4);
  busy := extensions.dblink_is_busy('ch_b');
  perform extensions.dblink_exec('ch_a', 'commit');
  select t.charged into b_charged from extensions.dblink_get_result('ch_b') as t(charged boolean);
  perform extensions.dblink_disconnect('ch_a');
  perform extensions.dblink_disconnect('ch_b');
  after := pg_temp.hits('c8000000-0000-0000-0000-0000000000a2');
  if not a.charged or b_charged or busy <> 1 or after <> before + 1 then raise exception 'FALHA CH9: a=% b=% esperou=% antes=% depois=%', a, b_charged, busy, before, after; end if;
  raise notice 'OK CH9: duas conexões reais gerando o MESMO local ao mesmo tempo: a segunda espera e não cobra (+1 no total)';
end $$;

-- ===================== CH10: concorrência — locais diferentes na última utilização =====================
-- Preparação confirmada ANTES da disputa: R2 fica a 1 da cota (limite padrão 10).
update public.directlab_usage set hits = 9 where user_id = 'c8000000-0000-0000-0000-0000000000a2' and kind = 'daily' and period = public.directlab_usage_day(now())::text;
do $$
declare
  conn text := current_setting('test.conn');
  a_ok boolean; b_ok boolean; busy int;
  prep text := 'set role authenticated; set request.jwt.claim.sub = ''c8000000-0000-0000-0000-0000000000a2''; ';
begin
  perform extensions.dblink_connect('cd_a', conn);
  perform extensions.dblink_connect('cd_b', conn);
  perform extensions.dblink_exec('cd_a', 'begin');
  perform extensions.dblink_exec('cd_a', prep);
  select t.allowed into a_ok from extensions.dblink('cd_a', 'select allowed from public.directlab_charge_generation(''ChIJdiferenteA000001'')') as t(allowed boolean);
  perform extensions.dblink_exec('cd_b', prep);
  perform extensions.dblink_send_query('cd_b', 'select allowed from public.directlab_charge_generation(''ChIJdiferenteB000002'')');
  perform pg_sleep(0.4);
  busy := extensions.dblink_is_busy('cd_b');
  perform extensions.dblink_exec('cd_a', 'commit');
  select t.allowed into b_ok from extensions.dblink_get_result('cd_b') as t(allowed boolean);
  perform extensions.dblink_disconnect('cd_a');
  perform extensions.dblink_disconnect('cd_b');
  if not a_ok or b_ok or busy <> 1 or pg_temp.hits('c8000000-0000-0000-0000-0000000000a2') <> 10
     or exists (select 1 from public.directlab_generations where user_id = 'c8000000-0000-0000-0000-0000000000a2' and place_hash = md5('ChIJdiferenteB000002')) then
    raise exception 'FALHA CH10: a=% b=% esperou=%', a_ok, b_ok, busy; end if;
  raise notice 'OK CH10: duas conexões reais com locais diferentes disputando a última utilização (9 de 10): uma gera, a outra é recusada sem deixar reserva (total 10)';
end $$;

-- ===================== CH11: funções antigas intactas =====================
do $$
declare s record; b record;
begin
  perform set_config('request.jwt.claim.sub', 'c8000000-0000-0000-0000-0000000000a1', true);
  set local role authenticated;
  select * into s from public.directlab_quota_status();
  select * into b from public.directlab_consume('burst');
  reset role;
  if s.used_today <> 3 or s.daily_limit <> 3 or not b.allowed then raise exception 'FALHA CH11: % %', s, b; end if;
  raise notice 'OK CH11: o status "X de Y utilizações hoje" reflete as gerações (3 de 3) e a proteção curta continua igual';
end $$;
