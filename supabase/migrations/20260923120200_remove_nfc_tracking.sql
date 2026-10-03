-- =====================================================================
-- 010 · Remoção do controle operacional de NFC
--
-- O sistema não controla mais gravação/teste físico do NFC. Cada placa
-- continua tendo sua URL NFC ({GO_BASE_URL}/{public_code}?src=nfc), e o
-- parâmetro src segue registrado em redirects.source apenas para analytics.
--
-- Migration incremental e segura para bancos que já aplicaram 001–009:
-- as migrations anteriores não foram alteradas.
-- =====================================================================

-- create_plate_batch inseria nfc_status: redefinida ANTES do drop para que
-- a geração de lotes nunca fique quebrada.
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

    insert into public.plates (public_code, batch_id, status)
    values (public.generate_public_code(6), v_batch_id, 'in_stock')
    on conflict (public_code) do nothing;

    get diagnostics v_rows = row_count;
    v_inserted := v_inserted + v_rows;
  end loop;

  return v_batch_id;
end;
$$;

-- A constraint plates_nfc_status_check é removida junto com a coluna.
alter table public.plates drop column if exists nfc_status;
alter table public.plates drop column if exists nfc_recorded_at;
alter table public.plates drop column if exists nfc_tested_at;

revoke all on function public.create_plate_batch(text, text, integer, uuid, uuid) from public, anon;
grant execute on function public.create_plate_batch(text, text, integer, uuid, uuid) to authenticated;
