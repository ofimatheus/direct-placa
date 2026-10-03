-- =====================================================================
-- 027 · CMS da landing de revendedores (/revendedores)
--
-- Conteúdo = UM documento JSON validado pela aplicação (esquema tipado em
-- src/lib/landing/schema.ts), em DUAS linhas:
--   · 'draft'     → rascunho editado pelo ADMIN;
--   · 'published' → o que a página pública mostra.
-- Publicar copia o rascunho para o publicado numa única transação: ou tudo
-- muda, ou nada muda (a versão pública anterior continua em caso de erro).
--
-- Sem nada publicado (ou antes desta migration), a aplicação mostra o
-- conteúdo padrão = a landing que já estava no ar. Nada fica vazio.
--
-- Leitura pública: só public_landing_content() (só o PUBLICADO).
-- Rascunho, mídia e todas as escritas: só ADMIN (is_admin() no banco).
--
-- Imagens: bucket público 'landing-assets', só ADMIN envia/apaga; nomes
-- únicos (media/<uuid>.<ext>); sem UPDATE (nada é sobrescrito). A
-- aplicação valida o tipo pelos BYTES (PNG/JPG/WEBP, sem SVG) antes de enviar.
--
-- Histórico simples: updated_at/updated_by e published_at/published_by.
-- Incremental e idempotente; não altera migrations anteriores.
-- =====================================================================

create table if not exists public.landing_documents (
  kind          text primary key,
  content       jsonb not null,
  version       integer not null default 1,
  updated_at    timestamptz not null default now(),
  updated_by    uuid,
  published_at  timestamptz,
  published_by  uuid,
  constraint landing_documents_kind_check check (kind in ('draft', 'published')),
  constraint landing_documents_content_check check (
    jsonb_typeof(content) = 'object'
    and content ->> 'schemaVersion' = '1'
    and length(content::text) <= 262144
  ),
  constraint landing_documents_version_check check (version >= 1)
);

comment on table public.landing_documents is
  'CMS da landing: linha draft (rascunho do ADMIN) e linha published (o que /revendedores mostra).';

create table if not exists public.landing_media (
  id          uuid primary key default gen_random_uuid(),
  path        text not null unique,
  mime        text not null,
  width       integer not null,
  height      integer not null,
  bytes       integer not null,
  created_at  timestamptz not null default now(),
  created_by  uuid,
  constraint landing_media_path_check check (path ~ '^media/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp)$'),
  constraint landing_media_mime_check check (mime in ('image/png', 'image/jpeg', 'image/webp')),
  constraint landing_media_dims_check check (width between 1 and 10000 and height between 1 and 10000),
  constraint landing_media_bytes_check check (bytes between 1 and 4194304)
);

alter table public.landing_documents enable row level security;
alter table public.landing_media enable row level security;
revoke all on public.landing_documents from anon, authenticated;
revoke all on public.landing_media from anon, authenticated;

-- ---------------------------------------------------------------------
-- Público: só o PUBLICADO
-- ---------------------------------------------------------------------
create or replace function public.public_landing_content()
returns table (content jsonb, published_at timestamptz, version integer)
language sql
stable
security definer
set search_path = public
as $$
  select d.content, d.published_at, d.version
  from public.landing_documents d
  where d.kind = 'published';
$$;
revoke all on function public.public_landing_content() from public;
grant execute on function public.public_landing_content() to anon, authenticated;

-- ---------------------------------------------------------------------
-- ADMIN
-- ---------------------------------------------------------------------
create or replace function public.landing_assert_admin()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Somente ADMIN' using errcode = '42501';
  end if;
end;
$$;
revoke all on function public.landing_assert_admin() from public, anon, authenticated;

/** Estado do CMS para a tela do ADMIN (rascunho + publicado + datas). */
create or replace function public.admin_landing_state()
returns table (
  draft              jsonb,
  draft_version      integer,
  draft_updated_at   timestamptz,
  published          jsonb,
  published_version  integer,
  published_at       timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.landing_assert_admin();
  select d.content, d.version, d.updated_at into draft, draft_version, draft_updated_at
  from public.landing_documents d where d.kind = 'draft';
  select p.content, p.version, p.published_at into published, published_version, published_at
  from public.landing_documents p where p.kind = 'published';
  return next;
end;
$$;

/**
 * Salva o rascunho. p_expected_version = versão que o ADMIN abriu (0 = não
 * havia rascunho). Se outra aba salvou antes, recusa (não sobrescreve).
 */
create or replace function public.admin_landing_save_draft(p_content jsonb, p_expected_version integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current integer;
begin
  perform public.landing_assert_admin();
  select d.version into v_current from public.landing_documents d where d.kind = 'draft' for update;
  if coalesce(v_current, 0) <> coalesce(p_expected_version, -1) then
    raise exception 'O rascunho foi alterado em outra aba ou por outra pessoa. Recarregue a página para continuar.' using errcode = '55000';
  end if;
  insert into public.landing_documents as d (kind, content, version, updated_at, updated_by)
  values ('draft', p_content, coalesce(v_current, 0) + 1, now(), auth.uid())
  on conflict (kind) do update
    set content = excluded.content, version = excluded.version, updated_at = now(), updated_by = auth.uid();
  return coalesce(v_current, 0) + 1;
end;
$$;

/**
 * Publica o rascunho (versão p_expected_version) de forma ATÔMICA: o
 * publicado passa a ser exatamente o rascunho. Qualquer erro → nada muda.
 */
create or replace function public.admin_landing_publish(p_expected_version integer)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_draft record;
  v_now timestamptz := now();
begin
  perform public.landing_assert_admin();
  select d.content, d.version into v_draft from public.landing_documents d where d.kind = 'draft' for update;
  if not found then
    raise exception 'Não há rascunho para publicar.' using errcode = '55000';
  end if;
  if v_draft.version <> p_expected_version then
    raise exception 'O rascunho mudou desde que você abriu a página. Recarregue antes de publicar.' using errcode = '55000';
  end if;
  insert into public.landing_documents as d (kind, content, version, updated_at, updated_by, published_at, published_by)
  values ('published', v_draft.content, v_draft.version, v_now, auth.uid(), v_now, auth.uid())
  on conflict (kind) do update
    set content = excluded.content, version = excluded.version, updated_at = v_now,
        updated_by = auth.uid(), published_at = v_now, published_by = auth.uid();
  return v_now;
end;
$$;

/** Descarta o rascunho: volta a ser igual ao publicado (ou ao padrão, se nada foi publicado). */
create or replace function public.admin_landing_discard_draft()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_published jsonb;
begin
  perform public.landing_assert_admin();
  select p.content into v_published from public.landing_documents p where p.kind = 'published';
  if v_published is null then
    delete from public.landing_documents d where d.kind = 'draft';
  else
    update public.landing_documents d
      set content = v_published, version = d.version + 1, updated_at = now(), updated_by = auth.uid()
    where d.kind = 'draft';
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Mídia
-- ---------------------------------------------------------------------
create or replace function public.admin_landing_media_list()
returns setof public.landing_media
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.landing_assert_admin();
  return query select * from public.landing_media m order by m.created_at desc;
end;
$$;

/** Registra uma imagem JÁ validada (pelos bytes) e enviada ao bucket. */
create or replace function public.admin_landing_media_register(p_path text, p_mime text, p_width integer, p_height integer, p_bytes integer)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  perform public.landing_assert_admin();
  if not exists (select 1 from storage.objects o where o.bucket_id = 'landing-assets' and o.name = p_path) then
    raise exception 'Arquivo não encontrado no armazenamento.' using errcode = 'P0002';
  end if;
  insert into public.landing_media (path, mime, width, height, bytes, created_by)
  values (p_path, p_mime, p_width, p_height, p_bytes, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

/**
 * Remove uma imagem da biblioteca. Recusa se o rascunho OU o publicado ainda
 * a usam (trocar/remover do conteúdo primeiro). Devolve o caminho, para a
 * aplicação apagar o arquivo do bucket.
 */
create or replace function public.admin_landing_media_delete(p_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_path text;
begin
  perform public.landing_assert_admin();
  select m.path into v_path from public.landing_media m where m.id = p_id for update;
  if v_path is null then
    raise exception 'Imagem não encontrada.' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.landing_documents d where position(v_path in d.content::text) > 0) then
    raise exception 'Esta imagem está em uso no rascunho ou na landing publicada. Troque-a no conteúdo (e publique) antes de excluir.' using errcode = '55000';
  end if;
  delete from public.landing_media m where m.id = p_id;
  return v_path;
end;
$$;

revoke all on function public.admin_landing_state() from public, anon;
grant execute on function public.admin_landing_state() to authenticated;
revoke all on function public.admin_landing_save_draft(jsonb, integer) from public, anon;
grant execute on function public.admin_landing_save_draft(jsonb, integer) to authenticated;
revoke all on function public.admin_landing_publish(integer) from public, anon;
grant execute on function public.admin_landing_publish(integer) to authenticated;
revoke all on function public.admin_landing_discard_draft() from public, anon;
grant execute on function public.admin_landing_discard_draft() to authenticated;
revoke all on function public.admin_landing_media_list() from public, anon;
grant execute on function public.admin_landing_media_list() to authenticated;
revoke all on function public.admin_landing_media_register(text, text, integer, integer, integer) from public, anon;
grant execute on function public.admin_landing_media_register(text, text, integer, integer, integer) to authenticated;
revoke all on function public.admin_landing_media_delete(uuid) from public, anon;
grant execute on function public.admin_landing_media_delete(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Storage: bucket público landing-assets (só ADMIN envia/apaga)
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('landing-assets', 'landing-assets', true, 4194304, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
  set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists landing_assets_insert on storage.objects;
create policy landing_assets_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'landing-assets'
    and public.is_admin()
    and name ~ '^media/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp)$'
  );

drop policy if exists landing_assets_delete on storage.objects;
create policy landing_assets_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'landing-assets' and public.is_admin());
-- Apagar pela API do Storage exige também SELECT: só o ADMIN tem (o público
-- não lista o bucket; ele só abre arquivos pela URL pública direta).
drop policy if exists landing_assets_select_admin on storage.objects;
create policy landing_assets_select_admin on storage.objects
  for select to authenticated
  using (bucket_id = 'landing-assets' and public.is_admin());
-- Sem policy de UPDATE: nada é sobrescrito.
