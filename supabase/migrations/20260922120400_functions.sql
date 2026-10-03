-- =====================================================================
-- 005 · Funções transacionais
--
-- Toda operação que precisa ser atômica mora aqui, dentro de uma única
-- transação do Postgres: criação de lote (com placas), criação/edição de
-- template (com versionamento), redirect público e reivindicação de jobs.
-- Códigos de erro (SQLSTATE) usados e mapeados na API:
--   42501 → 403 · 22023 → 400 · P0002 → 404 · 55000 → 409
-- =====================================================================

-- ---------------------------------------------------------------------
-- Geração de public_code: 6 caracteres de um alfabeto sem ambíguos
-- (sem 0/O, 1/I/L). 31^6 ≈ 887 milhões de combinações.
-- Amostragem por rejeição para distribuição uniforme.
-- ---------------------------------------------------------------------
create or replace function public.generate_public_code(p_length integer default 6)
returns text
language plpgsql
volatile
set search_path = public, extensions
as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_size     constant integer := 31;
  v_limit    constant integer := 248; -- 31 * 8
  v_code     text := '';
  v_bytes    bytea;
  v_byte     integer;
  i          integer;
begin
  while char_length(v_code) < p_length loop
    v_bytes := extensions.gen_random_bytes(16);
    for i in 0 .. 15 loop
      v_byte := get_byte(v_bytes, i);
      if v_byte < v_limit then
        v_code := v_code || substr(v_alphabet, (v_byte % v_size) + 1, 1);
        exit when char_length(v_code) >= p_length;
      end if;
    end loop;
  end loop;
  return v_code;
end;
$$;

-- ---------------------------------------------------------------------
-- Campos de layout de uma versão (para detectar "nada mudou")
-- ---------------------------------------------------------------------
create or replace function public.ptv_layout_json(v public.plate_template_versions)
returns jsonb
language sql
immutable
as $$
  select to_jsonb(v) - array[
    'id', 'template_id', 'version_number', 'locked_at',
    'created_by', 'created_at', 'updated_at'
  ];
$$;

-- ---------------------------------------------------------------------
-- Criar template + versão 1 (atômico)
-- A arte já deve estar no Storage no caminho imutável
-- plate-templates/{template_id}/{sha256}.{ext} — por isso o id vem da API.
-- ---------------------------------------------------------------------
create or replace function public.create_plate_template(
  p_template_id   uuid,
  p_name          text,
  p_internal_key  text,
  p_description   text,
  p_layout        jsonb
)
returns table (result_template_id uuid, result_version_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_layout     public.plate_template_versions%rowtype;
  v_version_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Somente ADMIN pode criar templates' using errcode = '42501';
  end if;

  select * into v_layout from jsonb_populate_record(null::public.plate_template_versions, p_layout);

  insert into public.plate_templates (id, name, internal_key, description, active, created_by)
  values (p_template_id, btrim(p_name), p_internal_key, nullif(btrim(coalesce(p_description, '')), ''), true, auth.uid());

  insert into public.plate_template_versions (
    template_id, version_number,
    base_image_path, base_image_mime_type, base_image_sha256, base_image_size_bytes,
    canvas_width, canvas_height, print_width_mm, print_height_mm,
    qr_x, qr_y, qr_width, qr_height, qr_error_correction, qr_quiet_zone, qr_color, qr_background_color,
    show_public_code, code_x, code_y, code_font_family, code_font_size, code_color, code_align, code_max_width,
    safe_margin, renderer_version, created_by
  ) values (
    p_template_id, 1,
    v_layout.base_image_path, v_layout.base_image_mime_type, v_layout.base_image_sha256, v_layout.base_image_size_bytes,
    v_layout.canvas_width, v_layout.canvas_height, v_layout.print_width_mm, v_layout.print_height_mm,
    v_layout.qr_x, v_layout.qr_y, v_layout.qr_width, v_layout.qr_height, v_layout.qr_error_correction,
    v_layout.qr_quiet_zone, v_layout.qr_color, v_layout.qr_background_color,
    v_layout.show_public_code, v_layout.code_x, v_layout.code_y, v_layout.code_font_family, v_layout.code_font_size,
    v_layout.code_color, v_layout.code_align, v_layout.code_max_width,
    v_layout.safe_margin, v_layout.renderer_version, auth.uid()
  )
  returning id into v_version_id;

  update public.plate_templates set current_version_id = v_version_id where id = p_template_id;

  return query select p_template_id, v_version_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Salvar layout de um template com versionamento automático
--   · layout idêntico à versão atual      → nada muda (unchanged)
--   · versão atual ainda não usada em lote → edita no lugar
--   · versão atual bloqueada               → cria versão N+1 e a torna atual
-- O FOR UPDATE no template serializa esta função com create_plate_batch,
-- então uma versão nunca é editada no instante em que um lote passa a usá-la.
-- ---------------------------------------------------------------------
create or replace function public.save_template_layout(p_template_id uuid, p_layout jsonb)
returns table (
  result_version_id      uuid,
  result_version_number  integer,
  created_new            boolean,
  unchanged              boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_template public.plate_templates%rowtype;
  v_current  public.plate_template_versions%rowtype;
  v_layout   public.plate_template_versions%rowtype;
  v_next     integer;
  v_new_id   uuid;
begin
  if not public.is_admin() then
    raise exception 'Somente ADMIN pode editar templates' using errcode = '42501';
  end if;

  select * into v_template from public.plate_templates t where t.id = p_template_id for update;
  if not found then
    raise exception 'Template não encontrado' using errcode = 'P0002';
  end if;

  select * into v_layout from jsonb_populate_record(null::public.plate_template_versions, p_layout);

  if v_template.current_version_id is not null then
    select * into v_current from public.plate_template_versions v where v.id = v_template.current_version_id;

    if public.ptv_layout_json(v_current) = public.ptv_layout_json(v_layout) then
      return query select v_current.id, v_current.version_number, false, true;
      return;
    end if;

    if v_current.locked_at is null then
      update public.plate_template_versions v set
        base_image_path       = v_layout.base_image_path,
        base_image_mime_type  = v_layout.base_image_mime_type,
        base_image_sha256     = v_layout.base_image_sha256,
        base_image_size_bytes = v_layout.base_image_size_bytes,
        canvas_width          = v_layout.canvas_width,
        canvas_height         = v_layout.canvas_height,
        print_width_mm        = v_layout.print_width_mm,
        print_height_mm       = v_layout.print_height_mm,
        qr_x                  = v_layout.qr_x,
        qr_y                  = v_layout.qr_y,
        qr_width              = v_layout.qr_width,
        qr_height             = v_layout.qr_height,
        qr_error_correction   = v_layout.qr_error_correction,
        qr_quiet_zone         = v_layout.qr_quiet_zone,
        qr_color              = v_layout.qr_color,
        qr_background_color   = v_layout.qr_background_color,
        show_public_code      = v_layout.show_public_code,
        code_x                = v_layout.code_x,
        code_y                = v_layout.code_y,
        code_font_family      = v_layout.code_font_family,
        code_font_size        = v_layout.code_font_size,
        code_color            = v_layout.code_color,
        code_align            = v_layout.code_align,
        code_max_width        = v_layout.code_max_width,
        safe_margin           = v_layout.safe_margin,
        renderer_version      = v_layout.renderer_version
      where v.id = v_current.id;

      return query select v_current.id, v_current.version_number, false, false;
      return;
    end if;
  end if;

  select coalesce(max(v.version_number), 0) + 1 into v_next
  from public.plate_template_versions v
  where v.template_id = p_template_id;

  insert into public.plate_template_versions (
    template_id, version_number,
    base_image_path, base_image_mime_type, base_image_sha256, base_image_size_bytes,
    canvas_width, canvas_height, print_width_mm, print_height_mm,
    qr_x, qr_y, qr_width, qr_height, qr_error_correction, qr_quiet_zone, qr_color, qr_background_color,
    show_public_code, code_x, code_y, code_font_family, code_font_size, code_color, code_align, code_max_width,
    safe_margin, renderer_version, created_by
  ) values (
    p_template_id, v_next,
    v_layout.base_image_path, v_layout.base_image_mime_type, v_layout.base_image_sha256, v_layout.base_image_size_bytes,
    v_layout.canvas_width, v_layout.canvas_height, v_layout.print_width_mm, v_layout.print_height_mm,
    v_layout.qr_x, v_layout.qr_y, v_layout.qr_width, v_layout.qr_height, v_layout.qr_error_correction,
    v_layout.qr_quiet_zone, v_layout.qr_color, v_layout.qr_background_color,
    v_layout.show_public_code, v_layout.code_x, v_layout.code_y, v_layout.code_font_family, v_layout.code_font_size,
    v_layout.code_color, v_layout.code_align, v_layout.code_max_width,
    v_layout.safe_margin, v_layout.renderer_version, auth.uid()
  )
  returning id into v_new_id;

  update public.plate_templates t set current_version_id = v_new_id where t.id = p_template_id;

  return query select v_new_id, v_next, true, false;
end;
$$;

-- ---------------------------------------------------------------------
-- Criar lote + placas (atômico e idempotente)
--   · clique duplo / request duplicada → mesma idempotency_key devolve o mesmo lote
--   · colisão de public_code           → ON CONFLICT DO NOTHING + nova tentativa
--   · criação parcial                  → impossível: tudo numa transação
-- ---------------------------------------------------------------------
create or replace function public.create_plate_batch(
  p_name             text,
  p_description      text,
  p_quantity         integer,
  p_template_id      uuid,
  p_idempotency_key  uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_template  public.plate_templates%rowtype;
  v_batch_id  uuid;
  v_inserted  integer := 0;
  v_attempts  integer := 0;
  v_rows      integer;
begin
  if not public.is_admin() then
    raise exception 'Somente ADMIN pode gerar lotes' using errcode = '42501';
  end if;
  if p_quantity is null or p_quantity < 1 or p_quantity > 1000 then
    raise exception 'A quantidade deve estar entre 1 e 1000' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_name, ''))) = 0 then
    raise exception 'Informe o nome do lote' using errcode = '22023';
  end if;
  if p_idempotency_key is null then
    raise exception 'idempotency_key é obrigatória' using errcode = '22023';
  end if;

  -- Trava o template primeiro: serializa com save_template_layout e com
  -- outra request idêntica em andamento.
  select * into v_template from public.plate_templates t where t.id = p_template_id for update;
  if not found then
    raise exception 'Template não encontrado' using errcode = 'P0002';
  end if;

  -- Request repetida: devolve o lote já criado.
  select b.id into v_batch_id from public.plate_batches b where b.idempotency_key = p_idempotency_key;
  if found then
    return v_batch_id;
  end if;

  if not v_template.active then
    raise exception 'Template inativo não pode ser usado em novos lotes' using errcode = '55000';
  end if;
  if v_template.current_version_id is null then
    raise exception 'Template sem versão' using errcode = '55000';
  end if;

  begin
    insert into public.plate_batches (
      name, description, quantity, template_id, template_version_id, created_by, idempotency_key
    ) values (
      btrim(p_name), nullif(btrim(coalesce(p_description, '')), ''), p_quantity,
      v_template.id, v_template.current_version_id, auth.uid(), p_idempotency_key
    )
    returning id into v_batch_id;
  exception when unique_violation then
    select b.id into v_batch_id from public.plate_batches b where b.idempotency_key = p_idempotency_key;
    return v_batch_id;
  end;
  -- O trigger trg_plate_batches_lock_version preenche locked_at da versão aqui.

  while v_inserted < p_quantity loop
    v_attempts := v_attempts + 1;
    if v_attempts > p_quantity * 10 + 100 then
      raise exception 'Não foi possível gerar códigos únicos suficientes' using errcode = '55000';
    end if;

    insert into public.plates (public_code, batch_id, status, nfc_status)
    values (public.generate_public_code(6), v_batch_id, 'in_stock', 'not_recorded')
    on conflict (public_code) do nothing;

    get diagnostics v_rows = row_count;
    v_inserted := v_inserted + v_rows;
  end loop;

  return v_batch_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Redirect público (QR / NFC) — chamado com a chave anon.
-- Não expõe a tabela plates: só devolve o resultado da resolução.
-- Um acesso via NFC marca a placa como "testada" automaticamente.
-- ---------------------------------------------------------------------
create or replace function public.resolve_plate_redirect(p_code text, p_source text)
returns table (outcome text, target_url text, code text)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_plate  public.plates%rowtype;
  v_code   text := upper(btrim(coalesce(p_code, '')));
  v_source text := case when p_source in ('qr', 'nfc') then p_source else 'unknown' end;
begin
  if v_code !~ '^[A-Z0-9]{4,12}$' then
    return query select 'not_found'::text, null::text, v_code;
    return;
  end if;

  select * into v_plate from public.plates p where p.public_code = v_code;
  if not found then
    return query select 'not_found'::text, null::text, v_code;
    return;
  end if;

  insert into public.redirects (plate_id, source) values (v_plate.id, v_source);

  if v_source = 'nfc' and v_plate.nfc_status <> 'tested' then
    update public.plates p set
      nfc_status = 'tested',
      nfc_recorded_at = coalesce(p.nfc_recorded_at, now()),
      nfc_tested_at = now()
    where p.id = v_plate.id;
  end if;

  if v_plate.status = 'blocked' then
    return query select 'blocked'::text, null::text, v_code;
    return;
  end if;

  if v_plate.destination_url is null or v_plate.destination_url !~* '^https?://' then
    return query select 'unconfigured'::text, null::text, v_code;
    return;
  end if;

  return query select 'ok'::text, v_plate.destination_url, v_code;
end;
$$;

-- ---------------------------------------------------------------------
-- Reivindicar um job de exportação (worker, service_role)
-- ---------------------------------------------------------------------
create or replace function public.claim_batch_export(p_export_id uuid, p_lease_seconds integer default 90)
returns setof public.batch_exports
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update public.batch_exports e set
    status = 'processing',
    lease_token = gen_random_uuid(),
    lease_expires_at = now() + make_interval(secs => p_lease_seconds),
    started_at = coalesce(e.started_at, now())
  where e.id = p_export_id
    and (
      e.status = 'pending'
      or (e.status = 'processing' and (e.lease_expires_at is null or e.lease_expires_at < now()))
    )
  returning e.*;
end;
$$;

-- ---------------------------------------------------------------------
-- Permissões de execução (as funções também validam is_admin() por dentro)
-- ---------------------------------------------------------------------
revoke all on function public.generate_public_code(integer) from public, anon, authenticated;

revoke all on function public.create_plate_template(uuid, text, text, text, jsonb) from public, anon;
grant execute on function public.create_plate_template(uuid, text, text, text, jsonb) to authenticated;

revoke all on function public.save_template_layout(uuid, jsonb) from public, anon;
grant execute on function public.save_template_layout(uuid, jsonb) to authenticated;

revoke all on function public.create_plate_batch(text, text, integer, uuid, uuid) from public, anon;
grant execute on function public.create_plate_batch(text, text, integer, uuid, uuid) to authenticated;

revoke all on function public.resolve_plate_redirect(text, text) from public;
grant execute on function public.resolve_plate_redirect(text, text) to anon, authenticated;

revoke all on function public.claim_batch_export(uuid, integer) from public, anon, authenticated;
grant execute on function public.claim_batch_export(uuid, integer) to service_role;
