-- =====================================================================
-- 004 · Exportações do lote (também funciona como fila de jobs)
--
-- O processamento é feito em etapas curtas por um worker com "lease":
-- quem reivindica o job recebe um lease_token; só esse token pode avançar
-- o progresso. Se o worker morrer, o lease expira e outro retoma do
-- next_offset salvo — sem refazer partes já enviadas ao Storage.
-- =====================================================================

create table if not exists public.batch_exports (
  id                   uuid primary key default gen_random_uuid(),
  batch_id             uuid not null references public.plate_batches (id) on delete cascade,
  kind                 text not null,
  status               text not null default 'pending',
  template_version_id  uuid references public.plate_template_versions (id) on delete restrict,

  -- Arquivo principal (quando há um só) e lista completa de arquivos gerados
  file_path            text,
  files                jsonb not null default '[]'::jsonb,

  -- Progresso / retomada
  progress_total       integer not null default 0,
  progress_done        integer not null default 0,
  next_offset          integer not null default 0,
  part_count           integer not null default 0,
  attempts             integer not null default 0,
  lease_token          uuid,
  lease_expires_at     timestamptz,

  error_message        text,
  requested_by         uuid references public.profiles (id) on delete set null,
  created_at           timestamptz not null default now(),
  started_at           timestamptz,
  finished_at          timestamptz,
  updated_at           timestamptz not null default now(),

  constraint batch_exports_kind_check check (kind in ('qr_zip', 'csv', 'art_png_zip', 'art_pdf')),
  constraint batch_exports_status_check check (status in ('pending', 'processing', 'done', 'failed')),
  constraint batch_exports_files_array check (jsonb_typeof(files) = 'array')
);

create index if not exists batch_exports_batch_idx on public.batch_exports (batch_id, created_at desc);
create index if not exists batch_exports_status_idx on public.batch_exports (status, created_at);

-- Clique duplo / request duplicada: no máximo um job ativo por (lote, tipo).
create unique index if not exists batch_exports_one_active_per_kind
  on public.batch_exports (batch_id, kind)
  where status in ('pending', 'processing');

drop trigger if exists trg_batch_exports_updated_at on public.batch_exports;
create trigger trg_batch_exports_updated_at
  before update on public.batch_exports
  for each row execute function public.set_updated_at();
