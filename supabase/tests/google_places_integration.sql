-- Integrações · chave da Google Places no Supabase Vault (migration 025).
-- Localmente o Vault é simulado em supabase_stubs.sql (mesma API do Supabase).
--   psql -d placas_test -f supabase/tests/google_places_integration.sql
\set ON_ERROR_STOP 1

insert into auth.users (id, email) values
  ('b7000000-0000-0000-0000-00000000000a', 'gp-admin@teste.com'),
  ('b7000000-0000-0000-0000-0000000000a1', 'gp-r1@teste.com');
update public.profiles set role = 'admin' where email = 'gp-admin@teste.com';
insert into public.reseller_profiles (id, user_id, company_name) values
  ('b7100000-0000-0000-0000-000000000001', 'b7000000-0000-0000-0000-0000000000a1', 'GP Um');

-- Chaves FALSAS (formato válido; nunca chaves reais).
select set_config('test.k1', 'AIzaFAKEchaveDeTesteNumero1aaaaaaaaaA1b', false) as k1,
       set_config('test.k2', 'AIzaFAKEchaveDeTesteNumero2bbbbbbbbbZ9x', false) as k2;

create function pg_temp.as_user(p_user uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', p_user::text, true); execute 'set local role authenticated'; end $$;
create function pg_temp.svc_key() returns text language plpgsql as $$
declare v text; begin execute 'set local role service_role'; v := public.google_places_api_key(); execute 'reset role'; return v; end $$;
create function pg_temp.admin_status() returns record language plpgsql as $$
declare r record; begin perform pg_temp.as_user('b7000000-0000-0000-0000-00000000000a'); select * into r from public.admin_google_places_status(); execute 'reset role'; return r; end $$;
create function pg_temp.admin_set(p text) returns text language plpgsql as $$
declare v text; begin perform pg_temp.as_user('b7000000-0000-0000-0000-00000000000a'); v := public.admin_google_places_set(p); execute 'reset role'; return v; end $$;

-- ===================== G1: nada configurado =====================
do $$
declare s record;
begin
  s := pg_temp.admin_status();
  if s.custom_configured or s.key_last4 is not null then raise exception 'FALHA G1: %', s; end if;
  if pg_temp.svc_key() is not null then raise exception 'FALHA G1: servidor leu chave inexistente'; end if;
  raise notice 'OK G1: sem chave do ADMIN, o status diz "não configurada" e o servidor recebe null (a aplicação usa o ambiente)';
end $$;

-- ===================== G2: ADMIN grava; só o servidor lê; Vault cifrado =====================
do $$
declare last4 text; s record; n int; stored text;
begin
  last4 := pg_temp.admin_set(current_setting('test.k1'));
  s := pg_temp.admin_status();
  if last4 <> 'aA1b' or not s.custom_configured or s.key_last4 <> 'aA1b' or s.configured_at is null then raise exception 'FALHA G2 status: % %', last4, s; end if;
  if pg_temp.svc_key() is distinct from current_setting('test.k1') then raise exception 'FALHA G2: servidor não leu a chave'; end if;
  select count(*), max(secret) into n, stored from vault.secrets where name = 'directplaca_google_places_api_key';
  if n <> 1 or position(current_setting('test.k1') in stored) > 0 then raise exception 'FALHA G2: segredo em texto puro ou duplicado'; end if;
  raise notice 'OK G2: ADMIN grava a chave no Vault (não fica em texto puro); devolve só os últimos 4 (aA1b); a service_role lê a chave completa';
end $$;

-- ===================== G3: trocar vale na hora (mesmo segredo, atualizado) =====================
do $$
declare id_before uuid; id_after uuid; s record;
begin
  select id into id_before from vault.secrets where name = 'directplaca_google_places_api_key';
  perform pg_temp.admin_set(current_setting('test.k2'));
  select id into id_after from vault.secrets where name = 'directplaca_google_places_api_key';
  s := pg_temp.admin_status();
  if pg_temp.svc_key() is distinct from current_setting('test.k2') or id_before <> id_after or s.key_last4 <> 'Z9x' and s.key_last4 <> 'bZ9x' then
    raise exception 'FALHA G3: % %', s, id_after; end if;
  if (select count(*) from vault.secrets) <> 1 then raise exception 'FALHA G3: segredo antigo ficou'; end if;
  raise notice 'OK G3: trocar a chave atualiza o mesmo segredo no Vault; a próxima leitura do servidor já devolve a nova (sem restart)';
end $$;

-- ===================== G4: formato inválido não substitui e não vaza =====================
do $$
declare msg text;
begin
  begin
    perform pg_temp.admin_set('AIzaCURTA-invalida-SEGREDO123');
    raise exception 'FALHA G4: aceitou formato inválido';
  exception when invalid_parameter_value then
    get stacked diagnostics msg = message_text;
    execute 'reset role';
  end;
  if position('SEGREDO123' in msg) > 0 then raise exception 'FALHA G4: erro contém o valor'; end if;
  if pg_temp.svc_key() is distinct from current_setting('test.k2') then raise exception 'FALHA G4: chave atual foi substituída'; end if;
  raise notice 'OK G4: chave em formato inválido é recusada no banco, a chave atual continua e a mensagem de erro não contém o valor';
end $$;

-- ===================== G5: registro do teste (só código seguro) =====================
do $$
declare s record;
begin
  perform pg_temp.as_user('b7000000-0000-0000-0000-00000000000a');
  perform public.admin_google_places_record_test('permission_denied', 'admin');
  begin perform public.admin_google_places_record_test('AIza-qualquer-coisa', 'admin'); raise exception 'FALHA G5: status livre'; exception when invalid_parameter_value then null; end;
  execute 'reset role';
  s := pg_temp.admin_status();
  if s.last_test_status <> 'permission_denied' or s.last_test_source <> 'admin' or s.last_test_at is null then raise exception 'FALHA G5: %', s; end if;
  raise notice 'OK G5: o resultado do último teste guarda só um código da lista (ex.: permission_denied), nunca texto livre';
end $$;

-- ===================== G6: revendedor não acessa nada =====================
do $$
begin
  perform pg_temp.as_user('b7000000-0000-0000-0000-0000000000a1');
  begin perform public.admin_google_places_status(); raise exception 'FALHA G6 status'; exception when insufficient_privilege then null; end;
  begin perform public.admin_google_places_set(current_setting('test.k1')); raise exception 'FALHA G6 set'; exception when insufficient_privilege then null; end;
  begin perform public.admin_google_places_remove(); raise exception 'FALHA G6 remove'; exception when insufficient_privilege then null; end;
  begin perform public.admin_google_places_record_test('ok', 'env'); raise exception 'FALHA G6 record'; exception when insufficient_privilege then null; end;
  begin perform public.google_places_api_key(); raise exception 'FALHA G6 leu segredo'; exception when insufficient_privilege then null; end;
  begin perform 1 from public.integration_settings; raise exception 'FALHA G6 tabela'; exception when insufficient_privilege then null; end;
  begin perform 1 from vault.secrets; raise exception 'FALHA G6 vault'; exception when insufficient_privilege then null; end;
  begin perform 1 from vault.decrypted_secrets; raise exception 'FALHA G6 vault view'; exception when insufficient_privilege then null; end;
  execute 'reset role';
  if pg_temp.svc_key() is distinct from current_setting('test.k2') then raise exception 'FALHA G6: chave mudou'; end if;
  raise notice 'OK G6: revendedor não lê status, não grava, não remove, não registra teste, não lê o segredo nem as tabelas/Vault';
end $$;

-- ===================== G7: nem o ADMIN logado lê o segredo pela API =====================
do $$
declare s record;
begin
  perform pg_temp.as_user('b7000000-0000-0000-0000-00000000000a');
  begin perform public.google_places_api_key(); raise exception 'FALHA G7 ADMIN leu'; exception when insufficient_privilege then null; end;
  begin perform 1 from public.integration_settings; raise exception 'FALHA G7 tabela'; exception when insufficient_privilege then null; end;
  begin perform 1 from vault.decrypted_secrets; raise exception 'FALHA G7 vault'; exception when insufficient_privilege then null; end;
  execute 'reset role';
  set local role anon;
  begin perform public.google_places_api_key(); raise exception 'FALHA G7 anon'; exception when insufficient_privilege then null; end;
  reset role;
  s := pg_temp.admin_status();
  if row_to_json(s)::text like '%' || current_setting('test.k2') || '%' or row_to_json(s)::text like '%AIzaFAKE%' then raise exception 'FALHA G7: status contém a chave'; end if;
  raise notice 'OK G7: nem o ADMIN logado nem anon leem a chave pela API (só a service_role); o status do ADMIN traz só metadados';
end $$;

-- ===================== G8: remover volta ao ambiente; idempotente =====================
do $$
declare s record;
begin
  perform pg_temp.as_user('b7000000-0000-0000-0000-00000000000a');
  perform public.admin_google_places_remove();
  perform public.admin_google_places_remove();
  execute 'reset role';
  s := pg_temp.admin_status();
  if s.custom_configured or s.key_last4 is not null or pg_temp.svc_key() is not null
     or exists (select 1 from vault.secrets where name = 'directplaca_google_places_api_key') then raise exception 'FALHA G8: %', s; end if;
  raise notice 'OK G8: remover apaga o segredo do Vault e os metadados (2x sem erro); o servidor volta a receber null e usa o ambiente';
end $$;

-- ===================== G9: sem auditoria/histórico =====================
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name ~ '(integration|google).*(audit|history|log)')
    then raise exception 'FALHA G9'; end if;
  if (select count(*) from public.integration_settings) > 1 then raise exception 'FALHA G9: mais de uma linha'; end if;
  raise notice 'OK G9: sem tabela de histórico/auditoria; só o estado atual';
end $$;
