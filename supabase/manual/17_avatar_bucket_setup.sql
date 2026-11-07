-- ============================================================
-- 17_avatar_bucket_setup.sql
-- Purpose: Create the avatars storage bucket and RLS policies
--          for resident profile picture upload.
-- Safety:  bucket is PUBLIC so getPublicUrl() works.
--          RLS policies restrict residents to their own folder.
-- ============================================================

-- ── Create avatars bucket (public) ─────────────────────────
-- If the bucket already exists, this will fail harmlessly.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'avatars',
  'avatars',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = true,
  file_size_limit = 5242880,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp'];

-- ── Storage RLS policies ───────────────────────────────────
-- Drop existing policies if they exist (safe re-run)
DROP POLICY IF EXISTS "Residents upload own avatar" ON storage.objects;
DROP POLICY IF EXISTS "Residents read own avatar" ON storage.objects;
DROP POLICY IF EXISTS "Residents update own avatar" ON storage.objects;
DROP POLICY IF EXISTS "Residents delete own avatar" ON storage.objects;

-- Residents can upload to their own user-ID folder
CREATE POLICY "Residents upload own avatar"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Anyone authenticated can read avatars (bucket is public, but
-- this policy lets the Supabase client read via API too)
CREATE POLICY "Residents read own avatar"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'avatars'
    AND auth.uid() IS NOT NULL
  );

-- Residents can update files in their own folder
CREATE POLICY "Residents update own avatar"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Residents can delete files in their own folder
CREATE POLICY "Residents delete own avatar"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
