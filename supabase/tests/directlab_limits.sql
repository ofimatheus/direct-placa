-- DirectLab · limites por revendedor definidos pelo ADMIN (migration 024).
--   psql -d placas_test -v dblink_conn='dbname=placas_test host=/tmp' -f supabase/tests/directlab_limits.sql
\set ON_ERROR_STOP 1
create extension if not exists dblink with schema extensions;
\if :{?dblink_conn}
\else
select 'dbname=' || current_database() as dblink_conn \gset
\endif
select set_config('test.conn', :'dblink_conn', false) as dblink_conn_em_uso;

insert into auth.users (id, email) values
  ('e9000000-0000-0000-0000-00000000000a', 'lim-admin@teste.com'),
  ('e9000000-0000-0000-0000-0000000000a1', 'lim-r1@teste.com'),
  ('e9000000-0000-0000-0000-0000000000a2', 'lim-r2@teste.com'),
  ('e9000000-0000-0000-0000-0000000000a3', 'lim-r3@teste.com');
update public.profiles set role = 'admin' where email = 'lim-admin@teste.com';
insert into public.reseller_profiles (id, user_id, company_name) values
  ('e9100000-0000-0000-0000-000000000001', 'e9000000-0000-0000-0000-0000000000a1', 'Limite Um'),
  ('e9100000-0000-0000-0000-000000000002', 'e9000000-0000-0000-0000-0000000000a2', 'Limite Dois'),
  ('e9100000-0000-0000-0000-000000000003', 'e9000000-0000-0000-0000-0000000000a3', 'Limite Três');

create function pg_temp.as_user(p_user uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', p_user::text, true); execute 'set local role authenticated'; end $$;
create function pg_temp.consume(p_user uuid) returns record language plpgsql as $$
declare r record; begin perform pg_temp.as_user(p_user); select * into r from public.directlab_consume('daily'); execute 'reset role'; return r; end $$;
create function pg_temp.status(p_user uuid) returns record language plpgsql as $$
declare r record; begin perform pg_temp.as_user(p_user); select * into r from public.directlab_quota_status(); execute 'reset role'; return r; end $$;
create function pg_temp.pages(p_user uuid) returns record language plpgsql as $$
declare r record; begin perform pg_temp.as_user(p_user); select * into r from public.directlink_page_status(); execute 'reset role'; return r; end $$;
create function pg_temp.save(p_user uuid, p_title text) returns uuid language plpgsql as $$
declare r record; begin perform pg_temp.as_user(p_user); select * into r from public.directlink_save(null, p_title, null, null, null, true, '[]'); execute 'reset role'; return r.id; end $$;
create function pg_temp.set_limits(p_reseller uuid, g int, p int) returns void language plpgsql as $$
begin perform pg_temp.as_user('e9000000-0000-0000-0000-00000000000a'); perform public.admin_set_directlab_limits(p_reseller, g, p); execute 'reset role'; end $$;
create function pg_temp.hits(p_user uuid) returns integer language sql as $$
  select coalesce(max(hits), 0) from public.directlab_usage where user_id = p_user and kind = 'daily' and period = public.directlab_usage_day(now())::text $$;
create function pg_temp.save_err(p_user uuid, p_title text) returns text language plpgsql as $$
begin perform pg_temp.save(p_user, p_title); return 'criou';
exception when others then execute 'reset role'; return sqlstate || ' ' || sqlerrm; end $$;

-- ===================== LM1–LM2: padrões =====================
do $$
declare s record; p record;
begin
  s := pg_temp.status('e9000000-0000-0000-0000-0000000000a1');
  if s.daily_limit <> 10 or s.used_today <> 0 then raise exception 'FALHA LM1: %', s; end if;
  raise notice 'OK LM1: revendedor sem personalização recebe Avaliação Google = 10 por dia';
  p := pg_temp.pages('e9000000-0000-0000-0000-0000000000a1');
  if p.role <> 'reseller' or p.page_limit <> 3 or p.used <> 0 then raise exception 'FALHA LM2: %', p; end if;
  if exists (select 1 from public.reseller_directlab_limits) then raise exception 'FALHA LM2: criou linha sem o ADMIN definir'; end if;
  raise notice 'OK LM2: revendedor sem personalização recebe DirectLink = 3 páginas (nenhuma linha gravada)';
end $$;

-- ===================== LM3–LM4: ADMIN reduz 10 → 5, vale na hora =====================
do $$
declare r record; i int;
begin
  for i in 1..4 loop perform pg_temp.consume('e9000000-0000-0000-0000-0000000000a1'); end loop;
  perform pg_temp.set_limits('e9100000-0000-0000-0000-000000000001', 5, 3);
  r := pg_temp.status('e9000000-0000-0000-0000-0000000000a1');
  if r.daily_limit <> 5 then raise exception 'FALHA LM3: %', r; end if;
  raise notice 'OK LM3: ADMIN altera a Avaliação Google do revendedor de 10 para 5';
  r := pg_temp.consume('e9000000-0000-0000-0000-0000000000a1');
  if not r.allowed or r.used_today <> 5 or r.daily_limit <> 5 then raise exception 'FALHA LM4 5ª: %', r; end if;
  r := pg_temp.consume('e9000000-0000-0000-0000-0000000000a1');
  if r.allowed or r.reason <> 'daily' or r.used_today <> 5 then raise exception 'FALHA LM4 6ª: %', r; end if;
  raise notice 'OK LM4: o novo limite vale na hora (5ª passa, 6ª é recusada)';
end $$;

-- ===================== LM5–LM6: ADMIN aumenta para 20 =====================
do $$
declare r record;
begin
  perform pg_temp.set_limits('e9100000-0000-0000-0000-000000000001', 20, 3);
  r := pg_temp.consume('e9000000-0000-0000-0000-0000000000a1');
  if not r.allowed or r.used_today <> 6 or r.daily_limit <> 20 then raise exception 'FALHA LM6: %', r; end if;
  raise notice 'OK LM5–LM6: ADMIN aumenta para 20 e o revendedor volta a usar imediatamente (6 de 20)';
end $$;

-- ===================== LM7: reduzir abaixo do consumo atual =====================
do $$
declare r record; i int;
begin
  for i in 1..2 loop perform pg_temp.consume('e9000000-0000-0000-0000-0000000000a1'); end loop; -- 8 usados
  perform pg_temp.set_limits('e9100000-0000-0000-0000-000000000001', 5, 3);
  r := pg_temp.consume('e9000000-0000-0000-0000-0000000000a1');
  if r.allowed or r.used_today <> 8 or r.daily_limit <> 5 or pg_temp.hits('e9000000-0000-0000-0000-0000000000a1') <> 8 then
    raise exception 'FALHA LM7: %', r; end if;
  raise notice 'OK LM7: com 8 usados, reduzir para 5 bloqueia novas utilizações sem apagar nem alterar o contador (continua 8)';
end $$;

-- ===================== LM8: próximo dia reinicia (com limite personalizado) =====================
do $$
declare r record;
begin
  perform pg_temp.set_limits('e9100000-0000-0000-0000-000000000003', 2, 3);
  insert into public.directlab_usage values ('e9000000-0000-0000-0000-0000000000a3', 'daily', (public.directlab_usage_day(now()) - 1)::text, 2);
  r := pg_temp.consume('e9000000-0000-0000-0000-0000000000a3');
  if not r.allowed or r.used_today <> 1 or r.daily_limit <> 2 then raise exception 'FALHA LM8: %', r; end if;
  if not exists (select 1 from public.directlab_usage where user_id = 'e9000000-0000-0000-0000-0000000000a3' and period = (public.directlab_usage_day(now()) - 1)::text and hits = 2)
    then raise exception 'FALHA LM8: mexeu no dia anterior'; end if;
  raise notice 'OK LM8: ontem esgotado (2 de 2) não afeta hoje; o contador recomeça no novo dia de Brasília';
end $$;

-- ===================== LM9: A e B com limites diferentes =====================
do $$
declare a record; b record; p record;
begin
  perform pg_temp.set_limits('e9100000-0000-0000-0000-000000000002', 30, 7);
  p := pg_temp.pages('e9000000-0000-0000-0000-0000000000a2');
  a := pg_temp.status('e9000000-0000-0000-0000-0000000000a1');
  b := pg_temp.status('e9000000-0000-0000-0000-0000000000a2');
  if a.daily_limit <> 5 or b.daily_limit <> 30 or b.used_today <> 0 or p.page_limit <> 7 then
    raise exception 'FALHA LM9: A=% B=%', a, b; end if;
  raise notice 'OK LM9: revendedor A (5/dia) e B (30/dia, 7 páginas) com limites e contadores independentes';
end $$;

-- ===================== LM10: chamada direta não contorna =====================
do $$
declare r record;
begin
  perform pg_temp.as_user('e9000000-0000-0000-0000-0000000000a1');
  begin perform public.admin_set_directlab_limits('e9100000-0000-0000-0000-000000000001', 1000, 1000); raise exception 'FALHA LM10: revendedor mudou o próprio limite'; exception when insufficient_privilege then null; end;
  begin perform public.admin_directlab_limits('e9100000-0000-0000-0000-000000000002'); raise exception 'FALHA LM10: leu limites de outro'; exception when insufficient_privilege then null; end;
  begin perform 1 from public.reseller_directlab_limits; raise exception 'FALHA LM10: leu a tabela'; exception when insufficient_privilege then null; end;
  begin insert into public.reseller_directlab_limits values ('e9100000-0000-0000-0000-000000000001', 1000, 1000); raise exception 'FALHA LM10: gravou na tabela'; exception when insufficient_privilege then null; end;
  begin perform public.directlab_effective_limits('e9100000-0000-0000-0000-000000000002'); raise exception 'FALHA LM10: função interna exposta'; exception when insufficient_privilege then null; end;
  begin insert into public.direct_links (public_code, owner_user_id, reseller_id, title) values ('ZZZ2345', auth.uid(), null, 'burla'); raise exception 'FALHA LM10: insert direto'; exception when insufficient_privilege then null; end;
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
  set local role anon;
  begin perform public.directlink_page_status(); raise exception 'FALHA LM10: anon'; exception when insufficient_privilege then null; end;
  reset role;
  r := pg_temp.consume('e9000000-0000-0000-0000-0000000000a1');
  if r.allowed then raise exception 'FALHA LM10: continuou consumindo'; end if;
  raise notice 'OK LM10: revendedor não altera nem lê limites (RPC do ADMIN, tabela, função interna), não insere página direto; o limite continua valendo';
end $$;

-- ===================== LM11: DirectLink respeita o limite específico =====================
do $$
declare e text; p record;
begin
  perform pg_temp.set_limits('e9100000-0000-0000-0000-000000000003', 2, 2);
  perform pg_temp.save('e9000000-0000-0000-0000-0000000000a3', 'R3 página 1');
  perform pg_temp.save('e9000000-0000-0000-0000-0000000000a3', 'R3 página 2');
  e := pg_temp.save_err('e9000000-0000-0000-0000-0000000000a3', 'R3 página 3');
  if e not like '55000 Você atingiu o limite de páginas DirectLink definido para sua conta.%' then raise exception 'FALHA LM11: %', e; end if;
  p := pg_temp.pages('e9000000-0000-0000-0000-0000000000a3');
  if p.used <> 2 or p.page_limit <> 2 then raise exception 'FALHA LM11 status: %', p; end if;
  raise notice 'OK LM11: com limite 2, a 3ª página é recusada no banco (409) com a mensagem pedida; status 2 de 2';
end $$;

-- ===================== LM12–LM13: 5 → 3 não apaga; criação bloqueada; subir libera =====================
do $$
declare i int; e text; n_active int; code text;
begin
  perform pg_temp.set_limits('e9100000-0000-0000-0000-000000000002', 30, 5);
  for i in 1..5 loop perform pg_temp.save('e9000000-0000-0000-0000-0000000000a2', 'R2 página ' || i); end loop;
  perform pg_temp.set_limits('e9100000-0000-0000-0000-000000000002', 30, 3);
  select count(*) filter (where is_active) into n_active from public.direct_links where reseller_id = 'e9100000-0000-0000-0000-000000000002';
  select public_code into code from public.direct_links where reseller_id = 'e9100000-0000-0000-0000-000000000002' order by created_at limit 1;
  if n_active <> 5 or not exists (select 1 from public.public_direct_link(code)) then raise exception 'FALHA LM12: ativas=%', n_active; end if;
  raise notice 'OK LM12: reduzir de 5 para 3 mantém as 5 páginas ativas e públicas (nada apagado ou desativado)';
  e := pg_temp.save_err('e9000000-0000-0000-0000-0000000000a2', 'R2 página 6');
  if e not like '55000%' then raise exception 'FALHA LM13: %', e; end if;
  perform pg_temp.set_limits('e9100000-0000-0000-0000-000000000002', 30, 6);
  if pg_temp.save_err('e9000000-0000-0000-0000-0000000000a2', 'R2 página 6') <> 'criou' then raise exception 'FALHA LM13: não liberou'; end if;
  raise notice 'OK LM13: acima do limite a criação fica bloqueada; subir o limite para 6 libera uma nova página';
end $$;

-- ===================== LM14: ADMIN sem limite =====================
do $$
declare i int; r record; p record; rid uuid;
begin
  for i in 1..25 loop
    perform pg_temp.as_user('e9000000-0000-0000-0000-00000000000a');
    select * into r from public.directlab_consume('daily');
    execute 'reset role';
    if not r.allowed or r.daily_limit is not null then raise exception 'FALHA LM14 Google: %', r; end if;
  end loop;
  for i in 1..6 loop perform pg_temp.save('e9000000-0000-0000-0000-00000000000a', 'Plataforma ' || i); end loop;
  p := pg_temp.pages('e9000000-0000-0000-0000-00000000000a');
  if p.role <> 'admin' or p.page_limit is not null or p.used < 6 then raise exception 'FALHA LM14 páginas: %', p; end if;
  -- ADMIN editando página de um revendedor que está acima do limite: edição não é criação.
  select id into rid from public.direct_links where reseller_id = 'e9100000-0000-0000-0000-000000000003' limit 1;
  perform pg_temp.as_user('e9000000-0000-0000-0000-00000000000a');
  perform public.directlink_save(rid, 'Editada pelo ADMIN', null, null, null, true, '[]');
  execute 'reset role';
  raise notice 'OK LM14: ADMIN usa a Avaliação Google 25x no dia e cria 6 páginas sem limite; editar página existente nunca esbarra no limite';
end $$;

-- ===================== LM15: sem auditoria/histórico =====================
do $$
declare n_audit_before int; n_audit_after int; n_rows int;
begin
  select count(*) into n_audit_before from public.admin_audit_events;
  perform pg_temp.set_limits('e9100000-0000-0000-0000-000000000001', 11, 4);
  perform pg_temp.set_limits('e9100000-0000-0000-0000-000000000001', 12, 5);
  select count(*) into n_audit_after from public.admin_audit_events;
  select count(*) into n_rows from public.reseller_directlab_limits where reseller_id = 'e9100000-0000-0000-0000-000000000001';
  if n_audit_after <> n_audit_before or n_rows <> 1 then raise exception 'FALHA LM15: audit %→%, linhas %', n_audit_before, n_audit_after, n_rows; end if;
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name ~ '(directlab|limit).*(audit|history|log)|(audit|history|log).*(directlab|limit)')
    then raise exception 'FALHA LM15: tabela de histórico criada'; end if;
  raise notice 'OK LM15: alterar limites não gera auditoria nem histórico — só o valor atual (1 linha por revendedor)';
end $$;

-- ===================== LM16: validação dos valores =====================
do $$
declare r record;
begin
  begin perform pg_temp.set_limits('e9100000-0000-0000-0000-000000000001', -1, 3); raise exception 'FALHA LM16 negativo'; exception when invalid_parameter_value then execute 'reset role'; end;
  begin perform pg_temp.set_limits('e9100000-0000-0000-0000-000000000001', 10, 1001); raise exception 'FALHA LM16 acima'; exception when invalid_parameter_value then execute 'reset role'; end;
  begin perform pg_temp.set_limits('e9100000-0000-0000-0000-00000000ffff', 10, 3); raise exception 'FALHA LM16 inexistente'; exception when no_data_found then execute 'reset role'; end;
  perform pg_temp.set_limits('e9100000-0000-0000-0000-000000000003', 0, 2);
  r := pg_temp.consume('e9000000-0000-0000-0000-0000000000a3');
  if r.allowed then raise exception 'FALHA LM16: limite 0 permitiu'; end if;
  raise notice 'OK LM16: limites fora de 0–1000 e revendedor inexistente são recusados; limite 0 bloqueia a ferramenta';
end $$;

-- ===================== LM17: concorrência real na última página =====================
-- Preparação confirmada ANTES da disputa (evita impasse entre sessões).
select pg_temp.set_limits('e9100000-0000-0000-0000-000000000001', 12, 1);
do $$
declare
  conn text := current_setting('test.conn');
  ok_a boolean; err_b text; busy int; total int;
  prep text := 'set role authenticated; set request.jwt.claim.sub = ''e9000000-0000-0000-0000-0000000000a1''; ';
begin
  perform extensions.dblink_connect('lm_a', conn);
  perform extensions.dblink_connect('lm_b', conn);
  perform extensions.dblink_exec('lm_a', 'begin');
  perform extensions.dblink_exec('lm_a', prep);
  select t.ok into ok_a from extensions.dblink('lm_a', 'select (select id from public.directlink_save(null, ''A'', null, null, null, true, ''[]'')) is not null') as t(ok boolean);
  perform extensions.dblink_exec('lm_b', prep);
  perform extensions.dblink_send_query('lm_b', 'select (select id from public.directlink_save(null, ''B'', null, null, null, true, ''[]'')) is not null');
  perform pg_sleep(0.4);
  busy := extensions.dblink_is_busy('lm_b');
  perform extensions.dblink_exec('lm_a', 'commit');
  begin
    perform * from extensions.dblink_get_result('lm_b') as t(ok boolean);
    err_b := 'criou';
  exception when others then err_b := sqlstate;
  end;
  perform extensions.dblink_disconnect('lm_a');
  perform extensions.dblink_disconnect('lm_b');
  select count(*) into total from public.direct_links where reseller_id = 'e9100000-0000-0000-0000-000000000001';
  if not ok_a or busy <> 1 or err_b <> '55000' or total <> 1 then raise exception 'FALHA LM17: a=% esperou=% b=% total=%', ok_a, busy, err_b, total; end if;
  raise notice 'OK LM17: duas conexões reais criando a última página permitida: a segunda espera e é recusada (total fica 1)';
end $$;
