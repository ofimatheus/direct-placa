-- =====================================================================
-- 012 · Venda e reserva de placas numa única operação
--
-- Antes: o ADMIN registrava a venda (orders) e depois atribuía as mesmas
-- placas ao revendedor em outra tela. Agora registrar a venda JÁ reserva
-- as placas, numa única transação.
--
-- Status (valores internos preservados; só os rótulos do painel mudam):
--   in_stock  → DISPONÍVEL  em estoque, sem revendedor, sem venda
--   assigned  → RESERVADA   vendida/atribuída ao revendedor, ainda não ativada
--   active    → ATIVA       configurada e no ar
--   inactive / blocked continuam como estados administrativos.
--
-- Incremental e não destrutiva: não altera migrations anteriores, não
-- apaga dados. Vendas antigas continuam válidas (apenas sem placas
-- vinculadas). Substitui via CREATE OR REPLACE somente set_order_status
-- (mesma assinatura e permissões).
--
-- Garantias no banco (não só na interface):
--   · order_plates_one_active_idx: uma placa tem no máximo UM vínculo ativo
--     com venda. Duas vendas nunca reservam a mesma placa, mesmo que duas
--     transações passem pelas validações ao mesmo tempo.
--   · Reserva com FOR UPDATE (manual) / FOR UPDATE SKIP LOCKED (automática):
--     requests concorrentes não pegam a mesma placa.
--   · Placa vinculada a venda válida não muda de revendedor por outro
--     caminho (trigger), e venda com placas vinculadas só é cancelada pela
--     RPC de cancelamento (trigger).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Idempotência do registro de venda (clique duplo / retry de rede)
-- ---------------------------------------------------------------------
alter table public.orders add column if not exists idempotency_key uuid;
create unique index if not exists orders_idempotency_key_key on public.orders (idempotency_key);

-- ---------------------------------------------------------------------
-- 2. Vínculo venda ↔ placa (com histórico)
--    released_at IS NULL  → vínculo ativo (placa pertence à venda)
--    released_at NOT NULL → vínculo encerrado; release_reason diz o motivo:
--      returned_to_stock   venda cancelada, placa só reservada voltou ao estoque
--      kept_with_reseller  venda cancelada por ação administrativa explícita,
--                          placa em uso continuou com o revendedor
-- ---------------------------------------------------------------------
create table if not exists public.order_plates (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid not null references public.orders (id) on delete restrict,
  plate_id        uuid not null references public.plates (id) on delete restrict,
  reserved_by     uuid references public.profiles (id) on delete set null,
  reserved_at     timestamptz not null default now(),
  released_at     timestamptz,
  released_by     uuid references public.profiles (id) on delete set null,
  release_reason  text,
  constraint order_plates_release_reason_check
    check (release_reason is null or release_reason in ('returned_to_stock', 'kept_with_reseller')),
  constraint order_plates_release_consistency_check
    check ((released_at is null) = (release_reason is null))
);

comment on table public.order_plates is
  'Placas de cada venda. Vínculo ativo = released_at nulo. Índice único parcial garante uma venda válida por placa.';

-- REGRA CRÍTICA DE CONCORRÊNCIA: no máximo um vínculo ativo por placa.
create unique index if not exists order_plates_one_active_idx
  on public.order_plates (plate_id)
  where released_at is null;

create index if not exists order_plates_order_idx on public.order_plates (order_id);
create index if not exists order_plates_plate_idx on public.order_plates (plate_id, reserved_at desc);

-- Estoque disponível em ordem de reserva automática (mais antigas primeiro).
create index if not exists plates_available_idx
  on public.plates (created_at, public_code)
  where status = 'in_stock' and reseller_id is null;

-- ---------------------------------------------------------------------
-- 3. Histórico de atribuição ligado à venda
--    plate_assignments continua sendo preenchido pelo trigger existente
--    (track_plate_assignment); aqui só ganha a origem e o motivo de saída.
-- ---------------------------------------------------------------------
alter table public.plate_assignments
  add column if not exists order_id uuid references public.orders (id) on delete set null;
alter table public.plate_assignments add column if not exists ended_reason text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'plate_assignments_ended_reason_check') then
    alter table public.plate_assignments add constraint plate_assignments_ended_reason_check
      check (ended_reason is null or ended_reason in ('order_cancelled'));
  end if;
end;
$$;

create index if not exists plate_assignments_order_idx
  on public.plate_assignments (order_id)
  where order_id is not null;

-- ---------------------------------------------------------------------
-- 4. Guardas de integridade (valem para RPC, painel e SQL manual)
-- ---------------------------------------------------------------------

-- 4a. Um vínculo só nasce para placa RESERVADA ao revendedor da venda, em venda não cancelada.
create or replace function public.guard_order_plate_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_plate public.plates%rowtype;
begin
  select * into v_order from public.orders o where o.id = new.order_id;
  if v_order.status = 'cancelled' then
    raise exception 'Venda cancelada não pode receber placas' using errcode = '55000';
  end if;
  select * into v_plate from public.plates p where p.id = new.plate_id;
  if v_plate.status <> 'assigned' or v_plate.reseller_id is distinct from v_order.reseller_id then
    raise exception 'A placa % precisa estar reservada para o revendedor da venda', v_plate.public_code
      using errcode = '55000';
  end if;
  if new.released_at is not null then
    raise exception 'O vínculo da placa com a venda precisa nascer ativo' using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_order_plates_insert_guard on public.order_plates;
create trigger trg_order_plates_insert_guard
  before insert on public.order_plates
  for each row execute function public.guard_order_plate_insert();

-- 4b. Histórico imutável: só é possível encerrar um vínculo ativo, uma única vez.
create or replace function public.guard_order_plate_change()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'O histórico de placas da venda não pode ser apagado' using errcode = '55000';
  end if;
  if new.order_id is distinct from old.order_id
     or new.plate_id is distinct from old.plate_id
     or new.reserved_at is distinct from old.reserved_at
     or new.reserved_by is distinct from old.reserved_by then
    raise exception 'Venda, placa e data de reserva do vínculo são imutáveis' using errcode = '55000';
  end if;
  if old.released_at is not null and (
       new.released_at is distinct from old.released_at
       or new.released_by is distinct from old.released_by
       or new.release_reason is distinct from old.release_reason) then
    raise exception 'Um vínculo encerrado não pode ser reaberto nem alterado' using errcode = '55000';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_order_plates_change_guard on public.order_plates;
create trigger trg_order_plates_change_guard
  before update or delete on public.order_plates
  for each row execute function public.guard_order_plate_change();

-- 4c. Placa vinculada a venda válida não troca de revendedor por nenhum caminho
--     (set_plate_reseller, UPDATE do painel ou SQL manual).
create or replace function public.guard_plate_order_reseller()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_number bigint;
  v_order_reseller uuid;
begin
  if new.reseller_id is not distinct from old.reseller_id then
    return new;
  end if;
  select o.order_number, o.reseller_id into v_order_number, v_order_reseller
  from public.order_plates op
  join public.orders o on o.id = op.order_id
  where op.plate_id = new.id and op.released_at is null;
  if found and new.reseller_id is distinct from v_order_reseller then
    raise exception 'A placa % pertence à venda #% e não pode mudar de revendedor. Para devolvê-la ao estoque, cancele a venda.',
      new.public_code, v_order_number
      using errcode = '55000';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_plates_order_reseller_guard on public.plates;
create trigger trg_plates_order_reseller_guard
  before update of reseller_id on public.plates
  for each row execute function public.guard_plate_order_reseller();

-- 4d. Venda com placas vinculadas: cancelamento só pela RPC (que devolve o
--     estoque) e revendedor da venda imutável.
create or replace function public.guard_order_with_plates()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'cancelled' and old.status <> 'cancelled' and exists (
    select 1 from public.order_plates op where op.order_id = new.id and op.released_at is null
  ) then
    raise exception 'Use a operação de cancelamento da venda: ela trata as placas vinculadas'
      using errcode = '55000';
  end if;
  if new.reseller_id is distinct from old.reseller_id and exists (
    select 1 from public.order_plates op where op.order_id = new.id and op.released_at is null
  ) then
    raise exception 'O revendedor de uma venda com placas vinculadas não pode ser alterado'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_orders_plates_guard on public.orders;
create trigger trg_orders_plates_guard
  before update of status, reseller_id on public.orders
  for each row execute function public.guard_order_with_plates();

-- ---------------------------------------------------------------------
-- 5. RLS de order_plates
--    ADMIN lê tudo. RESELLER lê só vínculos ativos de placas dele.
--    Ninguém escreve direto: toda escrita passa pelas RPCs abaixo.
-- ---------------------------------------------------------------------
alter table public.order_plates enable row level security;

drop policy if exists order_plates_select on public.order_plates;
create policy order_plates_select on public.order_plates
  for select to authenticated
  using (
    public.is_admin()
    or (
      order_plates.released_at is null
      and exists (
        select 1 from public.plates p
        where p.id = order_plates.plate_id
          and p.reseller_id = public.current_reseller_id()
      )
    )
  );

revoke insert, update, delete on public.order_plates from anon, authenticated;

-- ---------------------------------------------------------------------
-- 6. Registrar venda + reservar placas (atômico e idempotente)
--
--   p_selection = 'automatic' → as N placas disponíveis mais antigas
--                               (opcionalmente de um lote)
--   p_selection = 'manual'    → exatamente as placas informadas
--
--   Numa única transação: cria a venda (create_order), vincula as placas à
--   venda e ao revendedor, muda o status para RESERVADA (assigned) e grava o
--   histórico. Qualquer falha desfaz tudo.
--
--   Disponível = status in_stock, sem revendedor e sem vínculo ativo com venda.
-- ---------------------------------------------------------------------
create or replace function public.create_sale_with_plates(
  p_reseller_id      uuid,
  p_quantity         integer,
  p_unit_price       numeric,
  p_discount         numeric default 0,
  p_notes            text default null,
  p_status           text default 'pending',
  p_selection        text default 'automatic',
  p_plate_ids        uuid[] default null,
  p_batch_id         uuid default null,
  p_idempotency_key  uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
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

  -- Request repetida (clique duplo / retry): serializa pela chave e devolve a
  -- venda já criada, sem reservar placas de novo.
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

  if p_selection = 'manual' then
    select array_agg(distinct x) into v_ids from unnest(coalesce(p_plate_ids, '{}'::uuid[])) as x where x is not null;
    v_found := coalesce(cardinality(v_ids), 0);
    if v_found <> p_quantity then
      raise exception 'Selecione exatamente % placa(s) para esta venda (selecionadas: %)', p_quantity, v_found
        using errcode = '22023';
    end if;

    -- Trava as placas escolhidas em ordem estável (sem deadlock entre vendas).
    -- Quem chegar depois espera aqui e, ao seguir, enxerga a reserva já gravada.
    perform 1 from public.plates p where p.id = any(v_ids) order by p.id for update;

    select string_agg(coalesce(p.public_code, 'inexistente'), ', ' order by p.public_code) into v_codes
    from unnest(v_ids) as x
    left join public.plates p on p.id = x
    where p.id is null
       or p.status <> 'in_stock'
       or p.reseller_id is not null
       or exists (select 1 from public.order_plates op where op.plate_id = p.id and op.released_at is null);
    if v_codes is not null then
      raise exception 'Estas placas não estão mais disponíveis: %. Atualize a lista e selecione outras.', v_codes
        using errcode = '55000';
    end if;
  else
    -- SKIP LOCKED: placas que outra venda está reservando agora são puladas,
    -- então duas vendas simultâneas nunca disputam a mesma placa.
    select array_agg(s.id) into v_ids
    from (
      select p.id
      from public.plates p
      where p.status = 'in_stock'
        and p.reseller_id is null
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

  -- Dados comerciais: reutiliza create_order (valida preço e desconto e
  -- calcula subtotal/total no banco).
  v_order := public.create_order(p_reseller_id, p_quantity, p_unit_price, p_discount, p_notes, p_status);
  update public.orders o set idempotency_key = p_idempotency_key where o.id = v_order;

  -- DISPONÍVEL → RESERVADA. O trigger track_plate_assignment abre a
  -- atribuição em plate_assignments.
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

  -- O índice order_plates_one_active_idx é a última barreira: se, por
  -- qualquer caminho, a placa já tivesse vínculo ativo, este INSERT falha
  -- (23505) e a transação inteira é desfeita.
  insert into public.order_plates (order_id, plate_id, reserved_by)
  select v_order, x, auth.uid() from unnest(v_ids) as x;

  return v_order;
end;
$$;

-- ---------------------------------------------------------------------
-- 7. Cancelar venda
--
--   Placas só RESERVADAS (assigned) → voltam para DISPONÍVEL: saem do
--   revendedor, perdem cliente/destino, o vínculo com a venda é encerrado
--   (returned_to_stock) e a atribuição é fechada com ended_reason =
--   'order_cancelled'.
--
--   Placas ATIVAS ou em uso (active, inactive, blocked) → o cancelamento é
--   BLOQUEADO, a menos que o ADMIN escolha explicitamente
--   p_keep_plates_in_use = true: nesse caso elas continuam com o mesmo
--   revendedor, intactas, e só o vínculo com a venda é encerrado
--   (kept_with_reseller). Uma placa em uso nunca volta ao estoque por aqui.
-- ---------------------------------------------------------------------
create or replace function public.cancel_order(p_order_id uuid, p_keep_plates_in_use boolean default false)
returns setof public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order     public.orders%rowtype;
  v_in_use    integer;
  v_list      text;
  v_return    uuid[];
begin
  if not public.is_admin() then
    raise exception 'Somente ADMIN pode cancelar vendas' using errcode = '42501';
  end if;

  select * into v_order from public.orders o where o.id = p_order_id for update;
  if not found then
    raise exception 'Venda não encontrada' using errcode = 'P0002';
  end if;
  if v_order.status = 'cancelled' then
    raise exception 'Esta venda já está cancelada' using errcode = '55000';
  end if;

  -- Trava as placas da venda: a ativação pelo revendedor (que também trava a
  -- placa) espera, e o status lido abaixo é o definitivo.
  perform 1
  from public.plates p
  join public.order_plates op on op.plate_id = p.id
  where op.order_id = p_order_id and op.released_at is null
  order by p.id
  for update of p;

  select count(*),
         string_agg(s.public_code || ' (' || s.label || ')', ', ' order by s.public_code) filter (where s.rn <= 10)
  into v_in_use, v_list
  from (
    select p.public_code,
           case p.status when 'active' then 'Ativa' when 'inactive' then 'Inativa'
                         when 'blocked' then 'Bloqueada' else p.status end as label,
           row_number() over (order by p.public_code) as rn
    from public.order_plates op
    join public.plates p on p.id = op.plate_id
    where op.order_id = p_order_id and op.released_at is null and p.status <> 'assigned'
  ) s;

  if v_in_use > 0 and not coalesce(p_keep_plates_in_use, false) then
    if v_in_use > 10 then
      v_list := v_list || format(' e mais %s', v_in_use - 10);
    end if;
    raise exception 'Esta venda tem % placa(s) ativa(s) ou em uso vinculada(s): %. O cancelamento automático foi bloqueado para que elas não voltem ao estoque. Para cancelar mesmo assim, use a ação administrativa "Cancelar e manter placas em uso com o revendedor".',
      v_in_use, v_list
      using errcode = '55000', detail = 'plates_in_use';
  end if;

  -- RESERVADA → DISPONÍVEL
  select array_agg(p.id) into v_return
  from public.order_plates op
  join public.plates p on p.id = op.plate_id
  where op.order_id = p_order_id and op.released_at is null and p.status = 'assigned';

  if v_return is not null then
    update public.order_plates op set
      released_at = now(),
      released_by = auth.uid(),
      release_reason = 'returned_to_stock'
    where op.order_id = p_order_id and op.plate_id = any(v_return) and op.released_at is null;

    update public.plate_assignments a set
      unassigned_at = now(),
      ended_reason = 'order_cancelled'
    where a.plate_id = any(v_return) and a.unassigned_at is null;

    update public.plates p set
      reseller_id = null,
      customer_id = null,
      destination_type = null,
      destination_url = null,
      status = 'in_stock'
    where p.id = any(v_return);
  end if;

  -- Ação administrativa explícita: placas em uso ficam com o revendedor.
  if v_in_use > 0 then
    update public.order_plates op set
      released_at = now(),
      released_by = auth.uid(),
      release_reason = 'kept_with_reseller'
    where op.order_id = p_order_id and op.released_at is null;
  end if;

  update public.orders o set status = 'cancelled', cancelled_at = now() where o.id = p_order_id;

  return query select * from public.orders o where o.id = p_order_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 8. set_order_status (substitui a versão da migration 009)
--    Mesmas transições. O cancelamento agora passa por cancel_order, então
--    qualquer caminho que cancele uma venda devolve as placas reservadas e
--    respeita o bloqueio de placas em uso.
-- ---------------------------------------------------------------------
create or replace function public.set_order_status(p_order_id uuid, p_status text)
returns setof public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
begin
  if not public.is_admin() then
    raise exception 'Somente ADMIN pode alterar vendas' using errcode = '42501';
  end if;

  if p_status = 'cancelled' then
    return query select * from public.cancel_order(p_order_id, false);
    return;
  end if;

  select * into v_order from public.orders o where o.id = p_order_id for update;
  if not found then
    raise exception 'Pedido não encontrado' using errcode = 'P0002';
  end if;

  if not (
    (v_order.status = 'draft' and p_status in ('pending', 'paid'))
    or (v_order.status = 'pending' and p_status = 'paid')
  ) then
    raise exception 'Não é possível mudar o pedido de % para %', v_order.status, p_status using errcode = '55000';
  end if;

  update public.orders o set
    status = p_status,
    paid_at = case when p_status = 'paid' then now() else o.paid_at end
  where o.id = p_order_id;

  return query select * from public.orders o where o.id = p_order_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 9. Leitura para o painel ADMIN
-- ---------------------------------------------------------------------

-- Placas realmente disponíveis para venda manual (mesma regra da reserva).
create or replace function public.admin_available_plates(
  p_search    text default null,
  p_batch_id  uuid default null,
  p_limit     integer default 100,
  p_offset    integer default 0
)
returns table (
  plate_id        uuid,
  public_code     text,
  status          text,
  batch_id        uuid,
  batch_name      text,
  template_name   text,
  template_version integer,
  total_count     bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.public_code, p.status, b.id, b.name, t.name, v.version_number,
         count(*) over () as total_count
  from public.plates p
  left join public.plate_batches b on b.id = p.batch_id
  left join public.plate_template_versions v on v.id = b.template_version_id
  left join public.plate_templates t on t.id = v.template_id
  where public.is_admin()
    and p.status = 'in_stock'
    and p.reseller_id is null
    and not exists (select 1 from public.order_plates op where op.plate_id = p.id and op.released_at is null)
    and (p_batch_id is null or p.batch_id = p_batch_id)
    and (
      coalesce(btrim(p_search), '') = ''
      or p.public_code like '%' || upper(regexp_replace(p_search, '[^A-Za-z0-9]', '', 'g')) || '%'
    )
  order by p.created_at, p.public_code
  limit greatest(1, least(coalesce(p_limit, 100), 500))
  offset greatest(0, coalesce(p_offset, 0));
$$;

-- Estoque disponível por lote (para o seletor da reserva automática).
create or replace function public.admin_available_stock()
returns table (batch_id uuid, batch_name text, template_name text, available bigint)
language sql
stable
security definer
set search_path = public
as $$
  select b.id, b.name, t.name, count(p.id)
  from public.plates p
  join public.plate_batches b on b.id = p.batch_id
  left join public.plate_template_versions v on v.id = b.template_version_id
  left join public.plate_templates t on t.id = v.template_id
  where public.is_admin()
    and p.status = 'in_stock'
    and p.reseller_id is null
    and not exists (select 1 from public.order_plates op where op.plate_id = p.id and op.released_at is null)
  group by b.id, b.name, t.name, b.created_at
  order by b.created_at desc;
$$;

-- Placas de uma venda com o status ATUAL de cada uma (detalhe da venda).
create or replace function public.admin_order_plates(p_order_id uuid)
returns table (
  plate_id        uuid,
  public_code     text,
  status          text,
  batch_id        uuid,
  batch_name      text,
  template_name   text,
  reseller_id     uuid,
  reserved_at     timestamptz,
  released_at     timestamptz,
  release_reason  text
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.public_code, p.status, b.id, b.name, t.name, p.reseller_id,
         op.reserved_at, op.released_at, op.release_reason
  from public.order_plates op
  join public.plates p on p.id = op.plate_id
  left join public.plate_batches b on b.id = p.batch_id
  left join public.plate_template_versions v on v.id = b.template_version_id
  left join public.plate_templates t on t.id = v.template_id
  where public.is_admin()
    and op.order_id = p_order_id
  order by (op.released_at is not null), p.public_code;
$$;

-- ---------------------------------------------------------------------
-- 10. Permissões de execução (as funções validam is_admin() por dentro)
-- ---------------------------------------------------------------------
revoke all on function public.create_sale_with_plates(uuid, integer, numeric, numeric, text, text, text, uuid[], uuid, uuid) from public, anon;
grant execute on function public.create_sale_with_plates(uuid, integer, numeric, numeric, text, text, text, uuid[], uuid, uuid) to authenticated;

revoke all on function public.cancel_order(uuid, boolean) from public, anon;
grant execute on function public.cancel_order(uuid, boolean) to authenticated;

revoke all on function public.set_order_status(uuid, text) from public, anon;
grant execute on function public.set_order_status(uuid, text) to authenticated;

revoke all on function public.admin_available_plates(text, uuid, integer, integer) from public, anon;
grant execute on function public.admin_available_plates(text, uuid, integer, integer) to authenticated;

revoke all on function public.admin_available_stock() from public, anon;
grant execute on function public.admin_available_stock() to authenticated;

revoke all on function public.admin_order_plates(uuid) from public, anon;
grant execute on function public.admin_order_plates(uuid) to authenticated;

-- Funções de trigger não são chamáveis diretamente.
revoke all on function public.guard_order_plate_insert() from public, anon, authenticated;
revoke all on function public.guard_order_plate_change() from public, anon, authenticated;
revoke all on function public.guard_plate_order_reseller() from public, anon, authenticated;
revoke all on function public.guard_order_with_plates() from public, anon, authenticated;
