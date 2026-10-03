-- Stubs mínimos do Supabase (auth, storage, roles) para rodar as migrations
-- e supabase/tests/behavior.sql num PostgreSQL puro. NÃO use num projeto Supabase real.
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema if not exists extensions;
create schema if not exists auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}'::jsonb);
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
create schema if not exists storage;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
create or replace function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'),1)-1] $$;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- Simulação do Supabase Vault — SOMENTE PARA TESTES LOCAIS.
-- No Supabase real a extensão supabase_vault fornece esta mesma API
-- (vault.create_secret, vault.update_secret, vault.decrypted_secrets) com
-- cifragem de verdade. Aqui o valor fica ofuscado (não em texto puro), só
-- para provar que o código lê pela view decrypted_secrets.
-- ---------------------------------------------------------------------
create schema if not exists vault;
create table if not exists vault.secrets (
  id          uuid primary key default gen_random_uuid(),
  name        text unique,
  description text not null default '',
  secret      text not null,
  key_id      uuid,
  nonce       bytea,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create or replace function vault.create_secret(new_secret text, new_name text default null, new_description text default '', new_key_id uuid default null)
returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into vault.secrets (name, description, secret)
  values (new_name, coalesce(new_description, ''), encode(convert_to(reverse(new_secret), 'UTF8'), 'base64'))
  returning id into v;
  return v;
end $$;
create or replace function vault.update_secret(secret_id uuid, new_secret text default null, new_name text default null, new_description text default null, new_key_id uuid default null)
returns void language plpgsql as $$
begin
  update vault.secrets
     set secret = coalesce(encode(convert_to(reverse(new_secret), 'UTF8'), 'base64'), secret),
         name = coalesce(new_name, name),
         description = coalesce(new_description, description),
         updated_at = now()
   where id = secret_id;
end $$;
create or replace view vault.decrypted_secrets as
  select s.*, reverse(convert_from(decode(s.secret, 'base64'), 'UTF8')) as decrypted_secret from vault.secrets s;
revoke all on schema vault from public;
