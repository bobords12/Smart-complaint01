-- ============================================================
-- pnp-portal-05-storage-access.sql
-- Purpose: let a PNP officer open ONLY the evidence files a
--          Captain explicitly shared on a referral assigned to
--          them, and nothing else in the evidence bucket.
-- Safety:  the bucket is never made public and no existing policy
--          is widened. PNP officers write nothing to storage.
-- ============================================================
--
-- THE APPROACH, AND WHY IT IS THIS ONE
--   A storage SELECT policy can say "this path belongs to a file
--   shared on a referral assigned to me" because the join is
--   expressible in SQL:
--
--       evidence -> complaint_referral_evidence -> complaint_referrals
--                                                              -> assignments
--
--   This is the same shape as
--   "Lupon read assigned evidence storage" in
--   lupon-member-portal-and-pangkat-rls.sql, which does the same
--   thing for the Lupon member portal.
--
--   The consequence is that the client can mint a short-lived
--   signed URL with the officer's OWN session, via the ordinary
--   supabase.storage API, and the request is refused unless the
--   assignment and the sharing both hold. No service-role key, no
--   URL-minting RPC, and no signed URL ever stored in the
--   database.
--
--   A tempting alternative is a SECURITY DEFINER function that
--   signs a path. It is not used here: it moves the storage call
--   behind auth.uid(), where the row-level check can be bypassed
--   by a definer-owned read, and it makes the officer's access
--   depend on a function being granted rather than on a policy.
--   A policy is the place this kind of rule belongs.
--
-- THE BUCKET
--   A public bucket named 'evidence' is a FAILURE of this file,
--   not a prerequisite. The check at the top aborts.
--
-- HOW TO APPLY
--   After pnp-portal-04.
-- ============================================================


-- ── Prerequisite / safety checks ────────────────────────────
DO $$
DECLARE
  v_missing text;
  v_public  text;
BEGIN
  SELECT string_agg(expected, ', ')
    INTO v_missing
    FROM unnest(ARRAY['complaint_referral_evidence', 'evidence',
                      'pnp_referral_assignments', 'complaint_referrals'])
       AS expected
   WHERE to_regclass('public.' || expected) IS NULL;

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION
      'pnp-portal-05 cannot finish: these tables are missing: %. '
      'Apply pnp-portal-02 through -04 first.', v_missing;
  END IF;

  IF to_regprocedure('public.pnp_referral_is_visible(uuid)') IS NULL THEN
    RAISE EXCEPTION
      'pnp-portal-05 cannot finish: public.pnp_referral_is_visible(uuid) is missing. '
      'Apply pnp-portal-03-referral-functions.sql first.';
  END IF;

  -- Refuse to continue if the evidence bucket is public. A public
  -- evidence bucket makes every complaint attachment in the
  -- system world-readable regardless of this portal.
SELECT string_agg(id, ', ')
      INTO v_public
      FROM storage.buckets
     WHERE name = 'evidence'
       AND public = true;

  IF v_public IS NOT NULL THEN
    RAISE EXCEPTION
      'The storage bucket "evidence" is PUBLIC (%). Set it to private in '
      'Supabase Dashboard > Storage > evidence before applying this file. '
      'A public evidence bucket exposes every complaint attachment in the '
      'system.', v_public;
  END IF;
END
$$;


-- ── Read: shared referral evidence only ─────────────────────
--
-- The whole boundary. storage.objects.name is the path the client
-- is asking to sign; the EXISTS proves that path is a file
-- (a) belonging to a complaint, (b) explicitly shared on a
-- referral, and (c) visible to this officer through an active
-- assignment.
--
-- Nothing about this policy mentions the complaint's resident, the
-- other evidence on the same complaint, or any folder convention.
-- A file that was never ticked in the referral dialog is not
-- reachable, even though the same officer could be a resident of
-- that complaint in another account.
DROP POLICY IF EXISTS "PNP officers read shared referral evidence storage" ON storage.objects;

CREATE POLICY "PNP officers read shared referral evidence storage"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'evidence'
    AND EXISTS (
      SELECT 1
        FROM public.evidence e
        JOIN public.complaint_referral_evidence re
          ON re.evidence_id = e.id
       WHERE e.storage_path = storage.objects.name
         AND public.pnp_referral_is_visible(re.referral_id)
    )
  );

COMMENT ON POLICY "PNP officers read shared referral evidence storage"
  ON storage.objects IS
  'Grants a PNP officer read access to an evidence object only while that exact file is shared on a referral assigned to them. Scoped per file, not per folder or per complaint.';


-- ── Write: explicitly none ──────────────────────────────────
--
-- A PNP officer attaches nothing. Uploads, overwrites and deletes
-- are refused with WITH CHECK (false) rather than being left to
-- the absence of a policy, so the intent survives a future
-- "let PNP upload too" edit to this file: the reader has to
-- deliberately change these to do it.
DROP POLICY IF EXISTS "PNP officers upload referral evidence storage" ON storage.objects;
DROP POLICY IF EXISTS "PNP officers delete referral evidence storage" ON storage.objects;

CREATE POLICY "PNP officers upload referral evidence storage"
  ON storage.objects FOR INSERT
  WITH CHECK (false);

CREATE POLICY "PNP officers delete referral evidence storage"
  ON storage.objects FOR DELETE
  USING (false);


-- ── Officials keep their existing access ────────────────────
--
-- Nothing in this file touches:
--   * "Officials read all evidence storage"        (captain/oic/secretary)
--   * "Residents read own evidence"               (own folder)
--   * "Officials upload own evidence storage"     (own folder)
--   * "Residents upload own evidence" / delete    (own folder)
--   * "Residents delete own evidence"
--   * "Lupon read assigned evidence storage"      (assigned complaints)
--
-- A Captain who is also looking at a referral's evidence page
-- uses the same policies they already had. The referral UI does
-- not need a second path for the barangay's own officers.


-- ── Verification (read-only) ────────────────────────────────
-- 1. The bucket is still private.
-- SELECT id, public FROM storage.buckets WHERE id = 'evidence';
-- -- expect: evidence | false
--
-- 2. Exactly three new PNP policies exist: one real read grant and two
--    explicit denials. "Read-only" here means the PNP's only permitted
--    operation is SELECT; the INSERT and DELETE rows are USING (false)
--    sentinels, not grants.
-- SELECT policyname, cmd, qual
--   FROM pg_policies
--  WHERE schemaname = 'storage' AND tablename = 'objects'
--    AND policyname LIKE 'PNP%'
--  ORDER BY cmd, policyname;
-- -- expect exactly:
-- --   PNP officers delete referral evidence storage | DELETE | (false)
-- --   PNP officers read shared referral evidence storage | SELECT | <the join>
-- --   PNP officers upload referral evidence storage | INSERT | (false)
--
-- 2b. The two write policies really do evaluate to false, so the
-- --    "read-only" claim above is checked rather than assumed.
-- SELECT policyname, cmd, qual
--   FROM pg_policies
--  WHERE schemaname = 'storage' AND tablename = 'objects'
--    AND policyname LIKE 'PNP%' AND cmd <> 'SELECT';
-- -- expect both quals to read "(false)"
--
-- 3. No PNP policy grants UPDATE.
-- SELECT count(*) FROM pg_policies
--  WHERE schemaname = 'storage' AND tablename = 'objects'
--    AND policyname LIKE 'PNP%' AND cmd = 'UPDATE';
-- -- expect 0
--
-- 4. No PNP policy was added to any bucket other than 'evidence'.
-- SELECT policyname FROM pg_policies
--  WHERE schemaname = 'storage' AND tablename = 'objects'
--    AND policyname LIKE 'PNP%'
--    AND policyname NOT LIKE '%evidence%';
-- -- expect 0 rows. Avatars and summons are out of scope.
--
-- 5. The join the read policy depends on actually returns rows for
--    a shared file, and nothing for an unshared one.
-- SELECT r.referral_reference, e.original_filename, e.storage_path
--   FROM complaint_referrals r
--   JOIN complaint_referral_evidence re ON re.referral_id = r.id
--   JOIN evidence e ON e.id = re.evidence_id
--  ORDER BY r.referral_reference;
-- -- Run this as the database owner. Every row is a file a PNP
-- -- officer assigned to that referral may open. If a complaint has
-- -- evidence that is missing from this list, it is not shared and
-- -- is correctly unreachable from the PNP portal.
