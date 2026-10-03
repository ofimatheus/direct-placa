-- Testes da redefinição de senha pelo ADMIN (migration 016): autorização no
-- banco e trilha de auditoria. A troca da senha em si é feita pelo Supabase
-- Auth (fora do banco da aplicação) e é testada com a camada administrativa
-- simulada em scripts/test-password-reset.ts.
\set ON_ERROR_STOP 1

insert into auth.users (id, email) values
  ('d9000000-0000-0000-0000-00000000000a', 'sec-admin@teste.com'),
  ('d9000000-0000-0000-0000-0000000000b1', 'sec-r1@teste.com'),
  ('d9000000-0000-0000-0000-0000000000b2', 'sec-r2@teste.com');
update public.profiles set role = 'admin' where email = 'sec-admin@teste.com';
insert into public.reseller_profiles (id, user_id, company_name) values
  ('d9100000-0000-0000-0000-000000000001', 'd9000000-0000-0000-0000-0000000000b1', 'Revenda Segura Um'),
  ('d9100000-0000-0000-0000-000000000002', 'd9000000-0000-0000-0000-0000000000b2', 'Revenda Segura Dois');

-- ===================== P1: revendedor não redefine senha de ninguém =====================
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'd9000000-0000-0000-0000-0000000000b1';
do $$ begin
  begin perform public.admin_reseller_auth_user('d9100000-0000-0000-0000-000000000002');
    raise exception 'FALHA P1: revendedor obteve o usuário de outro revendedor'; exception when insufficient_privilege then null; end;
  begin perform public.admin_reseller_auth_user('d9100000-0000-0000-0000-000000000001');
    raise exception 'FALHA P1: revendedor usou a operação administrativa na própria conta'; exception when insufficient_privilege then null; end;
  begin perform public.admin_record_password_reset('d9100000-0000-0000-0000-000000000002', true);
    raise exception 'FALHA P1: revendedor registrou redefinição'; exception when insufficient_privilege then null; end;
  begin insert into public.admin_audit_events (event_type, target_reseller_id) values ('reseller_password_reset', 'd9100000-0000-0000-0000-000000000002');
    raise exception 'FALHA P1: revendedor escreveu na auditoria'; exception when insufficient_privilege then null; end;
  if (select count(*) from public.admin_audit_events) <> 0 then raise exception 'FALHA P1: revendedor leu a auditoria'; end if;
  raise notice 'OK P1: revendedor não redefine senha de outro usuário nem da própria conta pela via administrativa (42501)';
end $$;
commit;

do $$ begin
  set local role anon;
  begin perform public.admin_reseller_auth_user('d9100000-0000-0000-0000-000000000001');
    raise exception 'FALHA P2: anon chamou a operação'; exception when insufficient_privilege then null; end;
  reset role;
  raise notice 'OK P2: usuário não autenticado não chama a operação';
end $$;

-- ===================== P3: ADMIN válido =====================
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'd9000000-0000-0000-0000-00000000000a';
do $$
declare v_user uuid; v_at timestamptz; e public.admin_audit_events%rowtype; pr public.profiles%rowtype;
begin
  v_user := public.admin_reseller_auth_user('d9100000-0000-0000-0000-000000000001');
  if v_user <> 'd9000000-0000-0000-0000-0000000000b1' then raise exception 'FALHA P3: usuário resolvido errado'; end if;

  begin perform public.admin_reseller_auth_user(gen_random_uuid());
    raise exception 'FALHA P3: aceitou revendedor inexistente'; exception when no_data_found then null; end;

  v_at := public.admin_record_password_reset('d9100000-0000-0000-0000-000000000001', true);
  select * into e from public.admin_audit_events where target_reseller_id = 'd9100000-0000-0000-0000-000000000001';
  if e.event_type <> 'reseller_password_reset' or e.actor_id <> 'd9000000-0000-0000-0000-00000000000a'
     or e.target_user_id <> 'd9000000-0000-0000-0000-0000000000b1'
    then raise exception 'FALHA P3: evento de auditoria %', e; end if;
  select * into pr from public.profiles where id = 'd9000000-0000-0000-0000-0000000000b1';
  if not pr.must_change_password or pr.password_changed_at is null then raise exception 'FALHA P3: perfil não marcado'; end if;
  raise notice 'OK P3: ADMIN válido resolve o revendedor e registra "Senha redefinida pelo administrador" (quem, sobre quem, quando)';
end $$;
commit;

-- Um ADMIN não usa esta via para trocar a senha de outro ADMIN (só revendedores).
do $$
declare v_admin_as_reseller uuid := gen_random_uuid();
begin
  insert into public.reseller_profiles (id, user_id, company_name) values (v_admin_as_reseller, 'd9000000-0000-0000-0000-00000000000a', 'Perfil indevido');
  perform set_config('test.admin_rp', v_admin_as_reseller::text, false);
end $$;
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'd9000000-0000-0000-0000-00000000000a';
do $$ begin
  begin perform public.admin_reseller_auth_user(current_setting('test.admin_rp')::uuid);
    raise exception 'FALHA P4: aceitou alvo que não é revendedor'; exception when no_data_found then null; end;
  raise notice 'OK P4: o alvo precisa ser um usuário com papel de revendedor';
end $$;
commit;
delete from public.reseller_profiles where id = current_setting('test.admin_rp')::uuid;

-- ===================== P5: nada guarda senha =====================
do $$
declare v_cols text;
begin
  select string_agg(table_name || '.' || column_name, ', ') into v_cols
  from information_schema.columns
  where table_schema = 'public'
    and (column_name ilike '%password%' or column_name ilike '%senha%' or column_name ilike '%secret%')
    and not (table_name = 'profiles' and column_name in ('must_change_password', 'password_changed_at'));
  if v_cols is not null then raise exception 'FALHA P5: colunas que poderiam guardar senha: %', v_cols; end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles'
             and column_name in ('must_change_password', 'password_changed_at') and data_type not in ('boolean', 'timestamp with time zone'))
    then raise exception 'FALHA P5: campos de preparação com tipo capaz de guardar texto'; end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'admin_audit_events'
             and data_type in ('text', 'jsonb', 'json', 'character varying') and column_name <> 'event_type')
    then raise exception 'FALHA P5: a auditoria tem campo livre de texto'; end if;
  raise notice 'OK P5: nenhuma tabela da aplicação tem coluna capaz de guardar a senha (só flag e data de preparação)';
end $$;

-- ===================== P6: auditoria imutável =====================
do $$ begin
  begin update public.admin_audit_events set actor_id = null;
    raise exception 'FALHA P6: auditoria alterada'; exception when sqlstate '55000' then null; end;
  begin delete from public.admin_audit_events;
    raise exception 'FALHA P6: auditoria apagada'; exception when sqlstate '55000' then null; end;
  raise notice 'OK P6: a trilha de auditoria não pode ser alterada nem apagada';
end $$;
