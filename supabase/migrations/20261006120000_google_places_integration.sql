-- =====================================================================
-- 025 · Integrações: chave da Google Places API gerenciada pelo ADMIN
--
-- O SEGREDO fica no Supabase Vault (vault.secrets), cifrado em repouso com
-- uma chave mestra mantida fora do banco. Nenhuma tabela pública guarda a
-- chave.
--
-- Leitura do segredo: SOMENTE google_places_api_key(), executável apenas pela
-- service_role (servidor da aplicação). Nem o ADMIN logado consegue ler a
-- chave de volta pela API.
--
-- O ADMIN (validado no banco por is_admin()) pode gravar, trocar e remover a
-- chave, e ler só METADADOS não sensíveis (últimos 4 caracteres, datas e
-- resultado do último teste) em integration_settings.
--
-- Resolução na aplicação: chave do ADMIN (Vault) > GOOGLE_PLACES_API_KEY do
-- ambiente. Remover a chave do ADMIN nunca mexe no ambiente.
--
-- Sem auditoria/histórico (só o valor atual). Incremental e idempotente.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Supabase Vault (habilitado por padrão nos projetos Supabase)
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'supabase_vault') then
    begin
      create extension if not exists supabase_vault;
    exception when others then
      null; -- verificado logo abaixo, com mensagem clara
    end;
  end if;
  if to_regclass('vault.secrets') is null
     or to_regclass('vault.decrypted_secrets') is null
     or not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'vault' and p.proname = 'create_secret')
     or not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'vault' and p.proname = 'update_secret') then
    raise exception 'Supabase Vault indisponível neste banco. Habilite a extensão "supabase_vault" (Dashboard > Database > Extensions) e aplique esta migration novamente.';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Metadados não sensíveis (nunca a chave)
-- ---------------------------------------------------------------------
create table if not exists public.integration_settings (
  provider          text primary key,
  key_last4         text,
  configured_at     timestamptz,
  configured_by     uuid,
  last_test_status  text,
  last_test_source  text,
  last_test_at      timestamptz,
  constraint integration_settings_provider_check check (provider in ('google_places')),
  constraint integration_settings_last4_check check (key_last4 is null or key_last4 ~ '^[A-Za-z0-9_-]{4}$'),
  constraint integration_settings_status_check check (
    last_test_status is null
    or last_test_status in ('ok', 'invalid_key', 'permission_denied', 'quota_exceeded', 'unavailable', 'unexpected')),
  constraint integration_settings_source_check check (last_test_source is null or last_test_source in ('admin', 'env'))
);

comment on table public.integration_settings is
  'Metadados das integrações (sem segredos). A chave da Google Places fica no Supabase Vault.';

alter table public.integration_settings enable row level security;
revoke all on public.integration_settings from anon, authenticated;

-- Nome do segredo no Vault (uma fonte só).
create or replace function public.google_places_secret_name()
returns text
language sql
immutable
as $$
  select 'directplaca_google_places_api_key';
$$;

-- Formato de chave de API do Google: "AIza" + 35 caracteres [0-9A-Za-z_-] (39 no total).
create or replace function public.google_places_key_format_ok(p_key text)
returns boolean
language sql
immutable
as $$
  select coalesce(p_key ~ '^AIza[0-9A-Za-z_-]{35}$', false);
$$;

-- ---------------------------------------------------------------------
-- Leitura do segredo: SÓ service_role (servidor)
-- ---------------------------------------------------------------------
create or replace function public.google_places_api_key()
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_key text;
begin
  select ds.decrypted_secret into v_key
  from vault.decrypted_secrets ds
  where ds.name = public.google_places_secret_name()
  limit 1;
  return nullif(btrim(coalesce(v_key, '')), '');
end;
$$;

revoke all on function public.google_places_api_key() from public, anon, authenticated;
grant execute on function public.google_places_api_key() to service_role;

-- ---------------------------------------------------------------------
-- ADMIN: status (só metadados), gravar/trocar, remover, registrar teste
-- ---------------------------------------------------------------------
create or replace function public.admin_google_places_status()
returns table (
  custom_configured  boolean,
  key_last4          text,
  configured_at      timestamptz,
  last_test_status   text,
  last_test_source   text,
  last_test_at       timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Somente ADMIN' using errcode = '42501';
  end if;
  custom_configured := exists (select 1 from vault.secrets s where s.name = public.google_places_secret_name());
  select i.key_last4, i.configured_at, i.last_test_status, i.last_test_source, i.last_test_at
    into key_last4, configured_at, last_test_status, last_test_source, last_test_at
  from public.integration_settings i where i.provider = 'google_places';
  if not custom_configured then
    key_last4 := null;
    configured_at := null;
  end if;
  return next;
end;
$$;

/**
 * Grava ou troca a chave (a aplicação só chama depois de testar a chave nova
 * com sucesso no Google). Devolve os últimos 4 caracteres, nunca a chave.
 * Mensagens de erro nunca incluem o valor recebido.
 */
create or replace function public.admin_google_places_set(p_api_key text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_key text := btrim(coalesce(p_api_key, ''));
begin
  if not public.is_admin() then
    raise exception 'Somente ADMIN' using errcode = '42501';
  end if;
  if not public.google_places_key_format_ok(v_key) then
    raise exception 'Formato de chave da Google Places API inválido' using errcode = '22023';
  end if;

  select s.id into v_id from vault.secrets s where s.name = public.google_places_secret_name() limit 1;
  if v_id is null then
    perform vault.create_secret(v_key, public.google_places_secret_name(), 'Google Places API do DirectLab (DirectPlaca)');
  else
    perform vault.update_secret(v_id, v_key);
  end if;

  insert into public.integration_settings as i (provider, key_last4, configured_at, configured_by, last_test_status, last_test_source, last_test_at)
  values ('google_places', right(v_key, 4), now(), auth.uid(), null, null, null)
  on conflict (provider) do update
    set key_last4 = excluded.key_last4,
        configured_at = excluded.configured_at,
        configured_by = excluded.configured_by,
        last_test_status = null,
        last_test_source = null,
        last_test_at = null;
  return right(v_key, 4);
end;
$$;

/** Remove a chave do ADMIN (o Vault apaga o segredo). O ambiente não é tocado. */
create or replace function public.admin_google_places_remove()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Somente ADMIN' using errcode = '42501';
  end if;
  delete from vault.secrets s where s.name = public.google_places_secret_name();
  update public.integration_settings i
    set key_last4 = null, configured_at = null, configured_by = null,
        last_test_status = null, last_test_source = null, last_test_at = null
  where i.provider = 'google_places';
end;
$$;

/** Guarda só o RESULTADO do último teste (código seguro), nunca a chave. */
create or replace function public.admin_google_places_record_test(p_status text, p_source text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Somente ADMIN' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('ok', 'invalid_key', 'permission_denied', 'quota_exceeded', 'unavailable', 'unexpected')
     or p_source is null or p_source not in ('admin', 'env') then
    raise exception 'Resultado de teste inválido' using errcode = '22023';
  end if;
  insert into public.integration_settings as i (provider, last_test_status, last_test_source, last_test_at)
  values ('google_places', p_status, p_source, now())
  on conflict (provider) do update
    set last_test_status = excluded.last_test_status,
        last_test_source = excluded.last_test_source,
        last_test_at = excluded.last_test_at;
end;
$$;

revoke all on function public.admin_google_places_status() from public, anon;
grant execute on function public.admin_google_places_status() to authenticated;
revoke all on function public.admin_google_places_set(text) from public, anon;
grant execute on function public.admin_google_places_set(text) to authenticated;
revoke all on function public.admin_google_places_remove() from public, anon;
grant execute on function public.admin_google_places_remove() to authenticated;
revoke all on function public.admin_google_places_record_test(text, text) from public, anon;
grant execute on function public.admin_google_places_record_test(text, text) to authenticated;
