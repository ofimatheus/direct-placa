-- =====================================================================
-- 017 · Venda B2C vincula as placas ao cliente (operação única)
--
-- Antes: a venda registrava o financeiro, mas plates.customer_id ficava
-- vazio e o revendedor precisava atribuir o MESMO cliente de novo na tela
-- da placa. Agora, numa única transação:
--
--   cria reseller_sales + reseller_sale_items
--   → vincula cada placa ao cliente da venda (plates.customer_id)
--   → mantém o revendedor, mantém a placa RESERVADA (assigned)
--   → NÃO define destino e NÃO ativa
--
-- Qualquer falha desfaz tudo (é uma única função plpgsql).
--
-- Cancelamento (trigger, vale para qualquer caminho de cancelamento):
--   desfaz o vínculo com o cliente SOMENTE quando a própria venda o criou e
--   a placa continua só reservada: status assigned, sem destino, com o
--   mesmo revendedor e ainda com o cliente da venda. Nesse caso o cliente
--   anterior (normalmente nenhum) é restaurado.
--   Placa ativa, inativa, bloqueada ou configurada: nada operacional muda —
--   só o registro financeiro é cancelado.
--
-- Vendas registradas antes desta migration não têm customer_linked, então
-- o cancelamento delas continua sem tocar em plates.customer_id.
--
-- Incremental; substitui via CREATE OR REPLACE (mesmas assinaturas):
-- create_reseller_sale, guard_reseller_sale_item_change e
-- sync_reseller_sale_items_cancel. Não altera migrations anteriores.
-- =====================================================================

alter table public.reseller_sale_items add column if not exists customer_linked boolean not null default false;
alter table public.reseller_sale_items
  add column if not exists previous_customer_id uuid references public.customers (id) on delete set null;
alter table public.reseller_sale_items add column if not exists customer_unlinked_at timestamptz;

comment on column public.reseller_sale_items.customer_linked is
  'true quando ESTA venda vinculou a placa ao cliente (plates.customer_id). É o que autoriza desfazer o vínculo no cancelamento.';
comment on column public.reseller_sale_items.previous_customer_id is
  'Cliente da placa antes da venda (restaurado se a venda for cancelada com a placa ainda só reservada).';
comment on column public.reseller_sale_items.customer_unlinked_at is
  'Quando o cancelamento desfez o vínculo com o cliente (null = não desfez).';

-- ---------------------------------------------------------------------
-- Histórico do item: além de venda e placa, a origem do vínculo com o
-- cliente é imutável; customer_unlinked_at só é gravado uma vez.
-- ---------------------------------------------------------------------
create or replace function public.guard_reseller_sale_item_change()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'O histórico de placas da venda não pode ser apagado' using errcode = '55000';
  end if;
  if new.sale_id is distinct from old.sale_id or new.plate_id is distinct from old.plate_id then
    raise exception 'Venda e placa do item são imutáveis' using errcode = '55000';
  end if;
  if new.customer_linked is distinct from old.customer_linked then
    raise exception 'A origem do vínculo com o cliente é imutável' using errcode = '55000';
  end if;
  -- previous_customer_id só pode virar null pela FK (cliente excluído).
  if new.previous_customer_id is distinct from old.previous_customer_id and new.previous_customer_id is not null then
    raise exception 'O cliente anterior da placa é imutável' using errcode = '55000';
  end if;
  if old.customer_unlinked_at is not null and new.customer_unlinked_at is distinct from old.customer_unlinked_at then
    raise exception 'O desfazimento do vínculo já foi registrado' using errcode = '55000';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- Registrar venda final + vincular placas ao cliente (atômico, idempotente)
-- ---------------------------------------------------------------------
create or replace function public.create_reseller_sale(
  p_plate_ids        uuid[],
  p_total            numeric,
  p_customer_id      uuid default null,
  p_status           text default 'pending',
  p_sold_at          date default null,
  p_notes            text default null,
  p_idempotency_key  uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reseller uuid := public.current_reseller_id();
  v_sale     uuid;
  v_ids      uuid[];
  v_count    integer;
  v_linked   integer;
  v_codes    text;
begin
  if v_reseller is null then
    raise exception 'Somente revendedores ativos podem registrar vendas' using errcode = '42501';
  end if;
  if p_idempotency_key is null then
    raise exception 'idempotency_key é obrigatória' using errcode = '22023';
  end if;

  -- Clique duplo / retry: serializa pela chave e devolve a venda já criada.
  perform pg_advisory_xact_lock(hashtextextended('create_reseller_sale:' || p_idempotency_key::text, 0));
  select s.id into v_sale from public.reseller_sales s
  where s.idempotency_key = p_idempotency_key and s.reseller_id = v_reseller;
  if found then
    return v_sale;
  end if;

  if p_status is null or p_status not in ('pending', 'paid') then
    raise exception 'Status inicial inválido' using errcode = '22023';
  end if;
  if p_total is null or p_total < 0 then
    raise exception 'Informe o valor total da venda' using errcode = '22023';
  end if;

  select array_agg(distinct x) into v_ids
  from unnest(coalesce(p_plate_ids, '{}'::uuid[])) as x where x is not null;
  v_count := coalesce(cardinality(v_ids), 0);
  if v_count = 0 then
    raise exception 'Selecione ao menos uma placa' using errcode = '22023';
  end if;
  if v_count > 500 then
    raise exception 'Selecione no máximo 500 placas por venda' using errcode = '22023';
  end if;

  -- Cliente do MESMO revendedor (o trigger guard_reseller_sale e o
  -- guard_plate_customer da placa verificam de novo).
  if p_customer_id is not null and not exists (
    select 1 from public.customers c where c.id = p_customer_id and c.reseller_id = v_reseller
  ) then
    raise exception 'O cliente informado não pertence a este revendedor' using errcode = '42501';
  end if;

  -- Trava as placas em ordem estável: vendas simultâneas não disputam a
  -- mesma placa, e a configuração da placa (que também trava) espera.
  perform 1 from public.plates p where p.id = any(v_ids) order by p.id for update;

  select string_agg(coalesce(p.public_code, 'inexistente'), ', ' order by p.public_code) into v_codes
  from unnest(v_ids) as x
  left join public.plates p on p.id = x
  where p.id is null
     or p.reseller_id is distinct from v_reseller
     or p.status <> 'assigned'
     or p.destination_url is not null
     or exists (
          select 1 from public.reseller_sale_items i
          where i.plate_id = p.id and i.cancelled_at is null
        );
  if v_codes is not null then
    raise exception 'Estas placas não estão disponíveis para venda: %. Atualize a lista e selecione outras.', v_codes
      using errcode = '55000', detail = 'plates_not_sellable';
  end if;

  insert into public.reseller_sales (reseller_id, customer_id, status, total, sold_at, notes, idempotency_key, paid_at)
  values (
    v_reseller, p_customer_id, p_status, round(p_total, 2),
    coalesce(p_sold_at, current_date),
    nullif(btrim(coalesce(p_notes, '')), ''),
    p_idempotency_key,
    case when p_status = 'paid' then now() end
  )
  returning id into v_sale;

  -- Itens: registram se ESTA venda vincula o cliente e qual era o anterior.
  -- O índice único parcial segue sendo a última barreira contra a mesma
  -- placa em duas vendas ativas (23505 desfaz tudo).
  insert into public.reseller_sale_items (sale_id, plate_id, customer_linked, previous_customer_id)
  select v_sale, p.id, p_customer_id is not null,
         case when p_customer_id is not null then p.customer_id end
  from public.plates p
  where p.id = any(v_ids);

  -- Vínculo operacional placa → cliente. A placa continua RESERVADA, sem
  -- destino: a ativação segue sendo um passo à parte (configure_reseller_plate).
  if p_customer_id is not null then
    update public.plates p set customer_id = p_customer_id
    where p.id = any(v_ids);
    get diagnostics v_linked = row_count;
    if v_linked <> v_count then
      raise exception 'Não foi possível vincular todas as placas ao cliente' using errcode = '55000';
    end if;
  end if;

  return v_sale;
end;
$$;

-- ---------------------------------------------------------------------
-- Cancelamento: libera a placa para nova venda do mesmo revendedor e,
-- quando é seguro, desfaz o vínculo com o cliente criado pela venda.
-- ---------------------------------------------------------------------
create or replace function public.sync_reseller_sale_items_cancel()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_undone uuid[];
begin
  if new.status = 'cancelled' and old.status <> 'cancelled' then
    -- UPDATE com as condições no WHERE: se a placa for configurada/ativada
    -- em paralelo, o Postgres reavalia a linha após o lock e ela fica de fora.
    with undo as (
      update public.plates p set customer_id = i.previous_customer_id
      from public.reseller_sale_items i
      where i.sale_id = new.id
        and i.cancelled_at is null
        and i.customer_linked
        and p.id = i.plate_id
        and p.reseller_id = new.reseller_id
        and p.status = 'assigned'
        and p.destination_url is null
        and p.destination_type is null
        and p.customer_id is not distinct from new.customer_id
      returning p.id
    )
    select array_agg(id) into v_undone from undo;

    update public.reseller_sale_items i set
      cancelled_at = now(),
      customer_unlinked_at = case when i.plate_id = any(coalesce(v_undone, '{}'::uuid[])) then now() end
    where i.sale_id = new.id and i.cancelled_at is null;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- Placas da venda com o necessário para a sequência "configurar placas":
-- cliente e se já há destino (sem o endereço em si).
-- ---------------------------------------------------------------------
create or replace function public.reseller_sale_plate_setup(p_sale_id uuid)
returns table (
  plate_id        uuid,
  public_code     text,
  status          text,
  customer_id     uuid,
  customer_name   text,
  configured      boolean,
  cancelled_at    timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.public_code, p.status, p.customer_id, c.name,
         p.destination_url is not null, i.cancelled_at
  from public.reseller_sale_items i
  join public.reseller_sales s on s.id = i.sale_id
  join public.plates p on p.id = i.plate_id
  left join public.customers c on c.id = p.customer_id
  where i.sale_id = p_sale_id
    and s.reseller_id = public.current_reseller_id()
    and public.current_reseller_id() is not null
    -- a placa pode ter voltado ao ADMIN depois: aí não é mais do revendedor
    and p.reseller_id = s.reseller_id
  order by p.public_code;
$$;

revoke all on function public.reseller_sale_plate_setup(uuid) from public, anon;
grant execute on function public.reseller_sale_plate_setup(uuid) to authenticated;

revoke all on function public.create_reseller_sale(uuid[], numeric, uuid, text, date, text, uuid) from public, anon;
grant execute on function public.create_reseller_sale(uuid[], numeric, uuid, text, date, text, uuid) to authenticated;
revoke all on function public.sync_reseller_sale_items_cancel() from public, anon, authenticated;
revoke all on function public.guard_reseller_sale_item_change() from public, anon, authenticated;
