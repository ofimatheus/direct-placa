-- Concorrência REAL no fluxo de venda (migration 012): duas conexões
-- independentes (A e B, via dblink), cada uma com a própria transação e os
-- próprios locks, disputando as mesmas placas.
-- Rodar num banco de TESTE, depois das migrations (e opcionalmente depois
-- dos outros arquivos de teste).
--
-- Conexão usada pelo dblink (padrão: o banco atual pelo socket padrão):
--   psql -d placas_test -v dblink_conn='dbname=placas_test host=/tmp' -f supabase/tests/sales_concurrency.sql
--   Supabase local: -v dblink_conn='host=127.0.0.1 port=54322 user=postgres password=postgres dbname=postgres'
\set ON_ERROR_STOP 1

create extension if not exists dblink with schema extensions;

\if :{?dblink_conn}
\else
select 'dbname=' || current_database() as dblink_conn \gset
\endif
select set_config('test.conn', :'dblink_conn', false) as dblink_conn_em_uso;

insert into auth.users (id, email) values
  ('80000000-0000-0000-0000-00000000000a', 'con-admin@teste.com'),
  ('80000000-0000-0000-0000-0000000000b1', 'con-r1@teste.com'),
  ('80000000-0000-0000-0000-0000000000b2', 'con-r2@teste.com');
update public.profiles set role = 'admin' where email = 'con-admin@teste.com';
insert into public.reseller_profiles (id, user_id, company_name) values
  ('81000000-0000-0000-0000-000000000001', '80000000-0000-0000-0000-0000000000b1', 'Concorrência Um'),
  ('81000000-0000-0000-0000-000000000002', '80000000-0000-0000-0000-0000000000b2', 'Concorrência Dois');

insert into public.plate_batches (id, name, quantity) values
  ('82000000-0000-0000-0000-000000000001', 'Concorrência manual', 1),
  ('82000000-0000-0000-0000-000000000002', 'Concorrência esgotando', 4),
  ('82000000-0000-0000-0000-000000000003', 'Concorrência disjunta', 6),
  ('82000000-0000-0000-0000-000000000004', 'Concorrência mista', 2),
  ('82000000-0000-0000-0000-000000000005', 'Concorrência cancelamento', 2);
insert into public.plates (public_code, batch_id) values ('CON001', '82000000-0000-0000-0000-000000000001');
insert into public.plates (public_code, batch_id)
select 'CON1' || lpad(g::text, 2, '0'), '82000000-0000-0000-0000-000000000002' from generate_series(1, 4) g;
insert into public.plates (public_code, batch_id)
select 'CON2' || lpad(g::text, 2, '0'), '82000000-0000-0000-0000-000000000003' from generate_series(1, 6) g;
insert into public.plates (public_code, batch_id) values
  ('CON301', '82000000-0000-0000-0000-000000000004'), ('CON302', '82000000-0000-0000-0000-000000000004');
insert into public.plates (public_code, batch_id) values
  ('CON401', '82000000-0000-0000-0000-000000000005'), ('CON402', '82000000-0000-0000-0000-000000000005');

-- Abre uma conexão dblink numa transação, autenticada como o usuário indicado.
create function pg_temp.open_as(p_conn text, p_uid uuid) returns void language plpgsql as $$
begin
  perform extensions.dblink_connect(p_conn, current_setting('test.conn'));
  perform extensions.dblink_exec(p_conn, 'begin');
  perform extensions.dblink_exec(p_conn, 'set local role authenticated');
  perform extensions.dblink_exec(p_conn, format('set local request.jwt.claim.sub = %L', p_uid));
end $$;

-- Espera o resultado de uma query assíncrona e devolve a mensagem de erro ('OK' se não houve).
create function pg_temp.finish(p_conn text) returns text language plpgsql as $$
declare v_msg text;
begin
  perform * from extensions.dblink_get_result(p_conn, false) as t(x text);
  -- dblink devolve "ERROR:  mensagem\nDETAIL: ..."; fica só a mensagem.
  v_msg := split_part(regexp_replace(extensions.dblink_error_message(p_conn), '^ERROR:\s+', ''), E'\n', 1);
  perform * from extensions.dblink_get_result(p_conn, false) as t(x text);
  return btrim(v_msg);
end $$;

create function pg_temp.sale_sql(p_reseller uuid, p_qty int, p_notes text, p_mode text, p_plates text[], p_batch uuid) returns text
language sql as $$
  select format(
    'select public.create_sale_with_plates(%L, %s, 10, 0, %L, ''pending'', %L, %L::uuid[], %L::uuid, gen_random_uuid())::text',
    p_reseller, p_qty, p_notes, p_mode,
    case when p_plates is null then null
         else (select array_agg(id::text) from public.plates where public_code = any(p_plates)) end,
    p_batch);
$$;

-- ===================== C1: manual × manual na mesma placa =====================
do $$
declare v_msg text; v_a uuid;
begin
  perform pg_temp.open_as('a', '80000000-0000-0000-0000-00000000000a');
  perform pg_temp.open_as('b', '80000000-0000-0000-0000-00000000000a');

  select x::uuid into v_a from extensions.dblink('a',
    pg_temp.sale_sql('81000000-0000-0000-0000-000000000001', 1, 'C1-A', 'manual', array['CON001'], null)) as t(x text);

  -- B pede a mesma placa enquanto A ainda não confirmou: precisa ESPERAR.
  perform extensions.dblink_send_query('b',
    pg_temp.sale_sql('81000000-0000-0000-0000-000000000002', 1, 'C1-B', 'manual', array['CON001'], null));
  perform pg_sleep(0.6);
  if extensions.dblink_is_busy('b') <> 1 then raise exception 'FALHA: B deveria estar esperando o lock da placa'; end if;

  perform extensions.dblink_exec('a', 'commit');
  v_msg := pg_temp.finish('b');
  perform extensions.dblink_exec('b', 'rollback');
  perform extensions.dblink_disconnect('a');
  perform extensions.dblink_disconnect('b');

  if v_msg not like 'Estas placas não estão mais disponíveis: CON001.%' then
    raise exception 'FALHA: B deveria falhar por placa indisponível, veio "%"', v_msg; end if;
  if (select count(*) from public.order_plates op join public.plates p on p.id = op.plate_id
      where p.public_code = 'CON001' and op.released_at is null) <> 1
     or (select op.order_id from public.order_plates op join public.plates p on p.id = op.plate_id where p.public_code = 'CON001') <> v_a
     or exists (select 1 from public.orders where notes = 'C1-B')
     or (select reseller_id from public.plates where public_code = 'CON001') <> '81000000-0000-0000-0000-000000000001'
    then raise exception 'FALHA: estado final de C1'; end if;
  raise notice 'OK C1: duas vendas manuais simultâneas na mesma placa: B espera o lock, A confirma, B é recusada e não cria venda';
end $$;

-- ===================== C2: automática × automática, estoque suficiente para as duas =====================
do $$
declare v_msg text; v_a uuid; v_b uuid;
begin
  perform pg_temp.open_as('a', '80000000-0000-0000-0000-00000000000a');
  perform pg_temp.open_as('b', '80000000-0000-0000-0000-00000000000a');

  select x::uuid into v_a from extensions.dblink('a',
    pg_temp.sale_sql('81000000-0000-0000-0000-000000000001', 4, 'C2-A', 'automatic', null, '82000000-0000-0000-0000-000000000003')) as t(x text);

  -- B não espera: pula as placas travadas por A (SKIP LOCKED) e pega as livres.
  perform extensions.dblink_send_query('b',
    pg_temp.sale_sql('81000000-0000-0000-0000-000000000002', 2, 'C2-B', 'automatic', null, '82000000-0000-0000-0000-000000000003'));
  perform pg_sleep(0.3);
  if extensions.dblink_is_busy('b') <> 0 then raise exception 'FALHA: B não deveria esperar pelas placas de A'; end if;
  select x::uuid into v_b from extensions.dblink_get_result('b') as t(x text);
  perform * from extensions.dblink_get_result('b') as t(x text);

  perform extensions.dblink_exec('b', 'commit');
  perform extensions.dblink_exec('a', 'commit');
  perform extensions.dblink_disconnect('a');
  perform extensions.dblink_disconnect('b');

  if (select array_agg(p.public_code order by p.public_code) from public.order_plates op join public.plates p on p.id = op.plate_id where op.order_id = v_a)
       <> array['CON201', 'CON202', 'CON203', 'CON204']
     or (select array_agg(p.public_code order by p.public_code) from public.order_plates op join public.plates p on p.id = op.plate_id where op.order_id = v_b)
       <> array['CON205', 'CON206']
    then raise exception 'FALHA: C2 deveria dividir o lote sem sobreposição'; end if;
  raise notice 'OK C2: duas vendas automáticas simultâneas recebem placas diferentes, sem espera e sem sobreposição';
end $$;

-- ===================== C3: automática × automática disputando as últimas placas =====================
do $$
declare v_msg text; v_a uuid;
begin
  perform pg_temp.open_as('a', '80000000-0000-0000-0000-00000000000a');
  perform pg_temp.open_as('b', '80000000-0000-0000-0000-00000000000a');

  select x::uuid into v_a from extensions.dblink('a',
    pg_temp.sale_sql('81000000-0000-0000-0000-000000000001', 4, 'C3-A', 'automatic', null, '82000000-0000-0000-0000-000000000002')) as t(x text);

  perform extensions.dblink_send_query('b',
    pg_temp.sale_sql('81000000-0000-0000-0000-000000000002', 4, 'C3-B', 'automatic', null, '82000000-0000-0000-0000-000000000002'));
  v_msg := pg_temp.finish('b');
  perform extensions.dblink_exec('b', 'rollback');
  perform extensions.dblink_exec('a', 'commit');
  perform extensions.dblink_disconnect('a');
  perform extensions.dblink_disconnect('b');

  if v_msg <> 'Não há placas disponíveis neste lote.' then raise exception 'FALHA: mensagem de B em C3: "%"', v_msg; end if;
  if (select count(*) from public.order_plates where order_id = v_a and released_at is null) <> 4
     or exists (select 1 from public.orders where notes = 'C3-B')
    then raise exception 'FALHA: estado final de C3'; end if;
  raise notice 'OK C3: duas vendas automáticas pelas mesmas 4 últimas placas: só uma consegue; a outra recebe "Não há placas disponíveis"';
end $$;

-- ===================== C4: manual × automática na mesma placa =====================
do $$
declare v_a uuid; v_b uuid;
begin
  perform pg_temp.open_as('a', '80000000-0000-0000-0000-00000000000a');
  perform pg_temp.open_as('b', '80000000-0000-0000-0000-00000000000a');

  select x::uuid into v_a from extensions.dblink('a',
    pg_temp.sale_sql('81000000-0000-0000-0000-000000000001', 1, 'C4-A', 'manual', array['CON301'], null)) as t(x text);
  select x::uuid into v_b from extensions.dblink('b',
    pg_temp.sale_sql('81000000-0000-0000-0000-000000000002', 1, 'C4-B', 'automatic', null, '82000000-0000-0000-0000-000000000004')) as t(x text);
  perform extensions.dblink_exec('a', 'commit');
  perform extensions.dblink_exec('b', 'commit');
  perform extensions.dblink_disconnect('a');
  perform extensions.dblink_disconnect('b');

  if (select p.public_code from public.order_plates op join public.plates p on p.id = op.plate_id where op.order_id = v_a) <> 'CON301'
     or (select p.public_code from public.order_plates op join public.plates p on p.id = op.plate_id where op.order_id = v_b) <> 'CON302'
    then raise exception 'FALHA: C4 pegou a mesma placa'; end if;
  raise notice 'OK C4: venda automática simultânea pula a placa que a manual está reservando';
end $$;

-- ===================== C5 e C6: cancelamento × ativação pelo revendedor =====================
begin;
set local role authenticated;
set local request.jwt.claim.sub = '80000000-0000-0000-0000-00000000000a';
select set_config('test.c5_order', public.create_sale_with_plates('81000000-0000-0000-0000-000000000001', 1, 10, 0, 'C5', 'pending', 'manual',
  array(select id from public.plates where public_code = 'CON401'), null, gen_random_uuid())::text, false) is not null as c5;
select set_config('test.c6_order', public.create_sale_with_plates('81000000-0000-0000-0000-000000000001', 1, 10, 0, 'C6', 'pending', 'manual',
  array(select id from public.plates where public_code = 'CON402'), null, gen_random_uuid())::text, false) is not null as c6;
commit;

do $$
declare v_msg text; v_plate uuid := (select id from public.plates where public_code = 'CON401');
begin
  perform pg_temp.open_as('a', '80000000-0000-0000-0000-00000000000a');
  perform pg_temp.open_as('b', '80000000-0000-0000-0000-0000000000b1');

  -- A cancela (transação aberta): a placa volta ao estoque dentro de A.
  perform * from extensions.dblink('a', format('select id::text from public.cancel_order(%L)', current_setting('test.c5_order'))) as t(x text);
  -- B (revendedor) tenta ativar a mesma placa ao mesmo tempo: espera.
  perform extensions.dblink_send_query('b', format(
    'select status from public.configure_reseller_plate(%L, null, ''website'', ''https://revenda.com.br'', null)', v_plate));
  perform pg_sleep(0.6);
  if extensions.dblink_is_busy('b') <> 1 then raise exception 'FALHA: ativação deveria esperar o cancelamento'; end if;
  perform extensions.dblink_exec('a', 'commit');
  v_msg := pg_temp.finish('b');
  perform extensions.dblink_exec('b', 'rollback');
  perform extensions.dblink_disconnect('a');
  perform extensions.dblink_disconnect('b');

  if v_msg <> 'Placa não encontrada' then raise exception 'FALHA: ativação após cancelamento: "%"', v_msg; end if;
  if (select status from public.plates where id = v_plate) <> 'in_stock'
     or (select reseller_id from public.plates where id = v_plate) is not null
     or (select destination_url from public.plates where id = v_plate) is not null
    then raise exception 'FALHA: placa devolvida acabou configurada'; end if;
  raise notice 'OK C5: cancelamento e ativação simultâneos: a ativação espera e é recusada; a placa volta limpa ao estoque';
end $$;

do $$
declare v_msg text; v_plate uuid := (select id from public.plates where public_code = 'CON402');
begin
  perform pg_temp.open_as('a', '80000000-0000-0000-0000-00000000000a');
  perform pg_temp.open_as('b', '80000000-0000-0000-0000-0000000000b1');

  -- B (revendedor) ativa primeiro (transação aberta).
  perform * from extensions.dblink('b', format(
    'select status from public.configure_reseller_plate(%L, null, ''website'', ''https://revenda.com.br'', null)', v_plate)) as t(x text);
  -- A cancela ao mesmo tempo: espera o lock da placa e então enxerga que ela ficou ATIVA.
  perform extensions.dblink_send_query('a', format('select id::text from public.cancel_order(%L)', current_setting('test.c6_order')));
  perform pg_sleep(0.6);
  if extensions.dblink_is_busy('a') <> 1 then raise exception 'FALHA: cancelamento deveria esperar a ativação'; end if;
  perform extensions.dblink_exec('b', 'commit');
  v_msg := pg_temp.finish('a');
  perform extensions.dblink_exec('a', 'rollback');
  perform extensions.dblink_disconnect('a');
  perform extensions.dblink_disconnect('b');

  if v_msg not like 'Esta venda tem 1 placa(s) ativa(s) ou em uso vinculada(s): CON402 (Ativa).%' then
    raise exception 'FALHA: cancelamento após ativação: "%"', v_msg; end if;
  if (select status from public.orders where id = current_setting('test.c6_order')::uuid) <> 'pending'
     or (select status from public.plates where id = v_plate) <> 'active'
     or (select reseller_id from public.plates where id = v_plate) <> '81000000-0000-0000-0000-000000000001'
    then raise exception 'FALHA: estado final de C6'; end if;
  raise notice 'OK C6: ativação e cancelamento simultâneos: o cancelamento espera, vê a placa ATIVA e é bloqueado';
end $$;

-- ===================== C7: 8 vendas automáticas disparadas ao mesmo tempo =====================
insert into public.plate_batches (id, name, quantity) values ('82000000-0000-0000-0000-000000000006', 'Concorrência estresse', 30);
insert into public.plates (public_code, batch_id)
select 'CON5' || lpad(g::text, 2, '0'), '82000000-0000-0000-0000-000000000006' from generate_series(1, 30) g;

do $$
declare i int; v_ok int := 0; v_fail int := 0; v_msg text; v_id text;
begin
  for i in 1..8 loop
    perform pg_temp.open_as('s' || i, '80000000-0000-0000-0000-00000000000a');
  end loop;
  -- 8 × 5 = 40 placas pedidas para um lote de 30, todas em paralelo.
  for i in 1..8 loop
    perform extensions.dblink_send_query('s' || i,
      pg_temp.sale_sql('81000000-0000-0000-0000-000000000001', 5, 'C7-' || i, 'automatic', null, '82000000-0000-0000-0000-000000000006'));
  end loop;
  for i in 1..8 loop
    select x into v_id from extensions.dblink_get_result('s' || i, false) as t(x text);
    v_msg := extensions.dblink_error_message('s' || i);
    perform * from extensions.dblink_get_result('s' || i, false) as t(x text);
    if v_id is not null then
      v_ok := v_ok + 1;
      perform extensions.dblink_exec('s' || i, 'commit');
    else
      v_fail := v_fail + 1;
      perform extensions.dblink_exec('s' || i, 'rollback');
    end if;
    v_id := null;
    perform extensions.dblink_disconnect('s' || i);
  end loop;

  if v_ok + v_fail <> 8 or v_ok > 6 then raise exception 'FALHA: % vendas passaram, % falharam', v_ok, v_fail; end if;
  if (select count(*) from public.order_plates op join public.plates p on p.id = op.plate_id
      where p.batch_id = '82000000-0000-0000-0000-000000000006' and op.released_at is null) <> v_ok * 5
     or (select count(distinct op.plate_id) from public.order_plates op join public.plates p on p.id = op.plate_id
         where p.batch_id = '82000000-0000-0000-0000-000000000006') <> v_ok * 5
     or exists (select 1 from public.orders o where o.notes like 'C7-%'
                and (select count(*) from public.order_plates op where op.order_id = o.id) <> 5)
    then raise exception 'FALHA: sobreposição ou reserva parcial no estresse'; end if;
  raise notice 'OK C7: 8 vendas simultâneas (40 placas pedidas, 30 no lote): % confirmadas com 5 placas cada, % recusadas, nenhuma placa repetida', v_ok, v_fail;
end $$;
