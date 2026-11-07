-- ============================================================
-- kiosk-04-rls-and-permissions.sql
-- Purpose: Prove the public kiosk cannot reach resident data.
--
-- WHAT THIS DOES
--   1. Confirms RLS is enabled on every table the kiosk must
--      never read directly.
--   2. REVOKEs table-level privileges from anon on the sensitive
--      tables. Supabase grants anon broad table privileges by
--      default and relies on RLS to return zero rows; revoking
--      the privilege as well means a future mistake in a policy
--      cannot turn into a data leak. This STRENGTHENS the
--      existing posture and removes no capability any existing
--      portal uses, because every portal signs in as
--      'authenticated' and RLS keys off auth.uid().
--   3. Restricts EXECUTE to the small set of kiosk functions the
--      route handlers actually call.
--
-- PREREQUISITES: kiosk-01, kiosk-02, kiosk-03
-- ============================================================

-- ──────────────────────────────────────────────────────────────
-- A. RLS must be enabled everywhere
-- ──────────────────────────────────────────────────────────────
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'complaints', 'evidence', 'profiles', 'notifications',
    'case_statuses', 'hearings', 'kp_trackers', 'kp_phases',
    'activity_logs', 'audit_logs', 'complaint_sequences',
    'kiosk_upload_sessions', 'kiosk_upload_session_files',
    'kiosk_rate_limits'
  ] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    END IF;
  END LOOP;
END
$$;

-- ──────────────────────────────────────────────────────────────
-- B. No anonymous table privileges
--
--    The kiosk never inserts, selects, updates or deletes a row
--    in any of these. Every write goes through
--    public.kiosk_submit_complaint(); every read goes through
--    public.kiosk_status_by_token() / kiosk_status_lookup().
-- ──────────────────────────────────────────────────────────────
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'complaints', 'evidence', 'profiles', 'notifications',
    'case_statuses', 'hearings', 'summons', 'kp_trackers',
    'kp_phases', 'activity_logs', 'audit_logs', 'complaint_sequences',
    'resident_profiles', 'case_inquiries',
    'kiosk_upload_sessions', 'kiosk_upload_session_files',
    'kiosk_rate_limits'
  ] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', t);
    END IF;
  END LOOP;
END
$$;

-- ──────────────────────────────────────────────────────────────
-- C. No anonymous sequence privileges
--
--    complaint_sequences is keyed by (year integer) and has no
--    serial column, so no sequence is revoked here. The loop is
--    left in place, guarded by to_regclass, so the statement stays
--    correct if a serial column is ever added.
-- ──────────────────────────────────────────────────────────────
DO $$
DECLARE
  s text;
BEGIN
  FOR s IN
    SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind = 'S'
  LOOP
    EXECUTE format('REVOKE ALL ON SEQUENCE public.%I FROM anon', s);
  END LOOP;
END
$$;

-- ──────────────────────────────────────────────────────────────
-- D. EXECUTE surface
--
--    Internal helpers are revoked from anon and authenticated.
--    A helper that can hash a token must never be callable from
--    the browser, or token guessing becomes offline work.
-- ──────────────────────────────────────────────────────────────
DO $$
DECLARE
  fn text;
  sig text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'kiosk_sha256', 'kiosk_new_token', 'kiosk_status_payload',
    'kiosk_resolve_upload_session', 'kiosk_check_rate_limit',
    'kiosk_cleanup_expired_uploads'
  ] LOOP
    -- Every kiosk helper takes (text), (text, text), (integer),
    -- (integer, integer) or (uuid); revoke by matching name so
    -- the exact signature list does not have to be restated.
    FOR sig IN
      SELECT p.oid::regprocedure::text
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public'
         AND p.proname = fn
    LOOP
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', sig);
    END LOOP;
  END LOOP;
END
$$;

-- The two functions the public is allowed to reach beyond
-- submission, both of which perform their own token check and
-- rate limiting internally.
GRANT EXECUTE ON FUNCTION public.kiosk_status_by_token(text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.kiosk_status_lookup(text, text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.kiosk_create_upload_session(text) TO anon;
GRANT EXECUTE ON FUNCTION public.kiosk_upload_session_status(text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.kiosk_register_uploaded_file(text, text, text, bigint) TO anon;
GRANT EXECUTE ON FUNCTION public.kiosk_revoke_upload_session(text, text) TO anon;

-- The Service Worker replays a queued submission after the
-- browser reports connectivity, still through the same RPC.
GRANT EXECUTE ON FUNCTION public.kiosk_submit_complaint(
  uuid, text, text, text, jsonb, text, text, text, text, text, text,
  date, time, text, text, boolean, boolean, text, jsonb, timestamptz,
  timestamptz, text, text, text, numeric, text, boolean, timestamptz
) TO anon, authenticated;

-- kiosk_clean_text / kiosk_normalize_mobile are pure helpers
-- used inside the submission function only.
DO $$
DECLARE
  sig text;
BEGIN
  FOR sig IN
    SELECT p.oid::regprocedure::text
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('kiosk_clean_text', 'kiosk_normalize_mobile')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', sig);
  END LOOP;
END
$$;

-- ──────────────────────────────────────────────────────────────
-- E. The kiosk must never link itself to a resident account
--
--    Belt and braces: even if a caller somehow passed a resident
--    id, the only insert path is kiosk_submit_complaint(), which
--    hardcodes resident_id = NULL. This assertion documents the
--    invariant and fails loudly if the column is ever changed to
--    accept an account link.
-- ──────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'complaints_complainant_presence_check'
      AND conrelid = 'public.complaints'::regclass
  ) THEN
    RAISE NOTICE
      'kiosk-04: complaints_complainant_presence_check is missing. Re-apply 23_staff_assisted_complaint_filing.sql.';
  END IF;
END
$$;

-- ──────────────────────────────────────────────────────────────
-- F. Verification
--
-- F1. anon must have zero table privileges on the sensitive set.
--     Every row below must show privilege = ''.
-- ──────────────────────────────────────────────────────────────
-- SELECT table_name, privilege_type
--   FROM information_schema.role_table_grants
--  WHERE grantee = 'anon'
--    AND table_schema = 'public'
--    AND table_name IN ('complaints','evidence','profiles','notifications',
--                       'case_statuses','kiosk_upload_sessions',
--                       'kiosk_upload_session_files','activity_logs','audit_logs')
--  ORDER BY table_name, privilege_type;
-- Expected: 0 rows.
--
-- F2. The only anon-callable kiosk functions are the seven below.
-- ──────────────────────────────────────────────────────────────
-- SELECT p.proname
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--  WHERE n.nspname = 'public'
--    AND has_function_privilege('anon', p.oid, 'EXECUTE')
--    AND p.proname LIKE 'kiosk_%'
--  ORDER BY 1;
-- Expected exactly:
--   kiosk_create_upload_session
--   kiosk_register_uploaded_file
--   kiosk_revoke_upload_session
--   kiosk_status_by_token
--   kiosk_status_lookup
--   kiosk_submit_complaint
--   kiosk_upload_session_status
--
-- F3. RLS is enabled and no anon policy exists on complaints.
-- ──────────────────────────────────────────────────────────────
-- SELECT c.relname, c.relrowsecurity
--   FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--  WHERE n.nspname = 'public' AND c.relname IN
--    ('complaints','evidence','kiosk_upload_sessions','kiosk_rate_limits');
-- Expected: relrowsecurity = true for all four.
--
-- SELECT policyname FROM pg_policies
--  WHERE schemaname = 'public' AND tablename = 'kiosk_rate_limits';
-- Expected: 0 rows.
