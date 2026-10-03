-- =====================================================================
-- 022 · Venda do revendedor: valor unitário + desconto + total calculado
--
-- O revendedor informa o VALOR UNITÁRIO e o DESCONTO (em R$). O banco deriva:
--   quantidade = placas distintas realmente vendidas
--   subtotal   = quantidade × unitário
--   total      = subtotal − desconto        (desconto ≤ subtotal)
-- O total NUNCA vem do cliente. Tudo em CENTAVOS inteiros (bigint): nada de
-- ponto flutuante.
--
-- create_reseller_sale_priced() calcula e delega o registro à
-- create_reseller_sale() existente (mesma validação de placas, cliente,
-- idempotência e vínculo). O detalhamento fica em reseller_sale_pricing.
--
-- Privacidade: exatamente como reseller_sales — só o próprio revendedor lê;
-- NÃO existe policy para o ADMIN; a service_role não tem privilégio.
-- Vendas antigas (sem detalhamento) continuam válidas: simplesmente não têm
-- linha em reseller_sale_pricing. Métricas continuam usando
-- reseller_sales.total (valor final, depois do desconto) e só vendas pagas.
--
-- Incremental e idempotente; não altera migrations anteriores.
-- =====================================================================

create table if not exists public.reseller_sale_pricing (
  sale_id           uuid primary key references public.reseller_sales (id) on delete restrict,
  quantity          integer not null,
  unit_price_cents  bigint  not null,
  subtotal_cents    bigint  not null,
  discount_cents    bigint  not null default 0,
  total_cents       bigint  not null,
  created_at        timestamptz not null default now(),
  constraint reseller_sale_pricing_quantity_check check (quantity between 1 and 500),
  constraint reseller_sale_pricing_unit_check check (unit_price_cents between 0 and 99999999),
  constraint reseller_sale_pricing_discount_check check (discount_cents >= 0 and discount_cents <= subtotal_cents),
  constraint reseller_sale_pricing_subtotal_check check (subtotal_cents = quantity::bigint * unit_price_cents),
  constraint reseller_sale_pricing_total_check check (total_cents = subtotal_cents - discount_cents and total_cents <= 9999999999)
);

comment on table public.reseller_sale_pricing is
  'Detalhamento da venda do revendedor em centavos (quantidade, unitário, subtotal, desconto, total). Financeiro PRIVADO: sem acesso do ADMIN.';

alter table public.reseller_sale_pricing enable row level security;

drop policy if exists reseller_sale_pricing_select on public.reseller_sale_pricing;
create policy reseller_sale_pricing_select on public.reseller_sale_pricing
  for select to authenticated
  using (exists (
    select 1 from public.reseller_sales s
    where s.id = sale_id and s.reseller_id = public.current_reseller_id()
  ));

grant select on public.reseller_sale_pricing to authenticated;
revoke insert, update, delete on public.reseller_sale_pricing from anon, authenticated;
revoke all on public.reseller_sale_pricing from anon;
revoke all on public.reseller_sale_pricing from service_role;

-- Uma linha de preço é imutável depois de criada (o histórico não muda).
create or replace function public.guard_reseller_sale_pricing()
returns trigger
language plpgsql
as $$
begin
  raise exception 'O detalhamento de preço da venda não pode ser alterado nem apagado' using errcode = '55000';
end;
$$;

drop trigger if exists trg_reseller_sale_pricing_guard on public.reseller_sale_pricing;
create trigger trg_reseller_sale_pricing_guard
  before update or delete on public.reseller_sale_pricing
  for each row execute function public.guard_reseller_sale_pricing();

/**
 * Registra a venda a partir de UNITÁRIO e DESCONTO (centavos). O total é
 * calculado aqui; o cliente não o informa. Idempotente pela mesma chave.
 */
create or replace function public.create_reseller_sale_priced(
  p_plate_ids          uuid[],
  p_unit_price_cents   bigint,
  p_discount_cents     bigint,
  p_customer_id        uuid default null,
  p_status             text default 'pending',
  p_sold_at            date default null,
  p_notes              text default null,
  p_idempotency_key    uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reseller  uuid := public.current_reseller_id();
  v_ids       uuid[];
  v_qty       integer;
  v_subtotal  bigint;
  v_discount  bigint := coalesce(p_discount_cents, 0);
  v_total     bigint;
  v_sale      uuid;
  v_items     integer;
begin
  if v_reseller is null then
    raise exception 'Somente revendedores ativos podem registrar vendas' using errcode = '42501';
  end if;
  if p_unit_price_cents is null or p_unit_price_cents < 0 or p_unit_price_cents > 99999999 then
    raise exception 'Informe um valor unitário válido' using errcode = '22023';
  end if;
  if v_discount < 0 then
    raise exception 'O desconto não pode ser negativo' using errcode = '22023';
  end if;

  select array_agg(distinct x) into v_ids
  from unnest(coalesce(p_plate_ids, '{}'::uuid[])) as x where x is not null;
  v_qty := coalesce(cardinality(v_ids), 0);
  if v_qty = 0 then
    raise exception 'Selecione ao menos uma placa' using errcode = '22023';
  end if;
  if v_qty > 500 then
    raise exception 'Selecione no máximo 500 placas por venda' using errcode = '22023';
  end if;

  v_subtotal := v_qty::bigint * p_unit_price_cents;
  if v_discount > v_subtotal then
    raise exception 'O desconto não pode ser maior que o subtotal' using errcode = '22023';
  end if;
  v_total := v_subtotal - v_discount;
  if v_total > 9999999999 then
    raise exception 'O valor total ultrapassa o limite permitido' using errcode = '22023';
  end if;

  -- Toda a regra de placas/cliente/idempotência é a da função existente.
  v_sale := public.create_reseller_sale(v_ids, round(v_total::numeric / 100, 2), p_customer_id, p_status, p_sold_at, p_notes, p_idempotency_key);

  -- Repetição idempotente de uma venda já detalhada: devolve a mesma venda.
  if exists (select 1 from public.reseller_sale_pricing p where p.sale_id = v_sale) then
    return v_sale;
  end if;

  select count(*) into v_items from public.reseller_sale_items i where i.sale_id = v_sale;
  if v_items <> v_qty then
    raise exception 'A quantidade vendida (%) difere das placas selecionadas (%)', v_items, v_qty using errcode = '22023';
  end if;

  insert into public.reseller_sale_pricing (sale_id, quantity, unit_price_cents, subtotal_cents, discount_cents, total_cents)
  values (v_sale, v_qty, p_unit_price_cents, v_subtotal, v_discount, v_total);

  return v_sale;
end;
$$;

revoke all on function public.create_reseller_sale_priced(uuid[], bigint, bigint, uuid, text, date, text, uuid) from public, anon;
grant execute on function public.create_reseller_sale_priced(uuid[], bigint, bigint, uuid, text, date, text, uuid) to authenticated;
revoke all on function public.guard_reseller_sale_pricing() from public, anon, authenticated;
