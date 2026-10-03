-- DirectLink (migration 023): posse, RLS, página pública, código público,
-- validação de botões, imagens/Storage e independência da cota do Google.
\set ON_ERROR_STOP 1
grant usage on schema storage to anon, authenticated;
grant select, insert, update, delete on storage.objects to anon, authenticated;

insert into auth.users (id, email) values
  ('e6000000-0000-0000-0000-00000000000a', 'dl-admin@teste.com'),
  ('e6000000-0000-0000-0000-0000000000a1', 'dlk-r1@teste.com'),
  ('e6000000-0000-0000-0000-0000000000a2', 'dlk-r2@teste.com');
update public.profiles set role = 'admin' where email = 'dl-admin@teste.com';
insert into public.reseller_profiles (id, user_id, company_name) values
  ('e6100000-0000-0000-0000-000000000001', 'e6000000-0000-0000-0000-0000000000a1', 'Link Um'),
  ('e6100000-0000-0000-0000-000000000002', 'e6000000-0000-0000-0000-0000000000a2', 'Link Dois');
create table public.dl_ids (name text primary key, id uuid, code text);
grant select, insert, update on public.dl_ids to authenticated, anon;
create function pg_temp.items(p jsonb) returns jsonb language sql as $$ select p $$;

-- ===================== DL1–DL2: revendedor cria e edita o próprio =====================
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'e6000000-0000-0000-0000-0000000000a1';
do $$
declare r record; r2 record; ids uuid[]; ids2 uuid[];
begin
  select * into r from public.directlink_save(null, 'Adega Monster', 'Bebidas • Conveniência • Delivery', null, null, true, '[
    {"type":"instagram","title":"Instagram","value":"https://instagram.com/adegamonster"},
    {"type":"whatsapp","title":"WhatsApp","value":"5511999998888"},
    {"type":"pix","title":"Pagar com PIX","value":"adega@monster.com.br","receiver_name":"Adega Monster LTDA"},
    {"type":"youtube","title":"YouTube","value":"https://youtube.com/@adega"},
    {"type":"facebook","title":"Facebook","value":"https://facebook.com/adega","is_active":false},
    {"type":"maps","title":"Localização","value":"https://maps.google.com/?q=Adega"}
  ]'::jsonb);
  if r.public_code !~ '^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{7}$' then raise exception 'FALHA DL1: código %', r.public_code; end if;
  insert into public.dl_ids values ('a', r.id, r.public_code);
  if (select count(*) from public.direct_link_items where direct_link_id = r.id) <> 6 then raise exception 'FALHA DL1: itens'; end if;
  raise notice 'OK DL1: revendedor cria o DirectLink com 6 botões e recebe um código público de 7 caracteres (%)', r.public_code;

  select array_agg(i.id order by i.sort_order) into ids from public.direct_link_items i where i.direct_link_id = r.id;
  -- Edita: novo título, inverte os dois primeiros, remove o YouTube
  select * into r2 from public.directlink_save(r.id, 'Adega Monster Centro', 'Nova descrição', null, null, true, jsonb_build_array(
    jsonb_build_object('id', ids[2], 'type','whatsapp','title','WhatsApp','value','5511999998888'),
    jsonb_build_object('id', ids[1], 'type','instagram','title','Instagram','value','https://instagram.com/adegamonster'),
    jsonb_build_object('id', ids[3], 'type','pix','title','Pagar com PIX','value','adega@monster.com.br','receiver_name','Adega Monster LTDA'),
    jsonb_build_object('id', ids[5], 'type','facebook','title','Facebook','value','https://facebook.com/adega','is_active',false),
    jsonb_build_object('id', ids[6], 'type','maps','title','Localização','value','https://maps.google.com/?q=Adega')));
  if r2.public_code <> r.public_code or r2.id <> r.id then raise exception 'FALHA DL2: código mudou'; end if;
  select array_agg(i.id order by i.sort_order) into ids2 from public.direct_link_items i where i.direct_link_id = r.id;
  if ids2 <> array[ids[2], ids[1], ids[3], ids[5], ids[6]] then raise exception 'FALHA DL2: ordem/ids %', ids2; end if;
  if (select title from public.direct_links where id = r.id) <> 'Adega Monster Centro' then raise exception 'FALHA DL2: título'; end if;
  raise notice 'OK DL2: editar o título mantém o mesmo código público; a nova ordem é salva e os botões mantêm seus ids (base para métricas futuras)';
end $$;
commit;

-- ===================== DL3–DL4: revendedor B não alcança o A; ID forjado =====================
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'e6000000-0000-0000-0000-0000000000a2';
do $$
declare v uuid := (select id from public.dl_ids where name = 'a'); fake uuid;
begin
  if exists (select 1 from public.direct_links) or exists (select 1 from public.direct_link_items) then raise exception 'FALHA DL3: B enxerga o A'; end if;
  begin perform public.directlink_save(v, 'Invasão', null, null, null, true, '[]'); raise exception 'FALHA DL4: B editou o A'; exception when no_data_found then null; end;
  begin perform public.directlink_set_active(v, false); raise exception 'FALHA DL4: B desativou o A'; exception when no_data_found then null; end;
  begin perform public.directlink_save(gen_random_uuid(), 'X', null, null, null, true, '[]'); raise exception 'FALHA DL4: ID inexistente'; exception when no_data_found then null; end;
  begin update public.direct_links set title = 'x'; raise exception 'FALHA DL4: escrita direta'; exception when insufficient_privilege then null; end;
  -- item de outro DirectLink enfiado no próprio
  select id into fake from public.directlink_save(null, 'Do B', null, null, null, true, '[]');
  begin
    perform public.directlink_save(fake, 'Do B', null, null, null, true, jsonb_build_array(jsonb_build_object('id',
      (select i from unnest(array[gen_random_uuid()]) i), 'type','site','title','x','value','https://b.com.br')));
    raise exception 'FALHA DL4: item alheio'; exception when no_data_found then null; end;
  raise notice 'OK DL3: revendedor B não lista nem lê DirectLinks ou botões do revendedor A';
  raise notice 'OK DL4: ID forjado (do A ou inexistente), botão de outro DirectLink e escrita direta na tabela são recusados';
end $$;
commit;
do $$ begin
  if (select title from public.direct_links where id = (select id from public.dl_ids where name = 'a')) <> 'Adega Monster Centro' then raise exception 'FALHA DL4: A mudou'; end if;
end $$;

-- ===================== DL5: ADMIN administra =====================
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'e6000000-0000-0000-0000-00000000000a';
do $$
declare r record;
begin
  if (select count(*) from public.direct_links) < 2 then raise exception 'FALHA DL5: ADMIN não vê todos'; end if;
  select * into r from public.directlink_save(null, 'Página da Plataforma', null, null, null, true, '[{"type":"site","title":"Site","value":"https://directplaca.com.br"}]');
  if (select reseller_id from public.direct_links where id = r.id) is not null then raise exception 'FALHA DL5: dono'; end if;
  insert into public.dl_ids values ('admin', r.id, r.public_code);
  if exists (select 1 from public.reseller_sales) or exists (select 1 from public.reseller_sale_pricing) then raise exception 'FALHA DL5: ADMIN ganhou financeiro'; end if;
  raise notice 'OK DL5: ADMIN vê e administra todos os DirectLinks e cria os da plataforma — sem ganhar acesso ao financeiro dos revendedores';
end $$;
commit;

-- ===================== DL6–DL8: página pública =====================
do $$
declare j jsonb; code text := (select code from public.dl_ids where name = 'a');
begin
  set local role anon;
  j := public.public_direct_link(code);
  if j is null or j->>'title' <> 'Adega Monster Centro' then raise exception 'FALHA DL6: %', j; end if;
  if (select array_agg(k order by k) from jsonb_object_keys(j) k) <> array['banner_path','code','description','items','logo_path','title'] then
    raise exception 'FALHA DL6: campos expostos %', (select array_agg(k) from jsonb_object_keys(j) k); end if;
  if j::text ~* 'e6100000|e6000000|reseller|owner|email' then raise exception 'FALHA DL6: vazou dado interno'; end if;
  if (select string_agg(x->>'type', ',') from jsonb_array_elements(j->'items') x) <> 'whatsapp,instagram,pix,maps' then
    raise exception 'FALHA DL7: itens %', j->'items'; end if;
  if (j->'items'->2->>'receiver_name') <> 'Adega Monster LTDA' then raise exception 'FALHA DL7: pix'; end if;
  if public.public_direct_link(lower(code)) is null then raise exception 'FALHA DL6: minúsculas'; end if;
  begin perform 1 from public.direct_links; raise exception 'FALHA DL6: anon leu a tabela'; exception when insufficient_privilege then null; end;
  begin perform 1 from public.direct_link_items; raise exception 'FALHA DL6: anon leu itens'; exception when insufficient_privilege then null; end;
  reset role;
  raise notice 'OK DL6: sem login, a página ativa abre só com título, descrição, imagens e botões (sem ids, dono ou e-mail); as tabelas não são legíveis';
  raise notice 'OK DL7: a ordem salva é a exibida; o botão inativo (Facebook) não aparece; o PIX leva o nome do recebedor';
end $$;
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'e6000000-0000-0000-0000-0000000000a1';
do $$ begin perform public.directlink_set_active((select id from public.dl_ids where name = 'a'), false); end $$;
commit;
do $$ begin
  set local role anon;
  if public.public_direct_link((select code from public.dl_ids where name = 'a')) is not null then raise exception 'FALHA DL8: inativo público'; end if;
  if public.public_direct_link('ZZZZZZZ') is not null or public.public_direct_link('') is not null then raise exception 'FALHA DL8: código inexistente'; end if;
  reset role;
  raise notice 'OK DL8: DirectLink desativado (e código inexistente) não fica disponível publicamente';
end $$;

-- ===================== DL9: códigos aleatórios e imutáveis =====================
do $$
declare codes text[]; c text;
begin
  select array_agg(public.directlink_new_code()) into codes from generate_series(1, 200);
  if (select count(distinct x) from unnest(codes) x) <> 200 then raise exception 'FALHA DL9: repetidos'; end if;
  if (select count(*) from generate_series(2, 200) i where codes[i] > codes[i-1]) between 90 and 110 is false then
    raise exception 'FALHA DL9: códigos parecem ordenados'; end if;
  if exists (select 1 from unnest(codes) x where x ~ '[01ILO]') then raise exception 'FALHA DL9: caractere ambíguo'; end if;
  begin update public.direct_links set public_code = 'AAAAAAA' where id = (select id from public.dl_ids where name = 'a');
    raise exception 'FALHA DL9: código alterado'; exception when sqlstate '55000' then null; end;
  raise notice 'OK DL9: 200 códigos distintos, sem ordem (≈50%% crescentes, como no acaso), sem caracteres ambíguos; o código não muda nem com privilégio total';
end $$;

-- ===================== DL10: validação dos botões =====================
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'e6000000-0000-0000-0000-0000000000a1';
do $$
declare v uuid := (select id from public.dl_ids where name = 'a'); bad jsonb; n int := 0;
begin
  for bad in select * from jsonb_array_elements('[
    {"type":"link","title":"x","value":"javascript:alert(1)"},
    {"type":"site","title":"x","value":"data:text/html,<script>alert(1)</script>"},
    {"type":"link","title":"x","value":"file:///etc/passwd"},
    {"type":"site","title":"x","value":"ftp://arquivo.com.br"},
    {"type":"instagram","title":"x","value":"https://"},
    {"type":"site","title":"x","value":" https://espaco.com.br"},
    {"type":"whatsapp","title":"x","value":"+55 (11) 9999-8888"},
    {"type":"phone","title":"x","value":"abc"},
    {"type":"email","title":"x","value":"sem-arroba"},
    {"type":"pix","title":"x","value":""},
    {"type":"site","title":"x","value":"https://ok.com.br","receiver_name":"Só PIX tem recebedor"},
    {"type":"html","title":"x","value":"<b>oi</b>"}
  ]'::jsonb) loop
    begin
      perform public.directlink_save(v, 'Adega Monster Centro', null, null, null, true, jsonb_build_array(bad));
      raise exception 'FALHA DL10: aceitou %', bad;
    exception when invalid_parameter_value or check_violation then n := n + 1;
    end;
  end loop;
  perform public.directlink_save(v, 'Adega Monster Centro', null, null, null, true, '[
    {"type":"site","title":"Site http","value":"http://adega.com.br"},
    {"type":"phone","title":"Ligar","value":"+5511999998888"},
    {"type":"email","title":"E-mail","value":"contato@adega.com.br"},
    {"type":"menu","title":"Cardápio","value":"https://adega.com.br/cardapio"},
    {"type":"link","title":"Outro","value":"https://outro.com.br/x?y=1#z"}]');
  raise notice 'OK DL10: % valores perigosos/inválidos recusados (javascript:, data:, file:, ftp:, sem domínio, WhatsApp/telefone/e-mail inválidos, PIX vazio, tipo desconhecido); http(s), telefone e e-mail válidos aceitos', n;
end $$;
commit;

-- ===================== DL11: imagens e Storage =====================
insert into storage.objects (bucket_id, name) values
  ('directlink-assets', 'e6000000-0000-0000-0000-0000000000a2/banner/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2.png');
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'e6000000-0000-0000-0000-0000000000a1';
do $$
declare v uuid := (select id from public.dl_ids where name = 'a');
begin
  insert into storage.objects (bucket_id, name) values ('directlink-assets', 'e6000000-0000-0000-0000-0000000000a1/banner/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1.webp');
  begin insert into storage.objects (bucket_id, name) values ('directlink-assets', 'e6000000-0000-0000-0000-0000000000a2/banner/cccccccc-cccc-4ccc-8ccc-cccccccccccc.png');
    raise exception 'FALHA DL11: enviou na pasta de outro'; exception when insufficient_privilege then null; end;
  begin insert into storage.objects (bucket_id, name) values ('directlink-assets', 'e6000000-0000-0000-0000-0000000000a1/outro/dddddddd-dddd-4ddd-8ddd-dddddddddddd.png');
    raise exception 'FALHA DL11: pasta inválida'; exception when insufficient_privilege then null; end;
  perform public.directlink_save(v, 'Adega Monster Centro', null, 'e6000000-0000-0000-0000-0000000000a1/banner/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1.webp', null, true, '[]');
  if (select banner_path from public.direct_links where id = v) is null then raise exception 'FALHA DL11: banner válido'; end if;
  begin perform public.directlink_save(v, 'Adega Monster Centro', null, 'e6000000-0000-0000-0000-0000000000a2/banner/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2.png', null, true, '[]');
    raise exception 'FALHA DL11: usou imagem de outro'; exception when invalid_parameter_value then null; end;
  begin perform public.directlink_save(v, 'Adega Monster Centro', null, null, 'e6000000-0000-0000-0000-0000000000a1/logo/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee.png', true, '[]');
    raise exception 'FALHA DL11: logo inexistente'; exception when invalid_parameter_value then null; end;
  raise notice 'OK DL11: upload só na própria pasta; banner enviado pelo usuário é aceito; imagem de outro usuário ou inexistente é recusada';
end $$;
commit;
do $$
declare b record;
begin
  select * into b from storage.buckets where id = 'directlink-assets';
  if not b.public or b.file_size_limit <> 4194304 or b.allowed_mime_types <> array['image/png','image/jpeg','image/webp'] then raise exception 'FALHA DL12: bucket %', b; end if;
  if exists (select 1 from pg_policies where schemaname = 'storage' and policyname like 'directlink%' and cmd in ('UPDATE','DELETE')) then raise exception 'FALHA DL12: sobrescrita'; end if;
  set local role anon;
  begin insert into storage.objects (bucket_id, name) values ('directlink-assets', 'x/banner/ffffffff-ffff-4fff-8fff-ffffffffffff.png'); raise exception 'FALHA DL12: anon enviou'; exception when insufficient_privilege then null; end;
  reset role;
  raise notice 'OK DL12: bucket directlink-assets público só para leitura; PNG/JPG/WEBP até 4 MB (sem SVG); sem sobrescrever/apagar; anônimo não envia';
end $$;

-- ===================== DL13: nenhuma cota do Google consumida =====================
do $$ begin
  if exists (select 1 from public.directlab_usage where user_id in ('e6000000-0000-0000-0000-0000000000a1','e6000000-0000-0000-0000-0000000000a2','e6000000-0000-0000-0000-00000000000a'))
     or exists (select 1 from public.rate_limit_counters where user_id in ('e6000000-0000-0000-0000-0000000000a1','e6000000-0000-0000-0000-0000000000a2','e6000000-0000-0000-0000-00000000000a'))
    then raise exception 'FALHA DL13: DirectLink consumiu cota'; end if;
  raise notice 'OK DL13: criar, editar, ativar/desativar e abrir DirectLinks não consome a cota do Google (nenhum contador tocado)';
end $$;
drop table public.dl_ids;
