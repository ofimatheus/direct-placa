-- Testes da venda B2C com vínculo automático placa ↔ cliente (migration 017).
-- Rodar num banco de TESTE, depois das migrations. Independente dos outros
-- arquivos (ids e lotes próprios). O último bloco (B17) usa dblink para
-- concorrência real:
--   psql -d placas_test -v dblink_conn='dbname=placas_test' -f supabase/tests/reseller_sale_customer_link.sql
\set ON_ERROR_STOP 1

create extension if not exists dblink with schema extensions;
\if :{?dblink_conn}
\else
select 'dbname=' || current_database() as dblink_conn \gset
\endif
select set_config('test.conn', :'dblink_conn', false) is not null as conexao_configurada;

insert into auth.users (id, email) values
  ('d7000000-0000-0000-0000-00000000000a', 'bcl-admin@teste.com'),
  ('d7000000-0000-0000-0000-0000000000b1', 'bcl-r1@teste.com'),
  ('d7000000-0000-0000-0000-0000000000b2', 'bcl-r2@teste.com');
update public.profiles set role = 'admin' where email = 'bcl-admin@teste.com';
insert into public.reseller_profiles (id, user_id, company_name) values
  ('d7100000-0000-0000-0000-000000000001', 'd7000000-0000-0000-0000-0000000000b1', 'Jorge LTDA'),
  ('d7100000-0000-0000-0000-000000000002', 'd7000000-0000-0000-0000-0000000000b2', 'Outra Revenda');
insert into public.customers (id, reseller_id, name) values
  ('d7200000-0000-0000-0000-000000000001', 'd7100000-0000-0000-0000-000000000001', 'João'),
  ('d7200000-0000-0000-0000-000000000002', 'd7100000-0000-0000-0000-000000000001', 'Ana Beatriz'),
  ('d7200000-0000-0000-0000-000000000003', 'd7100000-0000-0000-0000-000000000002', 'Cliente da outra revenda');
insert into public.plate_batches (id, name, quantity) values ('d7300000-0000-0000-0000-000000000001', 'Lote B2C', 20);
-- Placas já RESERVADAS para cada revendedor (como depois de uma venda do ADMIN).
insert into public.plates (public_code, batch_id, reseller_id, status)
select 'BCL' || lpad(g::text, 3, '0'), 'd7300000-0000-0000-0000-000000000001', 'd7100000-0000-0000-0000-000000000001', 'assigned'
from generate_series(1, 14) g;
insert into public.plates (public_code, batch_id, reseller_id, status)
select 'BCM' || lpad(g::text, 3, '0'), 'd7300000-0000-0000-0000-000000000001', 'd7100000-0000-0000-0000-000000000002', 'assigned'
from generate_series(1, 3) g;

create table public.bcl_ids (name text primary key, id uuid not null);
grant select, insert on public.bcl_ids to authenticated;

create function pg_temp.plate(p_code text) returns uuid language sql as $$ select id from public.plates where public_code = p_code $$;

-- ===================== B1–B2: venda com e sem cliente =====================
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'd7000000-0000-0000-0000-0000000000b1';
do $$
declare v_sale uuid; p public.plates%rowtype; i public.reseller_sale_items%rowtype;
begin
  v_sale := public.create_reseller_sale(array[(select id from public.plates where public_code = 'BCL001')], 120.00,
    'd7200000-0000-0000-0000-000000000001', 'pending', current_date, null, 'd7400000-0000-0000-0000-000000000001');
  insert into public.bcl_ids values ('uma', v_sale);
  select * into p from public.plates where public_code = 'BCL001';
  select * into i from public.reseller_sale_items where sale_id = v_sale;
  if p.customer_id is distinct from 'd7200000-0000-0000-0000-000000000001' then raise exception 'FALHA B1: a venda não vinculou a placa ao cliente'; end if;
  if p.reseller_id <> 'd7100000-0000-0000-0000-000000000001' then raise exception 'FALHA B1: mudou o revendedor'; end if;
  if p.status <> 'assigned' or p.destination_url is not null or p.destination_type is not null
    then raise exception 'FALHA B1: a venda ativou ou configurou a placa (%)', p.status; end if;
  if not i.customer_linked or i.previous_customer_id is not null then raise exception 'FALHA B1: item não registrou a origem do vínculo'; end if;
  raise notice 'OK B1: venda com cliente vincula a placa ao cliente, mantém o revendedor e deixa a placa RESERVADA (sem destino, sem ativar)';

  v_sale := public.create_reseller_sale(array[(select id from public.plates where public_code = 'BCL002')], 50.00,
    null, 'paid', current_date, null, gen_random_uuid());
  if (select customer_id from public.plates where public_code = 'BCL002') is not null then raise exception 'FALHA B2: venda sem cliente preencheu customer_id'; end if;
  if (select customer_linked from public.reseller_sale_items where sale_id = v_sale) then raise exception 'FALHA B2: item marcado como vinculado'; end if;
  raise notice 'OK B2: venda "Sem cliente" é permitida e mantém customer_id nulo';
end $$;
commit;

-- ===================== B3–B5: recusas, sem nenhuma alteração parcial =====================
select set_config('test.plate_of_r2', (select id::text from public.plates where public_code = 'BCM001'), false) is not null as ok;
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'd7000000-0000-0000-0000-0000000000b1';
do $$
declare v_sales int := (select count(*) from public.reseller_sales);
begin
  begin
    perform public.create_reseller_sale(array[(select id from public.plates where public_code = 'BCL003')], 10,
      'd7200000-0000-0000-0000-000000000003', 'pending', null, null, gen_random_uuid());
    raise exception 'FALHA B3: aceitou cliente de outro revendedor';
  exception when sqlstate '42501' then null; end;
  if (select customer_id from public.plates where public_code = 'BCL003') is not null then raise exception 'FALHA B3: vinculou cliente mesmo recusando'; end if;
  raise notice 'OK B3: cliente de outro revendedor é recusado e a placa não recebe cliente';

  begin
    perform public.create_reseller_sale(array[current_setting('test.plate_of_r2')::uuid], 10,
      'd7200000-0000-0000-0000-000000000001', 'pending', null, null, gen_random_uuid());
    raise exception 'FALHA B4: vendeu placa de outro revendedor';
  exception when sqlstate '55000' then null; end;
  raise notice 'OK B4: placa de outro revendedor é recusada';

  begin
    perform public.create_reseller_sale(array[(select id from public.plates where public_code = 'BCL001')], 10,
      'd7200000-0000-0000-0000-000000000002', 'pending', null, null, gen_random_uuid());
    raise exception 'FALHA B5: a mesma placa entrou em duas vendas';
  exception when sqlstate '55000' then null; end;
  if (select customer_id from public.plates where public_code = 'BCL001') <> 'd7200000-0000-0000-0000-000000000001'
    then raise exception 'FALHA B5: a venda recusada trocou o cliente da placa'; end if;
  if (select count(*) from public.reseller_sales) <> v_sales then raise exception 'FALHA B3-B5: venda recusada ficou gravada'; end if;
  raise notice 'OK B5: venda duplicada da mesma placa continua impedida, sem trocar o cliente já vinculado';
end $$;
commit;

-- Placa de outro revendedor não foi tocada
do $$ begin
  if (select customer_id from public.plates where public_code = 'BCM001') is not null then raise exception 'FALHA B4: placa do R2 recebeu cliente'; end if;
end $$;

-- ===================== B6–B7: não ativa; configuração posterior =====================
do $$
declare r record;
begin
  set local role anon;
  select * into r from public.resolve_plate_redirect('BCL001', 'qr');
  reset role;
  if r.outcome <> 'unconfigured' then raise exception 'FALHA B6: placa vendida redirecionou antes de configurar (%)', r.outcome; end if;
  raise notice 'OK B6: criar a venda não ativa a placa (o QR ainda não redireciona)';
end $$;

begin;
set local role authenticated;
set local request.jwt.claim.sub = 'd7000000-0000-0000-0000-0000000000b1';
do $$
declare v_sale uuid := (select id from public.bcl_ids where name = 'uma'); r record; p record;
begin
  select * into r from public.reseller_sale_plate_setup(v_sale);
  if r.public_code <> 'BCL001' or r.configured or r.customer_name <> 'João' or r.status <> 'assigned'
    then raise exception 'FALHA B7: estado para configuração %', r; end if;
  -- O formulário da placa já vem com o cliente da venda: o revendedor só informa o destino.
  select * into p from public.configure_reseller_plate(pg_temp.plate('BCL001'),
    (select customer_id from public.plates where public_code = 'BCL001'), 'google_review', 'https://g.page/r/joao', null);
  if p.status <> 'active' or p.customer_id <> 'd7200000-0000-0000-0000-000000000001' then raise exception 'FALHA B7: configuração posterior'; end if;
  select * into r from public.reseller_sale_plate_setup(v_sale);
  if not r.configured then raise exception 'FALHA B7: placa configurada não aparece como configurada'; end if;
  raise notice 'OK B7: depois da venda a placa segue para configuração com o cliente já vinculado; salvar o destino ativa';
end $$;
commit;

-- ===================== B8: cancelamento ANTES da configuração =====================
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'd7000000-0000-0000-0000-0000000000b1';
do $$
declare v_sale uuid; v_sale2 uuid; p public.plates%rowtype;
begin
  v_sale := public.create_reseller_sale(array[pg_temp.plate('BCL004')], 80, 'd7200000-0000-0000-0000-000000000001', 'paid', null, null, gen_random_uuid());
  perform public.set_reseller_sale_status(v_sale, 'cancelled');
  select * into p from public.plates where public_code = 'BCL004';
  if p.customer_id is not null then raise exception 'FALHA B8: cancelamento não desfez o vínculo com o cliente'; end if;
  if p.reseller_id <> 'd7100000-0000-0000-0000-000000000001' or p.status <> 'assigned'
    then raise exception 'FALHA B8: cancelamento devolveu a placa ao ADMIN ou mudou o status'; end if;
  if (select customer_unlinked_at from public.reseller_sale_items where sale_id = v_sale) is null
    then raise exception 'FALHA B8: desfazimento não registrado no item'; end if;
  if not exists (select 1 from public.reseller_sellable_plates(null, 500) where plate_id = p.id)
    then raise exception 'FALHA B8: placa não voltou a ser elegível para o revendedor'; end if;
  raise notice 'OK B8: cancelar antes da configuração remove o cliente vinculado pela venda e devolve a placa à elegibilidade do próprio revendedor';

  -- O revendedor já tinha deixado Ana na placa (sem destino); a venda foi para João.
  perform public.configure_reseller_plate(pg_temp.plate('BCL005'), 'd7200000-0000-0000-0000-000000000002', null, null, null);
  v_sale2 := public.create_reseller_sale(array[pg_temp.plate('BCL005')], 80, 'd7200000-0000-0000-0000-000000000001', 'pending', null, null, gen_random_uuid());
  if (select customer_id from public.plates where public_code = 'BCL005') <> 'd7200000-0000-0000-0000-000000000001'
    then raise exception 'FALHA B8b: venda não vinculou João'; end if;
  perform public.set_reseller_sale_status(v_sale2, 'cancelled');
  if (select customer_id from public.plates where public_code = 'BCL005') <> 'd7200000-0000-0000-0000-000000000002'
    then raise exception 'FALHA B8b: cancelamento não restaurou o cliente anterior'; end if;
  raise notice 'OK B8b: se a placa já tinha outro cliente antes da venda, o cancelamento restaura esse cliente (não apaga)';
end $$;
commit;

-- ===================== B9: cancelamento DEPOIS da ativação / em uso =====================
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'd7000000-0000-0000-0000-0000000000b1';
do $$
declare v_sale uuid := (select id from public.bcl_ids where name = 'uma'); p public.plates%rowtype; m jsonb;
begin
  perform public.set_reseller_sale_status(v_sale, 'paid');
  perform public.set_reseller_sale_status(v_sale, 'cancelled');
  select * into p from public.plates where public_code = 'BCL001';
  if p.status <> 'active' or p.destination_url <> 'https://g.page/r/joao'
     or p.customer_id <> 'd7200000-0000-0000-0000-000000000001' or p.reseller_id <> 'd7100000-0000-0000-0000-000000000001'
    then raise exception 'FALHA B9: cancelar desfez a operação da placa ativa'; end if;
  if (select customer_unlinked_at from public.reseller_sale_items where sale_id = v_sale) is not null
    then raise exception 'FALHA B9: registrou desfazimento que não aconteceu'; end if;
  select public.reseller_sales_metrics(null) into m;
  if (m->>'revenue')::numeric <> 50 then raise exception 'FALHA B9: venda cancelada continuou nos indicadores (%)', m; end if;
  raise notice 'OK B9: cancelar depois da ativação cancela só o financeiro: cliente, destino, status e revendedor ficam intactos';
end $$;
commit;

-- Placa BLOQUEADA (sem destino) e placa cujo cliente foi trocado depois da venda: também intactas.
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'd7000000-0000-0000-0000-0000000000b1';
insert into public.bcl_ids
select 'bloqueada', public.create_reseller_sale(array[pg_temp.plate('BCL006')], 10, 'd7200000-0000-0000-0000-000000000001', 'pending', null, null, gen_random_uuid());
insert into public.bcl_ids
select 'trocado', public.create_reseller_sale(array[pg_temp.plate('BCL007')], 10, 'd7200000-0000-0000-0000-000000000001', 'pending', null, null, gen_random_uuid());
-- Depois da venda o revendedor muda o cliente da placa para Ana (sem destino).
select status from public.configure_reseller_plate(pg_temp.plate('BCL007'), 'd7200000-0000-0000-0000-000000000002', null, null, null);
commit;
update public.plates set status = 'blocked' where public_code = 'BCL006';
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'd7000000-0000-0000-0000-0000000000b1';
select id from public.set_reseller_sale_status((select id from public.bcl_ids where name = 'bloqueada'), 'cancelled');
select id from public.set_reseller_sale_status((select id from public.bcl_ids where name = 'trocado'), 'cancelled');
commit;
do $$ begin
  if (select customer_id from public.plates where public_code = 'BCL006') is distinct from 'd7200000-0000-0000-0000-000000000001'
     or (select status from public.plates where public_code = 'BCL006') <> 'blocked'
    then raise exception 'FALHA B9b: cancelamento mexeu na placa bloqueada'; end if;
  if (select customer_id from public.plates where public_code = 'BCL007') is distinct from 'd7200000-0000-0000-0000-000000000002'
    then raise exception 'FALHA B9c: cancelamento apagou um cliente que não foi a venda que vinculou'; end if;
  raise notice 'OK B9b: placa bloqueada mantém cliente e status; o cancelamento só desfaz o vínculo que a própria venda criou';
end $$;

-- ===================== B10: várias placas, mesmo cliente =====================
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'd7000000-0000-0000-0000-0000000000b1';
do $$
declare v_sale uuid; v_cfg int;
begin
  v_sale := public.create_reseller_sale(array[pg_temp.plate('BCL008'), pg_temp.plate('BCL009'), pg_temp.plate('BCL010')],
    300, 'd7200000-0000-0000-0000-000000000002', 'paid', null, null, gen_random_uuid());
  insert into public.bcl_ids values ('varias', v_sale);
  if (select count(*) from public.plates where public_code in ('BCL008', 'BCL009', 'BCL010')
      and customer_id = 'd7200000-0000-0000-0000-000000000002' and status = 'assigned') <> 3
    then raise exception 'FALHA B10: nem todas as placas foram vinculadas ao cliente'; end if;
  perform public.configure_reseller_plate(pg_temp.plate('BCL009'), 'd7200000-0000-0000-0000-000000000002', 'website', 'https://ana.com.br', null);
  select count(*) filter (where configured) into v_cfg from public.reseller_sale_plate_setup(v_sale);
  if v_cfg <> 1 or (select count(*) from public.reseller_sale_plate_setup(v_sale)) <> 3
    then raise exception 'FALHA B10: sequência de configuração (% de 3)', v_cfg; end if;
  raise notice 'OK B10: venda com várias placas vincula todas ao mesmo cliente; a venda mostra 1 de 3 configuradas';
end $$;
commit;

-- ===================== B11: falha no meio → rollback completo =====================
-- Uma falha injetada no passo de vínculo (depois de a venda e os itens terem
-- sido inseridos na mesma transação) precisa desfazer TUDO.
create function public.bcl_fail_on_link() returns trigger language plpgsql as $$
begin
  if new.public_code = 'BCL012' and new.customer_id is not null then
    raise exception 'falha simulada no vínculo' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger trg_bcl_fail_on_link before update of customer_id on public.plates
  for each row execute function public.bcl_fail_on_link();

begin;
set local role authenticated;
set local request.jwt.claim.sub = 'd7000000-0000-0000-0000-0000000000b1';
do $$
declare v_sales int := (select count(*) from public.reseller_sales);
begin
  begin
    perform public.create_reseller_sale(array[pg_temp.plate('BCL011'), pg_temp.plate('BCL012')], 90,
      'd7200000-0000-0000-0000-000000000001', 'paid', null, null, 'd7400000-0000-0000-0000-000000000099');
    raise exception 'FALHA B11: a falha simulada não interrompeu a venda';
  exception when sqlstate 'P0001' then
    if sqlerrm like 'FALHA%' then raise; end if;
  end;
  if (select count(*) from public.reseller_sales) <> v_sales
     or exists (select 1 from public.reseller_sales where idempotency_key = 'd7400000-0000-0000-0000-000000000099')
    then raise exception 'FALHA B11: venda ficou gravada após a falha'; end if;
  if exists (select 1 from public.reseller_sale_items i where i.plate_id in (pg_temp.plate('BCL011'), pg_temp.plate('BCL012')))
    then raise exception 'FALHA B11: item ficou gravado após a falha'; end if;
  if (select customer_id from public.plates where public_code = 'BCL011') is not null
    then raise exception 'FALHA B11: cliente ficou vinculado sem venda'; end if;
  raise notice 'OK B11: falha no meio da operação desfaz tudo (sem venda, sem item, sem cliente vinculado)';
end $$;
commit;
drop trigger trg_bcl_fail_on_link on public.plates;
drop function public.bcl_fail_on_link();

-- ===================== B12–B15: idempotência, ADMIN, histórico, vendas antigas =====================
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'd7000000-0000-0000-0000-0000000000b1';
do $$
declare v_again uuid;
begin
  v_again := public.create_reseller_sale(array[pg_temp.plate('BCL001')], 120.00, 'd7200000-0000-0000-0000-000000000002',
    'pending', null, null, 'd7400000-0000-0000-0000-000000000001');
  if v_again <> (select id from public.bcl_ids where name = 'uma') then raise exception 'FALHA B12: retry criou outra venda'; end if;
  if (select customer_id from public.plates where public_code = 'BCL001') <> 'd7200000-0000-0000-0000-000000000001'
    then raise exception 'FALHA B12: retry revinculou a placa a outro cliente'; end if;
  raise notice 'OK B12: request repetida devolve a mesma venda e não revincula a placa';
end $$;
commit;

begin;
set local role authenticated;
set local request.jwt.claim.sub = 'd7000000-0000-0000-0000-00000000000a';
do $$
declare v_customer uuid; v_rows int;
begin
  select customer_id into v_customer from public.plates where public_code = 'BCL009';
  if v_customer is distinct from 'd7200000-0000-0000-0000-000000000002' then raise exception 'FALHA B13: ADMIN não vê placa → cliente'; end if;
  begin
    select count(*) into v_rows from public.reseller_sales;
    if v_rows > 0 then raise exception 'FALHA B13: ADMIN leu vendas privadas do revendedor'; end if;
  exception when insufficient_privilege then null; end;
  if (select count(*) from public.reseller_sale_plate_setup((select id from public.bcl_ids where name = 'varias'))) <> 0
    then raise exception 'FALHA B13: ADMIN leu a venda privada pela RPC'; end if;
  raise notice 'OK B13: ADMIN vê a relação operacional placa → revendedor → cliente, mas não as vendas nem valores do revendedor';
end $$;
commit;

do $$ begin
  begin
    update public.reseller_sale_items set customer_linked = false where sale_id = (select id from public.bcl_ids where name = 'varias');
    raise exception 'FALHA B14: origem do vínculo foi alterada';
  exception when sqlstate '55000' then null; end;
  raise notice 'OK B14: a origem do vínculo com o cliente no item da venda é imutável';
end $$;

-- Venda registrada ANTES desta versão: item sem customer_linked, cliente
-- colocado na placa à mão depois. Cancelar continua sem tocar no cliente.
do $$
declare v_sale uuid;
begin
  insert into public.reseller_sales (reseller_id, customer_id, status, total)
  values ('d7100000-0000-0000-0000-000000000001', 'd7200000-0000-0000-0000-000000000001', 'pending', 40)
  returning id into v_sale;
  insert into public.reseller_sale_items (sale_id, plate_id) values (v_sale, pg_temp.plate('BCL013'));
  update public.plates set customer_id = 'd7200000-0000-0000-0000-000000000001' where public_code = 'BCL013';
  insert into public.bcl_ids values ('antiga', v_sale);
end $$;
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'd7000000-0000-0000-0000-0000000000b1';
select id from public.set_reseller_sale_status((select id from public.bcl_ids where name = 'antiga'), 'cancelled');
commit;
do $$ begin
  if (select customer_id from public.plates where public_code = 'BCL013') is distinct from 'd7200000-0000-0000-0000-000000000001'
    then raise exception 'FALHA B15: cancelar venda antiga removeu cliente atribuído manualmente'; end if;
  raise notice 'OK B15: vendas anteriores a esta versão cancelam como antes, sem mexer no cliente da placa';
end $$;

-- ===================== B16: revendedor não enxerga a sequência de outro =====================
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'd7000000-0000-0000-0000-0000000000b2';
do $$ begin
  if (select count(*) from public.reseller_sale_plate_setup((select id from public.bcl_ids where name = 'varias'))) <> 0
    then raise exception 'FALHA B16: revendedor leu placas da venda de outro'; end if;
  if exists (select 1 from public.plates where public_code like 'BCL%') then raise exception 'FALHA B16: vê placas de outro revendedor'; end if;
  raise notice 'OK B16: outro revendedor não vê as placas nem a sequência de configuração da venda';
end $$;
commit;

-- ===================== B17: ativação × cancelamento simultâneos (dblink) =====================
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'd7000000-0000-0000-0000-0000000000b1';
insert into public.bcl_ids
select 'corrida', public.create_reseller_sale(array[pg_temp.plate('BCL014')], 70, 'd7200000-0000-0000-0000-000000000001', 'pending', null, null, gen_random_uuid());
commit;

do $$
declare v_msg text; v_plate uuid := pg_temp.plate('BCL014'); v_sale uuid := (select id from public.bcl_ids where name = 'corrida');
begin
  perform extensions.dblink_connect('ativa', current_setting('test.conn'));
  perform extensions.dblink_connect('cancela', current_setting('test.conn'));
  foreach v_msg in array array['ativa', 'cancela'] loop
    perform extensions.dblink_exec(v_msg, 'begin');
    perform extensions.dblink_exec(v_msg, 'set local role authenticated');
    perform extensions.dblink_exec(v_msg, 'set local request.jwt.claim.sub = ''d7000000-0000-0000-0000-0000000000b1''');
  end loop;

  -- A ativação começa primeiro e segura a placa.
  perform * from extensions.dblink('ativa', format(
    'select status from public.configure_reseller_plate(%L, %L, ''website'', ''https://joao.com.br'', null)',
    v_plate, 'd7200000-0000-0000-0000-000000000001')) as t(x text);
  -- O cancelamento chega em seguida e precisa esperar a placa.
  perform extensions.dblink_send_query('cancela', format('select id::text from public.set_reseller_sale_status(%L, ''cancelled'')', v_sale));
  perform pg_sleep(0.5);
  if extensions.dblink_is_busy('cancela') <> 1 then raise exception 'FALHA B17: o cancelamento não esperou a ativação'; end if;
  perform extensions.dblink_exec('ativa', 'commit');
  perform * from extensions.dblink_get_result('cancela', false) as t(x text);
  v_msg := extensions.dblink_error_message('cancela');
  perform * from extensions.dblink_get_result('cancela', false) as t(x text);
  perform extensions.dblink_exec('cancela', 'commit');
  perform extensions.dblink_disconnect('ativa');
  perform extensions.dblink_disconnect('cancela');

  if v_msg not like 'OK%' then raise exception 'FALHA B17: cancelamento falhou: %', v_msg; end if;
  if (select status from public.reseller_sales where id = v_sale) <> 'cancelled' then raise exception 'FALHA B17: venda não cancelada'; end if;
  if (select status from public.plates where id = v_plate) <> 'active'
     or (select customer_id from public.plates where id = v_plate) is distinct from 'd7200000-0000-0000-0000-000000000001'
    then raise exception 'FALHA B17: o cancelamento concorrente desfez a ativação ou o cliente'; end if;
  raise notice 'OK B17: ativação e cancelamento simultâneos: o cancelamento espera, vê a placa ATIVA e só cancela o financeiro';
end $$;

drop table public.bcl_ids;
