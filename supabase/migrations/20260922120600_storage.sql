-- =====================================================================
-- 007 · Supabase Storage (buckets privados)
--
-- plate-templates  artes base
--   staging/{uuid}.{ext}                 upload temporário (URL assinada)
--   {template_id}/{sha256}.{ext}         arquivo definitivo e IMUTÁVEL
-- plate-outputs    arquivos gerados pelo sistema
--   exports/{batch_id}/{export_id}/...   ZIPs e CSVs das exportações
--   previews/...                         prévias fiéis e artes avulsas
--
-- Não há política de UPDATE: pela API do Storage ninguém sobrescreve um
-- arquivo existente. O servidor (service_role) nunca usa upsert em artes.
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('plate-templates', 'plate-templates', false, 26214400, array['image/png', 'image/jpeg'])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('plate-outputs', 'plate-outputs', false, null, array['application/zip', 'text/csv', 'image/png'])
on conflict (id) do update set
  public = false,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists plate_templates_admin_read on storage.objects;
create policy plate_templates_admin_read on storage.objects
  for select to authenticated
  using (bucket_id = 'plate-templates' and public.is_admin());

drop policy if exists plate_templates_admin_insert on storage.objects;
create policy plate_templates_admin_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'plate-templates' and public.is_admin());

-- Apenas arquivos temporários podem ser removidos; artes de versões, nunca.
drop policy if exists plate_templates_admin_delete_staging on storage.objects;
create policy plate_templates_admin_delete_staging on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'plate-templates'
    and public.is_admin()
    and (storage.foldername(name))[1] = 'staging'
  );

drop policy if exists plate_outputs_admin_read on storage.objects;
create policy plate_outputs_admin_read on storage.objects
  for select to authenticated
  using (bucket_id = 'plate-outputs' and public.is_admin());
