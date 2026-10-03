-- Testes da operação (migrations 008 e 009). Rodar num banco de TESTE,
-- depois das migrations. Independente de behavior.sql (usa ids próprios).
-- Cada bloco lança exceção "FALHA: ..." se a regra não for respeitada.
\set ON_ERROR_STOP 1

insert into auth.users (id, email) values
  ('10000000-0000-0000-0000-00000000000a', 'op-admin@teste.com'),
  ('10000000-0000-0000-0000-0000000000b1', 'op-r1@teste.com'),
  ('10000000-0000-0000-0000-0000000000b2', 'op-r2@teste.com'),
  ('10000000-0000-0000-0000-0000000000b3', 'op-r3@teste.com');
update public.profiles set role = 'admin' where email = 'op-admin@teste.com';
update public.profiles set active = false where email = 'op-r3@teste.com';
insert into public.reseller_profiles (id, user_id, company_name) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-0000000000b1', 'Revenda Um'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-0000000000b2', 'Revenda Dois'),
  ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-0000000000b3', 'Revenda Inativa');
insert into public.customers (id, reseller_id, name) values
  ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Cliente do R1'),
  ('30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', 'Cliente do R2');
insert into public.plate_batches (id, name, quantity) values ('40000000-0000-0000-0000-000000000001', 'Lote de teste operações', 20);
insert into public.plates (public_code, batch_id)
select 'OPS' || lpad(g::text, 3, '0'), '40000000-0000-0000-0000-000000000001' from generate_series(1, 20) g;

-- ===================== ADMIN: atribuição =====================
begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-0000-0000-00000000000a';
do $$
declare n int;
begin
  n := public.assign_plates_to_reseller('20000000-0000-0000-0000-000000000001', 10, null, '40000000-0000-0000-0000-000000000001');
  if n <> 10 then raise exception 'FALHA: esperava 10 atribuídas, veio %', n; end if;
  if (select count(*) from public.plates where reseller_id = '20000000-0000-0000-0000-000000000001' and status = 'assigned' and public_code like 'OPS%') <> 10
    then raise exception 'FALHA: placas não ficaram com o revendedor'; end if;
  if (select count(*) from public.plate_assignments a join public.plates p on p.id = a.plate_id
      where p.public_code like 'OPS%' and a.unassigned_at is null
        and a.assigned_by = '10000000-0000-0000-0000-00000000000a' and a.assigned_at is not null) <> 10
    then raise exception 'FALHA: plate_assignments sem assigned_by/assigned_at'; end if;
  raise notice 'OK A1: "atribuir 10 disponíveis" (filtrando por lote) preenche reseller_id, status e histórico com assigned_by';

  begin
    perform public.assign_plates_to_reseller('20000000-0000-0000-0000-000000000001', 50, null, '40000000-0000-0000-0000-000000000001');
    raise exception 'FALHA: atribuiu mais do que o estoque';
  exception when sqlstate '55000' then null; end;
  if (select count(*) from public.plates where status = 'in_stock' and public_code like 'OPS%') <> 10
    then raise exception 'FALHA: atribuição parcial após erro'; end if;
  raise notice 'OK A2: estoque insuficiente não atribui nada';

  begin
    perform public.assign_plates_to_reseller('20000000-0000-0000-0000-000000000002', null,
      array(select id from public.plates where public_code in ('OPS011', 'OPS001')));
    raise exception 'FALHA: seleção manual com placa já atribuída foi aceita';
  exception when sqlstate '55000' then null; end;
  if (select reseller_id from public.plates where public_code = 'OPS011') is not null
    then raise exception 'FALHA: seleção manual não foi transacional'; end if;
  n := public.assign_plates_to_reseller('20000000-0000-0000-0000-000000000002', null,
      array(select id from public.plates where public_code in ('OPS011', 'OPS012')));
  if n <> 2 then raise exception 'FALHA: seleção manual'; end if;
  raise notice 'OK A3: seleção manual é tudo-ou-nada';

  begin
    perform public.assign_plates_to_reseller('20000000-0000-0000-0000-000000000003', 1);
    raise exception 'FALHA: atribuiu a revendedor inativo';
  exception when sqlstate '22023' then null; end;
  raise notice 'OK A4: não atribui a revendedor inativo';

  begin
    perform * from public.configure_reseller_plate((select id from public.plates where public_code = 'OPS001'), null, null, null, null);
    raise exception 'FALHA: ADMIN usou a RPC do revendedor';
  exception when insufficient_privilege then null; end;
  raise notice 'OK A5: configure_reseller_plate é exclusiva do RESELLER';
end $$;
commit;

-- ===================== RESELLER: configurar placas =====================
begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-0000-0000-0000000000b1';
do $$
declare p record; n int;
begin
  select * into p from public.configure_reseller_plate(
    (select id from public.plates where public_code = 'OPS001'),
    '30000000-0000-0000-0000-000000000001', 'whatsapp', 'https://wa.me/5511999999999', 'active');
  if p.status <> 'active' or p.destination_url <> 'https://wa.me/5511999999999' or p.customer_id <> '30000000-0000-0000-0000-000000000001'
    then raise exception 'FALHA: configuração da própria placa'; end if;
  raise notice 'OK R1: revendedor configura e ativa a própria placa';

  begin
    perform * from public.configure_reseller_plate((select id from public.plates where public_code = 'OPS011'),
      null, 'website', 'https://exemplo.com.br', null);
    raise exception 'FALHA: revendedor configurou placa de outro revendedor';
  exception when sqlstate 'P0002' then null; end;
  raise notice 'OK R2: revendedor NÃO edita placa de outro revendedor';

  begin
    perform * from public.configure_reseller_plate((select id from public.plates where public_code = 'OPS002'),
      '30000000-0000-0000-0000-000000000002', 'website', 'https://exemplo.com.br', null);
    raise exception 'FALHA: aceitou cliente de outro revendedor';
  exception when invalid_parameter_value then null; end;
  raise notice 'OK R3: cliente precisa pertencer ao mesmo revendedor';

  begin
    perform * from public.configure_reseller_plate((select id from public.plates where public_code = 'OPS002'), null, 'website', 'javascript:alert(1)', null);
    raise exception 'FALHA: aceitou javascript:';
  exception when invalid_parameter_value then null; end;
  begin
    perform * from public.configure_reseller_plate((select id from public.plates where public_code = 'OPS002'), null, 'website', 'ftp://exemplo.com', null);
    raise exception 'FALHA: aceitou ftp:';
  exception when invalid_parameter_value then null; end;
  begin
    perform * from public.configure_reseller_plate((select id from public.plates where public_code = 'OPS002'), null, 'hack', 'https://exemplo.com', null);
    raise exception 'FALHA: aceitou destination_type inválido';
  exception when invalid_parameter_value then null; end;
  begin
    perform * from public.configure_reseller_plate((select id from public.plates where public_code = 'OPS002'), null, null, null, 'active');
    raise exception 'FALHA: ativou sem destino';
  exception when invalid_parameter_value then null; end;
  begin
    perform * from public.configure_reseller_plate((select id from public.plates where public_code = 'OPS002'), null, 'website', 'https://exemplo.com', 'blocked');
    raise exception 'FALHA: revendedor aplicou status administrativo';
  exception when invalid_parameter_value then null; end;
  raise notice 'OK R4: tipo, URL HTTP/HTTPS e status operacional validados no banco';

  -- UPDATE direto na tabela: sem política de UPDATE para o revendedor
  update public.plates set reseller_id = '20000000-0000-0000-0000-000000000002' where public_code = 'OPS001';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FALHA: revendedor mudou reseller_id'; end if;
  update public.plates set public_code = 'HACK01' where public_code = 'OPS001';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FALHA: revendedor mudou public_code'; end if;
  update public.plates set batch_id = null where public_code = 'OPS001';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FALHA: revendedor mudou batch_id'; end if;
  update public.plates set destination_url = 'https://evil.com' where public_code = 'OPS001';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FALHA: revendedor fez UPDATE genérico'; end if;
  raise notice 'OK R5: revendedor NÃO muda reseller_id, public_code, batch_id nem faz UPDATE direto';

  select count(*) into n from public.customers;
  if n <> 1 then raise exception 'FALHA: revendedor vê clientes de outro (%)', n; end if;
  begin
    insert into public.customers (reseller_id, name) values ('20000000-0000-0000-0000-000000000002', 'Invasor');
    raise exception 'FALHA: criou cliente para outro revendedor';
  exception when insufficient_privilege then null; end;
  update public.customers set name = 'x' where id = '30000000-0000-0000-0000-000000000002';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FALHA: alterou cliente de outro revendedor'; end if;
  insert into public.customers (reseller_id, name) values ('20000000-0000-0000-0000-000000000001', 'Novo cliente');
  begin
    update public.customers set reseller_id = '20000000-0000-0000-0000-000000000002' where name = 'Novo cliente';
    raise exception 'FALHA: moveu cliente para outro revendedor';
  exception when insufficient_privilege then null; end;
  raise notice 'OK R6: clientes isolados por revendedor (ler, criar, alterar, mover)';
end $$;
commit;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-0000-0000-0000000000b1';
do $$
declare m jsonb;
begin
  begin perform public.assign_plates_to_reseller('20000000-0000-0000-0000-000000000001', 1);
    raise exception 'FALHA: revendedor atribuiu placas'; exception when insufficient_privilege then null; end;
  begin perform * from public.set_plate_reseller((select id from public.plates where public_code = 'OPS001'), null);
    raise exception 'FALHA: revendedor mudou revendedor da placa'; exception when insufficient_privilege then null; end;
  begin perform public.create_order('20000000-0000-0000-0000-000000000001', 1, 1);
    raise exception 'FALHA: revendedor criou venda'; exception when insufficient_privilege then null; end;
  begin perform public.admin_dashboard_metrics(now() - interval '1 day', now());
    raise exception 'FALHA: revendedor leu métricas do ADMIN'; exception when insufficient_privilege then null; end;
  if (select count(*) from public.admin_reseller_stats()) <> 0 then raise exception 'FALHA: revendedor leu stats de revendedores'; end if;
  m := public.reseller_dashboard_metrics();
  if (m->>'plates')::int <> 10 or (m->>'active')::int <> 1 or (m->>'configured')::int <> 1 or (m->>'available')::int <> 9
    then raise exception 'FALHA: métricas do revendedor %', m; end if;
  raise notice 'OK R7: revendedor bloqueado nas operações de ADMIN; métricas próprias corretas';
end $$;
commit;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-0000-0000-0000000000b3';
do $$ begin
  perform * from public.configure_reseller_plate((select id from public.plates where public_code = 'OPS002'), null, null, null, null);
  raise exception 'FALHA: revendedor inativo operou';
exception when insufficient_privilege then
  raise notice 'OK R8: revendedor inativo é recusado';
end $$;
commit;

-- Bloqueio administrativo impede o revendedor
update public.plates set status = 'blocked' where public_code = 'OPS003';
begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-0000-0000-0000000000b1';
do $$ begin
  perform * from public.configure_reseller_plate((select id from public.plates where public_code = 'OPS003'), null, 'website', 'https://exemplo.com', null);
  raise exception 'FALHA: revendedor alterou placa bloqueada';
exception when sqlstate '55000' then
  raise notice 'OK R9: placa bloqueada pelo ADMIN não pode ser alterada pelo revendedor';
end $$;
commit;

-- ===================== Redirect e origem (qr / nfc) =====================
do $$
declare r record; before public.plates%rowtype; after public.plates%rowtype;
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'plates' and column_name like 'nfc%') then
    raise exception 'FALHA: ainda existem colunas de controle de NFC em plates';
  end if;

  select * into before from public.plates where public_code = 'OPS001';
  set local role anon;
  select * into r from public.resolve_plate_redirect('OPS001', 'nfc');
  if r.outcome <> 'ok' or r.target_url <> 'https://wa.me/5511999999999' then raise exception 'FALHA: src=nfc deveria seguir para o destino (%)', r.outcome; end if;
  select * into r from public.resolve_plate_redirect('OPS001', 'qr');
  select * into r from public.resolve_plate_redirect('OPS001', 'qualquer');
  if r.outcome <> 'ok' then raise exception 'FALHA: src desconhecido'; end if;
  reset role;
  select * into after from public.plates where public_code = 'OPS001';
  if after.status <> before.status or after.destination_url <> before.destination_url
     or after.customer_id <> before.customer_id or after.updated_at <> before.updated_at then
    raise exception 'FALHA: o acesso alterou a placa';
  end if;
  if (select array_agg(r2.source order by r2.id) from public.redirects r2 where r2.plate_id = after.id) <> array['nfc', 'qr', 'unknown']
    then raise exception 'FALHA: redirects.source'; end if;
  if after.access_count <> 3 then raise exception 'FALHA: access_count'; end if;

  set local role anon;
  select * into r from public.resolve_plate_redirect('OPS002', 'qr');
  if r.outcome <> 'unconfigured' then raise exception 'FALHA: placa não ativada deveria ser unconfigured'; end if;
  select * into r from public.resolve_plate_redirect('OPS003', 'nfc');
  if r.outcome <> 'blocked' then raise exception 'FALHA: bloqueada'; end if;
  reset role;
  raise notice 'OK N1: src=nfc/qr/unknown só registram redirects.source e seguem ao destino; a placa não é alterada';
end $$;

-- ===================== Ativação automática e regra de redirect =====================
begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-0000-0000-0000000000b1';
do $$
declare p record; plate uuid := (select id from public.plates where public_code = 'OPS004');
begin
  if (select status from public.plates where id = plate) <> 'assigned' then raise exception 'FALHA: pré-condição assigned'; end if;
  select * into p from public.configure_reseller_plate(plate, '30000000-0000-0000-0000-000000000001', 'google_review', 'https://g.page/r/revenda-um', null);
  if p.status <> 'active' then raise exception 'FALHA: ASSIGNED + configuração válida deveria virar ACTIVE (veio %)', p.status; end if;
  raise notice 'OK F1: ASSIGNED + configuração válida → ACTIVE automaticamente';

  select * into p from public.configure_reseller_plate(plate, '30000000-0000-0000-0000-000000000001', 'google_review', 'https://g.page/r/revenda-um', 'inactive');
  if p.status <> 'inactive' then raise exception 'FALHA: ACTIVE → INACTIVE'; end if;
  select * into p from public.configure_reseller_plate(plate, null, 'website', 'https://revenda-um.com.br', null);
  if p.status <> 'inactive' then raise exception 'FALHA: salvar placa inativa não deve reativá-la'; end if;
  begin
    perform * from public.configure_reseller_plate((select id from public.plates where public_code = 'OPS005'), null, null, null, 'inactive');
    raise exception 'FALHA: desativou placa sem destino';
  exception when invalid_parameter_value then null; end;
  raise notice 'OK F2: ACTIVE ↔ INACTIVE controlado; salvar não reativa placa inativa';
end $$;
commit;

do $$
declare r record;
begin
  set local role anon;
  select * into r from public.resolve_plate_redirect('OPS004', 'qr');
  if r.outcome <> 'inactive' or r.target_url is not null then raise exception 'FALHA: INACTIVE redirecionou'; end if;
  reset role;
  raise notice 'OK F3: INACTIVE não redireciona';
end $$;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-0000-0000-0000000000b1';
do $$
declare p record; r record; n int;
begin
  select * into p from public.configure_reseller_plate((select id from public.plates where public_code = 'OPS004'), null, 'website', 'https://revenda-um.com.br', 'active');
  set local role anon;
  select * into r from public.resolve_plate_redirect('OPS004', 'qr');
  if r.outcome <> 'ok' or r.target_url <> 'https://revenda-um.com.br' then raise exception 'FALHA: ACTIVE deveria redirecionar'; end if;
  select * into r from public.resolve_plate_redirect('OPS005', 'qr');
  if r.outcome <> 'unconfigured' then raise exception 'FALHA: ASSIGNED não configurada redirecionou'; end if;
  select * into r from public.resolve_plate_redirect('OPS003', 'qr');
  if r.outcome <> 'blocked' or r.target_url is not null then raise exception 'FALHA: BLOCKED redirecionou'; end if;
  set local role authenticated;
  raise notice 'OK F4: ACTIVE redireciona; ASSIGNED sem configuração e BLOCKED não';

  begin
    perform * from public.configure_reseller_plate((select id from public.plates where public_code = 'OPS003'), null, 'website', 'https://exemplo.com.br', 'active');
    raise exception 'FALHA: revendedor desbloqueou placa BLOCKED';
  exception when sqlstate '55000' then null; end;
  update public.plates set status = 'active' where public_code = 'OPS003';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FALHA: UPDATE direto desbloqueou'; end if;
  raise notice 'OK F5: RESELLER não consegue desbloquear BLOCKED (nem pela RPC nem por UPDATE)';

  select count(*) into n from public.plates where public_code in ('OPS011', 'OPS012');
  if n <> 0 then raise exception 'FALHA: revendedor enxerga placas de outro'; end if;
  begin
    perform * from public.configure_reseller_plate((select id from public.plates where public_code = 'OPS011'), null, 'website', 'https://exemplo.com.br', null);
    raise exception 'FALHA: revendedor configurou placa de outro';
  exception when sqlstate 'P0002' then null; end;
  raise notice 'OK F6: RESELLER não vê nem acessa placa de outro revendedor';
end $$;
commit;
update public.plates set status = 'blocked' where public_code = 'OPS003' and status <> 'blocked';
do $$ begin
  if (select status from public.plates where public_code = 'OPS003') <> 'blocked' then raise exception 'FALHA: OPS003 deveria seguir bloqueada'; end if;
end $$;

-- ===================== ADMIN: troca e retirada de revendedor =====================
begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-0000-0000-00000000000a';
do $$
declare p record; plate uuid := (select id from public.plates where public_code = 'OPS001');
begin
  select * into p from public.set_plate_reseller(plate, '20000000-0000-0000-0000-000000000002');
  if p.reseller_id <> '20000000-0000-0000-0000-000000000002' or p.customer_id is not null or p.destination_url is not null or p.status <> 'assigned'
    then raise exception 'FALHA: troca de revendedor'; end if;
  select * into p from public.set_plate_reseller(plate, null);
  if p.reseller_id is not null or p.status <> 'in_stock' then raise exception 'FALHA: retirada de revendedor'; end if;
  if (select count(*) from public.plate_assignments where plate_id = plate) <> 2
     or (select count(*) from public.plate_assignments where plate_id = plate and unassigned_at is null) <> 0
    then raise exception 'FALHA: histórico da placa'; end if;
  raise notice 'OK T1: trocar e retirar revendedor zera a configuração e preserva o histórico';

  update public.plates set reseller_id = '20000000-0000-0000-0000-000000000001', status = 'assigned' where id = plate;
  if (select count(*) from public.plate_assignments where plate_id = plate) <> 3 then raise exception 'FALHA: UPDATE manual sem histórico'; end if;
  begin
    update public.plates set customer_id = '30000000-0000-0000-0000-000000000002' where id = plate;
    raise exception 'FALHA: ADMIN vinculou cliente de outro revendedor';
  exception when invalid_parameter_value then null; end;
  begin
    update public.plates set status = 'active' where id = plate;
    raise exception 'FALHA: ativou sem destino';
  exception when check_violation then null; end;
  raise notice 'OK T2: até UPDATE manual gera histórico; cliente e ativação são validados no banco';
end $$;
commit;

-- ===================== Vendas e métricas =====================
begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-0000-0000-00000000000a';
do $$
declare o1 uuid; o2 uuid; o3 uuid; o record; m jsonb; s numeric; t record;
begin
  o1 := public.create_order('20000000-0000-0000-0000-000000000001', 50, 25.00, 100.00, 'Primeira venda', 'paid');
  select * into o from public.orders where id = o1;
  if o.subtotal <> 1250 or o.discount <> 100 or o.total <> 1150 or o.status <> 'paid' or o.paid_at is null
    then raise exception 'FALHA: totais da venda (% / % / %)', o.subtotal, o.discount, o.total; end if;
  raise notice 'OK O1: 50 × R$ 25,00 − R$ 100,00 = R$ 1.150,00';

  begin perform public.create_order('20000000-0000-0000-0000-000000000001', 10, 10, 200);
    raise exception 'FALHA: desconto maior que o subtotal'; exception when invalid_parameter_value then null; end;
  begin insert into public.order_items (order_id, description, quantity, unit_price, total) values (o1, 'extra', 1, 1, 1);
    raise exception 'FALHA: item em pedido pago'; exception when sqlstate '55000' then null; end;
  raise notice 'OK O2: desconto e itens de pedido pago validados';

  o2 := public.create_order('20000000-0000-0000-0000-000000000002', 10, 30);
  perform * from public.set_order_status(o2, 'paid');
  begin perform * from public.set_order_status(o2, 'pending');
    raise exception 'FALHA: voltou de pago para pendente'; exception when sqlstate '55000' then null; end;
  o3 := public.create_order('20000000-0000-0000-0000-000000000001', 100, 1, 0, null, 'paid');
  perform * from public.set_order_status(o3, 'cancelled');
  raise notice 'OK O3: transições de status controladas';

  m := public.admin_dashboard_metrics(now() - interval '1 day', now() + interval '1 day');
  if (m->>'revenue')::numeric <> 1450 or (m->>'sales')::int <> 2 or (m->>'plates_sold')::int <> 60
    then raise exception 'FALHA: métricas de vendas %', m; end if;
  if (m->>'resellers_active')::int < 2 then raise exception 'FALHA: revendedores ativos'; end if;
  select sum(revenue) into s from public.admin_revenue_series(now() - interval '1 day', now() + interval '1 day', 'day');
  if s <> 1450 then raise exception 'FALHA: série de faturamento (%)', s; end if;
  select * into t from public.admin_top_resellers(now() - interval '1 day', now() + interval '1 day', 5) limit 1;
  if t.company_name <> 'Revenda Um' or t.revenue <> 1150 or t.plates <> 50 then raise exception 'FALHA: maiores revendedores'; end if;
  select * into t from public.admin_reseller_stats('20000000-0000-0000-0000-000000000001');
  if t.plates_total <> 10 or t.customers <> 2 then raise exception 'FALHA: stats do revendedor (% placas, % clientes)', t.plates_total, t.customers; end if;
  raise notice 'OK O4: faturamento só de pagos, placas vendidas, série, ranking e stats vêm do banco';
end $$;
commit;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-0000-0000-0000000000b1';
do $$ declare n int; begin
  select count(*) into n from public.orders;
  if n <> 2 then raise exception 'FALHA: revendedor deveria ver só os 2 pedidos dele, viu %', n; end if;
  insert into public.orders (reseller_id, status) values ('20000000-0000-0000-0000-000000000001', 'paid');
  raise exception 'FALHA: revendedor inseriu pedido';
exception when insufficient_privilege then
  raise notice 'OK O5: revendedor só lê os próprios pedidos e não cria vendas';
end $$;
commit;
