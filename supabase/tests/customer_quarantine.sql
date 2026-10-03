-- Testes do nome de exibição e da quarentena de clientes (migration 018).
-- Rodar num banco de TESTE, depois das migrations. Independente dos outros
-- arquivos (ids e lotes próprios).
\set ON_ERROR_STOP 1

insert into auth.users (id, email) values
  ('e1000000-0000-0000-0000-00000000000a', 'kq-admin@teste.com'),
  ('e1000000-0000-0000-0000-0000000000b1', 'kq-r1@teste.com'),
  ('e1000000-0000-0000-0000-0000000000b2', 'kq-r2@teste.com');
update public.profiles set role = 'admin' where email = 'kq-admin@teste.com';
insert into public.reseller_profiles (id, user_id, company_name) values
  ('e1100000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-0000000000b1', 'Jorge LTDA'),
  ('e1100000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-0000000000b2', 'Outra Revenda');
insert into public.customers (id, reseller_id, name, company_name) values
  ('e1200000-0000-0000-0000-000000000001', 'e1100000-0000-0000-0000-000000000001', 'João da Silva', 'Adega Monster'),
  ('e1200000-0000-0000-0000-000000000002', 'e1100000-0000-0000-0000-000000000001', 'Ana Beatriz', null),
  ('e1200000-0000-0000-0000-000000000003', 'e1100000-0000-0000-0000-000000000001', 'Bia', '   '),
  ('e1200000-0000-0000-0000-000000000009', 'e1100000-0000-0000-0000-000000000002', 'Cliente do R2', 'Bar do R2');
insert into public.plate_batches (id, name, quantity) values ('e1300000-0000-0000-0000-000000000001', 'Lote Quarentena', 8);
insert into public.plates (public_code, batch_id, reseller_id, status)
select 'KQA' || lpad(g::text, 3, '0'), 'e1300000-0000-0000-0000-000000000001', 'e1100000-0000-0000-0000-000000000001', 'assigned'
from generate_series(1, 8) g;
create function pg_temp.plate(p_code text) returns uuid language sql as $$ select id from public.plates where public_code = p_code $$;
create table public.kq_ids (name text primary key, id uuid not null);
grant select, insert on public.kq_ids to authenticated;

-- ===================== K1: regra do nome de exibição =====================
do $$ begin
  if public.customer_display_name('João da Silva', 'Adega Monster') <> 'Adega Monster' then raise exception 'FALHA K1: empresa não é o nome principal'; end if;
  if public.customer_display_name('Ana Beatriz', null) <> 'Ana Beatriz' then raise exception 'FALHA K1: sem empresa deveria usar o nome'; end if;
  if public.customer_display_name('Bia', '   ') <> 'Bia' then raise exception 'FALHA K1: empresa em branco deveria usar o nome'; end if;
  if public.customer_display_name('  Rui  ', '  Padaria Pão  ') <> 'Padaria Pão' then raise exception 'FALHA K1: espaços nas bordas'; end if;
  if (select name from public.customers where id = 'e1200000-0000-0000-0000-000000000001') <> 'João da Silva'
    then raise exception 'FALHA K1: o dado do cliente foi alterado'; end if;
  raise notice 'OK K1: empresa preenchida vira o nome principal; empresa vazia usa o nome; nada é gravado no cadastro';
end $$;

-- ===================== K2: telas operacionais mostram a empresa =====================
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'e1000000-0000-0000-0000-0000000000b1';
do $$
declare v_sale uuid;
begin
  v_sale := public.create_reseller_sale(array[pg_temp.plate('KQA001')], 100, 'e1200000-0000-0000-0000-000000000001', 'paid', null, null, gen_random_uuid());
  insert into public.kq_ids values ('venda_adega', v_sale);
  if (select customer_name from public.reseller_sales_list(null, 50, 0) where sale_id = v_sale) <> 'Adega Monster'
    then raise exception 'FALHA K2: lista de vendas não mostra a empresa'; end if;
  if (select customer_name from public.reseller_sale_plate_setup(v_sale)) <> 'Adega Monster'
    then raise exception 'FALHA K2: detalhe da venda não mostra a empresa'; end if;
  raise notice 'OK K2: lista e detalhe da venda mostram a empresa como nome do cliente';
end $$;
commit;

-- ===================== K3: busca por pessoa e por empresa =====================
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'e1000000-0000-0000-0000-0000000000b1';
do $$ begin
  -- Mesmo filtro que a aplicação usa (name OU company_name).
  if (select count(*) from public.customers where name ilike '%joão%' or company_name ilike '%joão%') <> 1
     or (select count(*) from public.customers where name ilike '%monster%' or company_name ilike '%monster%') <> 1
    then raise exception 'FALHA K3: busca por pessoa ou empresa'; end if;
  raise notice 'OK K3: a busca encontra o cliente tanto pelo responsável quanto pela empresa';
end $$;
commit;

-- ===================== K4: quarentena tira das listas e das novas vendas =====================
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'e1000000-0000-0000-0000-0000000000b1';
do $$
declare c public.customers%rowtype; msg text;
begin
  if not exists (select 1 from public.customers where id = 'e1200000-0000-0000-0000-000000000002' and archived_at is null)
    then raise exception 'FALHA K4: cliente ativo não aparece na lista de ativos'; end if;

  select * into c from public.quarantine_customer('e1200000-0000-0000-0000-000000000002', 'Fechou a loja');
  if c.archived_at is null or c.archived_by <> 'e1000000-0000-0000-0000-0000000000b1' or c.archive_reason <> 'Fechou a loja'
    then raise exception 'FALHA K4: quarentena não registrada: %', c; end if;
  if exists (select 1 from public.customers where id = c.id and archived_at is null)
    then raise exception 'FALHA K4: cliente em quarentena continua na lista de ativos'; end if;

  begin
    perform public.create_reseller_sale(array[pg_temp.plate('KQA002')], 50, c.id, 'pending', null, null, gen_random_uuid());
    raise exception 'FALHA K4: vendeu para cliente em quarentena';
  exception when sqlstate '55000' then get stacked diagnostics msg = message_text; end;
  if msg not like 'O cliente "Ana Beatriz" está em quarentena%' then raise exception 'FALHA K4: mensagem "%"', msg; end if;

  begin
    perform public.configure_reseller_plate(pg_temp.plate('KQA002'), c.id, null, null, null);
    raise exception 'FALHA K4: atribuiu placa a cliente em quarentena';
  exception when sqlstate '55000' then null; end;
  if (select customer_id from public.plates where public_code = 'KQA002') is not null then raise exception 'FALHA K4: placa recebeu o cliente'; end if;
  raise notice 'OK K4: cliente em quarentena sai da lista de ativos e não entra em nova venda nem em nova atribuição de placa';
end $$;
commit;

-- ===================== K5: histórico continua intacto =====================
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'e1000000-0000-0000-0000-0000000000b1';
do $$
declare v_sale uuid := (select id from public.kq_ids where name = 'venda_adega'); p record;
begin
  perform public.quarantine_customer('e1200000-0000-0000-0000-000000000001', null);
  if (select customer_name from public.reseller_sales_list(null, 50, 0) where sale_id = v_sale) <> 'Adega Monster'
    then raise exception 'FALHA K5: venda histórica perdeu o cliente'; end if;
  if (select customer_id from public.plates where public_code = 'KQA001') <> 'e1200000-0000-0000-0000-000000000001'
    then raise exception 'FALHA K5: a placa perdeu o cliente'; end if;
  if (select total from public.reseller_sales where id = v_sale) <> 100 then raise exception 'FALHA K5: financeiro alterado'; end if;
  -- A placa que já é dele continua configurável sem trocar o cliente.
  select * into p from public.configure_reseller_plate(pg_temp.plate('KQA001'), 'e1200000-0000-0000-0000-000000000001', 'website', 'https://adega.com.br', null);
  if p.status <> 'active' then raise exception 'FALHA K5: placa do cliente em quarentena não pôde ser configurada'; end if;
  raise notice 'OK K5: em quarentena, o cliente continua nas vendas e placas onde já foi usado, e essas placas seguem configuráveis';
end $$;
commit;

-- ===================== K6: restaurar devolve às listas e às vendas =====================
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'e1000000-0000-0000-0000-0000000000b1';
do $$
declare c public.customers%rowtype;
begin
  select * into c from public.restore_customer('e1200000-0000-0000-0000-000000000002');
  if c.archived_at is not null or c.archived_by is not null or c.archive_reason is not null then raise exception 'FALHA K6: não restaurou'; end if;
  perform public.create_reseller_sale(array[pg_temp.plate('KQA002')], 50, c.id, 'pending', null, null, gen_random_uuid());
  if (select customer_id from public.plates where public_code = 'KQA002') <> c.id then raise exception 'FALHA K6: venda após restaurar'; end if;
  raise notice 'OK K6: restaurar (quarentena → ativo) devolve o cliente à lista e às novas vendas';
end $$;
commit;

-- ===================== K7: revendedor B não mexe em cliente do A =====================
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'e1000000-0000-0000-0000-0000000000b2';
do $$ begin
  begin perform public.quarantine_customer('e1200000-0000-0000-0000-000000000003', 'invasão');
    raise exception 'FALHA K7: B arquivou cliente do A'; exception when no_data_found then null; end;
  begin perform public.restore_customer('e1200000-0000-0000-0000-000000000001');
    raise exception 'FALHA K7: B restaurou cliente do A'; exception when no_data_found then null; end;
  if exists (select 1 from public.customers where reseller_id = 'e1100000-0000-0000-0000-000000000001')
    then raise exception 'FALHA K7: B enxerga clientes do A'; end if;
  raise notice 'OK K7: revendedor B não arquiva, não restaura e não enxerga clientes do revendedor A';
end $$;
commit;
do $$ begin
  if (select archived_at from public.customers where id = 'e1200000-0000-0000-0000-000000000003') is not null
     or (select archived_at from public.customers where id = 'e1200000-0000-0000-0000-000000000001') is null
    then raise exception 'FALHA K7: estado dos clientes do A mudou'; end if;
end $$;

-- ===================== K8: nada de DELETE físico, nem por atalho =====================
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'e1000000-0000-0000-0000-0000000000b1';
do $$ begin
  begin delete from public.customers where id = 'e1200000-0000-0000-0000-000000000003';
    raise exception 'FALHA K8: revendedor apagou cliente'; exception when insufficient_privilege then null; end;
  begin update public.customers set archived_at = now() where id = 'e1200000-0000-0000-0000-000000000003';
    raise exception 'FALHA K8: quarentena por UPDATE direto'; exception when insufficient_privilege then null; end;
  begin insert into public.customers (reseller_id, name, archived_at) values ('e1100000-0000-0000-0000-000000000001', 'x', now());
    raise exception 'FALHA K8: cliente nasceu em quarentena'; exception when insufficient_privilege then null; end;
  raise notice 'OK K8: revendedor não apaga cliente e não altera a quarentena fora das ações Excluir/Restaurar';
end $$;
commit;
do $$ begin
  -- Nem com privilégio total (service role / SQL manual) o banco aceita o DELETE.
  begin delete from public.customers where id = 'e1200000-0000-0000-0000-000000000003';
    raise exception 'FALHA K8b: DELETE físico aceito'; exception when sqlstate '55000' then null; end;
  if not exists (select 1 from public.customers where id = 'e1200000-0000-0000-0000-000000000003') then raise exception 'FALHA K8b'; end if;
  raise notice 'OK K8b: DELETE físico de cliente é recusado pelo banco mesmo com privilégio total';
end $$;

-- ===================== K9: cancelar venda com cliente anterior em quarentena =====================
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'e1000000-0000-0000-0000-0000000000b1';
do $$
declare v_sale uuid;
begin
  perform public.configure_reseller_plate(pg_temp.plate('KQA003'), 'e1200000-0000-0000-0000-000000000003', null, null, null);
  perform public.restore_customer('e1200000-0000-0000-0000-000000000001');
  v_sale := public.create_reseller_sale(array[pg_temp.plate('KQA003')], 70, 'e1200000-0000-0000-0000-000000000001', 'pending', null, null, gen_random_uuid());
  perform public.quarantine_customer('e1200000-0000-0000-0000-000000000003', null);
  perform public.set_reseller_sale_status(v_sale, 'cancelled');
  if (select customer_id from public.plates where public_code = 'KQA003') <> 'e1200000-0000-0000-0000-000000000003'
    then raise exception 'FALHA K9: cancelamento não restaurou o cliente anterior'; end if;
  raise notice 'OK K9: cancelar a venda restaura o cliente anterior da placa mesmo que ele esteja em quarentena (não é atribuição nova)';
end $$;
commit;

-- ===================== K10–K11: contagens e acesso anônimo =====================
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'e1000000-0000-0000-0000-0000000000b1';
do $$ begin
  -- Ativos do R1: Adega Monster e Ana Beatriz (Bia está em quarentena).
  if (public.reseller_dashboard_metrics()->>'customers')::int <> 2 then raise exception 'FALHA K10: contagem de clientes ativos'; end if;
  raise notice 'OK K10: indicadores contam só clientes ativos';
end $$;
commit;
do $$ begin
  set local role anon;
  begin perform public.quarantine_customer('e1200000-0000-0000-0000-000000000002', null);
    raise exception 'FALHA K11: anon arquivou cliente'; exception when insufficient_privilege then null; end;
  reset role;
  raise notice 'OK K11: usuário não autenticado não chama quarentena';
end $$;

drop table public.kq_ids;
