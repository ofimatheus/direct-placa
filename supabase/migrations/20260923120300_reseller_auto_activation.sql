-- =====================================================================
-- 011 · Ativação automática na primeira configuração do revendedor
--
-- ASSIGNED → (configura destino válido) → ACTIVE, sem clique separado.
-- Depois disso o revendedor alterna ACTIVE ↔ INACTIVE. BLOCKED continua
-- exclusivo do ADMIN. Substitui apenas configure_reseller_plate (mesma
-- assinatura; permissões preservadas e reafirmadas abaixo).
-- =====================================================================

create or replace function public.configure_reseller_plate(
  p_plate_id          uuid,
  p_customer_id       uuid,
  p_destination_type  text,
  p_destination_url   text,
  p_status            text default null
)
returns setof public.plates
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_profile  public.profiles%rowtype;
  v_reseller uuid;
  v_plate    public.plates%rowtype;
  v_url      text := nullif(btrim(coalesce(p_destination_url, '')), '');
  v_type     text := nullif(btrim(coalesce(p_destination_type, '')), '');
  v_status   text;
begin
  -- 1. autenticado
  if v_uid is null then
    raise exception 'Faça login para continuar' using errcode = '42501';
  end if;
  -- 2 e 3. ativo e RESELLER
  select * into v_profile from public.profiles pr where pr.id = v_uid;
  if not found or not v_profile.active then
    raise exception 'Usuário inativo' using errcode = '42501';
  end if;
  if v_profile.role <> 'reseller' then
    raise exception 'Somente revendedores configuram placas por esta operação' using errcode = '42501';
  end if;
  v_reseller := public.current_reseller_id();
  if v_reseller is null then
    raise exception 'Cadastro de revendedor não encontrado' using errcode = '42501';
  end if;

  -- 4. a placa pertence ao revendedor (não revela se a placa existe para outro)
  select * into v_plate from public.plates p where p.id = p_plate_id for update;
  if not found or v_plate.reseller_id is distinct from v_reseller then
    raise exception 'Placa não encontrada' using errcode = 'P0002';
  end if;
  if v_plate.status = 'blocked' then
    raise exception 'Esta placa foi bloqueada pelo administrador' using errcode = '55000';
  end if;

  -- 5. cliente do mesmo revendedor
  if p_customer_id is not null and not exists (
    select 1 from public.customers c where c.id = p_customer_id and c.reseller_id = v_reseller
  ) then
    raise exception 'Cliente inválido para este revendedor' using errcode = '22023';
  end if;

  -- 6 e 7. tipo permitido e URL HTTP/HTTPS
  if v_url is null then
    v_type := null;
  else
    if not public.is_valid_destination_url(v_url) then
      raise exception 'Informe uma URL de destino válida, começando com http:// ou https://' using errcode = '22023';
    end if;
    if v_type is null then
      raise exception 'Escolha o tipo de destino' using errcode = '22023';
    end if;
  end if;
  if v_type is not null and v_type not in ('google_review', 'whatsapp', 'instagram', 'menu', 'pix', 'website', 'custom') then
    raise exception 'Tipo de destino não permitido' using errcode = '22023';
  end if;

  -- Status operacional do revendedor:
  --   · sem status explícito: a primeira configuração válida ativa a placa
  --     (assigned → active); remover o destino de uma placa ativa volta para assigned
  --   · explícito: somente active ↔ inactive, e sempre com destino configurado
  --   · blocked é exclusivo do ADMIN (já recusado acima)
  if p_status is null then
    if v_url is null then
      v_status := case when v_plate.status = 'active' then 'assigned' else v_plate.status end;
    elsif v_plate.status = 'assigned' then
      v_status := 'active';
    else
      v_status := v_plate.status;
    end if;
  elsif p_status in ('active', 'inactive') then
    if v_url is null then
      raise exception 'Configure o destino antes de ativar ou desativar a placa' using errcode = '22023';
    end if;
    v_status := p_status;
  else
    raise exception 'Status não permitido para o revendedor' using errcode = '22023';
  end if;

  update public.plates p set
    customer_id = p_customer_id,
    destination_type = v_type,
    destination_url = v_url,
    status = v_status
  where p.id = p_plate_id;

  return query select * from public.plates p where p.id = p_plate_id;
end;
$$;

revoke all on function public.configure_reseller_plate(uuid, uuid, text, text, text) from public, anon;
grant execute on function public.configure_reseller_plate(uuid, uuid, text, text, text) to authenticated;
