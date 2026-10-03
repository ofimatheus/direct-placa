-- =====================================================================
-- 006 · Row Level Security
--
-- ADMIN     → acesso total ao módulo de produção.
-- RESELLER  → somente leitura do que é dele (placas atribuídas, clientes).
--             Nenhum acesso a templates, versões, lotes ou exportações.
-- anon      → nada direto; o redirect público usa resolve_plate_redirect().
-- O worker de exportação usa service_role (ignora RLS) e roda só no servidor.
-- =====================================================================

alter table public.profiles                enable row level security;
alter table public.reseller_profiles       enable row level security;
alter table public.customers               enable row level security;
alter table public.plate_batches           enable row level security;
alter table public.plates                  enable row level security;
alter table public.redirects               enable row level security;
alter table public.plate_assignments       enable row level security;
alter table public.plate_templates         enable row level security;
alter table public.plate_template_versions enable row level security;
alter table public.batch_exports           enable row level security;

-- profiles ------------------------------------------------------------
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_admin());

-- Só ADMIN altera perfis (impede que um usuário promova a si mesmo).
drop policy if exists profiles_admin_update on public.profiles;
create policy profiles_admin_update on public.profiles
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- reseller_profiles ---------------------------------------------------
drop policy if exists reseller_profiles_select on public.reseller_profiles;
create policy reseller_profiles_select on public.reseller_profiles
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists reseller_profiles_admin_write on public.reseller_profiles;
create policy reseller_profiles_admin_write on public.reseller_profiles
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- customers -----------------------------------------------------------
drop policy if exists customers_select on public.customers;
create policy customers_select on public.customers
  for select to authenticated
  using (public.is_admin() or reseller_id = public.current_reseller_id());

drop policy if exists customers_reseller_write on public.customers;
create policy customers_reseller_write on public.customers
  for all to authenticated
  using (public.is_admin() or reseller_id = public.current_reseller_id())
  with check (public.is_admin() or reseller_id = public.current_reseller_id());

-- plates --------------------------------------------------------------
drop policy if exists plates_select on public.plates;
create policy plates_select on public.plates
  for select to authenticated
  using (public.is_admin() or reseller_id = public.current_reseller_id());

drop policy if exists plates_admin_write on public.plates;
create policy plates_admin_write on public.plates
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- redirects -----------------------------------------------------------
drop policy if exists redirects_select on public.redirects;
create policy redirects_select on public.redirects
  for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.plates p
      where p.id = redirects.plate_id
        and p.reseller_id = public.current_reseller_id()
    )
  );

-- plate_assignments ---------------------------------------------------
drop policy if exists plate_assignments_select on public.plate_assignments;
create policy plate_assignments_select on public.plate_assignments
  for select to authenticated
  using (public.is_admin() or reseller_id = public.current_reseller_id());

drop policy if exists plate_assignments_admin_write on public.plate_assignments;
create policy plate_assignments_admin_write on public.plate_assignments
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Módulo de produção: somente ADMIN ------------------------------------
drop policy if exists plate_batches_admin on public.plate_batches;
create policy plate_batches_admin on public.plate_batches
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists plate_templates_admin on public.plate_templates;
create policy plate_templates_admin on public.plate_templates
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists plate_template_versions_admin on public.plate_template_versions;
create policy plate_template_versions_admin on public.plate_template_versions
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists batch_exports_admin on public.batch_exports;
create policy batch_exports_admin on public.batch_exports
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());
