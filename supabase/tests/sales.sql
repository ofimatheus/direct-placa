-- Testes do fluxo "venda = reserva de placas" (migration 012).
-- Rodar num banco de TESTE, depois das migrations. Independente dos outros
-- arquivos (ids e lotes próprios; contagens globais são relativas), então
-- pode rodar sozinho ou depois de behavior.sql / operations.sql.
-- Cada bloco lança exceção "FALHA: ..." se a regra não for respeitada.
-- Concorrência real (duas conexões) fica em sales_concurrency.sql.
\set ON_ERROR_STOP 1

insert into auth.users (id, email) values
  ('50000000-0000-0000-0000-00000000000a', 'sal-admin@teste.com'),
  ('50000000-0000-0000-0000-0000000000b1', 'sal-r1@teste.com'),
  ('50000000-0000-0000-0000-0000000000b2', 'sal-r2@teste.com'),
  ('50000000-0000-0000-0000-0000000000b3', 'sal-r3@teste.com');
update public.profiles set role = 'admin' where email = 'sal-admin@teste.com';
update public.profiles set active = false where email = 'sal-r3@teste.com';
insert into public.reseller_profiles (id, user_id, company_name) values
  ('60000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-0000000000b1', 'XP Comunicação'),
  ('60000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-0000000000b2', 'Revenda Dois'),
  ('60000000-0000-0000-0000-000000000003', '50000000-0000-0000-0000-0000000000b3', 'Revenda Inativa');
insert into public.customers (id, reseller_id, name) values
  ('61000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000001', 'Padaria do R1');

-- Template real (pela RPC) para conferir a coluna "template" das listas.
begin;
set local role authenticated;
set local request.jwt.claim.sub = '50000000-0000-0000-0000-00000000000a';
select * from public.create_plate_template('71000000-0000-0000-0000-000000000001', 'Avaliação Google Vendas', 'google-vendas', null,
  jsonb_build_object(
    'base_image_path', 'tpl/sal.png', 'base_image_mime_type', 'image/png',
    'base_image_sha256', repeat('b', 64), 'base_image_size_bytes', 1000,
    'canvas_width', 1000, 'canvas_height', 1500, 'print_width_mm', null, 'print_height_mm', null,
    'qr_x', 250, 'qr_y', 400, 'qr_width', 500, 'qr_height', 500,
    'qr_error_correction', 'M', 'qr_quiet_zone', 4, 'qr_color', '#000000', 'qr_background_color', '#FFFFFF',
    'show_public_code', true, 'code_x', 500, 'code_y', 1000, 'code_font_family', 'inter-bold',
    'code_font_size', 80, 'code_color', '#000000', 'code_align', 'center', 'code_max_width', 800,
    'safe_margin', 40, 'renderer_version', 1));
commit;

insert into public.plate_batches (id, name, quantity, template_id, template_version_id)
select '70000000-0000-0000-0000-00000000000a', 'Lote Vendas A', 30, t.id, t.current_version_id
from public.plate_templates t where t.id = '71000000-0000-0000-0000-000000000001';
insert into public.plates (public_code, batch_id)
select 'SAL' || lpad(g::text, 3, '0'), '70000000-0000-0000-0000-00000000000a' from generate_series(1, 30) g;

insert into public.plate_batches (id, name, quantity, template_id, template_version_id)
select '70000000-0000-0000-0000-00000000000b', 'Lote Vendas B', 5, t.id, t.current_version_id
from public.plate_templates t where t.id = '71000000-0000-0000-0000-000000000001';
insert into public.plates (public_code, batch_id)
select 'SLB' || lpad(g::text, 3, '0'), '70000000-0000-0000-0000-00000000000b' from generate_series(1, 5) g;

-- Placa bloqueada em estoque e placa com atribuição avulsa: nunca disponíveis para venda.
update public.plates set status = 'blocked' where public_code = 'SAL030';

-- Guarda os ids das vendas criadas para os blocos seguintes.
create table public.sales_test_ids (name text primary key, id uuid not null);
grant select, insert on public.sales_test_ids to authenticated;

-- ===================== Venda automática =====================
begin;
set local role authenticated;
set local request.jwt.claim.sub = '50000000-0000-0000-0000-00000000000a';
do $$
declare
  o uuid; o2 uuid; ord record; item record; n int;
  k uuid := '72000000-0000-0000-0000-000000000001';
begin
  perform public.assign_plates_to_reseller('60000000-0000-0000-0000-000000000002', null,
    array(select id from public.plates where public_code = 'SAL029'));

  o := public.create_sale_with_plates('60000000-0000-0000-0000-000000000001', 10, 25.00, 20.00, 'Venda automática',
         'pending', 'automatic', null, '70000000-0000-0000-0000-00000000000a', k);
  insert into public.sales_test_ids values ('auto', o);

  select * into ord from public.orders where id = o;
  select * into item from public.order_items where order_id = o;
  if ord.reseller_id <> '60000000-0000-0000-0000-000000000001' or ord.status <> 'pending'
     or ord.total <> 230 or item.quantity <> 10 or ord.idempotency_key <> k
    then raise exception 'FALHA: dados comerciais da venda automática'; end if;

  if (select array_agg(p.public_code order by p.public_code) from public.order_plates op join public.plates p on p.id = op.plate_id
      where op.order_id = o and op.released_at is null)
     <> array['SAL001','SAL002','SAL003','SAL004','SAL005','SAL006','SAL007','SAL008','SAL009','SAL010']
    then raise exception 'FALHA: esperava as 10 placas mais antigas do lote'; end if;

  select count(*) into n from public.plates p join public.order_plates op on op.plate_id = p.id and op.order_id = o
  where p.reseller_id = ord.reseller_id and p.status = 'assigned'
    and p.customer_id is null and p.destination_url is null;
  if n <> 10 then raise exception 'FALHA: placas não ficaram RESERVADAS para o revendedor (%)', n; end if;

  select count(*) into n from public.plate_assignments a join public.order_plates op on op.plate_id = a.plate_id and op.order_id = o
  where a.unassigned_at is null and a.order_id = o and a.reseller_id = ord.reseller_id
    and a.assigned_by = '50000000-0000-0000-0000-00000000000a';
  if n <> 10 then raise exception 'FALHA: histórico de atribuição com a venda (%)', n; end if;
  raise notice 'OK S1: venda automática cria a venda, reserva exatamente 10 placas, vincula ao revendedor e grava o histórico';

  o2 := public.create_sale_with_plates('60000000-0000-0000-0000-000000000001', 10, 25.00, 20.00, 'Venda automática',
          'pending', 'automatic', null, '70000000-0000-0000-0000-00000000000a', k);
  if o2 <> o then raise exception 'FALHA: request repetida criou outra venda'; end if;
  if (select count(*) from public.orders where idempotency_key = k) <> 1
     or (select count(*) from public.order_plates where order_id = o) <> 10
     or (select count(*) from public.plates where reseller_id = '60000000-0000-0000-0000-000000000001') <> 10
    then raise exception 'FALHA: request repetida reservou placas de novo'; end if;
  raise notice 'OK S2: request repetida (mesma idempotency_key) devolve a mesma venda sem reservar de novo';

  -- sem filtro de lote: N placas quaisquer, todas antes disponíveis
  select count(*) into n from public.plates
  where status = 'in_stock' and reseller_id is null;
  o2 := public.create_sale_with_plates('60000000-0000-0000-0000-000000000002', 2, 10, 0, null, 'paid', 'automatic', null, null,
          '72000000-0000-0000-0000-000000000002');
  insert into public.sales_test_ids values ('auto_r2', o2);
  if (select count(*) from public.order_plates op join public.plates p on p.id = op.plate_id
      where op.order_id = o2 and p.status = 'assigned' and p.reseller_id = '60000000-0000-0000-0000-000000000002') <> 2
     or (select count(*) from public.plates where status = 'in_stock' and reseller_id is null) <> n - 2
     or (select status from public.orders where id = o2) <> 'paid'
    then raise exception 'FALHA: venda automática sem filtro de lote'; end if;
  raise notice 'OK S3: venda automática sem lote reserva N placas do estoque geral (e pode nascer paga)';
end $$;
commit;

-- ===================== Venda manual =====================
begin;
set local role authenticated;
set local request.jwt.claim.sub = '50000000-0000-0000-0000-00000000000a';
do $$
declare o uuid; n int; before_orders int;
begin
  o := public.create_sale_with_plates('60000000-0000-0000-0000-000000000001', 3, 30, 0, 'Venda manual', 'pending', 'manual',
         array(select id from public.plates where public_code in ('SAL015', 'SAL020', 'SAL025')), null,
         '72000000-0000-0000-0000-000000000003');
  insert into public.sales_test_ids values ('manual', o);
  if (select array_agg(p.public_code order by p.public_code) from public.order_plates op join public.plates p on p.id = op.plate_id
      where op.order_id = o and op.released_at is null) <> array['SAL015','SAL020','SAL025']
     or (select count(*) from public.plates where public_code in ('SAL015','SAL020','SAL025')
         and status = 'assigned' and reseller_id = '60000000-0000-0000-0000-000000000001') <> 3
    then raise exception 'FALHA: venda manual não reservou exatamente as placas selecionadas'; end if;
  raise notice 'OK S4: venda manual reserva exatamente as placas selecionadas';

  select count(*) into before_orders from public.orders;
  begin
    perform public.create_sale_with_plates('60000000-0000-0000-0000-000000000001', 3, 30, 0, null, 'pending', 'manual',
      array(select id from public.plates where public_code in ('SAL016', 'SAL017')), null, gen_random_uuid());
    raise exception 'FALHA: aceitou seleção diferente da quantidade';
  exception when invalid_parameter_value then null; end;
  if (select count(*) from public.orders) <> before_orders
     or (select count(*) from public.plates where public_code in ('SAL016','SAL017') and status = 'in_stock') <> 2
    then raise exception 'FALHA: seleção inválida deixou alteração parcial'; end if;
  raise notice 'OK S5: seleção manual precisa ter exatamente a quantidade da venda';
end $$;
commit;

-- ===================== Estoque insuficiente =====================
begin;
set local role authenticated;
set local request.jwt.claim.sub = '50000000-0000-0000-0000-00000000000a';
do $$
declare avail int; msg text; det text; before_orders int; before_stock int;
begin
  select count(*) into before_orders from public.orders;
  select count(*) into avail from public.plates p
  where p.status = 'in_stock' and p.reseller_id is null
    and not exists (select 1 from public.order_plates op where op.plate_id = p.id and op.released_at is null);
  before_stock := avail;

  begin
    perform public.create_sale_with_plates('60000000-0000-0000-0000-000000000001', avail + 3, 10, 0, null, 'pending',
      'automatic', null, null, gen_random_uuid());
    raise exception 'FALHA: vendeu mais que o estoque';
  exception when sqlstate '55000' then
    get stacked diagnostics msg = message_text, det = pg_exception_detail;
  end;
  if msg <> format('Existem apenas %s placas disponíveis.', avail) or det <> 'insufficient_stock' then
    raise exception 'FALHA: mensagem de estoque insuficiente: "%" / %', msg, det; end if;

  -- lote B tem 5 placas
  begin
    perform public.create_sale_with_plates('60000000-0000-0000-0000-000000000001', 6, 10, 0, null, 'pending',
      'automatic', null, '70000000-0000-0000-0000-00000000000b', gen_random_uuid());
    raise exception 'FALHA: vendeu mais que o estoque do lote';
  exception when sqlstate '55000' then
    get stacked diagnostics msg = message_text;
  end;
  if msg <> 'Existem apenas 5 placas disponíveis neste lote.' then raise exception 'FALHA: mensagem do lote: "%"', msg; end if;

  if (select count(*) from public.orders) <> before_orders
     or (select count(*) from public.plates where status = 'in_stock' and reseller_id is null) <> before_stock
    then raise exception 'FALHA: estoque insuficiente deixou venda ou reserva parcial'; end if;
  raise notice 'OK S6: estoque insuficiente bloqueia a venda com "Existem apenas N placas disponíveis." e não altera nada';
end $$;
commit;

-- ===================== Placa já reservada / indisponível =====================
begin;
set local role authenticated;
set local request.jwt.claim.sub = '50000000-0000-0000-0000-00000000000a';
do $$
declare msg text; before_orders int;
begin
  select count(*) into before_orders from public.orders;
  begin
    perform public.create_sale_with_plates('60000000-0000-0000-0000-000000000002', 2, 10, 0, null, 'pending', 'manual',
      array(select id from public.plates where public_code in ('SAL001', 'SAL013')), null, gen_random_uuid());
    raise exception 'FALHA: reservou placa já reservada por outra venda';
  exception when sqlstate '55000' then
    get stacked diagnostics msg = message_text;
  end;
  if msg not like 'Estas placas não estão mais disponíveis: SAL001.%' then raise exception 'FALHA: mensagem "%"', msg; end if;
  if (select status from public.plates where public_code = 'SAL013') <> 'in_stock'
     or (select count(*) from public.orders) <> before_orders
    then raise exception 'FALHA: seleção manual não foi tudo-ou-nada'; end if;

  -- bloqueada em estoque, atribuída avulsa: também recusadas
  begin
    perform public.create_sale_with_plates('60000000-0000-0000-0000-000000000002', 2, 10, 0, null, 'pending', 'manual',
      array(select id from public.plates where public_code in ('SAL030', 'SAL029')), null, gen_random_uuid());
    raise exception 'FALHA: reservou placa bloqueada/atribuída';
  exception when sqlstate '55000' then
    get stacked diagnostics msg = message_text;
  end;
  if msg not like '%SAL029, SAL030%' then raise exception 'FALHA: mensagem "%"', msg; end if;
  raise notice 'OK S7: placa reservada, atribuída ou bloqueada é recusada e nada é alterado';
end $$;
commit;

-- Barreiras no banco, fora das RPCs (como superusuário: sem RLS)
do $$
declare o uuid := (select id from public.sales_test_ids where name = 'auto');
        o_other uuid; plate uuid := (select id from public.plates where public_code = 'SAL001'); msg text;
begin
  insert into public.orders (reseller_id, status) values ('60000000-0000-0000-0000-000000000001', 'pending') returning id into o_other;
  begin
    insert into public.order_plates (order_id, plate_id) values (o_other, plate);
    raise exception 'FALHA: a mesma placa ficou vinculada a duas vendas válidas';
  exception when unique_violation then null; end;

  begin
    update public.plates set reseller_id = '60000000-0000-0000-0000-000000000002' where id = plate;
    raise exception 'FALHA: placa de venda mudou de revendedor por UPDATE';
  exception when sqlstate '55000' then get stacked diagnostics msg = message_text; end;
  if msg not like 'A placa SAL001 pertence à venda #%' then raise exception 'FALHA: mensagem "%"', msg; end if;

  begin
    update public.orders set status = 'cancelled' where id = o;
    raise exception 'FALHA: cancelou venda com placas por UPDATE direto';
  exception when sqlstate '55000' then null; end;

  begin
    delete from public.order_plates where order_id = o;
    raise exception 'FALHA: apagou histórico de placas da venda';
  exception when sqlstate '55000' then null; end;

  delete from public.orders where id = o_other;
  raise notice 'OK S8: índice único impede a placa em duas vendas; troca de revendedor, cancelamento direto e exclusão do histórico são recusados pelo banco';
end $$;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '50000000-0000-0000-0000-00000000000a';
do $$
declare msg text;
begin
  begin
    perform * from public.set_plate_reseller((select id from public.plates where public_code = 'SAL002'), '60000000-0000-0000-0000-000000000002');
    raise exception 'FALHA: atribuição avulsa tirou placa de uma venda';
  exception when sqlstate '55000' then get stacked diagnostics msg = message_text; end;
  if msg not like '%cancele a venda%' then raise exception 'FALHA: mensagem "%"', msg; end if;
  begin
    perform * from public.set_plate_reseller((select id from public.plates where public_code = 'SAL002'), null);
    raise exception 'FALHA: removeu revendedor de placa vendida';
  exception when sqlstate '55000' then null; end;
  if public.assign_plates_to_reseller('60000000-0000-0000-0000-000000000002', 1, null, '70000000-0000-0000-0000-00000000000b') <> 1
    then raise exception 'FALHA: atribuição avulsa de placa livre deixou de funcionar'; end if;
  raise notice 'OK S9: atribuição avulsa continua funcionando, mas não mexe em placa vinculada a venda';
end $$;
commit;

-- ===================== Lista para seleção manual =====================
begin;
set local role authenticated;
set local request.jwt.claim.sub = '50000000-0000-0000-0000-00000000000a';
do $$
declare r record; n int; total int;
begin
  select count(*) into n from public.plates p
  where p.status = 'in_stock' and p.reseller_id is null
    and not exists (select 1 from public.order_plates op where op.plate_id = p.id and op.released_at is null);
  select max(total_count) into total from public.admin_available_plates(null, null, 500, 0);
  if total <> n then raise exception 'FALHA: total da lista (%) diferente do estoque disponível (%)', total, n; end if;

  if exists (
    select 1 from public.admin_available_plates(null, '70000000-0000-0000-0000-00000000000a', 500, 0)
    where public_code in ('SAL001', 'SAL015', 'SAL029', 'SAL030') or status <> 'in_stock'
  ) then raise exception 'FALHA: lista manual mostrou placa reservada, atribuída ou bloqueada'; end if;

  select * into r from public.admin_available_plates('sal013', null, 10, 0);
  if r.public_code <> 'SAL013' or r.batch_name <> 'Lote Vendas A' or r.template_name <> 'Avaliação Google Vendas'
     or r.template_version <> 1 or r.status <> 'in_stock'
    then raise exception 'FALHA: dados da linha (código, lote, template, status): %', r; end if;

  select available into n from public.admin_available_stock() where batch_id = '70000000-0000-0000-0000-00000000000a';
  select count(*) into total from public.plates p
  where p.batch_id = '70000000-0000-0000-0000-00000000000a' and p.status = 'in_stock' and p.reseller_id is null;
  -- no máximo 30 − 10 (auto) − 3 (manual) − SAL029 (avulsa) − SAL030 (bloqueada) = 15
  if n <> total or n > 15 then raise exception 'FALHA: estoque do lote A (% / %)', n, total; end if;
  raise notice 'OK S10: lista manual mostra só placas realmente disponíveis, com código, lote, template e status';
end $$;
commit;

-- ===================== Detalhe da venda =====================
-- O revendedor ativa uma das placas da venda automática.
begin;
set local role authenticated;
set local request.jwt.claim.sub = '50000000-0000-0000-0000-0000000000b1';
select status from public.configure_reseller_plate((select id from public.plates where public_code = 'SAL003'),
  '61000000-0000-0000-0000-000000000001', 'google_review', 'https://g.page/r/xp', null);
-- e vincula um cliente (sem destino) a uma placa da venda manual: continua RESERVADA
select status from public.configure_reseller_plate((select id from public.plates where public_code = 'SAL015'),
  '61000000-0000-0000-0000-000000000001', null, null, null);
commit;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '50000000-0000-0000-0000-00000000000a';
do $$
declare o uuid := (select id from public.sales_test_ids where name = 'auto'); rows jsonb;
begin
  select jsonb_agg(jsonb_build_object('code', public_code, 'status', status) order by public_code) into rows
  from public.admin_order_plates(o);
  if jsonb_array_length(rows) <> 10 then raise exception 'FALHA: detalhe com % placas', jsonb_array_length(rows); end if;
  if rows -> 2 <> '{"code": "SAL003", "status": "active"}'::jsonb
     or rows -> 0 <> '{"code": "SAL001", "status": "assigned"}'::jsonb
    then raise exception 'FALHA: status atual no detalhe: %', rows; end if;
  if exists (select 1 from public.admin_order_plates(o) where public_code not like 'SAL0%' or batch_name <> 'Lote Vendas A')
    then raise exception 'FALHA: detalhe mostrou placa de fora da venda'; end if;
  if (select count(*) from public.admin_order_plates((select id from public.sales_test_ids where name = 'manual'))) <> 3
    then raise exception 'FALHA: detalhe da venda manual'; end if;
  raise notice 'OK S11: detalhe da venda lista exatamente as placas dela, com o status atual de cada uma';
end $$;
commit;

-- ===================== Cancelamento =====================
begin;
set local role authenticated;
set local request.jwt.claim.sub = '50000000-0000-0000-0000-00000000000a';
do $$
declare o uuid := (select id from public.sales_test_ids where name = 'auto'); msg text; det text;
begin
  begin
    perform * from public.cancel_order(o);
    raise exception 'FALHA: cancelou venda com placa ATIVA';
  exception when sqlstate '55000' then
    get stacked diagnostics msg = message_text, det = pg_exception_detail;
  end;
  if det <> 'plates_in_use' or msg not like 'Esta venda tem 1 placa(s) ativa(s) ou em uso vinculada(s): SAL003 (Ativa).%'
    then raise exception 'FALHA: mensagem do bloqueio: "%" / %', msg, det; end if;

  begin
    perform * from public.set_order_status(o, 'cancelled');
    raise exception 'FALHA: set_order_status cancelou venda com placa ATIVA';
  exception when sqlstate '55000' then null; end;

  if (select status from public.orders where id = o) <> 'pending'
     or (select count(*) from public.order_plates where order_id = o and released_at is null) <> 10
     or (select count(*) from public.plates where public_code between 'SAL001' and 'SAL010' and status = 'in_stock') <> 0
    then raise exception 'FALHA: cancelamento bloqueado alterou algo'; end if;
  raise notice 'OK S12: cancelamento com placa ATIVA é bloqueado, informa as placas e não altera nada';
end $$;
commit;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '50000000-0000-0000-0000-00000000000a';
do $$
declare o uuid := (select id from public.sales_test_ids where name = 'manual'); ord record; n int; o_new uuid;
begin
  select * into ord from public.cancel_order(o);
  if ord.status <> 'cancelled' or ord.cancelled_at is null then raise exception 'FALHA: venda não cancelada'; end if;

  select count(*) into n from public.plates
  where public_code in ('SAL015', 'SAL020', 'SAL025')
    and status = 'in_stock' and reseller_id is null and customer_id is null and destination_url is null;
  if n <> 3 then raise exception 'FALHA: placas RESERVADAS não voltaram para DISPONÍVEL (%)', n; end if;

  if (select count(*) from public.order_plates where order_id = o and released_at is not null
      and release_reason = 'returned_to_stock' and released_by = '50000000-0000-0000-0000-00000000000a') <> 3
    then raise exception 'FALHA: vínculo com a venda não foi encerrado como devolução'; end if;

  if (select count(*) from public.plate_assignments a join public.plates p on p.id = a.plate_id
      where p.public_code in ('SAL015', 'SAL020', 'SAL025') and a.order_id = o
        and a.unassigned_at is not null and a.ended_reason = 'order_cancelled') <> 3
     or exists (select 1 from public.plate_assignments a join public.plates p on p.id = a.plate_id
                where p.public_code in ('SAL015', 'SAL020', 'SAL025') and a.unassigned_at is null)
    then raise exception 'FALHA: histórico não registra o retorno por cancelamento'; end if;

  if (select count(*) from public.admin_available_plates('SAL0', '70000000-0000-0000-0000-00000000000a', 500, 0)
      where public_code in ('SAL015', 'SAL020', 'SAL025')) <> 3
    then raise exception 'FALHA: placas devolvidas não aparecem como disponíveis'; end if;

  -- a placa física volta a ser vendável
  o_new := public.create_sale_with_plates('60000000-0000-0000-0000-000000000002', 2, 30, 0, null, 'pending', 'manual',
             array(select id from public.plates where public_code in ('SAL015', 'SAL020')), null,
             '72000000-0000-0000-0000-000000000004');
  if (select count(*) from public.order_plates where order_id = o_new and released_at is null) <> 2
    then raise exception 'FALHA: placa devolvida não pôde ser vendida de novo'; end if;
  if (select count(*) from public.admin_order_plates(o)) <> 3
    then raise exception 'FALHA: venda cancelada perdeu o registro das placas que teve'; end if;

  begin
    perform * from public.cancel_order(o);
    raise exception 'FALHA: cancelou duas vezes';
  exception when sqlstate '55000' then null; end;
  raise notice 'OK S13: cancelamento devolve placas RESERVADAS ao estoque (sem revendedor, cliente ou destino), registra o motivo e elas voltam a ser vendáveis';
end $$;
commit;

-- Ação administrativa explícita: cancelar mantendo as placas em uso com o revendedor
begin;
set local role authenticated;
set local request.jwt.claim.sub = '50000000-0000-0000-0000-00000000000a';
do $$
declare o uuid := (select id from public.sales_test_ids where name = 'auto'); p record; r record;
begin
  perform * from public.cancel_order(o, true);
  if (select status from public.orders where id = o) <> 'cancelled' then raise exception 'FALHA: venda não cancelada'; end if;

  select * into p from public.plates where public_code = 'SAL003';
  if p.status <> 'active' or p.reseller_id <> '60000000-0000-0000-0000-000000000001'
     or p.destination_url <> 'https://g.page/r/xp' or p.customer_id is null
    then raise exception 'FALHA: placa ATIVA não ficou intacta com o revendedor'; end if;
  if (select release_reason from public.order_plates where order_id = o and plate_id = p.id) <> 'kept_with_reseller'
    then raise exception 'FALHA: motivo da placa mantida'; end if;
  if exists (select 1 from public.admin_available_plates('SAL003', null, 10, 0))
    then raise exception 'FALHA: placa ATIVA apareceu como disponível'; end if;

  if (select count(*) from public.plates where public_code between 'SAL001' and 'SAL010' and status = 'in_stock' and reseller_id is null) <> 9
     or (select count(*) from public.order_plates where order_id = o and release_reason = 'returned_to_stock') <> 9
    then raise exception 'FALHA: as 9 placas só reservadas deveriam voltar ao estoque'; end if;

  set local role anon;
  select * into r from public.resolve_plate_redirect('SAL003', 'qr');
  if r.outcome <> 'ok' then raise exception 'FALHA: placa mantida deixou de redirecionar'; end if;
  set local role authenticated;
  raise notice 'OK S14: ação explícita cancela a venda, devolve as reservadas e mantém a ATIVA com o mesmo revendedor (sem ir ao estoque)';
end $$;
commit;

-- Placa BLOQUEADA também impede o cancelamento automático; venda antiga sem placas cancela normalmente
begin;
set local role authenticated;
set local request.jwt.claim.sub = '50000000-0000-0000-0000-00000000000a';
do $$
declare o uuid := (select id from public.sales_test_ids where name = 'auto_r2'); legacy uuid; msg text; plate uuid;
begin
  select op.plate_id into plate from public.order_plates op where op.order_id = o limit 1;
  update public.plates set status = 'blocked' where id = plate;
  begin
    perform * from public.cancel_order(o);
    raise exception 'FALHA: cancelou venda com placa bloqueada';
  exception when sqlstate '55000' then get stacked diagnostics msg = message_text; end;
  if msg not like '%(Bloqueada)%' then raise exception 'FALHA: mensagem "%"', msg; end if;
  update public.plates set status = 'assigned' where id = plate;  -- desbloqueio (sem destino → reservada)
  perform * from public.cancel_order(o);
  if (select count(*) from public.plates p join public.order_plates op on op.plate_id = p.id and op.order_id = o
      where p.status = 'in_stock') <> 2 then raise exception 'FALHA: após desbloquear, cancelamento deveria devolver'; end if;

  legacy := public.create_order('60000000-0000-0000-0000-000000000001', 5, 10);
  perform * from public.set_order_status(legacy, 'paid');
  perform * from public.set_order_status(legacy, 'cancelled');
  if (select status from public.orders where id = legacy) <> 'cancelled' then raise exception 'FALHA: venda antiga'; end if;
  raise notice 'OK S15: placa bloqueada também exige ação; venda antiga (sem placas vinculadas) cancela como antes';
end $$;
commit;

-- ===================== Validações e permissões =====================
begin;
set local role authenticated;
set local request.jwt.claim.sub = '50000000-0000-0000-0000-00000000000a';
do $$ begin
  begin
    perform public.create_sale_with_plates('60000000-0000-0000-0000-000000000003', 1, 10, 0, null, 'pending', 'automatic', null, null, gen_random_uuid());
    raise exception 'FALHA: vendeu para revendedor inativo';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.create_sale_with_plates('60000000-0000-0000-0000-000000000001', 1, 10, 0, null, 'pending', 'automatic', null, null, null);
    raise exception 'FALHA: aceitou venda sem idempotency_key';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.create_sale_with_plates('60000000-0000-0000-0000-000000000001', 1, 10, 50, null, 'pending', 'automatic', null, null, gen_random_uuid());
    raise exception 'FALHA: desconto maior que o subtotal';
  exception when invalid_parameter_value then null; end;
  if exists (select 1 from public.orders o where o.total < 0) then raise exception 'FALHA'; end if;
  raise notice 'OK S16: revendedor inativo, falta de idempotency_key e desconto inválido são recusados (sem reservar nada)';
end $$;
commit;

-- Revendedor R2: não vê nem mexe em placas e vendas do R1
begin;
set local role authenticated;
set local request.jwt.claim.sub = '50000000-0000-0000-0000-0000000000b2';
do $$
declare n int;
begin
  select count(*) into n from public.plates where public_code = 'SAL003';
  if n <> 0 then raise exception 'FALHA: R2 vê placa ativa do R1'; end if;
  select count(*) into n from public.plates where reseller_id = '60000000-0000-0000-0000-000000000001';
  if n <> 0 then raise exception 'FALHA: R2 vê placas do R1 (%)', n; end if;
  select count(*) into n from public.orders where reseller_id = '60000000-0000-0000-0000-000000000001';
  if n <> 0 then raise exception 'FALHA: R2 vê vendas do R1'; end if;
  -- R2 só enxerga os vínculos ATIVOS das próprias placas: SAL015 e SAL020 (revendidas a ele após o cancelamento)
  if (select array_agg(p.public_code order by p.public_code) from public.order_plates op join public.plates p on p.id = op.plate_id)
     is distinct from array['SAL015', 'SAL020']
    then raise exception 'FALHA: R2 deveria ver só os vínculos ativos das próprias placas'; end if;

  if (select count(*) from public.admin_order_plates((select id from public.sales_test_ids where name = 'auto'))) <> 0
     or (select count(*) from public.admin_available_plates(null, null, 10, 0)) <> 0
     or (select count(*) from public.admin_available_stock()) <> 0
    then raise exception 'FALHA: R2 leu dados de ADMIN'; end if;

  begin perform public.create_sale_with_plates('60000000-0000-0000-0000-000000000002', 1, 1, 0, null, 'pending', 'automatic', null, null, gen_random_uuid());
    raise exception 'FALHA: revendedor registrou venda'; exception when insufficient_privilege then null; end;
  begin perform * from public.cancel_order((select id from public.sales_test_ids where name = 'auto'));
    raise exception 'FALHA: revendedor cancelou venda'; exception when insufficient_privilege then null; end;
  begin insert into public.order_plates (order_id, plate_id) values (gen_random_uuid(), gen_random_uuid());
    raise exception 'FALHA: revendedor inseriu vínculo'; exception when insufficient_privilege then null; end;

  raise notice 'OK S17: revendedor não vê placas, vendas nem vínculos de outro revendedor e não usa as RPCs de venda';
end $$;
commit;

-- R2 tentando configurar a placa do R1 pelo id (obtido como superusuário)
select set_config('test.r1_plate', (select id::text from public.plates where public_code = 'SAL003'), false);
begin;
set local role authenticated;
set local request.jwt.claim.sub = '50000000-0000-0000-0000-0000000000b2';
do $$ begin
  perform * from public.configure_reseller_plate(current_setting('test.r1_plate')::uuid, null, 'website', 'https://invasor.com.br', null);
  raise exception 'FALHA: R2 configurou placa do R1';
exception when sqlstate 'P0002' then
  raise notice 'OK S18: revendedor não acessa a placa de outro revendedor nem pelo id';
end $$;
commit;

-- R1 enxerga as próprias placas (inclusive a mantida) e nenhuma do R2
begin;
set local role authenticated;
set local request.jwt.claim.sub = '50000000-0000-0000-0000-0000000000b1';
do $$ declare n int; begin
  select count(*) into n from public.plates where reseller_id <> '60000000-0000-0000-0000-000000000001';
  if n <> 0 then raise exception 'FALHA: R1 vê placas de outro revendedor'; end if;
  if (select status from public.plates where public_code = 'SAL003') <> 'active' then raise exception 'FALHA: R1 perdeu a placa ativa'; end if;
  if exists (select 1 from public.plates where public_code in ('SAL001', 'SAL015')) then raise exception 'FALHA: R1 ainda vê placas devolvidas'; end if;
  raise notice 'OK S19: revendedor vê só as próprias placas; as devolvidas ao estoque saem da visão dele';
end $$;
commit;

drop table public.sales_test_ids;
