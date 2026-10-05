-- Link curto da Avaliação Google (migration 028).
--   psql -d placas_test -v dblink_conn='dbname=placas_test host=/tmp' -f supabase/tests/directlab_short_links.sql
\set ON_ERROR_STOP 1
create extension if not exists dblink with schema extensions;
\if :{?dblink_conn}
\else
select 'dbname=' || current_database() as dblink_conn \gset
\endif
select set_config('test.conn', :'dblink_conn', false) as dblink_conn_em_uso;

insert into auth.users (id, email) values
  ('b1000000-0000-0000-0000-00000000000a', 'sl-admin@teste.com'),
  ('b1000000-0000-0000-0000-00000000000b', 'sl-admin2@teste.com'),
  ('b1000000-0000-0000-0000-0000000000a1', 'sl-r1@teste.com'),
  ('b1000000-0000-0000-0000-0000000000a2', 'sl-r2@teste.com');
update public.profiles set role = 'admin' where email in ('sl-admin@teste.com', 'sl-admin2@teste.com');
insert into public.reseller_profiles (id, user_id, company_name) values
  ('b1100000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-0000000000a1', 'Curto Um'),
  ('b1100000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-0000000000a2', 'Curto Dois');
insert into public.reseller_directlab_limits (reseller_id, google_review_daily, directlink_pages) values ('b1100000-0000-0000-0000-000000000001', 3, 3);

create function pg_temp.fin(p_user uuid, p_place text, p_url text) returns record language plpgsql as $$
declare r record; begin perform set_config('request.jwt.claim.sub', p_user::text, true); execute 'set local role authenticated';
select * into r from public.directlab_finalize_generation(p_place, p_url); execute 'reset role'; return r; end $$;
create function pg_temp.hits(p_user uuid) returns integer language sql as $$
  select coalesce(max(hits), 0) from public.directlab_usage where user_id = p_user and kind = 'daily' and period = public.directlab_usage_day(now())::text $$;
create function pg_temp.gens(p_user uuid) returns integer language sql as $$
  select count(*)::int from public.directlab_generations where user_id = p_user $$;
create function pg_temp.url(p text) returns text language sql as $$
  select 'https://www.google.com/maps/place//data=!4m3!3m2!1s0x94cf01b30bf59ca7:0x21e10e82e733c4f7!12e1?g_mp=' || p $$;

-- ===================== SL1: geração completa cria o link e cobra 1 =====================
do $$
declare r record; l record;
begin
  r := pg_temp.fin('b1000000-0000-0000-0000-0000000000a1', 'ChIJlocalUm00000000001', pg_temp.url('v1'));
  select * into l from public.directlab_review_links where public_code = r.public_code;
  if not r.allowed or not r.charged or r.public_code !~ '^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{7}$' or pg_temp.hits('b1000000-0000-0000-0000-0000000000a1') <> 1
     or l.owner_id <> 'b1000000-0000-0000-0000-0000000000a1' or l.google_place_id <> 'ChIJlocalUm00000000001' or l.destination_url <> pg_temp.url('v1') then
    raise exception 'FALHA SL1: % %', r, l; end if;
  perform set_config('test.code_r1', r.public_code, false);
  raise notice 'OK SL1: geração concluída → link curto % (7 caracteres) gravado com o destino oficial, e exatamente 1 utilização cobrada', r.public_code;
end $$;

-- ===================== SL2: mesmo dono + mesmo local → mesmo código; URL nova mantém o código =====================
do $$
declare r record; r2 record; l record; t0 timestamptz;
begin
  select updated_at into t0 from public.directlab_review_links where public_code = current_setting('test.code_r1');
  perform pg_sleep(0.02);
  r := pg_temp.fin('b1000000-0000-0000-0000-0000000000a1', 'ChIJlocalUm00000000001', pg_temp.url('v1'));
  r2 := pg_temp.fin('b1000000-0000-0000-0000-0000000000a1', 'ChIJlocalUm00000000001', pg_temp.url('v2-google-mudou'));
  select * into l from public.directlab_review_links where public_code = current_setting('test.code_r1');
  if r.public_code <> current_setting('test.code_r1') or r2.public_code <> r.public_code or r.charged or r2.charged
     or pg_temp.hits('b1000000-0000-0000-0000-0000000000a1') <> 1 or l.destination_url <> pg_temp.url('v2-google-mudou') or l.updated_at <= t0
     or (select count(*) from public.directlab_review_links where owner_id = 'b1000000-0000-0000-0000-0000000000a1') <> 1 then
    raise exception 'FALHA SL2: % % %', r, r2, l; end if;
  raise notice 'OK SL2: gerar de novo o mesmo local reaproveita o código % sem cobrar de novo; se o Google devolve outra URL, o destino é atualizado e o CÓDIGO continua o mesmo', r.public_code;
end $$;

-- ===================== SL3: outro dono, mesmo local → outro código =====================
do $$
declare r record;
begin
  r := pg_temp.fin('b1000000-0000-0000-0000-0000000000a2', 'ChIJlocalUm00000000001', pg_temp.url('v1'));
  if r.public_code = current_setting('test.code_r1') then raise exception 'FALHA SL3'; end if;
  raise notice 'OK SL3: outro revendedor gerando o mesmo local recebe o próprio código (%)', r.public_code;
end $$;

-- ===================== SL4: código imutável =====================
do $$
begin
  begin
    update public.directlab_review_links set public_code = 'ZZZZZZZ' where public_code = current_setting('test.code_r1');
    raise exception 'FALHA SL4 alterou';
  exception when object_not_in_prerequisite_state then null; end;
  raise notice 'OK SL4: o código não pode ser alterado depois de criado (nem por update direto no banco)';
end $$;

-- ===================== SL5: aleatório, único, não sequencial (ADMIN, ilimitado) =====================
do $$
declare r record; i int; codes text[] := '{}'; prefix_pairs int := 0; ascending int := 0;
begin
  for i in 1..150 loop
    r := pg_temp.fin('b1000000-0000-0000-0000-00000000000a', 'ChIJadmin' || lpad(i::text, 6, '0'), pg_temp.url('a' || i));
    if not r.allowed or r.charged then raise exception 'FALHA SL5 admin limitado: %', r; end if;
    codes := codes || r.public_code;
  end loop;
  for i in 2..150 loop
    if left(codes[i], 4) = left(codes[i - 1], 4) then prefix_pairs := prefix_pairs + 1; end if;
    if codes[i] > codes[i - 1] then ascending := ascending + 1; end if;
  end loop;
  if (select count(distinct c) from unnest(codes) c) <> 150 or prefix_pairs > 1 or ascending < 50 or ascending > 100
     or pg_temp.hits('b1000000-0000-0000-0000-00000000000a') <> 0 then
    raise exception 'FALHA SL5 únicos=% prefixos=% crescentes=%', (select count(distinct c) from unnest(codes) c), prefix_pairs, ascending; end if;
  raise notice 'OK SL5: 150 gerações do ADMIN (ilimitado, 0 cobradas) → 150 códigos únicos, sem prefixo comum entre vizinhos e sem ordem (% de 149 pares crescentes ≈ acaso)', ascending;
end $$;

-- ===================== SL6: colisão de código → tenta outro =====================
-- Troca o gerador temporariamente: a 1ª chamada devolve um código JÁ existente.
-- (Contador em SEQUÊNCIA: a gravação que colide é desfeita, mas nextval não volta atrás.)
create sequence public._sl6_calls;
create or replace function public.directlab_review_new_code() returns text language plpgsql volatile security definer set search_path = public as $$
declare v_alphabet constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ'; v_bytes bytea; v_code text;
begin
  if nextval('public._sl6_calls') = 1 then
    return current_setting('test.code_r1');
  end if;
  v_bytes := uuid_send(gen_random_uuid()); v_code := '';
  for i in 0..6 loop v_code := v_code || substr(v_alphabet, (get_byte(v_bytes, i + 8) % 31) + 1, 1); end loop;
  return v_code;
end $$;
do $$
declare r record; calls bigint;
begin
  r := pg_temp.fin('b1000000-0000-0000-0000-00000000000a', 'ChIJcolisao0000000001', pg_temp.url('colisao'));
  select last_value into calls from public._sl6_calls;
  if calls < 2 or r.public_code = current_setting('test.code_r1') or r.public_code is null
     or (select count(*) from public.directlab_review_links where public_code = current_setting('test.code_r1')) <> 1
     or (select destination_url from public.directlab_review_links where public_code = current_setting('test.code_r1')) <> pg_temp.url('v2-google-mudou') then
    raise exception 'FALHA SL6: % chamadas=%', r, calls; end if;
  raise notice 'OK SL6: o 1º código sorteado já existia → a gravação colidiu e a finalização sorteou outro (%; % sorteios); o link existente ficou intacto', r.public_code, calls;
end $$;
drop sequence public._sl6_calls;
-- Restaura o gerador original (reaplica a migration: idempotente).
\ir ../migrations/20261009120000_directlab_review_short_links.sql

-- ===================== SL7: destino só pode ser link de avaliação do Google =====================
do $$
declare u text; before_hits int := pg_temp.hits('b1000000-0000-0000-0000-0000000000a1'); before_rows int := (select count(*) from public.directlab_review_links);
  bad text[] := array[
    'javascript:alert(1)//https://www.google.com/maps/',
    'data:text/html,<script>alert(1)</script>',
    'file:///etc/passwd#https://www.google.com/maps/x',
    'http://www.google.com/maps/place//data=!4m3',
    'https://evil.example.com/maps/place/x',
    'https://www.google.com.evil.com/maps/place/x',
    'https://evil@www.google.com/maps/place/x',
    'https://www.google.com/url?q=https://evil.example.com',
    'https://www.google.com/maps/../url?q=https://evil.example.com',
    'https://www.google.com/maps/%2e%2e/url?q=https://evil.example.com',
    'https://www.google.com/maps/place/x y',
    'https://g.page/outra-coisa'];
begin
  foreach u in array bad loop
    begin
      perform pg_temp.fin('b1000000-0000-0000-0000-0000000000a1', 'ChIJmalicioso00000001', u);
      raise exception 'FALHA SL7 aceitou %', u;
    exception when invalid_parameter_value then null; end;
  end loop;
  if pg_temp.hits('b1000000-0000-0000-0000-0000000000a1') <> before_hits or (select count(*) from public.directlab_review_links) <> before_rows then raise exception 'FALHA SL7 efeito colateral'; end if;
  if not public.directlab_review_destination_ok('https://search.google.com/local/writereview?placeid=ChIJxyz') or not public.directlab_review_destination_ok('https://g.page/r/CZx0abc/review') then raise exception 'FALHA SL7 formatos válidos'; end if;
  raise notice 'OK SL7: % destinos recusados (javascript:, data:, file:, http, host falso, usuário na URL, google.com/url, "..", %%2e%%2e, espaço, g.page fora de /r/) sem cobrar e sem gravar; formatos oficiais aceitos', array_length(bad, 1);
end $$;

-- ===================== SL8: cota esgotada → não cria link =====================
do $$
declare r record; i int;
begin
  for i in 2..3 loop r := pg_temp.fin('b1000000-0000-0000-0000-0000000000a1', 'ChIJlocalR1extra00000' || i, pg_temp.url('r1-' || i)); end loop;
  r := pg_temp.fin('b1000000-0000-0000-0000-0000000000a1', 'ChIJlocalR1excede00001', pg_temp.url('excede'));
  if r.allowed or r.public_code is not null or pg_temp.hits('b1000000-0000-0000-0000-0000000000a1') <> 3
     or exists (select 1 from public.directlab_review_links where google_place_id = 'ChIJlocalR1excede00001') then
    raise exception 'FALHA SL8: %', r; end if;
  raise notice 'OK SL8: com o limite (3) esgotado, a geração é recusada e NENHUM link curto é criado';
end $$;

-- ===================== SL9: falha ao criar o link → cobrança desfeita =====================
create function public._sl9_fail() returns trigger language plpgsql as $$ begin raise exception 'falha simulada ao gravar o link'; end $$;
create trigger _sl9 before insert on public.directlab_review_links for each row execute function public._sl9_fail();
do $$
declare h0 int := pg_temp.hits('b1000000-0000-0000-0000-0000000000a2'); g0 int := pg_temp.gens('b1000000-0000-0000-0000-0000000000a2'); ok boolean := false;
begin
  begin
    perform pg_temp.fin('b1000000-0000-0000-0000-0000000000a2', 'ChIJfalhaLink00000001', pg_temp.url('falha'));
  exception when raise_exception then ok := true; end;
  if not ok or pg_temp.hits('b1000000-0000-0000-0000-0000000000a2') <> h0 or pg_temp.gens('b1000000-0000-0000-0000-0000000000a2') <> g0 then
    raise exception 'FALHA SL9: ok=% hits % → %', ok, h0, pg_temp.hits('b1000000-0000-0000-0000-0000000000a2'); end if;
  raise notice 'OK SL9: o Google respondeu mas gravar o link falhou → a cobrança é desfeita junto (uso continua %)', h0;
end $$;
drop trigger _sl9 on public.directlab_review_links;
drop function public._sl9_fail();
do $$
declare r record; h0 int := pg_temp.hits('b1000000-0000-0000-0000-0000000000a2');
begin
  r := pg_temp.fin('b1000000-0000-0000-0000-0000000000a2', 'ChIJfalhaLink00000001', pg_temp.url('falha'));
  r := pg_temp.fin('b1000000-0000-0000-0000-0000000000a2', 'ChIJfalhaLink00000001', pg_temp.url('falha'));
  if pg_temp.hits('b1000000-0000-0000-0000-0000000000a2') <> h0 + 1 or r.public_code is null then raise exception 'FALHA SL9b'; end if;
  raise notice 'OK SL9b: nova tentativa depois da falha cobra exatamente 1 (e repetir não cobra de novo)';
end $$;

-- ===================== SL10: leitura pública mínima =====================
do $$
declare d text; n int := 0; i int; h0 int := pg_temp.hits('b1000000-0000-0000-0000-0000000000a1'); g0 int := pg_temp.gens('b1000000-0000-0000-0000-0000000000a1');
begin
  set local role anon;
  d := public.public_review_link(current_setting('test.code_r1'));
  if d <> pg_temp.url('v2-google-mudou') or public.public_review_link(lower(current_setting('test.code_r1'))) <> d or public.public_review_link('AAAAAAA') is not null then raise exception 'FALHA SL10 lookup'; end if;
  for i in 1..100 loop if public.public_review_link(current_setting('test.code_r1')) is not null then n := n + 1; end if; end loop;
  begin perform 1 from public.directlab_review_links; raise exception 'FALHA SL10 anon lê tabela'; exception when insufficient_privilege then null; end;
  begin perform public.directlab_finalize_generation('ChIJx', pg_temp.url('x')); raise exception 'FALHA SL10 anon finaliza'; exception when insufficient_privilege then null; end;
  begin perform public.directlab_review_new_code(); raise exception 'FALHA SL10 anon gera código'; exception when insufficient_privilege then null; end;
  reset role;
  perform set_config('request.jwt.claim.sub', 'b1000000-0000-0000-0000-0000000000a2', true);
  set local role authenticated;
  begin perform 1 from public.directlab_review_links; raise exception 'FALHA SL10 revendedor lê tabela'; exception when insufficient_privilege then null; end;
  reset role;
  if n <> 100 or pg_temp.hits('b1000000-0000-0000-0000-0000000000a1') <> h0 or pg_temp.gens('b1000000-0000-0000-0000-0000000000a1') <> g0 then raise exception 'FALHA SL10 cota'; end if;
  update public.directlab_review_links set is_active = false where public_code = current_setting('test.code_r1');
  set local role anon;
  if public.public_review_link(current_setting('test.code_r1')) is not null then raise exception 'FALHA SL10 inativo'; end if;
  reset role;
  update public.directlab_review_links set is_active = true where public_code = current_setting('test.code_r1');
  raise notice 'OK SL10: o público só recebe o destino a partir do código (aceita minúsculas; inexistente/inativo → nada); 100 acessos não mudam uso nem gerações; público e revendedor não leem a tabela nem criam links';
end $$;

-- ===================== SL11: conta removida não quebra o link já entregue =====================
do $$
declare r record;
begin
  r := pg_temp.fin('b1000000-0000-0000-0000-00000000000b', 'ChIJcontaRemovida0001', pg_temp.url('removida'));
  delete from auth.users where id = 'b1000000-0000-0000-0000-00000000000b';
  if (select owner_id from public.directlab_review_links where public_code = r.public_code) is not null
     or public.public_review_link(r.public_code) <> pg_temp.url('removida') then raise exception 'FALHA SL11'; end if;
  raise notice 'OK SL11: excluir a conta do dono mantém o link % funcionando (dono vira NULL, destino preservado)', r.public_code;
end $$;

-- ===================== SL12: concorrência → um único código =====================
do $$
declare
  conn text := current_setting('test.conn');
  a text; b text; busy int;
  prep text := 'set role authenticated; set request.jwt.claim.sub = ''b1000000-0000-0000-0000-00000000000a''; ';
  q text := 'select public_code from public.directlab_finalize_generation(''ChIJconcorrente000001'', ''' || pg_temp.url('conc') || ''')';
begin
  perform extensions.dblink_connect('sl_a', conn);
  perform extensions.dblink_connect('sl_b', conn);
  perform extensions.dblink_exec('sl_a', 'begin');
  perform extensions.dblink_exec('sl_a', prep);
  select t.c into a from extensions.dblink('sl_a', q) as t(c text);
  perform extensions.dblink_exec('sl_b', prep);
  perform extensions.dblink_send_query('sl_b', q);
  perform pg_sleep(0.4);
  busy := extensions.dblink_is_busy('sl_b');
  perform extensions.dblink_exec('sl_a', 'commit');
  select t.c into b from extensions.dblink_get_result('sl_b') as t(c text);
  perform extensions.dblink_disconnect('sl_a');
  perform extensions.dblink_disconnect('sl_b');
  if a is null or a <> b or busy <> 1 or (select count(*) from public.directlab_review_links where google_place_id = 'ChIJconcorrente000001') <> 1 then
    raise exception 'FALHA SL12: a=% b=% esperou=%', a, b, busy; end if;
  raise notice 'OK SL12: duas gerações simultâneas do mesmo local (conexões separadas): a segunda espera e recebe o MESMO código (%); 1 registro', a;
end $$;
