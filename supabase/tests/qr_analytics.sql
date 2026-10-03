-- Testes das métricas oficiais somente QR (migration 015). Rodar num banco de
-- TESTE, depois das migrations. Independente dos outros arquivos: as contagens
-- globais são comparadas com o próprio log de redirects.
\set ON_ERROR_STOP 1

insert into auth.users (id, email) values
  ('d8000000-0000-0000-0000-00000000000a', 'qra-admin@teste.com'),
  ('d8000000-0000-0000-0000-0000000000b1', 'qra-r1@teste.com'),
  ('d8000000-0000-0000-0000-0000000000b2', 'qra-r2@teste.com');
update public.profiles set role = 'admin' where email = 'qra-admin@teste.com';
insert into public.reseller_profiles (id, user_id, company_name) values
  ('d8100000-0000-0000-0000-000000000001', 'd8000000-0000-0000-0000-0000000000b1', 'Revenda QR Um'),
  ('d8100000-0000-0000-0000-000000000002', 'd8000000-0000-0000-0000-0000000000b2', 'Revenda QR Dois');
insert into public.customers (id, reseller_id, name) values
  ('d8200000-0000-0000-0000-000000000001', 'd8100000-0000-0000-0000-000000000001', 'Ana Beatriz');
insert into public.plate_batches (id, name, quantity) values ('d8300000-0000-0000-0000-000000000001', 'Lote QR', 4);
insert into public.plates (public_code, batch_id, reseller_id, customer_id, status, destination_type, destination_url) values
  ('QRA001', 'd8300000-0000-0000-0000-000000000001', 'd8100000-0000-0000-0000-000000000001', 'd8200000-0000-0000-0000-000000000001', 'active', 'website', 'https://ana.com.br'),
  ('QRA002', 'd8300000-0000-0000-0000-000000000001', 'd8100000-0000-0000-0000-000000000001', null, 'assigned', null, null),
  ('QRA003', 'd8300000-0000-0000-0000-000000000001', 'd8100000-0000-0000-0000-000000000002', null, 'active', 'website', 'https://dois.com.br');

-- QRA001: 3 QR + 2 NFC + 1 sem origem. QRA002: só NFC. QRA003 (outro revendedor): 4 QR.
do $$
declare r record; before timestamptz := (select updated_at from public.plates where public_code = 'QRA001');
begin
  set local role anon;
  select * into r from public.resolve_plate_redirect('QRA001', 'qr');
  select * into r from public.resolve_plate_redirect('QRA001', 'qr');
  select * into r from public.resolve_plate_redirect('QRA001', 'qr');
  select * into r from public.resolve_plate_redirect('QRA001', 'nfc');
  if r.outcome <> 'ok' or r.target_url <> 'https://ana.com.br' then raise exception 'FALHA Q1: NFC deixou de redirecionar (%)', r.outcome; end if;
  select * into r from public.resolve_plate_redirect('QRA001', 'nfc');
  select * into r from public.resolve_plate_redirect('QRA001', 'outra-coisa');
  select * into r from public.resolve_plate_redirect('QRA002', 'nfc');
  select * into r from public.resolve_plate_redirect('QRA002', 'nfc');
  select * into r from public.resolve_plate_redirect('QRA003', 'qr');
  select * into r from public.resolve_plate_redirect('QRA003', 'qr');
  select * into r from public.resolve_plate_redirect('QRA003', 'qr');
  select * into r from public.resolve_plate_redirect('QRA003', 'qr');
  reset role;

  if (select count(*) from public.redirects r2 join public.plates p on p.id = r2.plate_id
      where p.public_code = 'QRA001' and r2.source = 'nfc') <> 2
    then raise exception 'FALHA Q1: o acesso NFC não foi registrado em redirects.source'; end if;
  if (select updated_at from public.plates where public_code = 'QRA001') <> before
    then raise exception 'FALHA Q1: contar acesso alterou updated_at da placa'; end if;
  raise notice 'OK Q1: NFC continua redirecionando e sendo registrado (source = nfc); a placa não é alterada';
end $$;

do $$
declare p public.plates%rowtype;
begin
  select * into p from public.plates where public_code = 'QRA001';
  if p.qr_access_count <> 3 then raise exception 'FALHA Q2: contador oficial deveria ser 3 (só QR), veio %', p.qr_access_count; end if;
  if p.access_count <> 6 then raise exception 'FALHA Q2: total histórico (todas as origens) deveria continuar 6, veio %', p.access_count; end if;
  if p.last_qr_access_at is null then raise exception 'FALHA Q2: last_qr_access_at'; end if;
  select * into p from public.plates where public_code = 'QRA002';
  if p.qr_access_count <> 0 or p.last_qr_access_at is not null then raise exception 'FALHA Q2: NFC entrou no contador oficial'; end if;
  raise notice 'OK Q2: contador oficial conta só QR; o histórico NFC permanece no log e no total histórico';
end $$;

-- Painel e agregações do revendedor
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'd8000000-0000-0000-0000-0000000000b1';
do $$
declare m jsonb; rows jsonb; n bigint;
begin
  m := public.reseller_dashboard_metrics();
  if (m->>'accesses')::int <> 3 then raise exception 'FALHA Q3: métrica do revendedor somou NFC (%)', m->>'accesses'; end if;

  select jsonb_agg(jsonb_build_object('code', public_code, 'customer', customer_name, 'qr', qr_accesses) order by public_code)
  into rows from public.reseller_qr_access_by_plate(now() - interval '1 day', now() + interval '1 day', 50, 0);
  if rows <> '[{"qr": 3, "code": "QRA001", "customer": "Ana Beatriz"}]'::jsonb
    then raise exception 'FALHA Q4: acessos por placa do revendedor: %', rows; end if;

  -- O mesmo número que a tela mostra no topo ("Acessos por QR Code").
  select count(*) into n from public.redirects r where r.source = 'qr'
    and r.created_at >= now() - interval '1 day' and r.created_at < now() + interval '1 day';
  if n <> 3 then raise exception 'FALHA Q4: total QR visível ao revendedor (%)', n; end if;

  if (select count(*) from public.admin_qr_access_by_plate(now() - interval '1 day', now() + interval '1 day', 10)) <> 0
    then raise exception 'FALHA Q5: revendedor leu a agregação do ADMIN'; end if;
  raise notice 'OK Q3: painel do revendedor conta só QR';
  raise notice 'OK Q4: "Por placa" do revendedor: só QR, só placas dele, com cliente; placa só com NFC não aparece';
end $$;
commit;

-- ADMIN
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'd8000000-0000-0000-0000-00000000000a';
do $$
declare m jsonb; qr_log bigint; s record; rows jsonb;
begin
  select count(*) into qr_log from public.redirects r
  where r.source = 'qr' and r.created_at >= now() - interval '1 day' and r.created_at < now() + interval '1 day';
  m := public.admin_dashboard_metrics(now() - interval '1 day', now() + interval '1 day');
  if (m->>'accesses')::bigint <> qr_log then raise exception 'FALHA Q5: dashboard ADMIN (%) ≠ log só QR (%)', m->>'accesses', qr_log; end if;

  select * into s from public.admin_reseller_stats('d8100000-0000-0000-0000-000000000001');
  if s.accesses <> 3 then raise exception 'FALHA Q5: stats do revendedor somaram NFC (%)', s.accesses; end if;

  select jsonb_agg(jsonb_build_object('code', public_code, 'reseller', reseller_name, 'qr', qr_accesses) order by public_code)
  into rows from public.admin_qr_access_by_plate(now() - interval '1 day', now() + interval '1 day', 100)
  where public_code like 'QRA%';
  if rows <> '[{"qr": 3, "code": "QRA001", "reseller": "Revenda QR Um"}, {"qr": 4, "code": "QRA003", "reseller": "Revenda QR Dois"}]'::jsonb
    then raise exception 'FALHA Q5: acessos por placa do ADMIN: %', rows; end if;
  raise notice 'OK Q5: ADMIN (dashboard, revendedor e por placa) conta só QR';
end $$;
commit;

-- Isolamento: o revendedor 2 só vê a própria placa
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'd8000000-0000-0000-0000-0000000000b2';
do $$ begin
  if (select string_agg(public_code, ',') from public.reseller_qr_access_by_plate(now() - interval '1 day', now() + interval '1 day', 50, 0)) <> 'QRA003'
    then raise exception 'FALHA Q6: revendedor 2 viu acessos de placa alheia'; end if;
  raise notice 'OK Q6: cada revendedor só vê os acessos das próprias placas';
end $$;
commit;

-- A URL NFC continua resolvendo mesmo para placa sem configuração (página "não ativada").
do $$ declare r record; begin
  set local role anon;
  select * into r from public.resolve_plate_redirect('QRA002', 'nfc');
  reset role;
  if r.outcome <> 'unconfigured' then raise exception 'FALHA Q7: NFC de placa não configurada (%)', r.outcome; end if;
  raise notice 'OK Q7: o comportamento do NFC por status continua o mesmo';
end $$;
