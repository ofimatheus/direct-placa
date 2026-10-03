-- =====================================================================
-- 019 · Personalização da tela de login (branding)
--
-- branding_settings: UMA linha (id = true). Campo nulo = usar o padrão
-- DirectPlaca definido no código, então "Restaurar padrão" é zerar tudo e
-- a tela de login funciona mesmo sem nenhuma personalização.
--
-- Leitura pública: SOMENTE pela RPC public_login_branding(), que devolve
-- apenas o que a tela de login precisa (textos e caminhos das imagens).
-- A tabela em si não tem leitura para anon/revendedor.
-- Escrita: somente ADMIN, pelas RPCs admin_save_branding() e
-- admin_reset_branding().
--
-- Storage: bucket PÚBLICO 'branding' (logo e banner não são sensíveis e
-- precisam carregar na tela de login sem sessão). Upload apenas por ADMIN
-- autenticado, só nas pastas logo/ e banner/, só PNG/JPG/WEBP até 4 MB.
-- Sem política de UPDATE/DELETE: cada upload tem nome único (versionado) e
-- arquivos antigos não são apagados — nenhuma configuração fica apontando
-- para um arquivo inexistente.
--
-- Incremental e idempotente; não altera migrations anteriores.
-- =====================================================================

create table if not exists public.branding_settings (
  id               boolean primary key default true,
  brand_name       text,
  show_brand_name  boolean not null default true,
  eyebrow          text,
  title            text,
  subtitle         text,
  logo_path        text,
  banner_path      text,
  updated_at       timestamptz not null default now(),
  updated_by       uuid,
  constraint branding_settings_singleton check (id),
  constraint branding_settings_brand_name_check check (brand_name is null or char_length(btrim(brand_name)) between 1 and 40),
  constraint branding_settings_eyebrow_check check (eyebrow is null or char_length(btrim(eyebrow)) between 1 and 60),
  constraint branding_settings_title_check check (title is null or char_length(btrim(title)) between 1 and 60),
  constraint branding_settings_subtitle_check check (subtitle is null or char_length(btrim(subtitle)) between 1 and 200),
  constraint branding_settings_logo_path_check check (
    logo_path is null or logo_path ~ '^logo/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp)$'
  ),
  constraint branding_settings_banner_path_check check (
    banner_path is null or banner_path ~ '^banner/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp)$'
  )
);

comment on table public.branding_settings is
  'Personalização da tela de login (linha única). Nulo = padrão DirectPlaca do código. Leitura pública só via public_login_branding().';

insert into public.branding_settings (id) values (true) on conflict (id) do nothing;

drop trigger if exists trg_branding_settings_updated_at on public.branding_settings;
create trigger trg_branding_settings_updated_at
  before update on public.branding_settings
  for each row execute function public.set_updated_at();

alter table public.branding_settings enable row level security;

drop policy if exists branding_settings_admin_select on public.branding_settings;
create policy branding_settings_admin_select on public.branding_settings
  for select to authenticated
  using (public.is_admin());

revoke insert, update, delete on public.branding_settings from anon, authenticated;
revoke select on public.branding_settings from anon;

-- ---------------------------------------------------------------------
-- Leitura pública (tela de login): só os campos necessários
-- ---------------------------------------------------------------------
create or replace function public.public_login_branding()
returns table (
  brand_name       text,
  show_brand_name  boolean,
  eyebrow          text,
  title            text,
  subtitle         text,
  logo_path        text,
  banner_path      text
)
language sql
stable
security definer
set search_path = public
as $$
  select b.brand_name, b.show_brand_name, b.eyebrow, b.title, b.subtitle, b.logo_path, b.banner_path
  from public.branding_settings b
  where b.id;
$$;

-- ---------------------------------------------------------------------
-- Escrita (somente ADMIN)
-- ---------------------------------------------------------------------
create or replace function public.admin_save_branding(
  p_brand_name       text,
  p_show_brand_name  boolean,
  p_eyebrow          text,
  p_title            text,
  p_subtitle         text,
  p_logo_path        text,
  p_banner_path      text
)
returns setof public.branding_settings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_logo   text := nullif(btrim(coalesce(p_logo_path, '')), '');
  v_banner text := nullif(btrim(coalesce(p_banner_path, '')), '');
begin
  if not public.is_admin() then
    raise exception 'Somente ADMIN pode alterar a tela de login' using errcode = '42501';
  end if;

  -- A imagem precisa ter sido enviada de fato ao bucket (não aceita caminho inventado).
  if v_logo is not null and not exists (
    select 1 from storage.objects o where o.bucket_id = 'branding' and o.name = v_logo
  ) then
    raise exception 'A logo informada não foi encontrada. Envie a imagem de novo.' using errcode = '22023';
  end if;
  if v_banner is not null and not exists (
    select 1 from storage.objects o where o.bucket_id = 'branding' and o.name = v_banner
  ) then
    raise exception 'O banner informado não foi encontrado. Envie a imagem de novo.' using errcode = '22023';
  end if;

  insert into public.branding_settings as b (id, brand_name, show_brand_name, eyebrow, title, subtitle, logo_path, banner_path, updated_by)
  values (
    true,
    nullif(btrim(coalesce(p_brand_name, '')), ''),
    coalesce(p_show_brand_name, true),
    nullif(btrim(coalesce(p_eyebrow, '')), ''),
    nullif(btrim(coalesce(p_title, '')), ''),
    nullif(btrim(coalesce(p_subtitle, '')), ''),
    v_logo,
    v_banner,
    auth.uid()
  )
  on conflict (id) do update set
    brand_name = excluded.brand_name,
    show_brand_name = excluded.show_brand_name,
    eyebrow = excluded.eyebrow,
    title = excluded.title,
    subtitle = excluded.subtitle,
    logo_path = excluded.logo_path,
    banner_path = excluded.banner_path,
    updated_by = excluded.updated_by;

  return query select * from public.branding_settings b where b.id;
end;
$$;

-- Restaurar padrão: volta tudo para o padrão DirectPlaca. Os arquivos já
-- enviados continuam no bucket (não são apagados).
create or replace function public.admin_reset_branding()
returns setof public.branding_settings
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Somente ADMIN pode alterar a tela de login' using errcode = '42501';
  end if;
  insert into public.branding_settings (id, updated_by) values (true, auth.uid())
  on conflict (id) do update set
    brand_name = null, show_brand_name = true, eyebrow = null, title = null, subtitle = null,
    logo_path = null, banner_path = null, updated_by = auth.uid();
  return query select * from public.branding_settings b where b.id;
end;
$$;

revoke all on function public.public_login_branding() from public;
grant execute on function public.public_login_branding() to anon, authenticated;
revoke all on function public.admin_save_branding(text, boolean, text, text, text, text, text) from public, anon;
grant execute on function public.admin_save_branding(text, boolean, text, text, text, text, text) to authenticated;
revoke all on function public.admin_reset_branding() from public, anon;
grant execute on function public.admin_reset_branding() to authenticated;

-- ---------------------------------------------------------------------
-- Storage: bucket público de assets de branding
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('branding', 'branding', true, 4194304, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update set
  public = true,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Upload: só ADMIN, só nas pastas logo/ e banner/.
drop policy if exists branding_admin_insert on storage.objects;
create policy branding_admin_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'branding'
    and public.is_admin()
    and (storage.foldername(name))[1] in ('logo', 'banner')
  );

-- Listagem pela API: só ADMIN. O download público das imagens não depende
-- desta policy (bucket público serve o arquivo pela URL pública).
drop policy if exists branding_admin_select on storage.objects;
create policy branding_admin_select on storage.objects
  for select to authenticated
  using (bucket_id = 'branding' and public.is_admin());

-- Não há policy de UPDATE nem DELETE: nada é sobrescrito nem apagado.
