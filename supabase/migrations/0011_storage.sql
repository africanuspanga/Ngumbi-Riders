-- =========================================================================
-- 0011_storage.sql — private storage buckets and policies (spec §24)
-- Identity documents NEVER live in public buckets. Riders receive files only
-- through short-lived, server-issued signed URLs (service role), so direct
-- rider access to storage.objects is intentionally not granted here.
-- =========================================================================

insert into storage.buckets (id, name, public)
values
  ('application-documents', 'application-documents', false),
  ('rider-documents',       'rider-documents',       false),
  ('guarantor-documents',   'guarantor-documents',   false),
  ('contract-documents',    'contract-documents',    false),
  ('receipts',              'receipts',              false),
  ('incident-attachments',  'incident-attachments',  false),
  ('import-files',          'import-files',          false)
on conflict (id) do nothing;

-- Owner has full control over every private bucket through authenticated
-- requests. All other access (including riders) is mediated server-side.
create policy storage_owner_all on storage.objects
  for all to authenticated
  using (
    bucket_id in (
      'application-documents','rider-documents','guarantor-documents',
      'contract-documents','receipts','incident-attachments','import-files'
    ) and public.is_owner()
  )
  with check (
    bucket_id in (
      'application-documents','rider-documents','guarantor-documents',
      'contract-documents','receipts','incident-attachments','import-files'
    ) and public.is_owner()
  );
