-- =====================================================================
-- 013 · Ciclo operacional do lote: ATIVO / QUARENTENA / ARQUIVADO
--
-- Lote não se apaga: os QRs e códigos podem já estar impressos em placas
-- físicas. O que existe é um ciclo OPERACIONAL, separado de qualquer
-- status técnico de geração ou exportação (batch_exports.status continua
-- sendo outra coisa e não é tocado aqui).
--
--   active      lote normal: participa de estoque, vendas e atribuições
--   quarantine  lote retirado de circulação; nada pode ser reservado dele
--   archived    organização histórica: lote sem estoque disponível
--
-- Nada é apagado em nenhuma transição: QR, public_code, placas, destinos,
-- revendedor, cliente, redirects e histórico permanecem exatamente como
-- estavam. Quarentena e arquivamento mudam UM campo do lote.
--
-- Incremental e não destrutiva. Não altera migrations anteriores. As
-- funções de estoque e venda são substituídas por CREATE OR REPLACE com a
-- MESMA assinatura e as mesmas permissões — só ganham o filtro de ciclo.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Campo de ciclo no lote
-- ---------------------------------------------------------------------
alter table public.plate_batches add column if not exists lifecycle_status text not null default 'active';
alter table public.plate_batches add column if not exists lifecycle_reason text;
alter table public.plate_batches add column if not exists lifecycle_changed_at timestamptz;
alter table public.plate_batches add column if not exists lifecycle_changed_by uuid references public.profiles (id) on delete set null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'plate_batches_lifecycle_status_check') then
    alter table public.plate_batches add constraint plate_batches_lifecycle_status_check
      check (lifecycle_status in ('active', 'quarantine', 'archived'));
  end if;
end;
$$;

comment on column public.plate_batches.lifecycle_status is
  'Ciclo OPERACIONAL do lote (active/quarantine/archived). Não confundir com o status técnico de exportação em batch_exports.';

-- Todo lote novo nasce ativo (default). Lotes que já existiam idem.
update public.plate_batches set lifecycle_status = 'active' where lifecycle_status is null;

create index if not exists plate_batches_lifecycle_idx
  on public.plate_batches (lifecycle_status, created_at desc);

-- Estoque disponível só existe em lote ativo: este índice parcial sustenta
-- as consultas de disponibilidade sem varrer lotes fora de circulação.
create index if not exists plate_batches_active_idx
  on public.plate_batches (id) where lifecycle_status = 'active';

-- ---------------------------------------------------------------------
-- 2. Histórico do ciclo (append-only)
-- ---------------------------------------------------------------------
create table if not exists public.batch_lifecycle_events (
  id               bigint generated always as identity primary key,
  batch_id         uuid not null references public.plate_batches (id) on delete restrict,
  previous_status  text not null,
  new_status       text not null,
  reason           text,
  changed_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  constraint batch_lifecycle_events_previous_check check (previous_status in ('active', 'quarantine', 'archived')),
  constraint batch_lifecycle_events_new_check check (new_status in ('active', 'quarantine', 'archived')),
  constraint batch_lifecycle_events_change_check check (previous_status <> new_status)
);

create index if not exists batch_lifecycle_events_batch_idx
  on public.batch_lifecycle_events (batch_id, created_at desc);

comment on table public.batch_lifecycle_events is
  'Histórico append-only das transições de ciclo do lote. Quem mudou, de quê para quê, por quê e quando.';

-- Append-only, como o resto do histórico do projeto.
create or replace function public.guard_batch_lifecycle_event()
returns trigger
language plpgsql
as $$
begin
  raise exception 'O histórico de ciclo do lote não pode ser alterado nem apagado' using errcode = '55000';
end;
$$;

drop trigger if exists trg_batch_lifecycle_events_immutable on public.batch_lifecycle_events;
create trigger trg_batch_lifecycle_events_immutable
  before update or delete on public.batch_lifecycle_events
  for each row execute function public.guard_batch_lifecycle_event();

-- ---------------------------------------------------------------------
-- 3. O que significa "placa totalmente livre"
--
-- Para o lote INTEIRO entrar em quarentena, nenhuma placa pode ter
-- qualquer compromisso operacional. Histórico antigo de venda cancelada
-- não conta: o que importa é o estado ATUAL.
-- ---------------------------------------------------------------------
create or replace function public.plate_is_operationally_free(p_plate public.plates)
returns boolean
language sql
stable
as $$
  select p_plate.status = 'in_stock'
     and p_plate.reseller_id is null
     and p_plate.customer_id is null
     and p_plate.destination_type is null
     and p_plate.destination_url is null
     and not exists (
       select 1 from public.order_plates op
       where op.plate_id = p_plate.id and op.released_at is null
     )
     and not exists (
       select 1 from public.plate_assignments a
       where a.plate_id = p_plate.id and a.unassigned_at is null
     );
$$;

comment on function public.plate_is_operationally_free(public.plates) is
  'Placa sem nenhum compromisso ATUAL: em estoque, sem revendedor, cliente, destino, reserva de venda ou atribuição aberta.';

-- Resumo por lote: alimenta a tela e as validações com o mesmo critério.
create or replace function public.admin_batch_lifecycle_summary(p_batch_id uuid default null)
returns table (
  batch_id        uuid,
  total_plates    bigint,
  free_plates     bigint,
  available_stock bigint,
  committed       bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select b.id,
         count(p.id),
         count(p.id) filter (where public.plate_is_operationally_free(p)),
         count(p.id) filter (
           where p.status = 'in_stock'
             and p.reseller_id is null
             and not exists (select 1 from public.order_plates op where op.plate_id = p.id and op.released_at is null)
         ),
         count(p.id) filter (where not public.plate_is_operationally_free(p))
  from public.plate_batches b
  left join public.plates p on p.batch_id = b.id
  where public.is_admin()
    and (p_batch_id is null or b.id = p_batch_id)
  group by b.id;
$$;

-- ---------------------------------------------------------------------
-- 4. Transições de ciclo
--
-- CONCORRÊNCIA (venda × quarentena) — o ponto delicado:
--
--   A função trava a linha do lote e TODAS as placas dele com FOR UPDATE,
--   em ordem de id — a mesma ordem usada pela seleção manual da venda.
--   Ordem igual em ambos os lados significa que não há deadlock.
--
--   · Se a venda chegar primeiro, ela segura as placas; a quarentena
--     espera, e ao seguir enxerga as placas já reservadas → recusa.
--   · Se a quarentena chegar primeiro, ela segura tudo; a venda manual
--     espera e, ao seguir, é barrada pelo trigger de ciclo. A venda
--     automática usa SKIP LOCKED: simplesmente não enxerga essas placas.
--
--   Nunca existe o estado intermediário "lote em quarentena com placa
--   recém-reservada".
-- ---------------------------------------------------------------------
create or replace function public.set_batch_lifecycle_status(
  p_batch_id  uuid,
  p_status    text,
  p_reason    text default null
)
returns setof public.plate_batches
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch      public.plate_batches%rowtype;
  v_reason     text := nullif(btrim(coalesce(p_reason, '')), '');
  v_committed  bigint;
  v_available  bigint;
  v_examples   text;
begin
  if not public.is_admin() then
    raise exception 'Somente ADMIN pode alterar o ciclo do lote' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('active', 'quarantine', 'archived') then
    raise exception 'Estado inválido para o lote' using errcode = '22023';
  end if;

  select * into v_batch from public.plate_batches b where b.id = p_batch_id for update;
  if not found then
    raise exception 'Lote não encontrado' using errcode = 'P0002';
  end if;

  if v_batch.lifecycle_status = p_status then
    return query select * from public.plate_batches b where b.id = p_batch_id;
    return;
  end if;

  -- Trava todas as placas do lote na mesma ordem usada pela venda manual.
  perform 1 from public.plates p where p.batch_id = p_batch_id order by p.id for update;

  if p_status = 'quarantine' then
    if v_batch.lifecycle_status <> 'active' then
      raise exception 'Só um lote ativo pode ir para quarentena' using errcode = '55000';
    end if;
    if v_reason is null then
      raise exception 'Informe o motivo da quarentena' using errcode = '22023';
    end if;

    select count(*),
           string_agg(s.public_code, ', ' order by s.public_code) filter (where s.rn <= 10)
    into v_committed, v_examples
    from (
      select p.public_code, row_number() over (order by p.public_code) as rn
      from public.plates p
      where p.batch_id = p_batch_id and not public.plate_is_operationally_free(p)
    ) s;

    if v_committed > 0 then
      if v_committed > 10 then
        v_examples := v_examples || format(' e mais %s', v_committed - 10);
      end if;
      raise exception 'Este lote tem % placa(s) em uso ou reservada(s) e não pode ir para quarentena: %. A quarentena exige o lote inteiro livre.',
        v_committed, v_examples
        using errcode = '55000', detail = 'batch_has_committed_plates';
    end if;

  elsif p_status = 'archived' then
    if v_batch.lifecycle_status not in ('active', 'quarantine') then
      raise exception 'Transição de ciclo inválida' using errcode = '55000';
    end if;

    select count(*) into v_available
    from public.plates p
    where p.batch_id = p_batch_id
      and p.status = 'in_stock'
      and p.reseller_id is null
      and not exists (select 1 from public.order_plates op where op.plate_id = p.id and op.released_at is null);

    if v_available > 0 then
      raise exception 'Este lote ainda tem % placa(s) disponível(is) em estoque. O arquivamento é apenas organização histórica e exige estoque zerado.',
        v_available
        using errcode = '55000', detail = 'batch_has_available_stock';
    end if;
  end if;

  -- active: restauração (quarantine → active) ou desarquivamento
  -- (archived → active). Nada a validar: as placas nunca foram alteradas,
  -- então voltam a ficar utilizáveis exatamente como estavam.

  update public.plate_batches b set
    lifecycle_status = p_status,
    lifecycle_reason = v_reason,
    lifecycle_changed_at = now(),
    lifecycle_changed_by = auth.uid()
  where b.id = p_batch_id;

  insert into public.batch_lifecycle_events (batch_id, previous_status, new_status, reason, changed_by)
  values (p_batch_id, v_batch.lifecycle_status, p_status, v_reason, auth.uid());

  return query select * from public.plate_batches b where b.id = p_batch_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 5. Barreira de banco: placa de lote fora de circulação não é reservada
--
-- Vale para QUALQUER caminho — RPC de venda, atribuição avulsa, troca de
-- revendedor ou UPDATE manual. A interface é conveniência; isto é a regra.
-- ---------------------------------------------------------------------
create or replace function public.guard_plate_batch_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lifecycle text;
  v_batch     text;
begin
  -- O que a barreira impede é UMA COISA SÓ: tirar placa do estoque de um
  -- lote fora de circulação para entregá-la a um revendedor.
  --
  -- Tudo o mais continua livre, e isso é deliberado:
  --   · placa que JÁ está com revendedor segue configurável, ativável,
  --     desativável e com cliente — arquivar um lote é organização
  --     histórica e não pode quebrar o painel do revendedor;
  --   · devolução ao estoque (cancelamento de venda) continua funcionando,
  --     senão um lote arquivado prenderia a venda para sempre;
  --   · bloqueio administrativo da placa continua disponível.
  if not (old.reseller_id is null and new.reseller_id is not null) then
    return new;
  end if;
  if new.batch_id is null then
    return new;
  end if;

  select b.lifecycle_status, b.name into v_lifecycle, v_batch
  from public.plate_batches b where b.id = new.batch_id;

  if v_lifecycle is distinct from 'active' then
    raise exception 'A placa % pertence ao lote "%", que está em % e não participa de novas operações.',
      new.public_code, v_batch,
      case v_lifecycle when 'quarantine' then 'quarentena' else 'arquivo' end
      using errcode = '55000', detail = 'batch_not_active';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_plates_batch_lifecycle_guard on public.plates;
create trigger trg_plates_batch_lifecycle_guard
  before update on public.plates
  for each row execute function public.guard_plate_batch_lifecycle();

-- ---------------------------------------------------------------------
-- 6. Estoque e venda passam a enxergar só lote ativo
--    Mesmas assinaturas, mesmas permissões: só o filtro entra.
-- ---------------------------------------------------------------------
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
  join public.plate_batches b on b.id = p.batch_id and b.lifecycle_status = 'active'
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

create or replace function public.admin_available_stock()
returns table (batch_id uuid, batch_name text, template_name text, available bigint)
language sql
stable
security definer
set search_path = public
as $$
  select b.id, b.name, t.name, count(p.id)
  from public.plates p
  join public.plate_batches b on b.id = p.batch_id and b.lifecycle_status = 'active'
  left join public.plate_template_versions v on v.id = b.template_version_id
  left join public.plate_templates t on t.id = v.template_id
  where public.is_admin()
    and p.status = 'in_stock'
    and p.reseller_id is null
    and not exists (select 1 from public.order_plates op where op.plate_id = p.id and op.released_at is null)
  group by b.id, b.name, t.name, b.created_at
  order by b.created_at desc;
$$;

-- ---------------------------------------------------------------------
-- 7. Venda e atribuição avulsa ignoram lote fora de circulação
--
-- O trigger da seção 5 já barraria, mas com mensagem de erro sobre a placa.
-- Aqui o filtro entra na origem: a placa de lote em quarentena/arquivo
-- simplesmente não aparece como disponível, e a mensagem que o ADMIN vê é
-- a de estoque insuficiente, que é o que de fato aconteceu.
--
-- CREATE OR REPLACE com a MESMA assinatura da migration 012, que não é
-- alterada. Todo o resto da lógica (idempotência, travas, devolução de
-- estoque, guardas) é preservado.
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
$$;

-- Atribuição avulsa: mesmo filtro.
create or replace function public.assign_plates_to_reseller(
  p_reseller_id  uuid,
  p_quantity     integer default null,
  p_plate_ids    uuid[] default null,
  p_batch_id     uuid default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
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
    where p.id = any(v_ids) and p.reseller_id is null and p.status = 'in_stock';
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
$$;

grant select on public.batch_lifecycle_events to authenticated;
alter table public.batch_lifecycle_events enable row level security;

drop policy if exists batch_lifecycle_events_select on public.batch_lifecycle_events;
create policy batch_lifecycle_events_select on public.batch_lifecycle_events
  for select to authenticated using (public.is_admin());

revoke insert, update, delete on public.batch_lifecycle_events from anon, authenticated;

revoke all on function public.set_batch_lifecycle_status(uuid, text, text) from public, anon;
grant execute on function public.set_batch_lifecycle_status(uuid, text, text) to authenticated;

revoke all on function public.admin_batch_lifecycle_summary(uuid) from public, anon;
grant execute on function public.admin_batch_lifecycle_summary(uuid) to authenticated;

revoke all on function public.plate_is_operationally_free(public.plates) from public, anon;
grant execute on function public.plate_is_operationally_free(public.plates) to authenticated;

revoke all on function public.guard_plate_batch_lifecycle() from public, anon, authenticated;
revoke all on function public.guard_batch_lifecycle_event() from public, anon, authenticated;
