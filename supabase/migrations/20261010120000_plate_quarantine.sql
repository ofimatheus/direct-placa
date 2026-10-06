-- =====================================================================
-- 029 · Quarentena e exclusão administrativa de PLACAS
--
-- Regra única de "fora da operação":
--     placa em quarentena (plates.quarantined_at)  OU  lote em quarentena
--     (plate_batches.lifecycle_status = 'quarantine')
-- → a placa sai da lista operacional, do estoque disponível, da escolha
--   automática de atribuição/venda e do contador "Disponíveis".
--
-- A quarentena da placa é um estado PRÓPRIO (colunas quarantined_*), sem
-- tocar no status operacional: restaurar é só limpar essas colunas, e a placa
-- volta exatamente como estava (status, lote, versão, código, QR).
-- "blocked" continua sendo o bloqueio operacional — não é quarentena.
--
-- Exclusão física: só pela função admin_plates_delete_unused (ADMIN), só de
-- placas NUNCA usadas, com as linhas travadas e a elegibilidade reconferida
-- na mesma transação. DELETE direto na tabela deixa de ser permitido aos
-- usuários do app.
--
-- Incremental e idempotente. Nenhuma placa existente entra em quarentena.
-- =====================================================================

alter table public.plates add column if not exists quarantined_at timestamptz;
alter table public.plates add column if not exists quarantined_by uuid references auth.users (id) on delete set null;
alter table public.plates add column if not exists quarantine_reason text;
do $$ begin
  alter table public.plates add constraint plates_quarantine_reason_check
    check (quarantine_reason is null or (quarantined_at is not null and char_length(quarantine_reason) <= 300));
exception when duplicate_object then null; end $$;
create index if not exists plates_quarantined_idx on public.plates (quarantined_at) where quarantined_at is not null;

comment on column public.plates.quarantined_at is 'Quarentena administrativa da placa (null = fora de quarentena). Não altera o status operacional.';

/**
 * Situação de quarentena da placa (campo calculado também usado pelo PostgREST):
 *   'plate' = a própria placa está em quarentena; 'batch' = o lote dela está;
 *   null    = operacional.
 */
create or replace function public.quarantine_state(p public.plates)
returns text
language sql
stable
set search_path = public
as $$
  select case
    when p.quarantined_at is not null then 'plate'
    when exists (select 1 from public.plate_batches b where b.id = p.batch_id and b.lifecycle_status = 'quarantine') then 'batch'
    else null
  end;
$$;
grant execute on function public.quarantine_state(public.plates) to authenticated;

-- Placa em quarentena não muda de dono, cliente, status nem destino (só os
-- contadores de acesso e a própria quarentena podem mudar).
create or replace function public.guard_plate_quarantine()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.quarantined_at is not null and new.quarantined_at is not null and (
       new.reseller_id is distinct from old.reseller_id
    or new.customer_id is distinct from old.customer_id
    or new.status is distinct from old.status
    or new.destination_url is distinct from old.destination_url
    or new.destination_type is distinct from old.destination_type
    or new.batch_id is distinct from old.batch_id
  ) then
    raise exception 'A placa % está em quarentena e não participa de operações. Restaure-a antes.', new.public_code
      using errcode = '55000', detail = 'plate_quarantined';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_plates_quarantine_guard on public.plates;
create trigger trg_plates_quarantine_guard before update on public.plates
  for each row execute function public.guard_plate_quarantine();

-- Placa em quarentena não pode ser reservada em pedido.
create or replace function public.guard_order_plate_quarantine()
returns trigger
language plpgsql
set search_path = public
as $$
declare v_code text;
begin
  select p.public_code into v_code from public.plates p where p.id = new.plate_id and p.quarantined_at is not null;
  if v_code is not null then
    raise exception 'A placa % está em quarentena e não pode ser reservada.', v_code using errcode = '55000', detail = 'plate_quarantined';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_order_plates_quarantine_guard on public.order_plates;
create trigger trg_order_plates_quarantine_guard before insert on public.order_plates
  for each row execute function public.guard_order_plate_quarantine();

-- Exclusão física só pela função administrativa (que roda como dona da tabela).
revoke delete on public.plates from anon, authenticated;

-- ---------------------------------------------------------------------
-- Funções existentes: a escolha de placas pula as que estão em quarentena
-- (definições atuais copiadas do banco, com o acréscimo de quarantined_at).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assign_plates_to_reseller(p_reseller_id uuid, p_quantity integer DEFAULT NULL::integer, p_plate_ids uuid[] DEFAULT NULL::uuid[], p_batch_id uuid DEFAULT NULL::uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_ids   uuid[];
  v_ready integer;
begin
  if not public.is_admin() then
    raise exception 'Somente ADMIN pode atribuir placas' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.reseller_profiles rp join public.profiles pr on pr.id = rp.user_id
    where rp.id = p_reseller_id and pr.active and pr.role = 'reseller'
  ) then
    raise exception 'Revendedor inválido ou inativo' using errcode = '22023';
  end if;
  if (p_quantity is null) = (p_plate_ids is null) then
    raise exception 'Informe a quantidade OU as placas selecionadas' using errcode = '22023';
  end if;
  if p_batch_id is not null and not exists (
    select 1 from public.plate_batches b where b.id = p_batch_id and b.lifecycle_status = 'active'
  ) then
    raise exception 'Este lote não está em circulação e não pode ser usado em atribuições'
      using errcode = '55000', detail = 'batch_not_active';
  end if;

  if p_plate_ids is not null then
    select array_agg(distinct x) into v_ids from unnest(p_plate_ids) as x;
    if v_ids is null or cardinality(v_ids) = 0 or cardinality(v_ids) > 1000 then
      raise exception 'Selecione entre 1 e 1000 placas' using errcode = '22023';
    end if;
    perform 1 from public.plates p where p.id = any(v_ids) order by p.id for update;
    select count(*) into v_ready
    from public.plates p
    join public.plate_batches b on b.id = p.batch_id and b.lifecycle_status = 'active'
    where p.id = any(v_ids) and p.reseller_id is null and p.status = 'in_stock'
      and p.quarantined_at is null;
    if v_ready <> cardinality(v_ids) then
      raise exception 'Algumas placas selecionadas não estão mais disponíveis em estoque' using errcode = '55000';
    end if;
  else
    if p_quantity < 1 or p_quantity > 1000 then
      raise exception 'A quantidade deve estar entre 1 e 1000' using errcode = '22023';
    end if;
    select array_agg(s.id) into v_ids
    from (
      select p.id
      from public.plates p
      join public.plate_batches b on b.id = p.batch_id and b.lifecycle_status = 'active'
      where p.reseller_id is null
        and p.status = 'in_stock'
        and p.quarantined_at is null
        and (p_batch_id is null or p.batch_id = p_batch_id)
      order by p.created_at, p.public_code
      limit p_quantity
      for update of p skip locked
    ) s;
    if coalesce(cardinality(v_ids), 0) < p_quantity then
      raise exception 'Há apenas % placas disponíveis em estoque', coalesce(cardinality(v_ids), 0)
        using errcode = '55000';
    end if;
  end if;

  update public.plates p set
    reseller_id = p_reseller_id,
    customer_id = null,
    status = 'assigned'
  where p.id = any(v_ids);

  return cardinality(v_ids);
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_sale_with_plates(p_reseller_id uuid, p_quantity integer, p_unit_price numeric, p_discount numeric DEFAULT 0, p_notes text DEFAULT NULL::text, p_status text DEFAULT 'pending'::text, p_selection text DEFAULT 'automatic'::text, p_plate_ids uuid[] DEFAULT NULL::uuid[], p_batch_id uuid DEFAULT NULL::uuid, p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_order   uuid;
  v_ids     uuid[];
  v_found   integer;
  v_codes   text;
  v_scope   text := case when p_batch_id is null then '' else ' neste lote' end;
begin
  if not public.is_admin() then
    raise exception 'Somente ADMIN pode registrar vendas' using errcode = '42501';
  end if;
  if p_idempotency_key is null then
    raise exception 'idempotency_key é obrigatória' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('create_sale_with_plates:' || p_idempotency_key::text, 0));
  select o.id into v_order from public.orders o where o.idempotency_key = p_idempotency_key;
  if found then
    return v_order;
  end if;

  if p_selection is null or p_selection not in ('automatic', 'manual') then
    raise exception 'Escolha a forma de seleção das placas: automática ou manual' using errcode = '22023';
  end if;
  if p_status is null or p_status not in ('pending', 'paid') then
    raise exception 'Status inicial inválido' using errcode = '22023';
  end if;
  if p_quantity is null or p_quantity < 1 or p_quantity > 2000 then
    raise exception 'A quantidade deve estar entre 1 e 2.000 placas por venda' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.reseller_profiles rp join public.profiles pr on pr.id = rp.user_id
    where rp.id = p_reseller_id and pr.active and pr.role = 'reseller'
  ) then
    raise exception 'Revendedor inválido ou inativo' using errcode = '22023';
  end if;

  -- Lote explicitamente escolhido precisa estar em circulação.
  if p_batch_id is not null and not exists (
    select 1 from public.plate_batches b where b.id = p_batch_id and b.lifecycle_status = 'active'
  ) then
    raise exception 'Este lote não está em circulação e não pode ser usado em vendas'
      using errcode = '55000', detail = 'batch_not_active';
  end if;

  if p_selection = 'manual' then
    select array_agg(distinct x) into v_ids from unnest(coalesce(p_plate_ids, '{}'::uuid[])) as x where x is not null;
    v_found := coalesce(cardinality(v_ids), 0);
    if v_found <> p_quantity then
      raise exception 'Selecione exatamente % placa(s) para esta venda (selecionadas: %)', p_quantity, v_found
        using errcode = '22023';
    end if;

    perform 1 from public.plates p where p.id = any(v_ids) order by p.id for update;

    select string_agg(coalesce(p.public_code, 'inexistente'), ', ' order by p.public_code) into v_codes
    from unnest(v_ids) as x
    left join public.plates p on p.id = x
    where p.id is null
       or p.status <> 'in_stock'
       or p.reseller_id is not null
       or p.quarantined_at is not null
       or exists (select 1 from public.order_plates op where op.plate_id = p.id and op.released_at is null)
       -- Lote fora de circulação: a placa não está disponível, ponto.
       or not exists (
            select 1 from public.plate_batches b
            where b.id = p.batch_id and b.lifecycle_status = 'active'
          );
    if v_codes is not null then
      raise exception 'Estas placas não estão mais disponíveis: %. Atualize a lista e selecione outras.', v_codes
        using errcode = '55000';
    end if;
  else
    select array_agg(s.id) into v_ids
    from (
      select p.id
      from public.plates p
      join public.plate_batches b on b.id = p.batch_id and b.lifecycle_status = 'active'
      where p.status = 'in_stock'
        and p.reseller_id is null
        and p.quarantined_at is null
        and (p_batch_id is null or p.batch_id = p_batch_id)
        and not exists (select 1 from public.order_plates op where op.plate_id = p.id and op.released_at is null)
      order by p.created_at, p.public_code
      limit p_quantity
      for update of p skip locked
    ) s;
    v_found := coalesce(cardinality(v_ids), 0);
    if v_found < p_quantity then
      if v_found = 0 then
        raise exception 'Não há placas disponíveis%.', case when p_batch_id is null then ' no estoque' else v_scope end
          using errcode = '55000', detail = 'insufficient_stock';
      elsif v_found = 1 then
        raise exception 'Existe apenas 1 placa disponível%.', v_scope
          using errcode = '55000', detail = 'insufficient_stock';
      else
        raise exception 'Existem apenas % placas disponíveis%.', v_found, v_scope
          using errcode = '55000', detail = 'insufficient_stock';
      end if;
    end if;
  end if;

  v_order := public.create_order(p_reseller_id, p_quantity, p_unit_price, p_discount, p_notes, p_status);
  update public.orders o set idempotency_key = p_idempotency_key where o.id = v_order;

  update public.plates p set
    reseller_id = p_reseller_id,
    customer_id = null,
    destination_type = null,
    destination_url = null,
    status = 'assigned'
  where p.id = any(v_ids);
  get diagnostics v_found = row_count;
  if v_found <> p_quantity then
    raise exception 'Não foi possível reservar todas as placas' using errcode = '55000';
  end if;

  update public.plate_assignments a set order_id = v_order
  where a.plate_id = any(v_ids) and a.unassigned_at is null;

  insert into public.order_plates (order_id, plate_id, reserved_by)
  select v_order, x, auth.uid() from unnest(v_ids) as x;

  return v_order;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_dashboard_metrics(p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_sales   jsonb;
  v_plates  jsonb;
begin
  if not public.is_admin() then
    raise exception 'Somente ADMIN' using errcode = '42501';
  end if;

  with paid as (
    select o.id, o.total from public.orders o
    where o.status = 'paid' and o.paid_at >= p_from and o.paid_at < p_to
  )
  select jsonb_build_object(
    'revenue', coalesce((select sum(total) from paid), 0),
    'sales', (select count(*) from paid),
    'plates_sold', coalesce((
      select sum(i.quantity) from public.order_items i join paid on paid.id = i.order_id where i.kind = 'plates'
    ), 0),
    'accesses', (
      select count(*) from public.redirects r
      where r.source = 'qr' and r.created_at >= p_from and r.created_at < p_to
    )
  ) into v_sales;

  select jsonb_build_object(
    'plates_produced', count(*),
    'plates_in_stock', count(*) filter (where p.reseller_id is null and p.status = 'in_stock' and public.quarantine_state(p) is null),
    'plates_with_resellers', count(*) filter (where p.reseller_id is not null),
    'plates_configured', count(*) filter (where p.destination_url is not null),
    'plates_active', count(*) filter (where p.status = 'active')
  ) into v_plates
  from public.plates p;

  return v_sales || v_plates || jsonb_build_object(
    'resellers_active', (
      select count(*) from public.reseller_profiles rp join public.profiles pr on pr.id = rp.user_id
      where pr.active and pr.role = 'reseller'
    )
  );
end;
$function$;

-- ---------------------------------------------------------------------
-- Ações administrativas em massa (uma chamada para até 5000 placas)
-- ---------------------------------------------------------------------
create or replace function public.admin_plates_assert(p_plate_ids uuid[])
returns uuid[]
language plpgsql
stable
security definer
set search_path = public
as $$
declare v uuid[];
begin
  if not public.is_admin() then raise exception 'Somente ADMIN' using errcode = '42501'; end if;
  select coalesce(array_agg(distinct x), '{}') into v from unnest(coalesce(p_plate_ids, '{}')) x where x is not null;
  if cardinality(v) = 0 then raise exception 'Selecione ao menos uma placa.' using errcode = '22023'; end if;
  if cardinality(v) > 5000 then raise exception 'No máximo 5000 placas por vez.' using errcode = '22023'; end if;
  return v;
end;
$$;
revoke all on function public.admin_plates_assert(uuid[]) from public, anon, authenticated;

/**
 * Coloca placas em quarentena. Só placas fora de uso: sem revendedor, não
 * ativas e sem reserva aberta. As demais são informadas (não alteradas).
 */
create or replace function public.admin_plates_quarantine(p_plate_ids uuid[], p_reason text default null)
returns table (quarantined integer, already integer, skipped integer, skipped_codes text[], missing integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids uuid[] := public.admin_plates_assert(p_plate_ids);
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if v_reason is not null and char_length(v_reason) > 300 then
    raise exception 'O motivo pode ter no máximo 300 caracteres.' using errcode = '22023';
  end if;
  perform 1 from public.plates p where p.id = any(v_ids) order by p.id for update;
  return query
  with target as (
    select p.*,
      (p.quarantined_at is not null) as is_already,
      (p.reseller_id is not null or p.status = 'active'
        or exists (select 1 from public.order_plates op where op.plate_id = p.id and op.released_at is null)) as in_use
    from public.plates p where p.id = any(v_ids)
  ), upd as (
    update public.plates p
       set quarantined_at = now(), quarantined_by = auth.uid(), quarantine_reason = v_reason
      from target t
     where p.id = t.id and not t.is_already and not t.in_use
    returning p.id
  )
  select (select count(*)::int from upd),
         (select count(*)::int from target where is_already),
         (select count(*)::int from target where not is_already and in_use),
         (select coalesce(array_agg(public_code order by public_code), '{}') from (select public_code from target where not is_already and in_use order by public_code limit 50) s),
         cardinality(v_ids) - (select count(*)::int from target);
end;
$$;

/** Restaura placas da quarentena: devolve exatamente o estado anterior (status/lote/código intactos). */
create or replace function public.admin_plates_restore(p_plate_ids uuid[])
returns table (restored integer, not_quarantined integer, still_batch_quarantine integer, missing integer)
language plpgsql
security definer
set search_path = public
as $$
declare v_ids uuid[] := public.admin_plates_assert(p_plate_ids);
begin
  perform 1 from public.plates p where p.id = any(v_ids) order by p.id for update;
  return query
  with target as (select p.id, p.batch_id, p.quarantined_at from public.plates p where p.id = any(v_ids)),
  upd as (
    update public.plates p set quarantined_at = null, quarantined_by = null, quarantine_reason = null
      from target t where p.id = t.id and t.quarantined_at is not null
    returning p.id, p.batch_id
  )
  select (select count(*)::int from upd),
         (select count(*)::int from target where quarantined_at is null),
         (select count(*)::int from upd u join public.plate_batches b on b.id = u.batch_id and b.lifecycle_status = 'quarantine'),
         cardinality(v_ids) - (select count(*)::int from target);
end;
$$;

/** Motivo pelo qual a placa NÃO pode ser excluída (null = nunca usada: pode). */
create or replace function public.plate_delete_block_reason(p public.plates)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when exists (select 1 from public.reseller_sale_items i where i.plate_id = p.id) then 'sale'
    when exists (select 1 from public.order_plates op where op.plate_id = p.id) then 'order'
    when p.customer_id is not null then 'customer'
    when p.reseller_id is not null or exists (select 1 from public.plate_assignments a where a.plate_id = p.id) then 'reseller'
    when p.status not in ('in_stock', 'blocked') or p.destination_url is not null or p.destination_type is not null then 'activation'
    when p.access_count > 0 or p.qr_access_count > 0 or p.last_access_at is not null
         or exists (select 1 from public.redirects r where r.plate_id = p.id) then 'accesses'
    else null
  end;
$$;
revoke all on function public.plate_delete_block_reason(public.plates) from public, anon, authenticated;

/**
 * Exclui DEFINITIVAMENTE as placas nunca usadas entre as selecionadas. Trava
 * as linhas e reconfere tudo na mesma transação (uma reserva concorrente ou
 * espera esta transação ou é vista aqui). As protegidas são mantidas e
 * listadas com o motivo. Devolve as excluídas (para limpar o Storage).
 */
create or replace function public.admin_plates_delete_unused(p_plate_ids uuid[])
returns table (deleted integer, deleted_plates jsonb, kept integer, kept_by_reason jsonb, kept_codes text[], missing integer)
language plpgsql
security definer
set search_path = public
as $$
declare v_ids uuid[] := public.admin_plates_assert(p_plate_ids);
begin
  perform 1 from public.plates p where p.id = any(v_ids) order by p.id for update;
  return query
  with target as (
    select p.id, p.public_code, p.batch_id, public.plate_delete_block_reason(p) as reason
    from public.plates p where p.id = any(v_ids)
  ), del as (
    delete from public.plates p using target t
     where p.id = t.id and t.reason is null
    returning p.id, p.public_code, p.batch_id
  )
  select (select count(*)::int from del),
         (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'public_code', public_code, 'batch_id', batch_id)), '[]'::jsonb) from del),
         (select count(*)::int from target where reason is not null),
         (select coalesce(jsonb_object_agg(reason, n), '{}'::jsonb) from (select reason, count(*)::int n from target where reason is not null group by reason) s),
         (select coalesce(array_agg(public_code order by public_code), '{}') from (select public_code from target where reason is not null order by public_code limit 50) s),
         cardinality(v_ids) - (select count(*)::int from target);
end;
$$;

revoke all on function public.admin_plates_quarantine(uuid[], text) from public, anon;
grant execute on function public.admin_plates_quarantine(uuid[], text) to authenticated;
revoke all on function public.admin_plates_restore(uuid[]) from public, anon;
grant execute on function public.admin_plates_restore(uuid[]) to authenticated;
revoke all on function public.admin_plates_delete_unused(uuid[]) from public, anon;
grant execute on function public.admin_plates_delete_unused(uuid[]) to authenticated;
