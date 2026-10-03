-- =====================================================================
-- 003 · Templates de placa com versionamento imutável
--
-- plate_templates          identidade (nome, descrição, ativo) — mutável
-- plate_template_versions  tudo que afeta a arte final — imutável após locked_at
-- plate_batches            aponta para a versão EXATA usada na criação
-- =====================================================================

create table if not exists public.plate_templates (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  internal_key        text not null,
  description         text,
  active              boolean not null default true,
  current_version_id  uuid,
  created_by          uuid references public.profiles (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint plate_templates_internal_key_key unique (internal_key),
  constraint plate_templates_name_check check (char_length(btrim(name)) between 1 and 120),
  constraint plate_templates_internal_key_format check (internal_key ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);

drop trigger if exists trg_plate_templates_updated_at on public.plate_templates;
create trigger trg_plate_templates_updated_at
  before update on public.plate_templates
  for each row execute function public.set_updated_at();

create table if not exists public.plate_template_versions (
  id                     uuid primary key default gen_random_uuid(),
  template_id            uuid not null references public.plate_templates (id) on delete restrict,
  version_number         integer not null,

  -- Arte base (arquivo imutável no Storage, nomeado pelo sha256)
  base_image_path        text not null,
  base_image_mime_type   text not null,
  base_image_sha256      text not null,
  base_image_size_bytes  bigint not null,
  canvas_width           integer not null,
  canvas_height          integer not null,

  -- Tamanho físico opcional (DPI, alertas e PDF futuro)
  print_width_mm         numeric(8, 2),
  print_height_mm        numeric(8, 2),

  -- QR: caixa em px da arte original; a caixa INCLUI a zona de silêncio
  qr_x                   integer not null,
  qr_y                   integer not null,
  qr_width               integer not null,
  qr_height              integer not null,
  qr_error_correction    text not null default 'M',
  qr_quiet_zone          integer not null default 4,
  qr_color               text not null default '#000000',
  qr_background_color    text not null default '#FFFFFF',

  -- ID / public_code: code_x é a âncora conforme code_align; code_y é o centro vertical
  show_public_code       boolean not null default true,
  code_x                 integer not null,
  code_y                 integer not null,
  code_font_family       text not null default 'inter-bold',
  code_font_size         integer not null,
  code_color             text not null default '#000000',
  code_align             text not null default 'center',
  code_max_width         integer,

  safe_margin            integer,
  renderer_version       integer not null default 1,

  locked_at              timestamptz,
  created_by             uuid references public.profiles (id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  constraint ptv_template_version_key unique (template_id, version_number),
  constraint ptv_id_template_key unique (id, template_id),
  constraint ptv_version_number_check check (version_number >= 1),
  constraint ptv_mime_check check (base_image_mime_type in ('image/png', 'image/jpeg')),
  constraint ptv_sha256_check check (base_image_sha256 ~ '^[0-9a-f]{64}$'),
  constraint ptv_size_check check (base_image_size_bytes > 0),
  constraint ptv_canvas_check check (canvas_width between 1 and 20000 and canvas_height between 1 and 20000),
  constraint ptv_print_dims_check check (
    (print_width_mm is null and print_height_mm is null)
    or (print_width_mm > 0 and print_height_mm > 0)
  ),
  constraint ptv_qr_square_check check (qr_width = qr_height),
  constraint ptv_qr_inside_check check (
    qr_x >= 0 and qr_y >= 0 and qr_width > 0
    and qr_x + qr_width <= canvas_width
    and qr_y + qr_height <= canvas_height
  ),
  constraint ptv_qr_ecc_check check (qr_error_correction in ('L', 'M', 'Q', 'H')),
  constraint ptv_qr_quiet_zone_check check (qr_quiet_zone between 0 and 10),
  constraint ptv_colors_check check (
    qr_color ~ '^#[0-9A-Fa-f]{6}$'
    and qr_background_color ~ '^#[0-9A-Fa-f]{6}$'
    and code_color ~ '^#[0-9A-Fa-f]{6}$'
  ),
  constraint ptv_code_inside_check check (
    code_x between 0 and canvas_width and code_y between 0 and canvas_height
  ),
  constraint ptv_code_font_size_check check (code_font_size between 6 and 2000),
  constraint ptv_code_align_check check (code_align in ('left', 'center', 'right')),
  constraint ptv_code_max_width_check check (code_max_width is null or code_max_width between 1 and canvas_width),
  constraint ptv_safe_margin_check check (safe_margin is null or safe_margin >= 0),
  constraint ptv_renderer_version_check check (renderer_version >= 1)
);

create index if not exists ptv_template_idx on public.plate_template_versions (template_id, version_number desc);

drop trigger if exists trg_ptv_updated_at on public.plate_template_versions;
create trigger trg_ptv_updated_at
  before update on public.plate_template_versions
  for each row execute function public.set_updated_at();

-- A versão atual precisa pertencer ao próprio template (FK composta).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'plate_templates_current_version_fk'
  ) then
    alter table public.plate_templates
      add constraint plate_templates_current_version_fk
      foreign key (current_version_id, id)
      references public.plate_template_versions (id, template_id)
      on delete restrict;
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Imutabilidade das versões no nível do banco.
-- Enquanto locked_at é nulo a versão é um rascunho editável.
-- Depois de travada, nenhum UPDATE ou DELETE é aceito — nem de ADMIN.
-- ---------------------------------------------------------------------
create or replace function public.guard_plate_template_version()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    if old.locked_at is not null then
      raise exception 'A versão % está bloqueada (usada em lote) e não pode ser removida', old.id
        using errcode = 'check_violation';
    end if;
    return old;
  end if;

  if old.locked_at is not null then
    raise exception 'A versão % está bloqueada (usada em lote) e é imutável', old.id
      using errcode = 'check_violation';
  end if;

  if new.template_id <> old.template_id or new.version_number <> old.version_number then
    raise exception 'template_id e version_number não podem ser alterados'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_ptv_guard on public.plate_template_versions;
create trigger trg_ptv_guard
  before update or delete on public.plate_template_versions
  for each row execute function public.guard_plate_template_version();

-- ---------------------------------------------------------------------
-- Vínculo lote → template / versão exata
-- ---------------------------------------------------------------------
alter table public.plate_batches add column if not exists template_id uuid;
alter table public.plate_batches add column if not exists template_version_id uuid;
alter table public.plate_batches add column if not exists idempotency_key uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'plate_batches_template_version_fk') then
    alter table public.plate_batches
      add constraint plate_batches_template_version_fk
      foreign key (template_version_id, template_id)
      references public.plate_template_versions (id, template_id)
      on delete restrict;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'plate_batches_template_pair_check') then
    alter table public.plate_batches
      add constraint plate_batches_template_pair_check
      check ((template_id is null) = (template_version_id is null));
  end if;
end;
$$;

create unique index if not exists plate_batches_idempotency_key_idx
  on public.plate_batches (idempotency_key)
  where idempotency_key is not null;

create index if not exists plate_batches_template_version_idx on public.plate_batches (template_version_id);

-- A versão usada por um lote nunca muda depois da criação.
create or replace function public.guard_plate_batch_template()
returns trigger
language plpgsql
as $$
begin
  if new.template_id is distinct from old.template_id
     or new.template_version_id is distinct from old.template_version_id then
    raise exception 'O template/versão de um lote não pode ser alterado após a criação'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_plate_batches_template_guard on public.plate_batches;
create trigger trg_plate_batches_template_guard
  before update on public.plate_batches
  for each row execute function public.guard_plate_batch_template();

-- Defesa em profundidade: qualquer lote inserido trava a versão usada,
-- mesmo que alguém insira o lote por fora da RPC.
create or replace function public.lock_version_on_batch_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.template_version_id is not null then
    update public.plate_template_versions
       set locked_at = now()
     where id = new.template_version_id
       and locked_at is null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_plate_batches_lock_version on public.plate_batches;
create trigger trg_plate_batches_lock_version
  after insert on public.plate_batches
  for each row execute function public.lock_version_on_batch_insert();
