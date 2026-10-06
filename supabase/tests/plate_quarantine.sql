-- Quarentena e exclusão administrativa de placas (migration 029).
--   psql -d placas_test -v dblink_conn='dbname=placas_test host=/tmp' -f supabase/tests/plate_quarantine.sql
\set ON_ERROR_STOP 1
create extension if not exists dblink with schema extensions;
\if :{?dblink_conn}
\else
select 'dbname=' || current_database() as dblink_conn \gset
\endif
select set_config('test.conn', :'dblink_conn', false) as dblink_conn_em_uso;

insert into auth.users (id, email) values
  ('c3000000-0000-0000-0000-00000000000a', 'pq-admin@teste.com'),
  ('c3000000-0000-0000-0000-0000000000a1', 'pq-r1@teste.com');
update public.profiles set role = 'admin' where email = 'pq-admin@teste.com';
insert into public.reseller_profiles (id, user_id, company_name) values ('c3100000-0000-0000-0000-000000000001', 'c3000000-0000-0000-0000-0000000000a1', 'Quarentena Um');
insert into public.plate_batches (id, name, quantity) values
  ('c3200000-0000-0000-0000-000000000001', 'Lote Mil', 1000),
  ('c3200000-0000-0000-0000-000000000002', 'Lote Dez', 10),
  ('c3200000-0000-0000-0000-000000000003', 'Lote Histórico', 8);
insert into public.plates (public_code, batch_id) select 'QT' || lpad(g::text, 4, '0'), 'c3200000-0000-0000-0000-000000000001' from generate_series(1, 1000) g;
insert into public.plates (public_code, batch_id) select 'QB' || lpad(g::text, 4, '0'), 'c3200000-0000-0000-0000-000000000002' from generate_series(1, 10) g;
insert into public.plates (public_code, batch_id) select 'QH' || lpad(g::text, 2, '0'), 'c3200000-0000-0000-0000-000000000003' from generate_series(1, 9) g;

create function pg_temp.admin() returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', 'c3000000-0000-0000-0000-00000000000a', true); execute 'set local role authenticated'; end $$;
-- Placas DESTE teste são identificadas pelo lote (outros testes da bateria também usam códigos 'QT…').
create function pg_temp.batch(p_prefix text) returns uuid language sql as $$
  select case p_prefix when 'QT' then 'c3200000-0000-0000-0000-000000000001'::uuid when 'QB' then 'c3200000-0000-0000-0000-000000000002'::uuid else 'c3200000-0000-0000-0000-000000000003'::uuid end $$;
create function pg_temp.ids(p_prefix text) returns uuid[] language sql as $$ select array_agg(id order by public_code) from public.plates where batch_id = pg_temp.batch(p_prefix) $$;
create function pg_temp.id(p_code text) returns uuid language sql as $$ select id from public.plates where public_code = p_code and batch_id = pg_temp.batch(left(p_code, 2)) $$;
create function pg_temp.instock() returns integer language plpgsql as $$
declare v int; begin perform pg_temp.admin(); select (public.admin_dashboard_metrics(now() - interval '1 day', now()) ->> 'plates_in_stock')::int into v; execute 'reset role'; return v; end $$;

-- ===================== PQ1: dados existentes começam fora de quarentena =====================
do $$
declare v_batch int;
begin
  -- A migration não coloca NENHUMA placa em quarentena; placas de lotes já em quarentena
  -- (deixados por outros testes da bateria) ficam fora da operação pela regra do lote.
  if exists (select 1 from public.plates p where p.quarantined_at is not null or p.quarantined_by is not null or p.quarantine_reason is not null)
     or exists (select 1 from public.plates p where public.quarantine_state(p) = 'plate') then raise exception 'FALHA PQ1'; end if;
  select count(*) into v_batch from public.plates p where public.quarantine_state(p) = 'batch';
  if v_batch <> (select count(*) from public.plates p join public.plate_batches b on b.id = p.batch_id where b.lifecycle_status = 'quarantine') then raise exception 'FALHA PQ1 lote'; end if;
  raise notice 'OK PQ1: nenhuma placa existente entra em quarentena pela migration (0 com quarantined_at); % placas já estavam fora da operação só porque o lote delas está em quarentena', v_batch;
end $$;

-- ===================== PQ2/PQ3: quarentenar 1 e depois 1000 numa chamada =====================
do $$
declare r record; t0 timestamptz; ms int; before_stock int := pg_temp.instock();
begin
  perform pg_temp.admin();
  select * into r from public.admin_plates_quarantine(array[pg_temp.id('QT0001')], '  Lote com defeito de impressão  ');
  execute 'reset role';
  if r.quarantined <> 1 or (select quarantine_reason from public.plates where public_code = 'QT0001' and batch_id = 'c3200000-0000-0000-0000-000000000001') <> 'Lote com defeito de impressão'
     or (select status from public.plates where public_code = 'QT0001' and batch_id = 'c3200000-0000-0000-0000-000000000001') <> 'in_stock'
     or (select quarantined_by from public.plates where public_code = 'QT0001' and batch_id = 'c3200000-0000-0000-0000-000000000001') <> 'c3000000-0000-0000-0000-00000000000a' then raise exception 'FALHA PQ2 %', r; end if;
  raise notice 'OK PQ2: 1 placa em quarentena (motivo, autor e data gravados; status continua in_stock)';
  t0 := clock_timestamp();
  perform pg_temp.admin();
  select * into r from public.admin_plates_quarantine(pg_temp.ids('QT'), null);
  execute 'reset role';
  ms := extract(milliseconds from clock_timestamp() - t0)::int;
  if r.quarantined <> 999 or r.already <> 1 or r.skipped <> 0 or ms > 5000 or pg_temp.instock() <> before_stock - 1000 then raise exception 'FALHA PQ3 % ms=% estoque=%→%', r, ms, before_stock, pg_temp.instock(); end if;
  raise notice 'OK PQ3: 1000 placas numa ÚNICA chamada (999 novas + 1 que já estava) em % ms; "Disponíveis" no painel caiu exatamente 1000', ms;
end $$;

-- ===================== PQ4: some da operação, aparece na quarentena =====================
do $$
begin
  if (select count(*) from public.plates p where p.batch_id = 'c3200000-0000-0000-0000-000000000001' and public.quarantine_state(p) is null) <> 0
     or (select count(*) from public.plates p where p.batch_id = 'c3200000-0000-0000-0000-000000000001' and public.quarantine_state(p) = 'plate') <> 1000 then raise exception 'FALHA PQ4'; end if;
  raise notice 'OK PQ4: as 1000 saem da lista operacional e estão todas na Quarentena (origem: placa)';
end $$;

-- ===================== PQ5: placa em quarentena não entra em atribuição nem venda =====================
do $$
begin
  perform pg_temp.admin();
  begin perform public.assign_plates_to_reseller('c3100000-0000-0000-0000-000000000001', 5, null, 'c3200000-0000-0000-0000-000000000001'); raise exception 'FALHA PQ5 auto'; exception when others then if sqlerrm like 'FALHA%' then raise; end if; end;
  begin perform public.assign_plates_to_reseller('c3100000-0000-0000-0000-000000000001', null, array[pg_temp.id('QT0002')], null); raise exception 'FALHA PQ5 manual'; exception when object_not_in_prerequisite_state then null; end;
  begin perform public.create_sale_with_plates('c3100000-0000-0000-0000-000000000001', 3, 10, 0, null, 'pending', 'automatic', null, 'c3200000-0000-0000-0000-000000000001', gen_random_uuid()); raise exception 'FALHA PQ5 venda auto'; exception when others then if sqlerrm like 'FALHA%' then raise; end if; end;
  begin perform public.create_sale_with_plates('c3100000-0000-0000-0000-000000000001', 1, 10, 0, null, 'pending', 'manual', array[pg_temp.id('QT0003')], null, gen_random_uuid()); raise exception 'FALHA PQ5 venda manual'; exception when object_not_in_prerequisite_state then null; end;
  begin update public.plates set reseller_id = 'c3100000-0000-0000-0000-000000000001', status = 'assigned' where public_code = 'QT0004' and batch_id = 'c3200000-0000-0000-0000-000000000001'; raise exception 'FALHA PQ5 update direto'; exception when object_not_in_prerequisite_state then null; end;
  execute 'reset role';
  if exists (select 1 from public.plates where batch_id = 'c3200000-0000-0000-0000-000000000001' and reseller_id is not null) or exists (select 1 from public.order_plates op join public.plates p on p.id = op.plate_id where p.batch_id = 'c3200000-0000-0000-0000-000000000001') then raise exception 'FALHA PQ5 efeito'; end if;
  raise notice 'OK PQ5: placa em quarentena não é atribuída nem vendida (escolha automática a pula; seleção manual e alteração direta são recusadas); nenhuma QT foi parar com revendedor ou pedido';
end $$;

-- ===================== PQ6: restaurar 1 e muitas =====================
do $$
declare r record; t0 timestamptz; ms int;
begin
  perform pg_temp.admin();
  select * into r from public.admin_plates_restore(array[pg_temp.id('QT0001')]);
  execute 'reset role';
  if r.restored <> 1 or (select quarantined_at from public.plates where public_code = 'QT0001' and batch_id = 'c3200000-0000-0000-0000-000000000001') is not null or (select quarantine_reason from public.plates where public_code = 'QT0001' and batch_id = 'c3200000-0000-0000-0000-000000000001') is not null then raise exception 'FALHA PQ6a %', r; end if;
  t0 := clock_timestamp();
  perform pg_temp.admin();
  select * into r from public.admin_plates_restore(pg_temp.ids('QT'));
  execute 'reset role';
  ms := extract(milliseconds from clock_timestamp() - t0)::int;
  if r.restored <> 999 or r.not_quarantined <> 1 or exists (select 1 from public.plates p where p.batch_id = 'c3200000-0000-0000-0000-000000000001' and (public.quarantine_state(p) is not null or p.status <> 'in_stock' or p.batch_id <> 'c3200000-0000-0000-0000-000000000001')) then raise exception 'FALHA PQ6b %', r; end if;
  perform pg_temp.admin();
  perform public.assign_plates_to_reseller('c3100000-0000-0000-0000-000000000001', 2, null, 'c3200000-0000-0000-0000-000000000001');
  execute 'reset role';
  if (select count(*) from public.plates where batch_id = 'c3200000-0000-0000-0000-000000000001' and reseller_id is not null) <> 2 then raise exception 'FALHA PQ6c'; end if;
  raise notice 'OK PQ6: restaurar 1 e depois 999 (em % ms) devolve as placas exatamente como estavam (status, lote, código); restauradas voltam a ser atribuíveis (2 atribuídas)', ms;
end $$;

-- ===================== PQ7: lote em quarentena reflete nas placas =====================
do $$
declare r record; s0 int := pg_temp.instock();
begin
  perform pg_temp.admin();
  perform public.set_batch_lifecycle_status('c3200000-0000-0000-0000-000000000002', 'quarantine', 'teste');
  execute 'reset role';
  if (select count(*) from public.plates p where p.batch_id = 'c3200000-0000-0000-0000-000000000002' and public.quarantine_state(p) = 'batch') <> 10 or pg_temp.instock() <> s0 - 10 then raise exception 'FALHA PQ7a'; end if;
  perform pg_temp.admin();
  begin perform public.assign_plates_to_reseller('c3100000-0000-0000-0000-000000000001', 1, null, 'c3200000-0000-0000-0000-000000000002'); raise exception 'FALHA PQ7 atribuiu'; exception when others then if sqlerrm like 'FALHA%' then raise; end if; end;
  select * into r from public.admin_plates_quarantine(array[pg_temp.id('QB0001')], null);
  select * into r from public.admin_plates_restore(array[pg_temp.id('QB0001')]);
  execute 'reset role';
  if r.restored <> 1 or r.still_batch_quarantine <> 1 or (select public.quarantine_state(p) from public.plates p where public_code = 'QB0001' and batch_id = 'c3200000-0000-0000-0000-000000000002') <> 'batch' then raise exception 'FALHA PQ7b %', r; end if;
  perform pg_temp.admin();
  perform public.set_batch_lifecycle_status('c3200000-0000-0000-0000-000000000002', 'active', null);
  perform public.assign_plates_to_reseller('c3100000-0000-0000-0000-000000000001', 1, null, 'c3200000-0000-0000-0000-000000000002');
  execute 'reset role';
  if exists (select 1 from public.plates p where p.batch_id = 'c3200000-0000-0000-0000-000000000002' and public.quarantine_state(p) is not null) or pg_temp.instock() <> s0 - 1 then raise exception 'FALHA PQ7c'; end if;
  raise notice 'OK PQ7: lote em quarentena → suas 10 placas ficam fora da operação (estado "batch", fora do estoque e da atribuição); restaurar a placa sozinha avisa que o lote ainda está em quarentena; restaurar o lote libera tudo (1 atribuída em seguida)';
end $$;

-- ===================== PQ8: permissões =====================
do $$
begin
  perform set_config('request.jwt.claim.sub', 'c3000000-0000-0000-0000-0000000000a1', true);
  set local role authenticated;
  begin perform public.admin_plates_quarantine(array[pg_temp.id('QT0010')], null); raise exception 'FALHA PQ8 q'; exception when insufficient_privilege then null; end;
  begin perform public.admin_plates_restore(array[pg_temp.id('QT0010')]); raise exception 'FALHA PQ8 r'; exception when insufficient_privilege then null; end;
  begin perform public.admin_plates_delete_unused(array[pg_temp.id('QT0010')]); raise exception 'FALHA PQ8 d'; exception when insufficient_privilege then null; end;
  begin delete from public.plates where public_code = 'QT0010' and batch_id = 'c3200000-0000-0000-0000-000000000001'; raise exception 'FALHA PQ8 delete revendedor'; exception when insufficient_privilege then null; end;
  reset role;
  perform pg_temp.admin();
  begin delete from public.plates where public_code = 'QT0010' and batch_id = 'c3200000-0000-0000-0000-000000000001'; raise exception 'FALHA PQ8 delete admin direto'; exception when insufficient_privilege then null; end;
  execute 'reset role';
  set local role anon;
  begin perform public.admin_plates_delete_unused(array[pg_temp.id('QT0010')]); raise exception 'FALHA PQ8 anon'; exception when insufficient_privilege then null; end;
  reset role;
  if not exists (select 1 from public.plates where public_code = 'QT0010' and batch_id = 'c3200000-0000-0000-0000-000000000001') then raise exception 'FALHA PQ8 apagou'; end if;
  raise notice 'OK PQ8: revendedor e público não quarentenam, restauram nem excluem; DELETE direto na tabela é recusado até para o ADMIN (só a função administrativa exclui)';
end $$;

-- ===================== PQ9: quem pode e quem não pode ser excluída =====================
do $$
declare r record; v_customer uuid; v_order uuid;
begin
  -- QH01 nunca usada · QH08 bloqueada sem uso → podem
  update public.plates set status = 'blocked' where public_code = 'QH08' and batch_id = 'c3200000-0000-0000-0000-000000000003';
  perform pg_temp.admin();
  -- QH02 venda do revendedor · QH03 venda do ADMIN (pedido) · QH04 com revendedor
  perform public.set_plate_reseller(pg_temp.id('QH02'), 'c3100000-0000-0000-0000-000000000001');
  perform public.create_sale_with_plates('c3100000-0000-0000-0000-000000000001', 1, 10, 0, null, 'pending', 'manual', array[pg_temp.id('QH03')], null, gen_random_uuid());
  perform public.set_plate_reseller(pg_temp.id('QH04'), 'c3100000-0000-0000-0000-000000000001');
  -- QH06 já teve revendedor (devolvida ao estoque: histórico de atribuição)
  perform public.set_plate_reseller(pg_temp.id('QH06'), 'c3100000-0000-0000-0000-000000000001');
  perform public.set_plate_reseller(pg_temp.id('QH06'), null);
  -- QH09 com cliente vinculado (sem venda)
  perform public.set_plate_reseller(pg_temp.id('QH09'), 'c3100000-0000-0000-0000-000000000001');
  execute 'reset role';
  insert into public.customers (reseller_id, name) values ('c3100000-0000-0000-0000-000000000001', 'Cliente PQ') returning id into v_customer;
  update public.plates set customer_id = v_customer where id = pg_temp.id('QH09');
  perform set_config('request.jwt.claim.sub', 'c3000000-0000-0000-0000-0000000000a1', true);
  set local role authenticated;
  perform public.create_reseller_sale(array[pg_temp.id('QH02')], 50, v_customer, 'paid', current_date, null, gen_random_uuid());
  reset role;
  -- QH05 ativada com destino · QH07 com acessos
  update public.plates set destination_type = 'website', destination_url = 'https://exemplo.com', status = 'active' where public_code = 'QH05' and batch_id = 'c3200000-0000-0000-0000-000000000003';
  update public.plates set access_count = 3, qr_access_count = 3, last_access_at = now() where public_code = 'QH07' and batch_id = 'c3200000-0000-0000-0000-000000000003';
  perform pg_temp.admin();
  select * into r from public.admin_plates_delete_unused(pg_temp.ids('QH'));
  execute 'reset role';
  if r.deleted <> 2 or r.kept <> 7
     or exists (select 1 from public.plates where public_code in ('QH01', 'QH08') and batch_id = 'c3200000-0000-0000-0000-000000000003')
     or (select count(*) from public.plates where batch_id = 'c3200000-0000-0000-0000-000000000003') <> 7
     or not (r.kept_by_reason ?& array['sale', 'order', 'reseller', 'activation', 'accesses', 'customer']) then
    raise exception 'FALHA PQ9: % ', r; end if;
  raise notice 'OK PQ9: das 9 selecionadas, 2 nunca usadas (uma bloqueada) foram excluídas; 7 mantidas com motivo: %', r.kept_by_reason;
end $$;

-- ===================== PQ10: concorrência — atribuição simultânea faz a exclusão manter a placa =====================
do $$
declare
  conn text := current_setting('test.conn');
  busy int; deleted int; kept jsonb;
  prep text := 'set role authenticated; set request.jwt.claim.sub = ''c3000000-0000-0000-0000-00000000000a''; ';
  pid text := pg_temp.id('QT0500')::text;
begin
  perform extensions.dblink_connect('pq_a', conn);
  perform extensions.dblink_connect('pq_b', conn);
  perform extensions.dblink_exec('pq_a', 'begin');
  perform extensions.dblink_exec('pq_a', prep);
  perform * from extensions.dblink('pq_a', 'select 1 from public.assign_plates_to_reseller(''c3100000-0000-0000-0000-000000000001'', null, array[''' || pid || '''::uuid], null)') as t(x int);
  perform extensions.dblink_exec('pq_b', prep);
  perform extensions.dblink_send_query('pq_b', 'select deleted, kept_by_reason from public.admin_plates_delete_unused(array[''' || pid || '''::uuid])');
  perform pg_sleep(0.4);
  busy := extensions.dblink_is_busy('pq_b');
  perform extensions.dblink_exec('pq_a', 'commit');
  select t.d, t.k into deleted, kept from extensions.dblink_get_result('pq_b') as t(d int, k jsonb);
  perform extensions.dblink_disconnect('pq_a');
  perform extensions.dblink_disconnect('pq_b');
  if busy <> 1 or deleted <> 0 or kept ->> 'reseller' <> '1' or not exists (select 1 from public.plates where id = pid::uuid and reseller_id is not null) then
    raise exception 'FALHA PQ10: esperou=% excluídas=% mantidas=%', busy, deleted, kept; end if;
  raise notice 'OK PQ10: a exclusão esperou a atribuição concorrente terminar, reconferiu e MANTEVE a placa (agora com revendedor)';
end $$;

-- ===================== PQ11: escala — excluir as elegíveis entre 1000 numa chamada =====================
do $$
declare r record; t0 timestamptz := clock_timestamp(); ms int;
begin
  perform pg_temp.admin();
  select * into r from public.admin_plates_delete_unused(pg_temp.ids('QT'));
  execute 'reset role';
  ms := extract(milliseconds from clock_timestamp() - t0)::int;
  if r.deleted <> 997 or r.kept <> 3 or (r.kept_by_reason ->> 'reseller')::int <> 3 or jsonb_array_length(r.deleted_plates) <> 997 or ms > 8000
     or (select count(*) from public.plates where batch_id = 'c3200000-0000-0000-0000-000000000001') <> 3
     or not exists (select 1 from public.plate_batches where id = 'c3200000-0000-0000-0000-000000000001') then
    raise exception 'FALHA PQ11: % ms=%', r, ms; end if;
  raise notice 'OK PQ11: 1000 selecionadas numa ÚNICA chamada → 997 nunca usadas excluídas e 3 mantidas (com revendedor) em % ms; o lote continua existindo (nada é apagado automaticamente)', ms;
end $$;
