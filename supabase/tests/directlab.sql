-- DirectLab: rate limit (migration 020) e "Usar em uma placa" pela RPC
-- existente configure_reseller_plate (nenhuma regra nova de ativação).
-- Rodar num banco de TESTE, depois das migrations.
\set ON_ERROR_STOP 1

insert into auth.users (id, email) values
  ('e3000000-0000-0000-0000-0000000000a1', 'dl-r1@teste.com'),
  ('e3000000-0000-0000-0000-0000000000a2', 'dl-r2@teste.com');
insert into public.reseller_profiles (id, user_id, company_name) values
  ('e3100000-0000-0000-0000-000000000001', 'e3000000-0000-0000-0000-0000000000a1', 'Revenda DL A'),
  ('e3100000-0000-0000-0000-000000000002', 'e3000000-0000-0000-0000-0000000000a2', 'Revenda DL B');
insert into public.customers (id, reseller_id, name, company_name) values
  ('e3200000-0000-0000-0000-000000000001', 'e3100000-0000-0000-0000-000000000001', 'João', 'Adega Monster');
insert into public.plate_batches (id, name, quantity) values ('e3300000-0000-0000-0000-000000000001', 'Lote DirectLab', 6);
insert into public.plates (public_code, batch_id, reseller_id, status, customer_id)
select 'DLA' || lpad(g::text, 3, '0'), 'e3300000-0000-0000-0000-000000000001', 'e3100000-0000-0000-0000-000000000001', 'assigned',
       case when g = 1 then 'e3200000-0000-0000-0000-000000000001'::uuid end
from generate_series(1, 4) g;
insert into public.plates (public_code, batch_id, reseller_id, status)
values ('DLB001', 'e3300000-0000-0000-0000-000000000001', 'e3100000-0000-0000-0000-000000000002', 'assigned');
update public.plates set status = 'blocked' where public_code = 'DLA004';
create function pg_temp.plate(p_code text) returns uuid language sql as $$ select id from public.plates where public_code = p_code $$;

-- ===================== D1–D3: rate limit =====================
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'e3000000-0000-0000-0000-0000000000a1';
do $$
declare r record; i int;
begin
  for i in 1..3 loop
    select * into r from public.consume_rate_limit('directlab.test', 3, 60);
    if not r.allowed or r.hits <> i then raise exception 'FALHA D1: chamada % deveria passar: %', i, r; end if;
  end loop;
  select * into r from public.consume_rate_limit('directlab.test', 3, 60);
  if r.allowed or r.retry_after_seconds < 1 or r.retry_after_seconds > 60 then raise exception 'FALHA D1: 4ª chamada deveria ser barrada: %', r; end if;
  select * into r from public.consume_rate_limit('directlab.outro', 3, 60);
  if not r.allowed then raise exception 'FALHA D1: baldes deveriam ser independentes'; end if;
  begin perform public.consume_rate_limit('Balde Inválido!', 3, 60);
    raise exception 'FALHA D1: balde inválido aceito'; exception when invalid_parameter_value then null; end;
  begin perform 1 from public.rate_limit_counters;
    raise exception 'FALHA D1: usuário leu os contadores'; exception when insufficient_privilege then null; end;
  begin delete from public.rate_limit_counters;
    raise exception 'FALHA D1: usuário zerou os contadores'; exception when insufficient_privilege then null; end;
  raise notice 'OK D1: limite por janela (3ª passa, 4ª barrada com retry-after), baldes independentes; o usuário não lê nem zera os contadores';
end $$;
commit;

begin;
set local role authenticated;
set local request.jwt.claim.sub = 'e3000000-0000-0000-0000-0000000000a2';
do $$
declare r record;
begin
  select * into r from public.consume_rate_limit('directlab.test', 3, 60);
  if not r.allowed or r.hits <> 1 then raise exception 'FALHA D2: limite vazou entre usuários: %', r; end if;
  raise notice 'OK D2: o limite é por usuário (o revendedor B não herda o consumo do A)';
end $$;
commit;

do $$
declare n int;
begin
  insert into public.rate_limit_counters values ('e3000000-0000-0000-0000-0000000000a1', 'directlab.test', now() - interval '2 days', 99);
  set local role authenticated;
  set local request.jwt.claim.sub = 'e3000000-0000-0000-0000-0000000000a1';
  perform public.consume_rate_limit('directlab.test', 3, 60);
  reset role;
  select count(*) into n from public.rate_limit_counters
  where user_id = 'e3000000-0000-0000-0000-0000000000a1' and bucket = 'directlab.test' and window_start < now() - interval '1 day';
  if n <> 0 then raise exception 'FALHA D3: janelas antigas não foram limpas'; end if;
  set local role anon;
  begin perform public.consume_rate_limit('directlab.test', 3, 60);
    raise exception 'FALHA D3: anon consumiu'; exception when insufficient_privilege then null; end;
  reset role;
  raise notice 'OK D3: janelas vencidas são apagadas (a tabela não cresce); usuário não autenticado não chama a RPC';
end $$;

-- ===================== D4–D7: Usar em uma placa = RPC existente =====================
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'e3000000-0000-0000-0000-0000000000a1';
do $$
declare p public.plates%rowtype;
begin
  -- Formatos típicos do writeAReviewUri passam na validação de destino que já existe.
  if not public.is_valid_destination_url('https://search.google.com/local/writereview?placeid=ChIJadegaMonster0001')
     or not public.is_valid_destination_url('https://www.google.com/maps/place//data=!4m3!3m2!1s0x94cf01:0xabc!12e1?source=g.page.m.rc._&laa=merchant-review-solicitation')
    then raise exception 'FALHA D4: link de avaliação recusado'; end if;

  -- Mesma chamada que "Usar em uma placa" faz (cliente atual preservado).
  select * into p from public.configure_reseller_plate(pg_temp.plate('DLA001'), 'e3200000-0000-0000-0000-000000000001', 'google_review',
    'https://search.google.com/local/writereview?placeid=ChIJadegaMonster0001', null);
  if p.status <> 'active' or p.destination_type <> 'google_review' or p.customer_id <> 'e3200000-0000-0000-0000-000000000001'
    then raise exception 'FALHA D4: %', p; end if;
  raise notice 'OK D4: placa reservada recebe o link de avaliação e é ativada pela regra atual (auto-ativação); o cliente continua o mesmo';

  select * into p from public.configure_reseller_plate(pg_temp.plate('DLA001'), 'e3200000-0000-0000-0000-000000000001', 'google_review',
    'https://search.google.com/local/writereview?placeid=ChIJoutroLocal00002', null);
  if p.status <> 'active' or p.destination_url not like '%ChIJoutroLocal00002' then raise exception 'FALHA D5: %', p; end if;
  raise notice 'OK D5: placa ativa só troca o destino, continua ativa (lifecycle intacto)';

  begin
    perform public.configure_reseller_plate(pg_temp.plate('DLA004'), null, 'google_review', 'https://search.google.com/local/writereview?placeid=ChIJx0000000001', null);
    raise exception 'FALHA D6: configurou placa bloqueada';
  exception when sqlstate '55000' then null; end;
  raise notice 'OK D6: placa bloqueada continua recusada pela RPC existente';
end $$;
commit;

begin;
set local role authenticated;
set local request.jwt.claim.sub = 'e3000000-0000-0000-0000-0000000000a2';
do $$ begin
  begin
    perform public.configure_reseller_plate(pg_temp.plate('DLA002'), null, 'google_review', 'https://search.google.com/local/writereview?placeid=ChIJinvasor0000001', null);
    raise exception 'FALHA D7: revendedor B configurou placa do A';
  exception when no_data_found then null; end;
  if exists (select 1 from public.plates where reseller_id = 'e3100000-0000-0000-0000-000000000001')
    then raise exception 'FALHA D7: B enxerga placas do A (a listagem do DirectLab usaria isso)'; end if;
  raise notice 'OK D7: revendedor B não altera nem enxerga placa do revendedor A (mesmo passando o ID)';
end $$;
commit;
do $$ begin
  if (select destination_url from public.plates where public_code = 'DLA002') is not null or (select status from public.plates where public_code = 'DLA002') <> 'assigned'
    then raise exception 'FALHA D7: a placa do A mudou'; end if;
end $$;
