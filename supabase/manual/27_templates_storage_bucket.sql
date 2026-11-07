-- 27_templates_storage_bucket.sql
--
-- Master document templates for the Captain Portal printed forms.
--
-- The barangay supplies the official .docx masters (Reklamo, Notice of Hearing).
-- Those files are the visual authority for the printed forms and are NEVER
-- edited: a generated document is produced by reading the master, replacing the
-- blank field runs in memory, and writing a NEW file to the private `documents`
-- bucket. Nothing is ever written back to this bucket from the application.
--
-- Because the masters are the source of truth for an official form, this bucket
-- is deliberately read-only to the application:
--   * private (public = false) - never reachable by an unauthenticated URL
--   * allowed_mime_types restricted to the OOXML wordprocessingml type
--   * SELECT granted only to active captain / oic / secretary profiles
--   * INSERT / UPDATE / DELETE explicitly denied to `authenticated`
-- so the only way to change a master is a deliberate action in the Supabase
-- dashboard (service role), which is the intended maintenance path.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'templates',
  'templates',
  false,
  10485760,
  array['application/vnd.openxmlformats-officedocument.wordprocessingml.document']::text[]
)
on conflict (id) do nothing;

-- Officers may read a master in order to render a generated document.
-- `account_status = 'active'` keeps a deactivated account from reading masters.
drop policy if exists "Officials read master templates storage" on storage.objects;
create policy "Officials read master templates storage"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'templates'
  and exists (
    select 1
    from profiles p
    where p.id = auth.uid()
      and p.role = any (array['captain'::app_role, 'oic'::app_role, 'secretary'::app_role])
      and p.account_status = 'active'::account_status
  )
);

-- The masters are immutable from the client. Without these, any authenticated
-- officer could overwrite the official template that every generated document
-- is derived from.
drop policy if exists "No client inserts master templates" on storage.objects;
create policy "No client inserts master templates"
on storage.objects
for insert
to authenticated
with check (false);

drop policy if exists "No client updates master templates" on storage.objects;
create policy "No client updates master templates"
on storage.objects
for update
to authenticated
using (false)
with check (false);

drop policy if exists "No client deletes master templates" on storage.objects;
create policy "No client deletes master templates"
on storage.objects
for delete
to authenticated
using (false);