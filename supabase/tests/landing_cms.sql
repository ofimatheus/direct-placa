-- CMS da landing (migration 027): rascunho × publicado, publicação atômica,
-- permissões (ADMIN, revendedor, público), mídia e políticas do bucket.
--   psql -d placas_test -f supabase/tests/landing_cms.sql
\set ON_ERROR_STOP 1
grant select, insert, update, delete on storage.objects to anon, authenticated;

insert into auth.users (id, email) values
  ('a8000000-0000-0000-0000-00000000000a', 'lp-admin@teste.com'),
  ('a8000000-0000-0000-0000-0000000000a1', 'lp-r1@teste.com');
update public.profiles set role = 'admin' where email = 'lp-admin@teste.com';
insert into public.reseller_profiles (id, user_id, company_name) values ('a8100000-0000-0000-0000-000000000001', 'a8000000-0000-0000-0000-0000000000a1', 'LP Um');

create function pg_temp.as_admin() returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', 'a8000000-0000-0000-0000-00000000000a', true); execute 'set local role authenticated'; end $$;
create function pg_temp.doc(t text) returns jsonb language sql as $$ select jsonb_build_object('schemaVersion', 1, 'marca', t) $$;
create function pg_temp.public_marca() returns text language plpgsql as $$
declare v text; begin execute 'set local role anon'; select content ->> 'marca' into v from public.public_landing_content(); execute 'reset role'; return v; end $$;

-- ===================== LC1: nada publicado → público vê nada (a aplicação usa o padrão) =====================
do $$
begin
  if pg_temp.public_marca() is not null then raise exception 'FALHA LC1'; end if;
  raise notice 'OK LC1: sem publicação, a leitura pública não devolve nada (a aplicação mostra o conteúdo padrão)';
end $$;

-- ===================== LC2: rascunho não aparece para o público =====================
do $$
declare v int;
begin
  perform pg_temp.as_admin();
  v := public.admin_landing_save_draft(pg_temp.doc('rascunho-1'), 0);
  execute 'reset role';
  if v <> 1 or pg_temp.public_marca() is not null then raise exception 'FALHA LC2 v=%', v; end if;
  raise notice 'OK LC2: ADMIN salva o rascunho (versão 1) e o público continua sem ver nada';
end $$;

-- ===================== LC3: publicar → público vê exatamente o rascunho =====================
do $$
declare t timestamptz; s record;
begin
  perform pg_temp.as_admin();
  t := public.admin_landing_publish(1);
  select * into s from public.admin_landing_state();
  execute 'reset role';
  if pg_temp.public_marca() <> 'rascunho-1' or t is null or s.published_at <> t or s.published_version <> 1 then raise exception 'FALHA LC3 %', s; end if;
  raise notice 'OK LC3: publicar faz o público ver exatamente o rascunho; published_at e published_by registrados';
end $$;

-- ===================== LC4: editar o rascunho não muda o publicado =====================
do $$
begin
  perform pg_temp.as_admin();
  perform public.admin_landing_save_draft(pg_temp.doc('rascunho-2'), 1);
  execute 'reset role';
  if pg_temp.public_marca() <> 'rascunho-1' then raise exception 'FALHA LC4'; end if;
  raise notice 'OK LC4: alterações no rascunho (versão 2) não mudam /revendedores até publicar';
end $$;

-- ===================== LC5: conflitos de versão =====================
do $$
begin
  perform pg_temp.as_admin();
  begin perform public.admin_landing_save_draft(pg_temp.doc('outra-aba'), 1); raise exception 'FALHA LC5 save'; exception when object_not_in_prerequisite_state then null; end;
  begin perform public.admin_landing_publish(1); raise exception 'FALHA LC5 publish'; exception when object_not_in_prerequisite_state then null; end;
  execute 'reset role';
  if pg_temp.public_marca() <> 'rascunho-1' then raise exception 'FALHA LC5 publicado mudou'; end if;
  raise notice 'OK LC5: salvar ou publicar com versão desatualizada (outra aba) é recusado; nada é sobrescrito e o publicado continua';
end $$;

-- ===================== LC6: publicação que falha no meio não deixa nada pela metade =====================
create function public._lc6_fail() returns trigger language plpgsql as $$
begin if new.kind = 'published' and new.content ->> 'marca' = 'rascunho-2' then raise exception 'falha simulada durante a publicação'; end if; return new; end $$;
create trigger _lc6 before insert or update on public.landing_documents for each row execute function public._lc6_fail();
do $$
begin
  perform pg_temp.as_admin();
  begin perform public.admin_landing_publish(2); raise exception 'FALHA LC6 publicou'; exception when raise_exception then null; end;
  execute 'reset role';
  if pg_temp.public_marca() <> 'rascunho-1' then raise exception 'FALHA LC6 publicado parcial'; end if;
  raise notice 'OK LC6: erro durante a publicação → tudo é desfeito; a versão pública anterior continua inteira';
end $$;
drop trigger _lc6 on public.landing_documents;
drop function public._lc6_fail();
do $$
begin
  perform pg_temp.as_admin();
  perform public.admin_landing_publish(2);
  execute 'reset role';
  if pg_temp.public_marca() <> 'rascunho-2' then raise exception 'FALHA LC6b'; end if;
  raise notice 'OK LC6b: sem a falha, a mesma publicação troca o conteúdo de uma vez (rascunho-2 no ar)';
end $$;

-- ===================== LC7: descartar o rascunho =====================
do $$
declare s record;
begin
  perform pg_temp.as_admin();
  perform public.admin_landing_save_draft(pg_temp.doc('descartar-me'), 2);
  perform public.admin_landing_discard_draft();
  select * into s from public.admin_landing_state();
  execute 'reset role';
  if s.draft ->> 'marca' <> 'rascunho-2' or s.draft_version <> 4 or pg_temp.public_marca() <> 'rascunho-2' then raise exception 'FALHA LC7 %', s; end if;
  raise notice 'OK LC7: descartar volta o rascunho ao conteúdo publicado (o público não muda)';
end $$;

-- ===================== LC8: validação do documento no banco =====================
do $$
begin
  perform pg_temp.as_admin();
  begin perform public.admin_landing_save_draft('[]'::jsonb, 4); raise exception 'FALHA LC8 array'; exception when check_violation then null; end;
  begin perform public.admin_landing_save_draft('{"schemaVersion": 99}'::jsonb, 4); raise exception 'FALHA LC8 versão'; exception when check_violation then null; end;
  begin perform public.admin_landing_save_draft(jsonb_build_object('schemaVersion', 1, 'x', repeat('a', 300000)), 4); raise exception 'FALHA LC8 tamanho'; exception when check_violation then null; end;
  execute 'reset role';
  raise notice 'OK LC8: o banco recusa documento que não é objeto, versão de esquema desconhecida e conteúdo acima de 256 KB';
end $$;

-- ===================== LC9: revendedor e público não acessam nada administrativo =====================
do $$
begin
  perform set_config('request.jwt.claim.sub', 'a8000000-0000-0000-0000-0000000000a1', true);
  set local role authenticated;
  begin perform public.admin_landing_state(); raise exception 'FALHA LC9 state'; exception when insufficient_privilege then null; end;
  begin perform public.admin_landing_save_draft(pg_temp.doc('invasao'), 4); raise exception 'FALHA LC9 save'; exception when insufficient_privilege then null; end;
  begin perform public.admin_landing_publish(4); raise exception 'FALHA LC9 publish'; exception when insufficient_privilege then null; end;
  begin perform public.admin_landing_discard_draft(); raise exception 'FALHA LC9 discard'; exception when insufficient_privilege then null; end;
  begin perform public.admin_landing_media_list(); raise exception 'FALHA LC9 media'; exception when insufficient_privilege then null; end;
  begin perform 1 from public.landing_documents; raise exception 'FALHA LC9 tabela'; exception when insufficient_privilege then null; end;
  begin perform 1 from public.landing_media; raise exception 'FALHA LC9 mídia'; exception when insufficient_privilege then null; end;
  if (select content ->> 'marca' from public.public_landing_content()) <> 'rascunho-2' then raise exception 'FALHA LC9 leitura pública'; end if;
  reset role;
  set local role anon;
  begin perform public.admin_landing_state(); raise exception 'FALHA LC9 anon'; exception when insufficient_privilege then null; end;
  begin perform 1 from public.landing_documents; raise exception 'FALHA LC9 anon tabela'; exception when insufficient_privilege then null; end;
  reset role;
  raise notice 'OK LC9: revendedor e público não leem nem alteram rascunho, publicação ou mídia (nem pelas tabelas); só leem o publicado';
end $$;

-- ===================== LC10: bucket landing-assets =====================
do $$
begin
  perform set_config('request.jwt.claim.sub', 'a8000000-0000-0000-0000-0000000000a1', true);
  set local role authenticated;
  begin insert into storage.objects (bucket_id, name) values ('landing-assets', 'media/11111111-1111-4111-8111-111111111111.png'); raise exception 'FALHA LC10 revendedor'; exception when insufficient_privilege then null; end;
  reset role;
  set local role anon;
  begin insert into storage.objects (bucket_id, name) values ('landing-assets', 'media/11111111-1111-4111-8111-111111111111.png'); raise exception 'FALHA LC10 anon'; exception when insufficient_privilege then null; end;
  reset role;
  perform pg_temp.as_admin();
  insert into storage.objects (bucket_id, name) values ('landing-assets', 'media/22222222-2222-4222-8222-222222222222.png');
  begin insert into storage.objects (bucket_id, name) values ('landing-assets', 'media/33333333-3333-4333-8333-333333333333.svg'); raise exception 'FALHA LC10 svg'; exception when insufficient_privilege then null; end;
  begin insert into storage.objects (bucket_id, name) values ('landing-assets', 'qualquer/coisa.png'); raise exception 'FALHA LC10 caminho'; exception when insufficient_privilege then null; end;
  begin update storage.objects set name = 'media/44444444-4444-4444-8444-444444444444.png' where name = 'media/22222222-2222-4222-8222-222222222222.png';
    if found then raise exception 'FALHA LC10 sobrescreveu'; end if;
  exception when insufficient_privilege then null; end;
  execute 'reset role';
  if not exists (select 1 from storage.buckets where id = 'landing-assets' and public and file_size_limit = 4194304 and allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp']) then raise exception 'FALHA LC10 bucket'; end if;
  raise notice 'OK LC10: bucket público landing-assets (4 MB, PNG/JPG/WEBP); só ADMIN envia, só em media/<uuid>.png|jpg|webp (SVG e outros caminhos recusados); nada é sobrescrito; revendedor e público não enviam';
end $$;

-- ===================== LC11: biblioteca de mídia e imagem em uso =====================
do $$
declare v_id uuid; v_path text; s record;
begin
  perform pg_temp.as_admin();
  begin perform public.admin_landing_media_register('media/55555555-5555-4555-8555-555555555555.png', 'image/png', 10, 10, 100); raise exception 'FALHA LC11 sem arquivo'; exception when no_data_found then null; end;
  v_id := public.admin_landing_media_register('media/22222222-2222-4222-8222-222222222222.png', 'image/png', 1200, 800, 50000);
  select * into s from public.admin_landing_state();
  perform public.admin_landing_save_draft(jsonb_build_object('schemaVersion', 1, 'marca', 'com-imagem', 'img', jsonb_build_object('kind', 'media', 'path', 'media/22222222-2222-4222-8222-222222222222.png')), s.draft_version);
  begin perform public.admin_landing_media_delete(v_id); raise exception 'FALHA LC11 apagou em uso'; exception when object_not_in_prerequisite_state then null; end;
  select * into s from public.admin_landing_state();
  perform public.admin_landing_save_draft(pg_temp.doc('sem-imagem'), s.draft_version);
  v_path := public.admin_landing_media_delete(v_id);
  execute 'reset role';
  if v_path <> 'media/22222222-2222-4222-8222-222222222222.png' or exists (select 1 from public.landing_media where id = v_id) then raise exception 'FALHA LC11 exclusão'; end if;
  raise notice 'OK LC11: só registra imagem que existe no bucket; imagem em uso no rascunho/publicado não pode ser excluída; fora de uso, é excluída e o caminho volta para apagar o arquivo';
end $$;
