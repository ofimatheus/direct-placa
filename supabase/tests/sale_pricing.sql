-- Venda do revendedor com unitário + desconto (migration 022): cálculo no
-- banco em centavos, recusas, idempotência, métricas pelo valor final pago,
-- privacidade (ADMIN/outro revendedor/service_role) e vendas antigas.
\set ON_ERROR_STOP 1

insert into auth.users (id, email) values
  ('e5000000-0000-0000-0000-00000000000a', 'sp-admin@teste.com'),
  ('e5000000-0000-0000-0000-0000000000a1', 'sp-r1@teste.com'),
  ('e5000000-0000-0000-0000-0000000000a2', 'sp-r2@teste.com');
update public.profiles set role = 'admin' where email = 'sp-admin@teste.com';
insert into public.reseller_profiles (id, user_id, company_name) values
  ('e5100000-0000-0000-0000-000000000001', 'e5000000-0000-0000-0000-0000000000a1', 'Preço Um'),
  ('e5100000-0000-0000-0000-000000000002', 'e5000000-0000-0000-0000-0000000000a2', 'Preço Dois');
insert into public.plate_batches (id, name, quantity) values ('e5300000-0000-0000-0000-000000000001', 'Lote Preço', 20);
insert into public.plates (public_code, batch_id, reseller_id, status)
select 'SPA' || lpad(g::text, 3, '0'), 'e5300000-0000-0000-0000-000000000001', 'e5100000-0000-0000-0000-000000000001', 'assigned'
from generate_series(1, 14) g;
create function pg_temp.p(c text) returns uuid language sql as $$ select id from public.plates where public_code = c $$;
create table public.sp_ids (name text primary key, id uuid);
grant select, insert on public.sp_ids to authenticated;

begin;
set local role authenticated;
set local request.jwt.claim.sub = 'e5000000-0000-0000-0000-0000000000a1';
do $$
declare v_sale uuid; s record; pr record; base numeric; m jsonb;
begin
  base := (public.reseller_sales_metrics()->>'revenue')::numeric;

  -- S1: 1 placa × R$ 25,00
  v_sale := public.create_reseller_sale_priced(array[pg_temp.p('SPA001')], 2500, 0, null, 'paid', null, null, gen_random_uuid());
  select * into s from public.reseller_sales where id = v_sale;
  select * into pr from public.reseller_sale_pricing where sale_id = v_sale;
  if s.total <> 25.00 or pr.quantity <> 1 or pr.unit_price_cents <> 2500 or pr.subtotal_cents <> 2500 or pr.discount_cents <> 0 or pr.total_cents <> 2500 then
    raise exception 'FALHA S1: % %', s.total, pr; end if;
  raise notice 'OK S1: 1 placa × R$ 25,00 → subtotal R$ 25,00, total R$ 25,00 (histórico com quantidade, unitário, subtotal, desconto e total)';

  -- S2: 4 placas × R$ 25,00 − R$ 10,00 = R$ 90,00
  v_sale := public.create_reseller_sale_priced(array[pg_temp.p('SPA002'), pg_temp.p('SPA003'), pg_temp.p('SPA004'), pg_temp.p('SPA005')], 2500, 1000, null, 'paid', null, null, gen_random_uuid());
  insert into public.sp_ids values ('s2', v_sale);
  select * into s from public.reseller_sales where id = v_sale;
  select * into pr from public.reseller_sale_pricing where sale_id = v_sale;
  if s.total <> 90.00 or pr.quantity <> 4 or pr.subtotal_cents <> 10000 or pr.discount_cents <> 1000 or pr.total_cents <> 9000 then
    raise exception 'FALHA S2: % %', s.total, pr; end if;
  raise notice 'OK S2: 4 placas × R$ 25,00 = R$ 100,00 − R$ 10,00 = R$ 90,00 (o mesmo total gravado na venda)';

  -- S3: desconto zero (padrão) e centavos exatos (3 × R$ 0,10 = R$ 0,30; sem erro de ponto flutuante)
  v_sale := public.create_reseller_sale_priced(array[pg_temp.p('SPA006'), pg_temp.p('SPA007'), pg_temp.p('SPA008')], 10, null, null, 'pending', null, null, gen_random_uuid());
  select * into s from public.reseller_sales where id = v_sale;
  if s.total <> 0.30 or (select discount_cents from public.reseller_sale_pricing where sale_id = v_sale) <> 0 then raise exception 'FALHA S3: %', s.total; end if;
  raise notice 'OK S3: desconto padrão R$ 0,00; 3 × R$ 0,10 = R$ 0,30 exatos (centavos inteiros)';

  -- S4/S5: recusas (e nada gravado)
  begin perform public.create_reseller_sale_priced(array[pg_temp.p('SPA009')], 2500, 2501, null, 'paid', null, null, gen_random_uuid());
    raise exception 'FALHA S4: desconto maior que o subtotal aceito'; exception when invalid_parameter_value then null; end;
  begin perform public.create_reseller_sale_priced(array[pg_temp.p('SPA009')], 2500, -1, null, 'paid', null, null, gen_random_uuid());
    raise exception 'FALHA S5: desconto negativo aceito'; exception when invalid_parameter_value then null; end;
  begin perform public.create_reseller_sale_priced(array[pg_temp.p('SPA009')], -100, 0, null, 'paid', null, null, gen_random_uuid());
    raise exception 'FALHA S5: unitário negativo aceito'; exception when invalid_parameter_value then null; end;
  begin perform public.create_reseller_sale_priced(array[pg_temp.p('SPA009')], null, 0, null, 'paid', null, null, gen_random_uuid());
    raise exception 'FALHA S5: unitário ausente aceito'; exception when invalid_parameter_value then null; end;
  if exists (select 1 from public.reseller_sale_items where plate_id = pg_temp.p('SPA009')) then raise exception 'FALHA S4/S5: gravou venda recusada'; end if;
  -- desconto igual ao subtotal é permitido (total zero)
  v_sale := public.create_reseller_sale_priced(array[pg_temp.p('SPA009')], 2500, 2500, null, 'pending', null, null, gen_random_uuid());
  if (select total from public.reseller_sales where id = v_sale) <> 0 then raise exception 'FALHA S4: desconto = subtotal'; end if;
  raise notice 'OK S4: desconto maior que o subtotal é recusado (desconto igual ao subtotal → total R$ 0,00)';
  raise notice 'OK S5: desconto negativo, unitário negativo ou ausente são recusados, sem gravar nada';

  -- S6: placa repetida conta uma vez (quantidade = placas realmente vendidas)
  v_sale := public.create_reseller_sale_priced(array[pg_temp.p('SPA010'), pg_temp.p('SPA010'), pg_temp.p('SPA011')], 1000, 0, null, 'pending', null, null, gen_random_uuid());
  if (select quantity from public.reseller_sale_pricing where sale_id = v_sale) <> 2 or (select total from public.reseller_sales where id = v_sale) <> 20.00
    or (select count(*) from public.reseller_sale_items where sale_id = v_sale) <> 2 then raise exception 'FALHA S6'; end if;
  raise notice 'OK S6: a quantidade é derivada das placas realmente vendidas (repetidas contam uma vez): 2 × R$ 10,00 = R$ 20,00';

  -- S7: idempotência (mesma chave → mesma venda, um só detalhamento)
  declare k uuid := gen_random_uuid(); a uuid; b uuid;
  begin
    a := public.create_reseller_sale_priced(array[pg_temp.p('SPA012')], 1500, 0, null, 'pending', null, null, k);
    b := public.create_reseller_sale_priced(array[pg_temp.p('SPA012')], 1500, 0, null, 'pending', null, null, k);
    if a <> b or (select count(*) from public.reseller_sale_pricing where sale_id = a) <> 1 then raise exception 'FALHA S7'; end if;
  end;
  raise notice 'OK S7: repetir a mesma chave devolve a mesma venda, com um único detalhamento';

  -- S8: métricas usam o valor final das vendas PAGAS (25 + 90; pendentes fora)
  m := public.reseller_sales_metrics();
  if (m->>'revenue')::numeric - base <> 115.00 then raise exception 'FALHA S8: receita %', (m->>'revenue')::numeric - base; end if;
  raise notice 'OK S8: faturamento soma o valor final pago depois do desconto (R$ 25 + R$ 90 = R$ 115; vendas pendentes fora)';

  -- S12: sem escrita direta no detalhamento
  begin insert into public.reseller_sale_pricing values ((select id from public.sp_ids where name = 's2'), 1, 1, 1, 0, 1, now());
    raise exception 'FALHA S12: inseriu direto'; exception when insufficient_privilege then null; end;
  raise notice 'OK S12: o revendedor não grava nem altera o detalhamento diretamente (só pela RPC que calcula)';
end $$;
commit;

-- S9: privacidade
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'e5000000-0000-0000-0000-00000000000a';
do $$ begin
  if exists (select 1 from public.reseller_sale_pricing) or exists (select 1 from public.reseller_sales) then raise exception 'FALHA S9: ADMIN leu financeiro'; end if;
  begin perform public.create_reseller_sale_priced(array[gen_random_uuid()], 100, 0, null, 'paid', null, null, gen_random_uuid());
    raise exception 'FALHA S9: ADMIN registrou venda de revendedor'; exception when insufficient_privilege then null; end;
end $$;
commit;
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'e5000000-0000-0000-0000-0000000000a2';
do $$ begin
  if exists (select 1 from public.reseller_sale_pricing) then raise exception 'FALHA S9: revendedor B leu o detalhamento do A'; end if;
end $$;
commit;
do $$ begin
  set local role service_role;
  begin perform 1 from public.reseller_sale_pricing; raise exception 'FALHA S9: service_role leu'; exception when insufficient_privilege then null; end;
  reset role;
  raise notice 'OK S9: ADMIN, outro revendedor e service_role não leem unitário, desconto, subtotal nem total do revendedor';
end $$;

-- S10: histórico imutável
do $$ begin
  begin update public.reseller_sale_pricing set discount_cents = 0; raise exception 'FALHA S10: alterou'; exception when sqlstate '55000' then null; end;
  begin delete from public.reseller_sale_pricing; raise exception 'FALHA S10: apagou'; exception when sqlstate '55000' then null; end;
  raise notice 'OK S10: o detalhamento é imutável (nem com privilégio total)';
end $$;

-- S11: venda antiga (sem detalhamento) continua legível
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'e5000000-0000-0000-0000-0000000000a1';
do $$
declare v_sale uuid;
begin
  v_sale := public.create_reseller_sale(array[pg_temp.p('SPA013')], 42.50, null, 'paid', null, null, gen_random_uuid());
  if exists (select 1 from public.reseller_sale_pricing where sale_id = v_sale) then raise exception 'FALHA S11: legado ganhou detalhamento'; end if;
  if (select total from public.reseller_sales_list(null, 200, 0) where sale_id = v_sale) <> 42.50 then raise exception 'FALHA S11: lista'; end if;
  raise notice 'OK S11: venda antiga (só total, sem detalhamento) continua registrada e listada normalmente';
end $$;
commit;
drop table public.sp_ids;
