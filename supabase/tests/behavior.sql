-- Testes de comportamento das migrations (rodar num banco de teste).
-- Cada bloco lança exceção se a regra não for respeitada.
\set ON_ERROR_STOP 1
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@teste.com'),
  ('00000000-0000-0000-0000-00000000000b', 'revenda@teste.com');
update public.profiles set role = 'admin' where email = 'admin@teste.com';
insert into public.reseller_profiles (id, user_id, company_name)
values ('00000000-0000-0000-0000-0000000000cc', '00000000-0000-0000-0000-00000000000b', 'XP Comunicação');

create temp table layout_base as select jsonb_build_object(
  'base_image_path', 'tpl/aaa.png', 'base_image_mime_type', 'image/png',
  'base_image_sha256', repeat('a', 64), 'base_image_size_bytes', 1000,
  'canvas_width', 1000, 'canvas_height', 1500, 'print_width_mm', null, 'print_height_mm', null,
  'qr_x', 250, 'qr_y', 400, 'qr_width', 500, 'qr_height', 500,
  'qr_error_correction', 'M', 'qr_quiet_zone', 4, 'qr_color', '#000000', 'qr_background_color', '#FFFFFF',
  'show_public_code', true, 'code_x', 500, 'code_y', 1000, 'code_font_family', 'inter-bold',
  'code_font_size', 80, 'code_color', '#000000', 'code_align', 'center', 'code_max_width', 800,
  'safe_margin', 40, 'renderer_version', 1) as j;
grant select on layout_base to authenticated;

-- ===== ADMIN =====
begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';

select * from public.create_plate_template('11111111-1111-1111-1111-111111111111', 'Avaliação Google - Preto', 'google-preto', null, (select j from layout_base));

do $$
declare r record;
begin
  -- 1) layout idêntico → unchanged
  select * into r from public.save_template_layout('11111111-1111-1111-1111-111111111111', (select j from layout_base));
  if not r.unchanged or r.created_new then raise exception 'FALHA: layout idêntico deveria ser unchanged'; end if;

  -- 2) versão não usada → edita no lugar (continua v1)
  select * into r from public.save_template_layout('11111111-1111-1111-1111-111111111111', (select j || '{"qr_x": 260}' from layout_base));
  if r.created_new or r.result_version_number <> 1 then raise exception 'FALHA: versão livre deveria ser editada no lugar'; end if;
  raise notice 'OK 1-2: unchanged e edição no lugar da v1';
end $$;

-- 3) criação de lote trava a versão; idempotência devolve o mesmo lote
do $$
declare b1 uuid; b2 uuid; n int; locked timestamptz;
begin
  b1 := public.create_plate_batch('Lote Setembro 2026', null, 100, '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222');
  b2 := public.create_plate_batch('Lote Setembro 2026', null, 100, '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222');
  if b1 <> b2 then raise exception 'FALHA: idempotência'; end if;
  select count(*) into n from public.plates where batch_id = b1;
  if n <> 100 then raise exception 'FALHA: esperava 100 placas, veio %', n; end if;
  select locked_at into locked from public.plate_template_versions where template_id = '11111111-1111-1111-1111-111111111111' and version_number = 1;
  if locked is null then raise exception 'FALHA: v1 deveria estar bloqueada'; end if;
  raise notice 'OK 3: lote criado, 100 placas, v1 bloqueada, request duplicada devolveu o mesmo lote';
end $$;

-- 4) editar template com v1 bloqueada → cria v2; lote antigo continua na v1
do $$
declare r record; v int;
begin
  select * into r from public.save_template_layout('11111111-1111-1111-1111-111111111111', (select j || '{"qr_x": 300}' from layout_base));
  if not r.created_new or r.result_version_number <> 2 then raise exception 'FALHA: deveria criar v2'; end if;
  select pv.version_number into v from public.plate_batches b join public.plate_template_versions pv on pv.id = b.template_version_id
   where b.idempotency_key = '22222222-2222-2222-2222-222222222222';
  if v <> 1 then raise exception 'FALHA: lote antigo mudou de versão'; end if;
  -- v2 ainda livre: nova edição é no lugar
  select * into r from public.save_template_layout('11111111-1111-1111-1111-111111111111', (select j || '{"qr_x": 310}' from layout_base));
  if r.created_new or r.result_version_number <> 2 then raise exception 'FALHA: v2 livre deveria ser editada no lugar'; end if;
  raise notice 'OK 4: v1 bloqueada gerou v2; lote antigo segue apontando para v1';
end $$;

-- 5) versão bloqueada é imutável até para ADMIN
do $$
begin
  begin
    update public.plate_template_versions set qr_x = 1 where version_number = 1 and template_id = '11111111-1111-1111-1111-111111111111';
    raise exception 'FALHA: UPDATE em versão bloqueada foi aceito';
  exception when check_violation then null;
  end;
  begin
    delete from public.plate_template_versions where version_number = 1 and template_id = '11111111-1111-1111-1111-111111111111';
    raise exception 'FALHA: DELETE em versão bloqueada foi aceito';
  exception when check_violation then null;
  end;
  begin
    update public.plate_batches set template_version_id = (select id from public.plate_template_versions where version_number = 2 and template_id = '11111111-1111-1111-1111-111111111111');
    raise exception 'FALHA: troca de versão do lote foi aceita';
  exception when check_violation then null;
  end;
  begin
    update public.plates set public_code = 'ZZZZZZ' where id = (select id from public.plates limit 1);
    raise exception 'FALHA: public_code alterado';
  exception when check_violation then null;
  end;
  raise notice 'OK 5: versão bloqueada, versão do lote e public_code são imutáveis';
end $$;

-- 6) limites de quantidade e template inativo
do $$
begin
  begin perform public.create_plate_batch('X', null, 1001, '11111111-1111-1111-1111-111111111111', gen_random_uuid());
    raise exception 'FALHA: aceitou 1001'; exception when invalid_parameter_value then null; end;
  begin perform public.create_plate_batch('X', null, 0, '11111111-1111-1111-1111-111111111111', gen_random_uuid());
    raise exception 'FALHA: aceitou 0'; exception when invalid_parameter_value then null; end;
  update public.plate_templates set active = false where id = '11111111-1111-1111-1111-111111111111';
  begin perform public.create_plate_batch('X', null, 5, '11111111-1111-1111-1111-111111111111', gen_random_uuid());
    raise exception 'FALHA: template inativo aceito'; exception when object_not_in_prerequisite_state then null; end;
  update public.plate_templates set active = true where id = '11111111-1111-1111-1111-111111111111';
  raise notice 'OK 6: limites 1..1000 e template inativo';
end $$;

-- 7) lote de 1000 com códigos únicos e formato correto
do $$
declare b uuid; n int; d int; bad int;
begin
  b := public.create_plate_batch('Lote grande', 'teste', 1000, '11111111-1111-1111-1111-111111111111', gen_random_uuid());
  select count(*), count(distinct public_code), count(*) filter (where public_code !~ '^[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{6}$')
    into n, d, bad from public.plates where batch_id = b;
  if n <> 1000 or d <> 1000 or bad <> 0 then raise exception 'FALHA: 1000 placas (%/% únicas, % inválidas)', n, d, bad; end if;
  raise notice 'OK 7: 1000 placas, códigos únicos no alfabeto sem ambíguos';
end $$;
commit;

-- 8) colisão de public_code: força o gerador a repetir e confirma retentativa
begin;
create or replace function public.generate_public_code(p_length integer default 6) returns text language plpgsql as $$
begin
  if coalesce(current_setting('test.collide', true), '0')::int < 3 then
    perform set_config('test.collide', (coalesce(current_setting('test.collide', true), '0')::int + 1)::text, true);
    return (select public_code from public.plates limit 1); -- código já existente
  end if;
  return 'Q' || lpad((floor(random()*99999))::int::text, 5, '2');
end $$;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
do $$ declare b uuid; n int; begin
  b := public.create_plate_batch('Colisão', null, 3, '11111111-1111-1111-1111-111111111111', gen_random_uuid());
  select count(*) into n from public.plates where batch_id = b;
  if n <> 3 then raise exception 'FALHA: colisão não tratada (% placas)', n; end if;
  raise notice 'OK 8: colisões de public_code retentadas sem erro';
end $$;
rollback;

-- ===== RESELLER =====
begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
do $$
declare n int;
begin
  select count(*) into n from public.plate_templates; if n <> 0 then raise exception 'FALHA: revendedor vê templates'; end if;
  select count(*) into n from public.plate_template_versions; if n <> 0 then raise exception 'FALHA: revendedor vê versões'; end if;
  select count(*) into n from public.plate_batches; if n <> 0 then raise exception 'FALHA: revendedor vê lotes'; end if;
  select count(*) into n from public.plates; if n <> 0 then raise exception 'FALHA: revendedor vê placas não atribuídas'; end if;
  begin perform public.create_plate_batch('X', null, 5, '11111111-1111-1111-1111-111111111111', gen_random_uuid());
    raise exception 'FALHA: revendedor criou lote'; exception when insufficient_privilege then null; end;
  begin perform * from public.save_template_layout('11111111-1111-1111-1111-111111111111', '{}'::jsonb);
    raise exception 'FALHA: revendedor editou template'; exception when insufficient_privilege then null; end;
  insert into public.plate_templates (name, internal_key) values ('hack', 'hack');
  raise exception 'FALHA: revendedor inseriu template';
exception when insufficient_privilege then
  raise notice 'OK 9: revendedor bloqueado em templates, versões, lotes e RPCs (RLS + 42501)';
end $$;
update public.profiles set role = 'admin' where id = auth.uid();
do $$ begin
  if (select role from public.profiles where id = '00000000-0000-0000-0000-00000000000b') <> 'reseller' then
    raise exception 'FALHA: revendedor se promoveu a admin'; end if;
  raise notice 'OK 10: revendedor não consegue se promover';
end $$;
commit;

-- ===== Atribuição e redirect público =====
update public.plates set reseller_id = '00000000-0000-0000-0000-0000000000cc', status = 'active', destination_url = 'https://g.page/r/exemplo'
 where id = (select id from public.plates order by public_code limit 1);
begin;
set local role anon;
do $$
declare r record; c text; n int;
begin
  select public_code into c from public.plates where false; -- anon não lê plates (RLS)
  select count(*) into n from public.plates; if n <> 0 then raise exception 'FALHA: anon lê plates'; end if;
  raise notice 'OK 11: anon não lê a tabela plates';
end $$;
commit;
do $$
declare r record; c text;
begin
  select public_code into c from public.plates where destination_url is not null limit 1;
  set local role anon;
  select * into r from public.resolve_plate_redirect(lower(c), 'qr');
  if r.outcome <> 'ok' or r.target_url <> 'https://g.page/r/exemplo' then raise exception 'FALHA: redirect qr'; end if;
  select * into r from public.resolve_plate_redirect(c, 'nfc');
  select * into r from public.resolve_plate_redirect('NAOEXISTE1', 'qr');
  if r.outcome <> 'not_found' then raise exception 'FALHA: not_found'; end if;
  select * into r from public.resolve_plate_redirect('<script>', 'qr');
  if r.outcome <> 'not_found' then raise exception 'FALHA: código inválido'; end if;
  reset role;
  if (select count(*) filter (where r2.source = 'qr') from public.redirects r2 join public.plates p on p.id = r2.plate_id where p.public_code = c) <> 1
     or (select count(*) filter (where r2.source = 'nfc') from public.redirects r2 join public.plates p on p.id = r2.plate_id where p.public_code = c) <> 1
    then raise exception 'FALHA: redirects.source'; end if;
  if (select count(*) from public.redirects r2 join public.plates p on p.id = r2.plate_id where p.public_code = c) <> 2 then raise exception 'FALHA: log de redirects'; end if;
  raise notice 'OK 12: redirect ok/not_found e log por origem (qr/nfc) em redirects.source';
end $$;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
do $$ declare n int; begin
  select count(*) into n from public.plates; if n <> 1 then raise exception 'FALHA: revendedor deveria ver 1 placa, viu %', n; end if;
  raise notice 'OK 13: revendedor vê apenas a placa atribuída a ele';
end $$;
commit;

-- ===== Jobs =====
do $$
declare e uuid; r record; n int;
begin
  insert into public.batch_exports (batch_id, kind) select id, 'csv' from public.plate_batches limit 1 returning id into e;
  begin
    insert into public.batch_exports (batch_id, kind) select batch_id, 'csv' from public.batch_exports where id = e;
    raise exception 'FALHA: job duplicado aceito';
  exception when unique_violation then null; end;
  select count(*) into n from public.claim_batch_export(e, 90); if n <> 1 then raise exception 'FALHA: claim'; end if;
  select count(*) into n from public.claim_batch_export(e, 90); if n <> 0 then raise exception 'FALHA: claim duplo'; end if;
  update public.batch_exports set lease_expires_at = now() - interval '1 second' where id = e;
  select count(*) into n from public.claim_batch_export(e, 90); if n <> 1 then raise exception 'FALHA: retomada após lease expirado'; end if;
  raise notice 'OK 14: fila com job único por tipo, claim exclusivo e retomada após lease expirado';
end $$;
