-- Testes da personalização da tela de login (migration 019): leitura
-- pública mínima, escrita só por ADMIN e políticas do bucket 'branding'.
-- Rodar num banco de TESTE, depois das migrations.
\set ON_ERROR_STOP 1

-- No Supabase, anon/authenticated têm privilégio de tabela em storage.objects e
-- quem decide é a RLS. O stub reproduz isso aqui.
grant usage on schema storage to anon, authenticated;
grant select, insert, update, delete on storage.objects to anon, authenticated;

insert into auth.users (id, email) values
  ('e2000000-0000-0000-0000-00000000000a', 'brand-admin@teste.com'),
  ('e2000000-0000-0000-0000-0000000000b1', 'brand-r1@teste.com');
update public.profiles set role = 'admin' where email = 'brand-admin@teste.com';
insert into public.reseller_profiles (id, user_id, company_name) values
  ('e2100000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-0000000000b1', 'Revenda Branding');

-- Estado inicial conhecido (outros arquivos de teste não mexem no branding).
update public.branding_settings set brand_name = null, eyebrow = null, title = null, subtitle = null,
  logo_path = null, banner_path = null, show_brand_name = true;

-- ===================== G1–G2: leitura pública mínima =====================
do $$
declare r record; n int;
begin
  set local role anon;
  select count(*) into n from public.public_login_branding();
  select * into r from public.public_login_branding();
  if n <> 1 or r.brand_name is not null or r.title is not null or r.logo_path is not null or not r.show_brand_name
    then raise exception 'FALHA G1: sem personalização a leitura pública deveria vir vazia (padrão): %', r; end if;
  begin
    perform 1 from public.branding_settings;
    raise exception 'FALHA G2: anon leu a tabela de configurações';
  exception when insufficient_privilege then null; end;
  reset role;
  raise notice 'OK G1: sem personalização, a tela de login recebe tudo nulo e usa o padrão DirectPlaca';
  raise notice 'OK G2: usuário não autenticado só lê pela RPC pública (a tabela não é legível)';
end $$;

do $$
declare cols text;
begin
  select string_agg(p.parameter_name, ',' order by p.ordinal_position) into cols
  from information_schema.parameters p
  join information_schema.routines r on r.specific_name = p.specific_name
  where r.routine_schema = 'public' and r.routine_name = 'public_login_branding' and p.parameter_mode = 'OUT';
  if cols <> 'brand_name,show_brand_name,eyebrow,title,subtitle,logo_path,banner_path' then
    raise exception 'FALHA G2b: a leitura pública expõe campos além do necessário: %', cols;
  end if;
  raise notice 'OK G2b: a leitura pública expõe só textos e caminhos das imagens (sem updated_by nem dados internos)';
end $$;

-- ===================== G3: revendedor não altera =====================
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'e2000000-0000-0000-0000-0000000000b1';
do $$ begin
  begin perform public.admin_save_branding('Invasor', true, null, 'Hackeado', null, null, null);
    raise exception 'FALHA G3: revendedor salvou branding'; exception when insufficient_privilege then null; end;
  begin perform public.admin_reset_branding();
    raise exception 'FALHA G3: revendedor restaurou branding'; exception when insufficient_privilege then null; end;
  begin update public.branding_settings set title = 'x';
    raise exception 'FALHA G3: revendedor alterou a tabela'; exception when insufficient_privilege then null; end;
  if (select count(*) from public.branding_settings) <> 0 then raise exception 'FALHA G3: revendedor leu a tabela'; end if;
  begin insert into storage.objects (bucket_id, name) values ('branding', 'logo/11111111-1111-4111-8111-111111111111.png');
    raise exception 'FALHA G3: revendedor enviou arquivo de branding'; exception when insufficient_privilege then null; end;
  raise notice 'OK G3: revendedor não altera o branding nem envia imagens';
end $$;
commit;

do $$ begin
  set local role anon;
  begin perform public.admin_save_branding('x', true, null, null, null, null, null);
    raise exception 'FALHA G3b: anon salvou'; exception when insufficient_privilege then null; end;
  begin insert into storage.objects (bucket_id, name) values ('branding', 'logo/11111111-1111-4111-8111-111111111111.png');
    raise exception 'FALHA G3b: anon enviou arquivo'; exception when insufficient_privilege then null; end;
  reset role;
  raise notice 'OK G3b: usuário não autenticado não altera nem envia nada';
end $$;

-- ===================== G4–G7: ADMIN altera, troca e restaura =====================
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'e2000000-0000-0000-0000-00000000000a';
do $$
declare r record;
begin
  -- Upload simulado (é o que a rota de upload faz com a sessão do ADMIN).
  insert into storage.objects (bucket_id, name) values
    ('branding', 'logo/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1.png'),
    ('branding', 'banner/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1.webp'),
    ('branding', 'banner/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2.jpg');
  begin insert into storage.objects (bucket_id, name) values ('branding', 'outra-pasta/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9.png');
    raise exception 'FALHA G4: aceitou arquivo fora de logo/ e banner/'; exception when insufficient_privilege then null; end;

  begin perform public.admin_save_branding('X', true, null, null, null, 'logo/cccccccc-cccc-4ccc-8ccc-cccccccccccc.png', null);
    raise exception 'FALHA G4: aceitou logo que não existe no bucket'; exception when invalid_parameter_value then null; end;

  perform public.admin_save_branding('Minha Marca', false, 'Área do parceiro', 'Bem-vindo', 'Texto de apoio',
    'logo/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1.png', 'banner/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1.webp');
  select * into r from public.public_login_branding();
  if r.brand_name <> 'Minha Marca' or r.show_brand_name or r.eyebrow <> 'Área do parceiro' or r.title <> 'Bem-vindo'
     or r.subtitle <> 'Texto de apoio' or r.logo_path <> 'logo/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1.png'
     or r.banner_path <> 'banner/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1.webp'
    then raise exception 'FALHA G4: leitura pública após salvar: %', r; end if;
  raise notice 'OK G4: ADMIN salva textos, logo e banner (só imagens realmente enviadas ao bucket, só em logo/ e banner/)';

  -- Trocar o banner: o arquivo antigo continua no bucket.
  perform public.admin_save_branding('Minha Marca', false, 'Área do parceiro', 'Bem-vindo', 'Texto de apoio',
    'logo/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1.png', 'banner/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2.jpg');
  if (select banner_path from public.public_login_branding()) <> 'banner/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2.jpg'
     or not exists (select 1 from storage.objects where name = 'banner/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1.webp')
    then raise exception 'FALHA G5: troca de banner'; end if;
  raise notice 'OK G5: trocar o banner passa a valer na hora e não apaga o arquivo anterior';

  -- Caminhos fora do padrão (outra extensão, pasta errada) são recusados pelo banco.
  insert into storage.objects (bucket_id, name) values ('branding', 'logo/dddddddd-dddd-4ddd-8ddd-dddddddddddd.svg');
  begin perform public.admin_save_branding(null, true, null, null, null, 'logo/dddddddd-dddd-4ddd-8ddd-dddddddddddd.svg', null);
    raise exception 'FALHA G6: aceitou SVG'; exception when check_violation then null; end;
  begin perform public.admin_save_branding(null, true, null, null, null, 'banner/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1.webp', null);
    raise exception 'FALHA G6: aceitou banner no lugar da logo'; exception when check_violation then null; end;
  begin perform public.admin_save_branding(null, true, null, repeat('x', 61), null, null, null);
    raise exception 'FALHA G6: título longo demais'; exception when check_violation then null; end;
  raise notice 'OK G6: caminho com outra extensão, pasta trocada e textos longos demais são recusados';

  select * into r from public.admin_reset_branding();
  select * into r from public.public_login_branding();
  if r.brand_name is not null or r.title is not null or r.subtitle is not null or r.logo_path is not null
     or r.banner_path is not null or not r.show_brand_name
    then raise exception 'FALHA G7: restaurar padrão: %', r; end if;
  if (select count(*) from storage.objects where bucket_id = 'branding') < 3 then raise exception 'FALHA G7: restaurar apagou arquivos'; end if;
  raise notice 'OK G7: restaurar padrão volta tudo ao padrão DirectPlaca sem apagar arquivos';
end $$;
commit;

-- ===================== G8: configuração do bucket =====================
do $$
declare b record;
begin
  select * into b from storage.buckets where id = 'branding';
  if not b.public or b.file_size_limit <> 4194304
     or b.allowed_mime_types <> array['image/png', 'image/jpeg', 'image/webp']
    then raise exception 'FALHA G8: bucket %', b; end if;
  if exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
             and policyname like 'branding%' and cmd in ('UPDATE', 'DELETE'))
    then raise exception 'FALHA G8: bucket permite sobrescrever ou apagar'; end if;
  raise notice 'OK G8: bucket público só para leitura das imagens; PNG/JPG/WEBP até 4 MB; sem SVG; sem sobrescrever nem apagar';
end $$;
