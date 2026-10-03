-- =====================================================================
-- 001 · Fundação: helpers, perfis, revendedores e clientes
-- Escrita de forma defensiva (IF NOT EXISTS / OR REPLACE) para não recriar
-- estruturas que já existam no projeto.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------
-- updated_at automático
-- ---------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- profiles (1:1 com auth.users)
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  name        text,
  email       text not null default '',
  role        text not null default 'reseller',
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint profiles_role_check check (role in ('admin', 'reseller'))
);

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Cria o profile automaticamente quando um usuário é criado no Supabase Auth.
-- Todo usuário novo nasce como RESELLER; a promoção a ADMIN é feita por SQL
-- ou por outro ADMIN.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, name)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'name', split_part(coalesce(new.email, ''), '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill para usuários que já existiam antes desta migration.
insert into public.profiles (id, email, name)
select u.id, coalesce(u.email, ''), split_part(coalesce(u.email, ''), '@', 1)
from auth.users u
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- Helpers de autorização (usados pelas políticas RLS e pelas RPCs)
-- SECURITY DEFINER evita recursão de RLS ao consultar profiles.
-- ---------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
      and p.active
  );
$$;

-- ---------------------------------------------------------------------
-- reseller_profiles
-- ---------------------------------------------------------------------
create table if not exists public.reseller_profiles (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null unique references public.profiles (id) on delete cascade,
  company_name  text not null,
  document      text,
  phone         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

drop trigger if exists trg_reseller_profiles_updated_at on public.reseller_profiles;
create trigger trg_reseller_profiles_updated_at
  before update on public.reseller_profiles
  for each row execute function public.set_updated_at();

create or replace function public.current_reseller_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select rp.id
  from public.reseller_profiles rp
  join public.profiles p on p.id = rp.user_id
  where rp.user_id = auth.uid()
    and p.role = 'reseller'
    and p.active
  limit 1;
$$;

-- ---------------------------------------------------------------------
-- customers (clientes finais do revendedor — não têm login)
-- ---------------------------------------------------------------------
create table if not exists public.customers (
  id            uuid primary key default gen_random_uuid(),
  reseller_id   uuid not null references public.reseller_profiles (id) on delete restrict,
  name          text not null,
  company_name  text,
  phone         text,
  email         text,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists customers_reseller_id_idx on public.customers (reseller_id);

drop trigger if exists trg_customers_updated_at on public.customers;
create trigger trg_customers_updated_at
  before update on public.customers
  for each row execute function public.set_updated_at();
