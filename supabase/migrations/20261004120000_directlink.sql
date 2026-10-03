-- =====================================================================
-- 023 · DirectLab → DirectLink: página pública simples ("link na bio")
--
-- direct_links       uma página: código público, dono, título, descrição,
--                    banner/logo (Storage) e ativo/inativo
-- direct_link_items  os botões: tipo, título, valor, recebedor (PIX),
--                    ordem e ativo/inativo
--
-- Dono: reseller_id do revendedor (NULL = criado pelo ADMIN). Revendedor vê
-- e altera só os próprios; ADMIN administra todos (DirectLinks não têm dado
-- financeiro). Escrita SOMENTE pelas RPCs abaixo (validação no banco).
-- Leitura pública SOMENTE por public_direct_link(código): só campos
-- públicos, só página e botões ativos.
--
-- Código público: 7 caracteres aleatórios (alfabeto sem 0/O/1/I/L),
-- imutável, independente do título. IDs dos botões são preservados entre
-- edições (base para métricas futuras). Não há exclusão de páginas:
-- desativar tira do ar.
--
-- Nada aqui consome a cota do DirectLab/Google (directlab_usage).
-- Incremental e idempotente; não altera migrations anteriores.
-- =====================================================================

create table if not exists public.direct_links (
  id             uuid primary key default gen_random_uuid(),
  public_code    text not null unique,
  owner_user_id  uuid not null,
  reseller_id    uuid references public.reseller_profiles (id) on delete restrict,
  title          text not null,
  description    text,
  banner_path    text,
  logo_path      text,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint direct_links_code_check check (public_code ~ '^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{7}$'),
  constraint direct_links_title_check check (char_length(btrim(title)) between 1 and 80),
  constraint direct_links_description_check check (description is null or char_length(description) <= 160),
  constraint direct_links_banner_check check (banner_path is null or banner_path ~ '^[0-9a-f-]{36}/banner/[0-9a-f-]{36}\.(png|jpg|webp)$'),
  constraint direct_links_logo_check check (logo_path is null or logo_path ~ '^[0-9a-f-]{36}/logo/[0-9a-f-]{36}\.(png|jpg|webp)$')
);

create index if not exists direct_links_reseller_idx on public.direct_links (reseller_id);

create table if not exists public.direct_link_items (
  id              uuid primary key default gen_random_uuid(),
  direct_link_id  uuid not null references public.direct_links (id) on delete cascade,
  type            text not null,
  title           text not null,
  value           text not null,
  receiver_name   text,
  sort_order      integer not null,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint direct_link_items_type_check check (type in
    ('instagram', 'whatsapp', 'pix', 'youtube', 'facebook', 'site', 'menu', 'maps', 'phone', 'email', 'link')),
  constraint direct_link_items_title_check check (char_length(btrim(title)) between 1 and 60),
  constraint direct_link_items_receiver_check check (receiver_name is null or (type = 'pix' and char_length(receiver_name) <= 60))
);

create index if not exists direct_link_items_link_idx on public.direct_link_items (direct_link_id, sort_order);

drop trigger if exists trg_direct_links_updated_at on public.direct_links;
create trigger trg_direct_links_updated_at before update on public.direct_links
  for each row execute function public.set_updated_at();
drop trigger if exists trg_direct_link_items_updated_at on public.direct_link_items;
create trigger trg_direct_link_items_updated_at before update on public.direct_link_items
  for each row execute function public.set_updated_at();

-- Código público e dono são imutáveis.
create or replace function public.guard_direct_link()
returns trigger
language plpgsql
as $$
begin
  if new.public_code is distinct from old.public_code
     or new.owner_user_id is distinct from old.owner_user_id
     or new.reseller_id is distinct from old.reseller_id then
    raise exception 'O código público e o dono do DirectLink não mudam' using errcode = '55000';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_direct_links_guard on public.direct_links;
create trigger trg_direct_links_guard before update on public.direct_links
  for each row execute function public.guard_direct_link();

-- ---------------------------------------------------------------------
-- Validação dos botões (a aplicação normaliza antes; o banco confere)
-- ---------------------------------------------------------------------
create or replace function public.directlink_item_is_valid(p_type text, p_value text, p_receiver text)
returns boolean
language sql
immutable
as $$
  select case
    when p_value is null or p_value <> btrim(p_value) or p_value = '' then false
    when p_type in ('instagram', 'youtube', 'facebook', 'site', 'menu', 'maps', 'link')
      then public.is_valid_destination_url(p_value)               -- só http(s) com domínio: nada de javascript:, data:, file:
    when p_type = 'whatsapp' then p_value ~ '^[0-9]{10,15}$'
    when p_type = 'phone'    then p_value ~ '^\+?[0-9]{8,15}$'
    when p_type = 'email'    then char_length(p_value) <= 254 and p_value ~* '^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$'
    when p_type = 'pix'      then char_length(p_value) <= 140 and p_value !~ '[[:cntrl:]]'
    else false
  end
  and (p_receiver is null or p_type = 'pix');
$$;

-- Código aleatório de 7 caracteres (bytes de gen_random_uuid, sem sequência).
create or replace function public.directlink_new_code()
returns text
language plpgsql
volatile
as $$
declare
  v_alphabet constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  v_bytes bytea;
  v_code text;
begin
  loop
    v_bytes := uuid_send(gen_random_uuid());
    v_code := '';
    for i in 0..6 loop
      v_code := v_code || substr(v_alphabet, (get_byte(v_bytes, i + 8) % 31) + 1, 1);
    end loop;
    exit when not exists (select 1 from public.direct_links where public_code = v_code);
  end loop;
  return v_code;
end;
$$;

-- ---------------------------------------------------------------------
-- RLS: revendedor só os próprios; ADMIN todos; sem escrita direta
-- ---------------------------------------------------------------------
alter table public.direct_links enable row level security;
alter table public.direct_link_items enable row level security;

drop policy if exists direct_links_select on public.direct_links;
create policy direct_links_select on public.direct_links
  for select to authenticated
  using (public.is_admin() or (reseller_id is not null and reseller_id = public.current_reseller_id()));

drop policy if exists direct_link_items_select on public.direct_link_items;
create policy direct_link_items_select on public.direct_link_items
  for select to authenticated
  using (exists (
    select 1 from public.direct_links d
    where d.id = direct_link_id
      and (public.is_admin() or (d.reseller_id is not null and d.reseller_id = public.current_reseller_id()))
  ));

revoke all on public.direct_links from anon;
revoke all on public.direct_link_items from anon;
revoke insert, update, delete on public.direct_links from authenticated;
revoke insert, update, delete on public.direct_link_items from authenticated;
grant select on public.direct_links to authenticated;
grant select on public.direct_link_items to authenticated;

-- ---------------------------------------------------------------------
-- Escrita: criar/editar (com botões) e ativar/desativar
-- ---------------------------------------------------------------------
create or replace function public.directlink_save(
  p_id           uuid,
  p_title        text,
  p_description  text,
  p_banner_path  text,
  p_logo_path    text,
  p_is_active    boolean,
  p_items        jsonb
)
returns table (id uuid, public_code text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_admin     boolean := public.is_admin();
  v_reseller  uuid := case when public.is_admin() then null else public.current_reseller_id() end;
  v_link      public.direct_links%rowtype;
  v_banner    text := nullif(btrim(coalesce(p_banner_path, '')), '');
  v_logo      text := nullif(btrim(coalesce(p_logo_path, '')), '');
  v_item      jsonb;
  v_pos       integer := 0;
  v_keep      uuid[] := '{}';
  v_item_id   uuid;
  v_type      text;
  v_value     text;
  v_receiver  text;
begin
  if v_uid is null then
    raise exception 'Faça login para continuar' using errcode = '42501';
  end if;
  if not v_admin and v_reseller is null then
    raise exception 'Somente ADMIN ou revendedor ativo usam o DirectLink' using errcode = '42501';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 30 then
    raise exception 'Informe até 30 botões' using errcode = '22023';
  end if;

  if p_id is not null then
    select * into v_link from public.direct_links d
    where d.id = p_id and (v_admin or d.reseller_id = v_reseller)
    for update;
    if not found then
      raise exception 'DirectLink não encontrado' using errcode = 'P0002';
    end if;
  end if;

  -- Imagem nova só se foi enviada por este usuário (pasta dele) e existe no bucket.
  if v_banner is not null and v_banner is distinct from v_link.banner_path and (
       split_part(v_banner, '/', 1) <> v_uid::text
    or not exists (select 1 from storage.objects o where o.bucket_id = 'directlink-assets' and o.name = v_banner)) then
    raise exception 'Banner inválido: envie a imagem de novo' using errcode = '22023';
  end if;
  if v_logo is not null and v_logo is distinct from v_link.logo_path and (
       split_part(v_logo, '/', 1) <> v_uid::text
    or not exists (select 1 from storage.objects o where o.bucket_id = 'directlink-assets' and o.name = v_logo)) then
    raise exception 'Logo inválida: envie a imagem de novo' using errcode = '22023';
  end if;

  if p_id is null then
    insert into public.direct_links (public_code, owner_user_id, reseller_id, title, description, banner_path, logo_path, is_active)
    values (public.directlink_new_code(), v_uid, v_reseller, btrim(coalesce(p_title, '')),
            nullif(btrim(coalesce(p_description, '')), ''), v_banner, v_logo, coalesce(p_is_active, true))
    returning * into v_link;
  else
    update public.direct_links d set
      title = btrim(coalesce(p_title, '')),
      description = nullif(btrim(coalesce(p_description, '')), ''),
      banner_path = v_banner,
      logo_path = v_logo,
      is_active = coalesce(p_is_active, d.is_active)
    where d.id = v_link.id
    returning * into v_link;
  end if;

  -- Botões: atualiza os existentes (mesmo id), cria os novos, remove os retirados.
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_pos := v_pos + 1;
    v_type := v_item->>'type';
    v_value := v_item->>'value';
    v_receiver := nullif(btrim(coalesce(v_item->>'receiver_name', '')), '');
    if not public.directlink_item_is_valid(v_type, v_value, v_receiver) then
      raise exception 'Botão % (%): valor inválido', v_pos, coalesce(v_type, '?') using errcode = '22023';
    end if;
    v_item_id := nullif(v_item->>'id', '')::uuid;
    if v_item_id is not null then
      update public.direct_link_items i set
        type = v_type, title = btrim(v_item->>'title'), value = v_value, receiver_name = v_receiver,
        sort_order = v_pos, is_active = coalesce((v_item->>'is_active')::boolean, true)
      where i.id = v_item_id and i.direct_link_id = v_link.id;
      if not found then
        raise exception 'Botão % não pertence a este DirectLink', v_pos using errcode = 'P0002';
      end if;
    else
      insert into public.direct_link_items (direct_link_id, type, title, value, receiver_name, sort_order, is_active)
      values (v_link.id, v_type, btrim(v_item->>'title'), v_value, v_receiver, v_pos, coalesce((v_item->>'is_active')::boolean, true))
      returning direct_link_items.id into v_item_id;
    end if;
    v_keep := v_keep || v_item_id;
  end loop;
  delete from public.direct_link_items i where i.direct_link_id = v_link.id and not (i.id = any(v_keep));

  id := v_link.id;
  public_code := v_link.public_code;
  return next;
end;
$$;

create or replace function public.directlink_set_active(p_id uuid, p_active boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin boolean := public.is_admin();
  v_reseller uuid := case when public.is_admin() then null else public.current_reseller_id() end;
begin
  if not v_admin and v_reseller is null then
    raise exception 'Somente ADMIN ou revendedor ativo usam o DirectLink' using errcode = '42501';
  end if;
  update public.direct_links d set is_active = coalesce(p_active, false)
  where d.id = p_id and (v_admin or d.reseller_id = v_reseller);
  if not found then
    raise exception 'DirectLink não encontrado' using errcode = 'P0002';
  end if;
  return coalesce(p_active, false);
end;
$$;

-- ---------------------------------------------------------------------
-- Leitura pública (sem login): só o necessário para exibir a página
-- ---------------------------------------------------------------------
create or replace function public.public_direct_link(p_code text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'code', d.public_code,
    'title', d.title,
    'description', d.description,
    'banner_path', d.banner_path,
    'logo_path', d.logo_path,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object('type', i.type, 'title', i.title, 'value', i.value, 'receiver_name', i.receiver_name)
                       order by i.sort_order)
      from public.direct_link_items i
      where i.direct_link_id = d.id and i.is_active
    ), '[]'::jsonb)
  )
  from public.direct_links d
  where d.public_code = upper(btrim(coalesce(p_code, ''))) and d.is_active;
$$;

revoke all on function public.directlink_save(uuid, text, text, text, text, boolean, jsonb) from public, anon;
grant execute on function public.directlink_save(uuid, text, text, text, text, boolean, jsonb) to authenticated;
revoke all on function public.directlink_set_active(uuid, boolean) from public, anon;
grant execute on function public.directlink_set_active(uuid, boolean) to authenticated;
revoke all on function public.public_direct_link(text) from public;
grant execute on function public.public_direct_link(text) to anon, authenticated;
revoke all on function public.directlink_new_code() from public, anon, authenticated;
revoke all on function public.guard_direct_link() from public, anon, authenticated;
grant execute on function public.directlink_item_is_valid(text, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- Storage: bucket público só para leitura das imagens das páginas
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('directlink-assets', 'directlink-assets', true, 4194304, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update set
  public = true,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Upload: ADMIN ou revendedor ativo, só na PRÓPRIA pasta (<uid>/banner|logo/...).
drop policy if exists directlink_assets_insert on storage.objects;
create policy directlink_assets_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'directlink-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
    and (storage.foldername(name))[2] in ('banner', 'logo')
    and (public.is_admin() or public.current_reseller_id() is not null)
  );
-- Sem policy de UPDATE/DELETE: nada é sobrescrito nem apagado.
