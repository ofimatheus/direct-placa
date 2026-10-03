-- =====================================================================
-- 016 · Redefinição de senha do revendedor pelo ADMIN: autorização no
--       banco e trilha de auditoria
--
-- A senha em si NUNCA passa pelo banco da aplicação: quem troca é o
-- Supabase Auth (API administrativa), chamado pelo servidor Next.js com a
-- service role, depois destas verificações. Nenhuma tabela aqui tem coluna
-- capaz de guardar senha, hash, dica ou valor digitado.
--
--   admin_reseller_auth_user(p_reseller_id)
--       valida ADMIN no banco e devolve o usuário de Auth do revendedor.
--       Só revendedores: não serve para trocar a senha de um ADMIN.
--   admin_record_password_reset(p_reseller_id, p_temporary)
--       grava o evento "Senha redefinida pelo administrador" e marca o
--       perfil (password_changed_at, must_change_password).
--
-- Preparação para "trocar senha no primeiro acesso": o campo
-- profiles.must_change_password fica gravado, mas NADA o exige ainda.
--
-- Incremental e idempotente; não altera migrations anteriores.
-- =====================================================================

alter table public.profiles add column if not exists must_change_password boolean not null default false;
alter table public.profiles add column if not exists password_changed_at timestamptz;

comment on column public.profiles.must_change_password is
  'Preparação: true quando o ADMIN definiu uma senha temporária. Ainda não há fluxo que obrigue a troca.';

-- ---------------------------------------------------------------------
-- Trilha de auditoria administrativa (append-only)
-- Sem FKs de propósito: o registro sobrevive à remoção do usuário, e FKs
-- com ON DELETE SET NULL colidiriam com a imutabilidade abaixo.
-- ---------------------------------------------------------------------
create table if not exists public.admin_audit_events (
  id                  bigint generated always as identity primary key,
  event_type          text not null,
  actor_id            uuid,
  target_user_id      uuid,
  target_reseller_id  uuid,
  created_at          timestamptz not null default now(),
  constraint admin_audit_events_type_check check (event_type in ('reseller_password_reset'))
);

comment on table public.admin_audit_events is
  'Eventos administrativos sensíveis (quem, o quê, sobre quem, quando). Nunca guarda valores secretos.';

create index if not exists admin_audit_events_target_idx
  on public.admin_audit_events (target_reseller_id, created_at desc);

create or replace function public.guard_admin_audit_event()
returns trigger
language plpgsql
as $$
begin
  raise exception 'A trilha de auditoria não pode ser alterada nem apagada' using errcode = '55000';
end;
$$;

drop trigger if exists trg_admin_audit_events_immutable on public.admin_audit_events;
create trigger trg_admin_audit_events_immutable
  before update or delete on public.admin_audit_events
  for each row execute function public.guard_admin_audit_event();

alter table public.admin_audit_events enable row level security;

drop policy if exists admin_audit_events_select on public.admin_audit_events;
create policy admin_audit_events_select on public.admin_audit_events
  for select to authenticated
  using (public.is_admin());

revoke insert, update, delete on public.admin_audit_events from anon, authenticated;

-- ---------------------------------------------------------------------
-- Autorização (chamada ANTES de tocar no Supabase Auth)
-- ---------------------------------------------------------------------
create or replace function public.admin_reseller_auth_user(p_reseller_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user uuid;
begin
  if not public.is_admin() then
    raise exception 'Somente ADMIN pode redefinir senhas' using errcode = '42501';
  end if;
  select rp.user_id into v_user
  from public.reseller_profiles rp
  join public.profiles pr on pr.id = rp.user_id
  where rp.id = p_reseller_id and pr.role = 'reseller';
  if v_user is null then
    raise exception 'Revendedor não encontrado' using errcode = 'P0002';
  end if;
  return v_user;
end;
$$;

-- ---------------------------------------------------------------------
-- Registro (chamado DEPOIS que o Supabase Auth confirmou a troca)
-- ---------------------------------------------------------------------
create or replace function public.admin_record_password_reset(p_reseller_id uuid, p_temporary boolean default false)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := public.admin_reseller_auth_user(p_reseller_id);  -- revalida ADMIN e alvo
  v_now  timestamptz := now();
begin
  update public.profiles pr set
    password_changed_at = v_now,
    must_change_password = coalesce(p_temporary, false)
  where pr.id = v_user;

  insert into public.admin_audit_events (event_type, actor_id, target_user_id, target_reseller_id)
  values ('reseller_password_reset', auth.uid(), v_user, p_reseller_id);

  return v_now;
end;
$$;

revoke all on function public.admin_reseller_auth_user(uuid) from public, anon;
grant execute on function public.admin_reseller_auth_user(uuid) to authenticated;
revoke all on function public.admin_record_password_reset(uuid, boolean) from public, anon;
grant execute on function public.admin_record_password_reset(uuid, boolean) to authenticated;
revoke all on function public.guard_admin_audit_event() from public, anon, authenticated;
