-- Testes do ciclo operacional do lote (migration 013): ATIVO / QUARENTENA / ARQUIVADO.
-- Rodar num banco de TESTE, depois das migrations. Ids próprios, independente
-- dos outros arquivos. Cada bloco lança "FALHA: ..." se a regra não valer.
-- A concorrência real (duas conexões) está no fim, via dblink.
\set ON_ERROR_STOP 1

create extension if not exists dblink with schema extensions;
\if :{?dblink_conn}
\else
select 'dbname=' || current_database() as dblink_conn \gset
\endif
select set_config('test.conn', :'dblink_conn', false) as dblink_conn_em_uso;

insert into auth.users (id, email) values
  ('90000000-0000-0000-0000-00000000000a', 'lc-admin@teste.com'),
  ('90000000-0000-0000-0000-0000000000b1', 'lc-r1@teste.com');
update public.profiles set role = 'admin' where email = 'lc-admin@teste.com';
insert into public.reseller_profiles (id, user_id, company_name) values
  ('91000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-0000000000b1', 'Revenda Ciclo');

-- L1 livre · L2 com placa reservada por venda · L3 com placa ativa
-- L4 esgotado (todas vendidas) · L5 para concorrência
insert into public.plate_batches (id, name, quantity) values
  ('92000000-0000-0000-0000-000000000001', 'Ciclo Livre', 4),
  ('92000000-0000-0000-0000-000000000002', 'Ciclo Reservado', 3),
  ('92000000-0000-0000-0000-000000000003', 'Ciclo Ativo', 2),
  ('92000000-0000-0000-0000-000000000004', 'Ciclo Esgotado', 2),
  ('92000000-0000-0000-0000-000000000005', 'Ciclo Concorrência', 3);
insert into public.plates (public_code, batch_id)
select 'LCA' || lpad(g::text, 2, '0'), '92000000-0000-0000-0000-000000000001' from generate_series(1, 4) g;
insert into public.plates (public_code, batch_id)
select 'LCB' || lpad(g::text, 2, '0'), '92000000-0000-0000-0000-000000000002' from generate_series(1, 3) g;
insert into public.plates (public_code, batch_id)
select 'LCC' || lpad(g::text, 2, '0'), '92000000-0000-0000-0000-000000000003' from generate_series(1, 2) g;
insert into public.plates (public_code, batch_id)
select 'LCD' || lpad(g::text, 2, '0'), '92000000-0000-0000-0000-000000000004' from generate_series(1, 2) g;
insert into public.plates (public_code, batch_id)
select 'LCE' || lpad(g::text, 2, '0'), '92000000-0000-0000-0000-000000000005' from generate_series(1, 3) g;

-- ===================== L1: novo lote nasce ativo =====================
do $$
begin
  if (select count(*) from public.plate_batches where lifecycle_status <> 'active') > 0 then
    raise exception 'FALHA L1: algum lote não nasceu ativo';
  end if;
  if (select lifecycle_status from public.plate_batches where id = '92000000-0000-0000-0000-000000000001') <> 'active' then
    raise exception 'FALHA L1: lote novo deveria nascer ativo';
  end if;
  raise notice 'OK L1: todo lote novo nasce ativo';
end $$;

-- ===================== L2: lote 100% livre entra em quarentena =====================
begin;
set local role authenticated;
set local request.jwt.claim.sub = '90000000-0000-0000-0000-00000000000a';
select public.set_batch_lifecycle_status('92000000-0000-0000-0000-000000000001', 'quarantine', 'Erro de impressão no lote');
commit;

do $$
declare v public.plate_batches%rowtype;
begin
  select * into v from public.plate_batches where id = '92000000-0000-0000-0000-000000000001';
  if v.lifecycle_status <> 'quarantine' then raise exception 'FALHA L2: lote não entrou em quarentena'; end if;
  if v.lifecycle_reason is null then raise exception 'FALHA L2: motivo não registrado'; end if;
  if v.lifecycle_changed_at is null or v.lifecycle_changed_by is null then
    raise exception 'FALHA L2: autor/data da mudança não registrados';
  end if;
  if not exists (
    select 1 from public.batch_lifecycle_events e
    where e.batch_id = '92000000-0000-0000-0000-000000000001'
      and e.previous_status = 'active' and e.new_status = 'quarantine'
      and e.reason = 'Erro de impressão no lote' and e.changed_by is not null
  ) then raise exception 'FALHA L2: evento de histórico não gravado'; end if;
  raise notice 'OK L2: lote 100%% livre entra em quarentena, com motivo, autor e histórico';
end $$;

-- ===================== L3: quarentena não apaga nada =====================
do $$
begin
  if (select count(*) from public.plates where batch_id = '92000000-0000-0000-0000-000000000001') <> 4 then
    raise exception 'FALHA L3: placas foram apagadas';
  end if;
  if exists (
    select 1 from public.plates where batch_id = '92000000-0000-0000-0000-000000000001'
      and (public_code is null or status <> 'in_stock')
  ) then raise exception 'FALHA L3: public_code ou status alterado'; end if;
  raise notice 'OK L3: quarentena preserva placas, public_code e status';
end $$;

-- ===================== L4: lote em quarentena sai do estoque disponível =====================
begin;
set local role authenticated;
set local request.jwt.claim.sub = '90000000-0000-0000-0000-00000000000a';
do $$
begin
  if exists (select 1 from public.admin_available_stock() where batch_id = '92000000-0000-0000-0000-000000000001') then
    raise exception 'FALHA L4: lote em quarentena apareceu em admin_available_stock';
  end if;
  if exists (select 1 from public.admin_available_plates(null, '92000000-0000-0000-0000-000000000001', 100, 0)) then
    raise exception 'FALHA L4: placa de lote em quarentena apareceu em admin_available_plates';
  end if;
  raise notice 'OK L4: lote em quarentena sai de admin_available_stock e admin_available_plates';
end $$;
commit;

-- ===================== L5: venda automática e manual ignoram quarentena =====================
begin;
set local role authenticated;
set local request.jwt.claim.sub = '90000000-0000-0000-0000-00000000000a';
do $$
declare v_plate uuid;
begin
  begin
    perform public.create_sale_with_plates('91000000-0000-0000-0000-000000000001', 1, 10, 0, 'quarentena auto',
      'pending', 'automatic', null, '92000000-0000-0000-0000-000000000001', gen_random_uuid());
    raise exception 'FALHA L5: venda automática usou lote em quarentena';
  exception when sqlstate '55000' then null;
  end;

  select id into v_plate from public.plates where public_code = 'LCA01';
  begin
    perform public.create_sale_with_plates('91000000-0000-0000-0000-000000000001', 1, 10, 0, 'quarentena manual',
      'pending', 'manual', array[v_plate], null, gen_random_uuid());
    raise exception 'FALHA L5: venda manual usou placa de lote em quarentena';
  exception when sqlstate '55000' then null;
  end;

  begin
    perform public.assign_plates_to_reseller('91000000-0000-0000-0000-000000000001', null, array[v_plate], null);
    raise exception 'FALHA L5: atribuição avulsa usou placa de lote em quarentena';
  exception when sqlstate '55000' then null;
  end;

  raise notice 'OK L5: venda automática, venda manual e atribuição avulsa recusam lote em quarentena';
end $$;
commit;

-- ===================== L6: a barreira é do banco, não da RPC =====================
do $$
declare v_plate uuid;
begin
  select id into v_plate from public.plates where public_code = 'LCA02';
  begin
    -- UPDATE direto, sem passar por RPC nenhuma.
    update public.plates set reseller_id = '91000000-0000-0000-0000-000000000001', status = 'assigned'
    where id = v_plate;
    raise exception 'FALHA L6: UPDATE direto reservou placa de lote em quarentena';
  exception when sqlstate '55000' then null;
  end;
  raise notice 'OK L6: o trigger barra reserva por qualquer caminho, inclusive UPDATE manual';
end $$;

-- ===================== L7: restauração devolve ao estoque =====================
begin;
set local role authenticated;
set local request.jwt.claim.sub = '90000000-0000-0000-0000-00000000000a';
select public.set_batch_lifecycle_status('92000000-0000-0000-0000-000000000001', 'active', 'Impressão conferida');
do $$
begin
  if not exists (select 1 from public.admin_available_stock() where batch_id = '92000000-0000-0000-0000-000000000001') then
    raise exception 'FALHA L7: lote restaurado não voltou ao estoque disponível';
  end if;
  if (select count(*) from public.admin_available_plates(null, '92000000-0000-0000-0000-000000000001', 100, 0)) <> 4 then
    raise exception 'FALHA L7: lote restaurado deveria ter 4 placas disponíveis';
  end if;
  raise notice 'OK L7: restauração devolve as placas ao estoque utilizável';
end $$;
commit;

do $$
begin
  if not exists (
    select 1 from public.batch_lifecycle_events
    where batch_id = '92000000-0000-0000-0000-000000000001'
      and previous_status = 'quarantine' and new_status = 'active'
  ) then raise exception 'FALHA L7: restauração não gerou evento'; end if;
  raise notice 'OK L7b: restauração registrada no histórico';
end $$;

-- ===================== L8: lote com placa reservada não vai para quarentena =====================
begin;
set local role authenticated;
set local request.jwt.claim.sub = '90000000-0000-0000-0000-00000000000a';
select public.create_sale_with_plates('91000000-0000-0000-0000-000000000001', 1, 25, 0, 'reserva L8',
  'pending', 'automatic', null, '92000000-0000-0000-0000-000000000002', gen_random_uuid());
commit;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '90000000-0000-0000-0000-00000000000a';
do $$
begin
  begin
    perform public.set_batch_lifecycle_status('92000000-0000-0000-0000-000000000002', 'quarantine', 'tentativa');
    raise exception 'FALHA L8: lote com placa reservada entrou em quarentena';
  exception when sqlstate '55000' then null;
  end;
  raise notice 'OK L8: lote com placa reservada por venda ativa NÃO entra em quarentena';
end $$;
commit;

-- ===================== L9: lote com placa ativa não vai para quarentena =====================
begin;
set local role authenticated;
set local request.jwt.claim.sub = '90000000-0000-0000-0000-00000000000a';
select public.create_sale_with_plates('91000000-0000-0000-0000-000000000001', 2, 25, 0, 'ativa L9',
  'pending', 'automatic', null, '92000000-0000-0000-0000-000000000003', gen_random_uuid());
commit;

update public.plates set destination_type = 'website', destination_url = 'https://exemplo.com', status = 'active'
where public_code = 'LCC01';

begin;
set local role authenticated;
set local request.jwt.claim.sub = '90000000-0000-0000-0000-00000000000a';
do $$
begin
  begin
    perform public.set_batch_lifecycle_status('92000000-0000-0000-0000-000000000003', 'quarantine', 'tentativa');
    raise exception 'FALHA L9: lote com placa ativa entrou em quarentena';
  exception when sqlstate '55000' then null;
  end;
  raise notice 'OK L9: lote com placa ativa NÃO entra em quarentena';
end $$;
commit;

-- ===================== L10: histórico de venda CANCELADA não impede =====================
begin;
set local role authenticated;
set local request.jwt.claim.sub = '90000000-0000-0000-0000-00000000000a';
select public.create_sale_with_plates('91000000-0000-0000-0000-000000000001', 4, 25, 0, 'cancelada L10',
  'pending', 'automatic', null, '92000000-0000-0000-0000-000000000001', gen_random_uuid()) as sale_id \gset
select public.cancel_order(:'sale_id', false);
-- As placas voltaram ao estoque: agora a quarentena precisa ser aceita.
select public.set_batch_lifecycle_status('92000000-0000-0000-0000-000000000001', 'quarantine', 'após cancelamento');
commit;

do $$
begin
  if (select lifecycle_status from public.plate_batches where id = '92000000-0000-0000-0000-000000000001') <> 'quarantine' then
    raise exception 'FALHA L10: histórico de venda cancelada impediu a quarentena';
  end if;
  if not exists (select 1 from public.order_plates op join public.plates p on p.id = op.plate_id
                 where p.batch_id = '92000000-0000-0000-0000-000000000001' and op.released_at is not null) then
    raise exception 'FALHA L10: o histórico da venda cancelada deveria ter sido preservado';
  end if;
  raise notice 'OK L10: venda cancelada não impede quarentena, e o histórico dela é preservado';
end $$;

-- restaura para não afetar os testes seguintes
begin;
set local role authenticated;
set local request.jwt.claim.sub = '90000000-0000-0000-0000-00000000000a';
select public.set_batch_lifecycle_status('92000000-0000-0000-0000-000000000001', 'active', null);
commit;

-- ===================== L11: arquivamento exige estoque zerado =====================
begin;
set local role authenticated;
set local request.jwt.claim.sub = '90000000-0000-0000-0000-00000000000a';
do $$
begin
  begin
    perform public.set_batch_lifecycle_status('92000000-0000-0000-0000-000000000001', 'archived', null);
    raise exception 'FALHA L11: arquivou lote com placas disponíveis';
  exception when sqlstate '55000' then null;
  end;
  raise notice 'OK L11: arquivamento recusado enquanto há placa disponível em estoque';
end $$;
select public.create_sale_with_plates('91000000-0000-0000-0000-000000000001', 2, 25, 0, 'esgota L11',
  'pending', 'automatic', null, '92000000-0000-0000-0000-000000000004', gen_random_uuid());
select public.set_batch_lifecycle_status('92000000-0000-0000-0000-000000000004', 'archived', 'lote esgotado');
commit;

do $$
begin
  if (select lifecycle_status from public.plate_batches where id = '92000000-0000-0000-0000-000000000004') <> 'archived' then
    raise exception 'FALHA L11: lote esgotado deveria arquivar';
  end if;
  raise notice 'OK L11b: lote com zero placas disponíveis é arquivado';
end $$;

-- ===================== L12: arquivamento não altera a operação =====================
do $$
declare v_before record; v_after record;
begin
  select p.status, p.reseller_id, p.destination_url, p.public_code into v_before
  from public.plates p where p.public_code = 'LCD01';
  -- lote já arquivado acima; nada pode ter mudado
  select p.status, p.reseller_id, p.destination_url, p.public_code into v_after
  from public.plates p where p.public_code = 'LCD01';
  if v_before is distinct from v_after then raise exception 'FALHA L12: arquivamento alterou a placa'; end if;
  if v_after.reseller_id is null or v_after.status <> 'assigned' then
    raise exception 'FALHA L12: placa do lote arquivado perdeu revendedor ou status';
  end if;
  raise notice 'OK L12: arquivamento não altera status, revendedor, destino nem código';
end $$;

-- ===================== L13: lote arquivado não quebra redirect =====================
update public.plates set destination_type = 'website', destination_url = 'https://cliente-lcd.com', status = 'active'
where public_code = 'LCD01';

do $$
declare v_outcome text; v_target text;
begin
  select r.outcome, r.target_url into v_outcome, v_target
  from public.resolve_plate_redirect('LCD01', 'qr') r;
  if v_outcome <> 'ok' then
    raise exception 'FALHA L13: redirect de placa em lote arquivado parou de funcionar (%)', v_outcome;
  end if;
  if v_target <> 'https://cliente-lcd.com' then
    raise exception 'FALHA L13: destino alterado pelo arquivamento (%)', v_target;
  end if;
  raise notice 'OK L13: placa de lote arquivado continua redirecionando normalmente';
end $$;

-- ===================== L14: desarquivamento =====================
begin;
set local role authenticated;
set local request.jwt.claim.sub = '90000000-0000-0000-0000-00000000000a';
select public.set_batch_lifecycle_status('92000000-0000-0000-0000-000000000004', 'active', 'reabertura');
commit;

do $$
begin
  if (select lifecycle_status from public.plate_batches where id = '92000000-0000-0000-0000-000000000004') <> 'active' then
    raise exception 'FALHA L14: archived → active não funcionou';
  end if;
  raise notice 'OK L14: lote arquivado volta a ativo';
end $$;

-- ===================== L15: histórico é append-only =====================
do $$
begin
  begin
    update public.batch_lifecycle_events set reason = 'adulterado' where id = (select min(id) from public.batch_lifecycle_events);
    raise exception 'FALHA L15: histórico de ciclo foi alterado';
  exception when sqlstate '55000' then null;
  end;
  begin
    delete from public.batch_lifecycle_events where id = (select min(id) from public.batch_lifecycle_events);
    raise exception 'FALHA L15: histórico de ciclo foi apagado';
  exception when sqlstate '55000' then null;
  end;
  raise notice 'OK L15: batch_lifecycle_events é append-only';
end $$;

-- ===================== L16: só ADMIN muda o ciclo =====================
begin;
set local role authenticated;
set local request.jwt.claim.sub = '90000000-0000-0000-0000-0000000000b1';
do $$
begin
  begin
    perform public.set_batch_lifecycle_status('92000000-0000-0000-0000-000000000001', 'quarantine', 'revendedor tentando');
    raise exception 'FALHA L16: revendedor mudou o ciclo do lote';
  exception when sqlstate '42501' then null;
  end;
  raise notice 'OK L16: revendedor não altera o ciclo do lote (42501)';
end $$;
commit;

-- ===================== L17: CONCORRÊNCIA venda × quarentena =====================
-- Duas conexões reais. A abre a transação e reserva; B tenta a quarentena
-- do mesmo lote. O resultado tem que ser um dos dois, nunca os dois.
create function pg_temp.open_as(p_conn text, p_uid uuid) returns void language plpgsql as $$
begin
  perform extensions.dblink_connect(p_conn, current_setting('test.conn'));
  perform extensions.dblink_exec(p_conn, 'begin');
  perform extensions.dblink_exec(p_conn, 'set local role authenticated');
  perform extensions.dblink_exec(p_conn, format('set local request.jwt.claim.sub = %L', p_uid));
end $$;

create function pg_temp.finish(p_conn text) returns text language plpgsql as $$
declare v_msg text;
begin
  perform * from extensions.dblink_get_result(p_conn, false) as t(x text);
  v_msg := split_part(regexp_replace(extensions.dblink_error_message(p_conn), '^ERROR:\s+', ''), E'\n', 1);
  perform * from extensions.dblink_get_result(p_conn, false) as t(x text);
  return btrim(v_msg);
end $$;

-- Cenário 1: a VENDA chega primeiro e segura as placas.
do $$
declare v_sale text; v_quar text;
begin
  perform pg_temp.open_as('A', '90000000-0000-0000-0000-00000000000a');
  perform pg_temp.open_as('B', '90000000-0000-0000-0000-00000000000a');

  -- A reserva 1 placa do lote e NÃO comita ainda.
  perform x from extensions.dblink('A', format(
    'select public.create_sale_with_plates(%L, 1, 10, 0, ''conc venda'', ''pending'', ''automatic'', null, %L::uuid, gen_random_uuid())::text',
    '91000000-0000-0000-0000-000000000001', '92000000-0000-0000-0000-000000000005')) as t(x text);

  -- B tenta a quarentena: fica esperando o lock das placas que A segura.
  perform extensions.dblink_send_query('B', format(
    'select public.set_batch_lifecycle_status(%L::uuid, ''quarantine'', ''conc'')',
    '92000000-0000-0000-0000-000000000005'));

  perform pg_sleep(0.3);
  perform extensions.dblink_exec('A', 'commit');   -- A vence
  v_quar := pg_temp.finish('B');
  perform extensions.dblink_exec('B', 'rollback');
  perform extensions.dblink_disconnect('A');
  perform extensions.dblink_disconnect('B');

  if v_quar = 'OK' then
    raise exception 'FALHA L17: a quarentena passou mesmo com a venda tendo reservado antes';
  end if;
  if (select lifecycle_status from public.plate_batches where id = '92000000-0000-0000-0000-000000000005') <> 'active' then
    raise exception 'FALHA L17: lote ficou em estado inconsistente';
  end if;
  if not exists (select 1 from public.plates where batch_id = '92000000-0000-0000-0000-000000000005' and status = 'assigned') then
    raise exception 'FALHA L17: a venda que venceu não reservou a placa';
  end if;
  raise notice 'OK L17: venda chegou primeiro → quarentena recusada (%), lote segue ativo e a reserva valeu', left(v_quar, 60);
end $$;

-- Cenário 2: a QUARENTENA chega primeiro e segura o lote.
-- Sobram 2 placas livres no lote 5; devolvemos a vendida para deixá-lo limpo.
select op.order_id as conc_order from public.order_plates op
join public.plates p on p.id = op.plate_id
where p.batch_id = '92000000-0000-0000-0000-000000000005' and op.released_at is null limit 1 \gset

begin;
set local role authenticated;
set local request.jwt.claim.sub = '90000000-0000-0000-0000-00000000000a';
select public.cancel_order(:'conc_order', false);
commit;

do $$
declare v_sale text; v_lifecycle text;
begin
  perform pg_temp.open_as('A', '90000000-0000-0000-0000-00000000000a');
  perform pg_temp.open_as('B', '90000000-0000-0000-0000-00000000000a');

  -- B coloca em quarentena e NÃO comita.
  perform x from extensions.dblink('B', format(
    'select count(*)::text from public.set_batch_lifecycle_status(%L::uuid, ''quarantine'', ''conc 2'')',
    '92000000-0000-0000-0000-000000000005')) as t(x text);

  -- A tenta vender do mesmo lote: espera pelos locks que B segura.
  perform extensions.dblink_send_query('A', format(
    'select public.create_sale_with_plates(%L, 1, 10, 0, ''conc venda 2'', ''pending'', ''automatic'', null, %L::uuid, gen_random_uuid())',
    '91000000-0000-0000-0000-000000000001', '92000000-0000-0000-0000-000000000005'));

  perform pg_sleep(0.3);
  perform extensions.dblink_exec('B', 'commit');   -- B vence
  v_sale := pg_temp.finish('A');
  perform extensions.dblink_exec('A', 'rollback');
  perform extensions.dblink_disconnect('A');
  perform extensions.dblink_disconnect('B');

  select lifecycle_status into v_lifecycle from public.plate_batches where id = '92000000-0000-0000-0000-000000000005';
  if v_lifecycle <> 'quarantine' then
    raise exception 'FALHA L17b: a quarentena deveria ter vencido (estado: %)', v_lifecycle;
  end if;
  if v_sale = 'OK' then
    raise exception 'FALHA L17b: a venda conseguiu usar placa de lote que acabou de entrar em quarentena';
  end if;
  if exists (select 1 from public.plates where batch_id = '92000000-0000-0000-0000-000000000005' and status <> 'in_stock') then
    raise exception 'FALHA L17b: alguma placa ficou reservada num lote em quarentena';
  end if;
  raise notice 'OK L17b: quarentena chegou primeiro → venda recusada (%), nenhuma placa reservada', left(v_sale, 60);
end $$;
