-- Testes do financeiro PRIVADO do revendedor (migration 014).
-- Rodar num banco de TESTE, depois das migrations. Ids próprios, independente
-- dos outros arquivos. Cada bloco lança "FALHA: ..." se a regra não valer.
\set ON_ERROR_STOP 1

insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-00000000000a', 'rs-admin@teste.com'),
  ('a0000000-0000-0000-0000-0000000000b1', 'rs-r1@teste.com'),
  ('a0000000-0000-0000-0000-0000000000b2', 'rs-r2@teste.com');
update public.profiles set role = 'admin' where email = 'rs-admin@teste.com';
insert into public.reseller_profiles (id, user_id, company_name) values
  ('a1000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000b1', 'Revenda A'),
  ('a1000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-0000000000b2', 'Revenda B');
insert into public.customers (id, reseller_id, name) values
  ('a2000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'Cliente do A'),
  ('a2000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000002', 'Cliente do B');

insert into public.plate_batches (id, name, quantity) values
  ('a3000000-0000-0000-0000-000000000001', 'Lote Revenda', 12);
insert into public.plates (public_code, batch_id)
select 'RSA' || lpad(g::text, 2, '0'), 'a3000000-0000-0000-0000-000000000001' from generate_series(1, 12) g;

-- 8 placas para A, 2 para B (pelo fluxo real do ADMIN).
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-00000000000a';
select public.create_sale_with_plates('a1000000-0000-0000-0000-000000000001', 8, 20, 0, 'estoque A',
  'paid', 'automatic', null, 'a3000000-0000-0000-0000-000000000001', gen_random_uuid());
select public.create_sale_with_plates('a1000000-0000-0000-0000-000000000002', 2, 20, 0, 'estoque B',
  'paid', 'automatic', null, 'a3000000-0000-0000-0000-000000000001', gen_random_uuid());
commit;

create table public.rs_ids (name text primary key, id uuid not null);
grant select, insert on public.rs_ids to authenticated;

-- ===================== R1: revendedor A registra venda =====================
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-0000000000b1';
insert into public.rs_ids (name, id)
select 'venda1', public.create_reseller_sale(
  (select array_agg(plate_id) from (select plate_id from public.reseller_sellable_plates(null, 2) limit 2) s),
  300.00, 'a2000000-0000-0000-0000-000000000001', 'paid', current_date, 'primeira venda', gen_random_uuid());
commit;

do $$
declare v public.reseller_sales%rowtype;
begin
  select s.* into v from public.reseller_sales s
  where s.id = (select id from public.rs_ids where name = 'venda1');
  if v.reseller_id <> 'a1000000-0000-0000-0000-000000000001' then raise exception 'FALHA R1: revendedor errado'; end if;
  if v.total <> 300.00 or v.status <> 'paid' then raise exception 'FALHA R1: dados da venda incorretos'; end if;
  if (select count(*) from public.reseller_sale_items where sale_id = v.id) <> 2 then
    raise exception 'FALHA R1: itens não gravados';
  end if;
  raise notice 'OK R1: revendedor registra venda com cliente, valor, status e placas';
end $$;

-- ===================== R2: registrar venda NÃO ativa a placa =====================
do $$
begin
  if exists (
    select 1 from public.reseller_sale_items i
    join public.plates p on p.id = i.plate_id
    where i.sale_id = (select id from public.rs_ids where name = 'venda1') and p.status <> 'assigned'
  ) then raise exception 'FALHA R2: a venda alterou o status da placa'; end if;
  if exists (
    select 1 from public.reseller_sale_items i
    join public.plates p on p.id = i.plate_id
    where i.sale_id = (select id from public.rs_ids where name = 'venda1') and p.destination_url is not null
  ) then raise exception 'FALHA R2: a venda configurou destino'; end if;
  raise notice 'OK R2: registrar venda não ativa a placa nem define destino';
end $$;

-- ===================== R3: a mesma placa não entra em duas vendas =====================
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-0000000000b1';
do $$
declare v_plate uuid;
begin
  select i.plate_id into v_plate from public.reseller_sale_items i
  where i.sale_id = (select id from public.rs_ids where name = 'venda1') limit 1;
  begin
    perform public.create_reseller_sale(array[v_plate], 100, null, 'pending', null, null, gen_random_uuid());
    raise exception 'FALHA R3: placa entrou em duas vendas finais';
  exception when sqlstate '55000' then null;
  end;
  raise notice 'OK R3: a mesma placa não entra em duas vendas finais ativas';
end $$;
commit;

-- ===================== R4: A não usa placa de B =====================
-- O id vem de fora da sessão do revendedor: com a RLS ligada, o A nem
-- enxergaria a placa do B para tentar usá-la.
select set_config('test.plate_of_b', (
  select p.id::text from public.plates p
  where p.reseller_id = 'a1000000-0000-0000-0000-000000000002' order by p.public_code limit 1
), false) as plate_of_b;

begin;
set local role authenticated;
set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-0000000000b1';
do $$
declare v_plate uuid := current_setting('test.plate_of_b')::uuid;
begin
  begin
    perform public.create_reseller_sale(array[v_plate], 100, null, 'pending', null, null, gen_random_uuid());
    raise exception 'FALHA R4: revendedor A vendeu placa do B';
  exception when sqlstate '55000' then null;
  end;
  if exists (select 1 from public.reseller_sellable_plates(null, 500) where plate_id = v_plate) then
    raise exception 'FALHA R4: placa do B apareceu como elegível para o A';
  end if;
  raise notice 'OK R4: revendedor A não usa nem enxerga placa do revendedor B';
end $$;
commit;

-- ===================== R5: cliente de outro revendedor é recusado =====================
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-0000000000b1';
do $$
declare v_plate uuid;
begin
  select plate_id into v_plate from public.reseller_sellable_plates(null, 1) limit 1;
  begin
    perform public.create_reseller_sale(array[v_plate], 100, 'a2000000-0000-0000-0000-000000000002',
      'pending', null, null, gen_random_uuid());
    raise exception 'FALHA R5: usou cliente de outro revendedor';
  exception when sqlstate '42501' then null;
  end;
  raise notice 'OK R5: cliente de outro revendedor é recusado (42501)';
end $$;
commit;

-- ===================== R6: A não enxerga venda de B =====================
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-0000000000b2';
insert into public.rs_ids (name, id)
select 'vendaB', public.create_reseller_sale(
  (select array_agg(plate_id) from (select plate_id from public.reseller_sellable_plates(null, 1) limit 1) s),
  999.00, null, 'paid', current_date, 'venda do B', gen_random_uuid());
commit;

begin;
set local role authenticated;
set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-0000000000b1';
do $$
begin
  if exists (select 1 from public.reseller_sales where id = (select id from public.rs_ids where name = 'vendaB')) then
    raise exception 'FALHA R6: A enxergou a venda do B';
  end if;
  if exists (select 1 from public.reseller_sales_list(null, 200, 0)
             where sale_id = (select id from public.rs_ids where name = 'vendaB')) then
    raise exception 'FALHA R6: a listagem do A trouxe venda do B';
  end if;
  if exists (select 1 from public.reseller_sale_plates((select id from public.rs_ids where name = 'vendaB'))) then
    raise exception 'FALHA R6: A leu as placas da venda do B';
  end if;
  raise notice 'OK R6: revendedor só enxerga as próprias vendas (RLS + RPC)';
end $$;
commit;

-- ===================== R7: PRIVACIDADE — o ADMIN não acessa =====================
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-00000000000a';
do $$
declare v_count bigint;
begin
  if not public.is_admin() then raise exception 'FALHA R7: o usuário de teste deveria ser ADMIN'; end if;
  select count(*) into v_count from public.reseller_sales;
  if v_count <> 0 then raise exception 'FALHA R7: o ADMIN leu % venda(s) do revendedor', v_count; end if;
  select count(*) into v_count from public.reseller_sale_items;
  if v_count <> 0 then raise exception 'FALHA R7: o ADMIN leu itens de venda do revendedor'; end if;
  select count(*) into v_count from public.reseller_sales_list(null, 200, 0);
  if v_count <> 0 then raise exception 'FALHA R7: a RPC de listagem devolveu dados para o ADMIN'; end if;
  raise notice 'OK R7: o ADMIN da aplicação não lê reseller_sales nem reseller_sale_items';
end $$;
commit;

-- ===================== R7b: nem o service_role lê =====================
do $$
begin
  if has_table_privilege('service_role', 'public.reseller_sales', 'SELECT') then
    raise exception 'FALHA R7b: service_role ainda tem SELECT em reseller_sales';
  end if;
  if has_table_privilege('service_role', 'public.reseller_sale_items', 'SELECT') then
    raise exception 'FALHA R7b: service_role ainda tem SELECT em reseller_sale_items';
  end if;
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename in ('reseller_sales', 'reseller_sale_items')
      and qual like '%is_admin%'
  ) then raise exception 'FALHA R7b: existe policy baseada em is_admin() nas tabelas financeiras'; end if;
  raise notice 'OK R7b: nem service_role tem privilégio, e não há policy de is_admin() — a privacidade não depende do código da aplicação';
end $$;

-- ===================== R8: métricas — pending fora, paid dentro =====================
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-0000000000b1';
insert into public.rs_ids (name, id)
select 'venda2', public.create_reseller_sale(
  (select array_agg(plate_id) from (select plate_id from public.reseller_sellable_plates(null, 1) limit 1) s),
  500.00, null, 'pending', current_date, 'pendente', gen_random_uuid());
do $$
declare m jsonb;
begin
  select public.reseller_sales_metrics(null) into m;
  if (m->>'revenue')::numeric <> 300.00 then
    raise exception 'FALHA R8: pendente entrou no faturamento (%)', m->>'revenue';
  end if;
  if (m->>'sales')::bigint <> 1 then raise exception 'FALHA R8: contagem de vendas pagas errada'; end if;
  if (m->>'plates')::bigint <> 2 then raise exception 'FALHA R8: contagem de placas vendidas errada'; end if;
  if (m->>'average_ticket')::numeric <> 300.00 then raise exception 'FALHA R8: ticket médio errado'; end if;
  raise notice 'OK R8: pending fica fora do faturamento; paid entra; ticket médio correto';
end $$;
commit;

-- ===================== R9: paid vira cancelled e sai dos indicadores =====================
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-0000000000b1';
select public.set_reseller_sale_status((select id from public.rs_ids where name = 'venda2'), 'paid');
do $$
declare m jsonb;
begin
  select public.reseller_sales_metrics(null) into m;
  if (m->>'revenue')::numeric <> 800.00 then raise exception 'FALHA R9: paid não entrou (%)', m->>'revenue'; end if;
  if (m->>'average_ticket')::numeric <> 400.00 then raise exception 'FALHA R9: ticket médio após 2 vendas'; end if;
end $$;
select public.set_reseller_sale_status((select id from public.rs_ids where name = 'venda2'), 'cancelled');
do $$
declare m jsonb;
begin
  select public.reseller_sales_metrics(null) into m;
  if (m->>'revenue')::numeric <> 300.00 then
    raise exception 'FALHA R9: venda paga cancelada continuou no faturamento (%)', m->>'revenue';
  end if;
  if (m->>'average_ticket')::numeric <> 300.00 then raise exception 'FALHA R9: ticket médio não recalculou'; end if;
  raise notice 'OK R9: venda paga cancelada sai dos indicadores e o ticket médio recalcula';
end $$;
commit;

-- ===================== R10: cancelar libera a placa, sem tocar na operação =====================
do $$
declare v_plate uuid; v_status text; v_reseller uuid;
begin
  select i.plate_id into v_plate from public.reseller_sale_items i
  where i.sale_id = (select id from public.rs_ids where name = 'venda2') limit 1;
  select p.status, p.reseller_id into v_status, v_reseller from public.plates p where p.id = v_plate;
  if v_status <> 'assigned' then raise exception 'FALHA R10: o cancelamento mudou o status da placa (%)', v_status; end if;
  if v_reseller <> 'a1000000-0000-0000-0000-000000000001' then
    raise exception 'FALHA R10: o cancelamento devolveu a placa ao estoque do ADMIN';
  end if;
  if (select cancelled_at from public.reseller_sale_items where sale_id = (select id from public.rs_ids where name = 'venda2') limit 1) is null then
    raise exception 'FALHA R10: item não foi marcado como cancelado';
  end if;
  raise notice 'OK R10: cancelar não devolve placa ao estoque do ADMIN nem muda revendedor/status';
end $$;

begin;
set local role authenticated;
set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-0000000000b1';
do $$
declare v_plate uuid;
begin
  select i.plate_id into v_plate from public.reseller_sale_items i
  where i.sale_id = (select id from public.rs_ids where name = 'venda2') limit 1;
  if not exists (select 1 from public.reseller_sellable_plates(null, 500) where plate_id = v_plate) then
    raise exception 'FALHA R10b: placa de venda cancelada não voltou a ser elegível';
  end if;
  perform public.create_reseller_sale(array[v_plate], 150, null, 'pending', null, 'revenda', gen_random_uuid());
  raise notice 'OK R10b: placa de venda cancelada volta a ser elegível para nova venda do mesmo revendedor';
end $$;
commit;

-- ===================== R11: placa ATIVA — cancelar não reverte nada =====================
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-0000000000b1';
insert into public.rs_ids (name, id)
select 'venda3', public.create_reseller_sale(
  (select array_agg(plate_id) from (select plate_id from public.reseller_sellable_plates(null, 1) limit 1) s),
  250.00, null, 'paid', current_date, 'vai ativar', gen_random_uuid());
commit;

-- Ativação continua funcionando depois da venda registrada (fluxo real).
do $$
declare v_plate uuid;
begin
  select i.plate_id into v_plate from public.reseller_sale_items i
  where i.sale_id = (select id from public.rs_ids where name = 'venda3') limit 1;
  update public.plates set destination_type = 'website', destination_url = 'https://cliente-final.com',
    customer_id = 'a2000000-0000-0000-0000-000000000001', status = 'active'
  where id = v_plate;
  if (select status from public.plates where id = v_plate) <> 'active' then
    raise exception 'FALHA R11: a ativação posterior parou de funcionar';
  end if;
  raise notice 'OK R11: registrar a venda não impede a ativação posterior da placa';
end $$;

begin;
set local role authenticated;
set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-0000000000b1';
select public.set_reseller_sale_status((select id from public.rs_ids where name = 'venda3'), 'cancelled');
commit;

do $$
declare v_plate uuid; p public.plates%rowtype;
begin
  select i.plate_id into v_plate from public.reseller_sale_items i
  where i.sale_id = (select id from public.rs_ids where name = 'venda3') limit 1;
  select * into p from public.plates where id = v_plate;
  if p.status <> 'active' then raise exception 'FALHA R11b: cancelar reverteu a ativação (%)', p.status; end if;
  if p.destination_url is null then raise exception 'FALHA R11b: cancelar apagou o destino'; end if;
  if p.reseller_id is null then raise exception 'FALHA R11b: cancelar devolveu a placa ao estoque'; end if;
  if p.customer_id is null then raise exception 'FALHA R11b: cancelar desvinculou o cliente'; end if;
  raise notice 'OK R11b: com a placa ATIVA, cancelar o financeiro não reverte ativação, destino, cliente nem revendedor';
end $$;

-- ===================== R12: venda cancelada é final =====================
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-0000000000b1';
do $$
begin
  begin
    perform public.set_reseller_sale_status((select id from public.rs_ids where name = 'venda3'), 'paid');
    raise exception 'FALHA R12: venda cancelada foi reaberta';
  exception when sqlstate '55000' then null;
  end;
  raise notice 'OK R12: venda cancelada não pode ser reaberta';
end $$;
commit;

-- ===================== R13: A não altera venda de B =====================
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-0000000000b1';
do $$
begin
  begin
    perform public.set_reseller_sale_status((select id from public.rs_ids where name = 'vendaB'), 'cancelled');
    raise exception 'FALHA R13: A alterou venda do B';
  exception when sqlstate 'P0002' then null;
  end;
  raise notice 'OK R13: revendedor A não altera venda do revendedor B';
end $$;
commit;

-- ===================== R14: sem vendas, ticket médio = 0 =====================
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-0000000000b2';
do $$
declare m jsonb;
begin
  select public.reseller_sales_metrics((current_date - interval '6 months')::date) into m;
  if (m->>'sales')::bigint <> 0 then raise exception 'FALHA R14: deveria não haver vendas no período'; end if;
  if (m->>'average_ticket')::numeric <> 0 then
    raise exception 'FALHA R14: ticket médio sem vendas deveria ser 0 (%)', m->>'average_ticket';
  end if;
  if (m->>'revenue')::numeric <> 0 then raise exception 'FALHA R14: faturamento sem vendas deveria ser 0'; end if;
  raise notice 'OK R14: sem vendas no período, faturamento e ticket médio são zero (sem divisão por zero)';
end $$;
commit;

-- ===================== R15: idempotência =====================
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-0000000000b1';
do $$
declare v_key uuid := gen_random_uuid(); v_a uuid; v_b uuid; v_plate uuid;
begin
  select plate_id into v_plate from public.reseller_sellable_plates(null, 1) limit 1;
  if v_plate is null then raise notice 'OK R15: (sem placa elegível para o teste de idempotência)'; return; end if;
  v_a := public.create_reseller_sale(array[v_plate], 90, null, 'pending', null, null, v_key);
  v_b := public.create_reseller_sale(array[v_plate], 90, null, 'pending', null, null, v_key);
  if v_a <> v_b then raise exception 'FALHA R15: request repetida criou duas vendas'; end if;
  if (select count(*) from public.reseller_sale_items where plate_id = v_plate and cancelled_at is null) <> 1 then
    raise exception 'FALHA R15: placa vinculada duas vezes';
  end if;
  raise notice 'OK R15: request repetida devolve a mesma venda (idempotência)';
end $$;
commit;

-- ===================== R16: o financeiro do ADMIN não mudou =====================
do $$
declare v_admin_revenue numeric;
begin
  select coalesce(sum(o.total), 0) into v_admin_revenue from public.orders o where o.status = 'paid';
  if v_admin_revenue <= 0 then raise exception 'FALHA R16: o faturamento do ADMIN sumiu'; end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'orders' and column_name like '%reseller_sale%'
  ) then raise exception 'FALHA R16: orders foi contaminado pelo módulo do revendedor'; end if;
  raise notice 'OK R16: o faturamento do ADMIN continua sendo só orders, intacto';
end $$;

-- ===================== R17: histórico de itens é append-only =====================
do $$
begin
  begin
    delete from public.reseller_sale_items where id = (select id from public.reseller_sale_items limit 1);
    raise exception 'FALHA R17: item de venda foi apagado';
  exception when sqlstate '55000' then null;
  end;
  raise notice 'OK R17: itens de venda do revendedor não podem ser apagados';
end $$;
