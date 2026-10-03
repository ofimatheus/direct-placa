-- =====================================================================
-- 002 · Núcleo de placas: lotes, placas, redirects e atribuições
-- Regra central: 1 placa = 1 public_code = 1 QR exclusivo = 1 URL NFC exclusiva.
-- QR e NFC apontam SEMPRE para a URL intermediária; só destination_url muda.
-- =====================================================================

create table if not exists public.plate_batches (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  description  text,
  quantity     integer not null,
  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  constraint plate_batches_name_check check (char_length(btrim(name)) between 1 and 120),
  constraint plate_batches_quantity_check check (quantity between 1 and 1000)
);

create index if not exists plate_batches_created_at_idx on public.plate_batches (created_at desc);

create table if not exists public.plates (
  id                uuid primary key default gen_random_uuid(),
  public_code       text not null,
  reseller_id       uuid references public.reseller_profiles (id) on delete set null,
  customer_id       uuid references public.customers (id) on delete set null,
  batch_id          uuid references public.plate_batches (id) on delete restrict,
  destination_type  text,
  destination_url   text,
  status            text not null default 'in_stock',
  nfc_status        text not null default 'not_recorded',
  nfc_recorded_at   timestamptz,
  nfc_tested_at     timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint plates_public_code_key unique (public_code),
  constraint plates_public_code_format check (public_code ~ '^[A-Z0-9]{4,12}$'),
  constraint plates_status_check check (status in ('in_stock', 'assigned', 'active', 'blocked')),
  constraint plates_nfc_status_check check (nfc_status in ('not_recorded', 'recorded', 'tested')),
  -- Evita open redirect para esquemas perigosos (javascript:, data: ...).
  constraint plates_destination_url_check check (destination_url is null or destination_url ~* '^https?://'),
  constraint plates_destination_type_check check (
    destination_type is null or destination_type in
      ('google_review', 'whatsapp', 'instagram', 'menu', 'pix', 'website', 'custom')
  )
);

create index if not exists plates_batch_id_idx on public.plates (batch_id);
create index if not exists plates_reseller_id_idx on public.plates (reseller_id);
create index if not exists plates_customer_id_idx on public.plates (customer_id);

drop trigger if exists trg_plates_updated_at on public.plates;
create trigger trg_plates_updated_at
  before update on public.plates
  for each row execute function public.set_updated_at();

-- public_code é a identidade física da placa (QR + NFC gravados): nunca muda.
create or replace function public.prevent_public_code_change()
returns trigger
language plpgsql
as $$
begin
  if new.public_code is distinct from old.public_code then
    raise exception 'public_code é imutável (placa %)', old.id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_plates_public_code_immutable on public.plates;
create trigger trg_plates_public_code_immutable
  before update on public.plates
  for each row execute function public.prevent_public_code_change();

-- Log de acessos (QR / NFC). bigint identity: tabela de alto volume.
create table if not exists public.redirects (
  id          bigint generated always as identity primary key,
  plate_id    uuid not null references public.plates (id) on delete cascade,
  source      text not null default 'unknown',
  created_at  timestamptz not null default now(),
  constraint redirects_source_check check (source in ('qr', 'nfc', 'unknown'))
);

create index if not exists redirects_plate_created_idx on public.redirects (plate_id, created_at desc);

create table if not exists public.plate_assignments (
  id             uuid primary key default gen_random_uuid(),
  plate_id       uuid not null references public.plates (id) on delete cascade,
  reseller_id    uuid not null references public.reseller_profiles (id) on delete restrict,
  assigned_by    uuid references public.profiles (id) on delete set null,
  assigned_at    timestamptz not null default now(),
  unassigned_at  timestamptz
);

-- No máximo uma atribuição ativa por placa.
create unique index if not exists plate_assignments_one_active_idx
  on public.plate_assignments (plate_id)
  where unassigned_at is null;

create index if not exists plate_assignments_reseller_idx on public.plate_assignments (reseller_id);
