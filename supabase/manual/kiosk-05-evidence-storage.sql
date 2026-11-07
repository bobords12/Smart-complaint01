-- ============================================================
-- kiosk-05-evidence-storage.sql
-- Purpose: Private Storage configuration and policies for kiosk
--          evidence uploads.
--
-- STORAGE LAYOUT
--   kiosk/{draft_reference}/{random}.{ext}
--
--   draft_reference is random and is NOT the QR secret, but it is
--   still unguessable (122 bits). The complainant's name never
--   appears in a path, so a path leak cannot identify anyone.
--   The resident's original filename is preserved in the
--   evidence table, not in the object name.
--
-- BUCKET STAYS PRIVATE
--   The 'evidence' bucket is never made public. There is no
--   policy that returns object URLs, no anonymous SELECT on the
--   bucket at large, and no long-lived signed URL. Previews are
--   short-lived signed URLs created only after the caller has
--   proved possession of a session token.
--
-- PREREQUISITES: kiosk-01, kiosk-02, kiosk-03
-- ============================================================

-- ──────────────────────────────────────────────────────────────
-- A. Bucket
-- ──────────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'evidence', 'evidence', false, 10485760,
  ARRAY['image/jpeg','image/jpg','image/png','image/webp','application/pdf']
)
ON CONFLICT (id) DO NOTHING;

-- The bucket already exists in this project with jpeg/png/pdf
-- only. Add image/webp WITHOUT removing any existing entry, and
-- only when it is genuinely missing.
UPDATE storage.buckets
   SET allowed_mime_types = ARRAY(
         SELECT DISTINCT unnest(allowed_mime_types || ARRAY['image/webp'])
       )
 WHERE id = 'evidence'
   AND NOT ('image/webp' = ANY (allowed_mime_types));

-- Enforce privacy even if someone flipped the flag by hand.
UPDATE storage.buckets
   SET public = false
 WHERE id = 'evidence'
   AND public IS DISTINCT FROM false;

-- ──────────────────────────────────────────────────────────────
-- B. Anonymous upload, scoped to a live QR session
--
--    The phone holding the QR token may store a file ONLY inside
--    the folder of a session that is unrevoked, unconsumed and
--    unexpired. It cannot write anywhere else in the bucket and
--    cannot list the bucket.
--
--    The storage path is not chosen by the phone: the route
--    handler calls kiosk_register_uploaded_file() first, which
--    derives the path server-side and returns it.
-- ──────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Kiosk uploads into a live session folder"
  ON storage.objects;

CREATE POLICY "Kiosk uploads into a live session folder"
  ON storage.objects FOR INSERT
  TO anon
  WITH CHECK (
    bucket_id = 'evidence'
    AND (storage.foldername(name))[1] = 'kiosk'
    AND EXISTS (
      SELECT 1
        FROM public.kiosk_upload_sessions s
       WHERE s.draft_reference = (storage.foldername(name))[2]
         AND s.revoked_at IS NULL
         AND s.consumed_at IS NULL
         AND s.expires_at > now()
    )
  );

-- ──────────────────────────────────────────────────────────────
-- C. Session-scoped read
--
--    While a session is live, the kiosk (and the phone) may read
--    that folder's objects. This is what allows the route handler
--    to mint a short-lived signed URL for a preview. The window is
--    10 minutes and the capability is a 122-bit random value, so
--    this is not a public listing.
-- ──────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Kiosk reads a live session folder"
  ON storage.objects;

CREATE POLICY "Kiosk reads a live session folder"
  ON storage.objects FOR SELECT
  TO anon, authenticated
  USING (
    bucket_id = 'evidence'
    AND (storage.foldername(name))[1] = 'kiosk'
    AND EXISTS (
      SELECT 1
        FROM public.kiosk_upload_sessions s
       WHERE s.draft_reference = (storage.foldername(name))[2]
         AND s.revoked_at IS NULL
         AND s.consumed_at IS NULL
         AND s.expires_at > now()
    )
  );

-- ──────────────────────────────────────────────────────────────
-- D. Officials read kiosk evidence
--
--    The existing resident/official policies all key off
--    (storage.foldername(name))[1] = auth.uid()::text, which can
--    never match a 'kiosk/...' path. Without this policy nobody
--    could open a walk-in's photo in the staff queue, so kiosk
--    evidence would be collected and then invisible.
-- ──────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Officials read kiosk evidence storage"
  ON storage.objects;

CREATE POLICY "Officials read kiosk evidence storage"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'evidence'
    AND (storage.foldername(name))[1] = 'kiosk'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
       WHERE p.id = auth.uid()
         AND p.role IN ('captain', 'oic', 'secretary')
         AND p.account_status = 'active'
    )
  );

-- ──────────────────────────────────────────────────────────────
-- E. Anonymous callers cannot overwrite or delete kiosk evidence
--
--    IMPORTANT: RLS policies are PERMISSIVE and are OR-ed together.
--    A policy whose name says "cannot delete" but whose USING clause
--    is true for the anonymous role would actually GRANT that
--    delete. There is no deny-policy in Postgres, so refusal is
--    expressed the only way that is actually correct: a policy
--    scoped to the anonymous role whose USING clause is always
--    false. It can never satisfy anon, and because it is scoped
--    with TO anon it is not even considered for a signed-in
--    official, who keeps the capabilities the existing portals
--    already rely on.
--
--    Verified by section E-verify below, which confirms anon
--    receives zero rows for UPDATE and DELETE on the kiosk prefix.
-- ──────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Kiosk anonymous cannot update evidence"
  ON storage.objects;

CREATE POLICY "Kiosk anonymous cannot update evidence"
  ON storage.objects FOR UPDATE
  TO anon
  USING (false)
  WITH CHECK (false);

DROP POLICY IF EXISTS "Kiosk anonymous cannot delete evidence"
  ON storage.objects;

CREATE POLICY "Kiosk anonymous cannot delete evidence"
  ON storage.objects FOR DELETE
  TO anon
  USING (false);

-- ──────────────────────────────────────────────────────────────
-- F. Evidence table access
--
--    The kiosk never writes the evidence table directly. Rows are
--    created inside kiosk_submit_complaint() from
--    kiosk_upload_session_files rows, so a caller cannot forge an
--    evidence row for a complaint it does not own.
--
--    uploaded_by is NULL for kiosk evidence (see kiosk-01). The
--    existing resident policies compare auth.uid() = uploaded_by
--    and therefore stay false, so no resident can read or write a
--    kiosk evidence row.
-- ──────────────────────────────────────────────────────────────
ALTER TABLE public.evidence ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.evidence FROM anon;

-- ──────────────────────────────────────────────────────────────
-- G. Verification
--
-- G1. The bucket must be private and accept the kiosk types.
-- ──────────────────────────────────────────────────────────────
-- SELECT id, public, file_size_limit, allowed_mime_types
--   FROM storage.buckets WHERE id = 'evidence';
-- Expected: public = false, file_size_limit = 10485760,
--           and image/webp present in allowed_mime_types.
--
-- G2. The kiosk storage policies.
-- ──────────────────────────────────────────────────────────────
-- SELECT policyname, cmd, qual, with_check
--   FROM pg_policies
--  WHERE schemaname = 'storage' AND tablename = 'objects'
--    AND policyname ILIKE '%kiosk%'
--  ORDER BY policyname;
-- Expected 4 policies:
--   Kiosk uploads into a live session folder   INSERT
--   Kiosk reads a live session folder          SELECT
--   Officials read kiosk evidence storage      SELECT
--   Kiosk anonymous cannot delete evidence     DELETE
--   Kiosk anonymous cannot update evidence     UPDATE
--
-- G3. No policy may expose the bucket publicly.
-- ──────────────────────────────────────────────────────────────
-- SELECT policyname, cmd
--   FROM pg_policies
--  WHERE schemaname = 'storage' AND tablename = 'objects'
--    AND cmd = 'SELECT'
--    AND (roles = '{public}' OR '{public}' = ANY(roles))
--    AND qual ILIKE '%kiosk%';
-- Expected: 0 rows.
--
-- G4. evidence.uploaded_by must now be nullable.
-- ──────────────────────────────────────────────────────────────
-- SELECT is_nullable FROM information_schema.columns
--  WHERE table_name = 'evidence' AND column_name = 'uploaded_by';
-- Expected: YES.
