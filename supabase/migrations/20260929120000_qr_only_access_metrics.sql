-- =====================================================================
-- 015 · Métricas oficiais de acesso: somente QR Code
--
-- Decisão de produto: o NFC continua funcionando (a URL NFC, o redirect
-- /go/[code]?src=nfc e o registro em redirects.source = 'nfc' ficam
-- exatamente como estão), mas NÃO faz mais parte das métricas oficiais.
--
-- O que muda aqui (no banco, não só na tela):
--   · plates.qr_access_count / last_qr_access_at: contador oficial, só QR.
--   · count_plate_access: continua mantendo access_count (histórico,
--     compatibilidade) e passa a manter o contador de QR na MESMA escrita.
--   · reseller_dashboard_metrics, admin_reseller_stats e
--     admin_dashboard_metrics: "accesses" passa a ser só QR.
--   · Novas agregações por placa, calculadas no banco, só com QR.
--
-- Não apaga nem altera registros de redirects: o histórico NFC permanece.
-- Incremental e idempotente; não altera migrations anteriores.
-- =====================================================================

alter table public.plates add column if not exists qr_access_count bigint not null default 0;
alter table public.plates add column if not exists last_qr_access_at timestamptz;

comment on column public.plates.qr_access_count is
  'Acessos por QR Code (métrica oficial). access_count segue existindo como total histórico de todas as origens.';

-- Consultas por período, só de QR.
create index if not exists redirects_qr_created_idx
  on public.redirects (created_at, plate_id)
  where source = 'qr';

-- ---------------------------------------------------------------------
-- updated_at de plates: contadores de acesso (inclusive os novos) não
-- contam como alteração da placa. Precisa vir ANTES do backfill.
-- ---------------------------------------------------------------------
create or replace function public.plates_set_updated_at()
returns trigger
language plpgsql
as $$
declare
  v_ignored constant text[] := array['updated_at', 'access_count', 'last_access_at', 'qr_access_count', 'last_qr_access_at'];
begin
  if (to_jsonb(new) - v_ignored) is distinct from (to_jsonb(old) - v_ignored) then
    new.updated_at = now();
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- Contadores: uma única escrita por acesso. O NFC continua incrementando
-- o total histórico (access_count) e não toca no contador oficial.
-- ---------------------------------------------------------------------
create or replace function public.count_plate_access()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.plates p set
    access_count = p.access_count + 1,
    last_access_at = new.created_at,
    qr_access_count = p.qr_access_count + case when new.source = 'qr' then 1 else 0 end,
    last_qr_access_at = case when new.source = 'qr' then new.created_at else p.last_qr_access_at end
  where p.id = new.plate_id;
  return null;
end;
$$;

-- Backfill a partir do log (fonte da verdade). Recalcular é idempotente.
update public.plates p set
  qr_access_count = s.total,
  last_qr_access_at = s.last_at
from (
  select r.plate_id, count(*) as total, max(r.created_at) as last_at
  from public.redirects r
  where r.source = 'qr'
  group by r.plate_id
) s
where s.plate_id = p.id
  and (p.qr_access_count is distinct from s.total or p.last_qr_access_at is distinct from s.last_at);

-- ---------------------------------------------------------------------
-- Painel do revendedor: "accesses" = QR (mesma assinatura e chaves)
-- ---------------------------------------------------------------------
create or replace function public.reseller_dashboard_metrics()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_reseller uuid := public.current_reseller_id();
  v_result   jsonb;
begin
  if v_reseller is null then
    raise exception 'Somente revendedores ativos' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'plates', count(*),
    'available', count(*) filter (where p.destination_url is null),
    'configured', count(*) filter (where p.destination_url is not null),
    'active', count(*) filter (where p.status = 'active'),
    'inactive', count(*) filter (where p.status = 'inactive'),
    'accesses', coalesce(sum(p.qr_access_count), 0)
  ) into v_result
  from public.plates p
  where p.reseller_id = v_reseller;

  return v_result || jsonb_build_object(
    'customers', (select count(*) from public.customers c where c.reseller_id = v_reseller)
  );
end;
$$;

-- ---------------------------------------------------------------------
-- Estatísticas por revendedor (ADMIN): "accesses" = QR (mesmo retorno)
-- ---------------------------------------------------------------------
create or replace function public.admin_reseller_stats(p_reseller_id uuid default null)
returns table (
  reseller_id        uuid,
  user_id            uuid,
  company_name       text,
  contact_name       text,
  email              text,
  document           text,
  phone              text,
  active             boolean,
  created_at         timestamptz,
  plates_total       bigint,
  plates_available   bigint,
  plates_configured  bigint,
  plates_active      bigint,
  customers          bigint,
  accesses           bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    rp.id, rp.user_id, rp.company_name, pr.name, pr.email, rp.document, rp.phone, pr.active, rp.created_at,
    coalesce(pl.total, 0), coalesce(pl.available, 0), coalesce(pl.configured, 0), coalesce(pl.active, 0),
    coalesce(cu.total, 0), coalesce(pl.accesses, 0)
  from public.reseller_profiles rp
  join public.profiles pr on pr.id = rp.user_id
  left join lateral (
    select count(*) as total,
           count(*) filter (where p.destination_url is null) as available,
           count(*) filter (where p.destination_url is not null) as configured,
           count(*) filter (where p.status = 'active') as active,
           coalesce(sum(p.qr_access_count), 0)::bigint as accesses
    from public.plates p
    where p.reseller_id = rp.id
  ) pl on true
  left join lateral (
    select count(*) as total from public.customers c where c.reseller_id = rp.id
  ) cu on true
  where public.is_admin()
    and (p_reseller_id is null or rp.id = p_reseller_id)
  order by rp.company_name;
$$;

-- ---------------------------------------------------------------------
-- Dashboard ADMIN: "accesses" do período = QR (mesma assinatura)
-- ---------------------------------------------------------------------
create or replace function public.admin_dashboard_metrics(p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
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
    'plates_in_stock', count(*) filter (where p.reseller_id is null and p.status = 'in_stock'),
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
$$;

-- ---------------------------------------------------------------------
-- Acessos por QR Code, por placa, no período (agregado no banco)
-- ---------------------------------------------------------------------

-- Revendedor: só as próprias placas (current_reseller_id, derivado de auth.uid()).
create or replace function public.reseller_qr_access_by_plate(
  p_from    timestamptz,
  p_to      timestamptz,
  p_limit   integer default 15,
  p_offset  integer default 0
)
returns table (
  plate_id       uuid,
  public_code    text,
  customer_name  text,
  qr_accesses    bigint,
  total_count    bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with counts as (
    select r.plate_id, count(*) as qr
    from public.redirects r
    join public.plates p on p.id = r.plate_id
    where r.source = 'qr'
      and r.created_at >= p_from and r.created_at < p_to
      and p.reseller_id = public.current_reseller_id()
    group by r.plate_id
  )
  select p.id, p.public_code, c.name, k.qr, count(*) over ()
  from counts k
  join public.plates p on p.id = k.plate_id
  left join public.customers c on c.id = p.customer_id
  where public.current_reseller_id() is not null
  order by k.qr desc, p.public_code
  limit greatest(1, least(coalesce(p_limit, 15), 200))
  offset greatest(0, coalesce(p_offset, 0));
$$;

-- ADMIN: todas as placas, com revendedor e cliente (sem nenhum dado financeiro).
create or replace function public.admin_qr_access_by_plate(
  p_from   timestamptz,
  p_to     timestamptz,
  p_limit  integer default 10
)
returns table (
  plate_id       uuid,
  public_code    text,
  reseller_name  text,
  customer_name  text,
  qr_accesses    bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with counts as (
    select r.plate_id, count(*) as qr
    from public.redirects r
    where r.source = 'qr' and r.created_at >= p_from and r.created_at < p_to
    group by r.plate_id
  )
  select p.id, p.public_code, rp.company_name, c.name, k.qr
  from counts k
  join public.plates p on p.id = k.plate_id
  left join public.reseller_profiles rp on rp.id = p.reseller_id
  left join public.customers c on c.id = p.customer_id
  where public.is_admin()
  order by k.qr desc, p.public_code
  limit greatest(1, least(coalesce(p_limit, 10), 100));
$$;

revoke all on function public.reseller_qr_access_by_plate(timestamptz, timestamptz, integer, integer) from public, anon;
grant execute on function public.reseller_qr_access_by_plate(timestamptz, timestamptz, integer, integer) to authenticated;
revoke all on function public.admin_qr_access_by_plate(timestamptz, timestamptz, integer) from public, anon;
grant execute on function public.admin_qr_access_by_plate(timestamptz, timestamptz, integer) to authenticated;

-- Permissões reafirmadas (mesmas assinaturas das migrations anteriores).
revoke all on function public.reseller_dashboard_metrics() from public, anon;
grant execute on function public.reseller_dashboard_metrics() to authenticated;
revoke all on function public.admin_reseller_stats(uuid) from public, anon;
grant execute on function public.admin_reseller_stats(uuid) to authenticated;
revoke all on function public.admin_dashboard_metrics(timestamptz, timestamptz) from public, anon;
grant execute on function public.admin_dashboard_metrics(timestamptz, timestamptz) to authenticated;
