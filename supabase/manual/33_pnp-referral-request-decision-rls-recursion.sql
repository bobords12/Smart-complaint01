-- ══════════════════════════════════════════════════════════
-- Migration 33 — Break the RLS recursion that stopped the Captain
--                from ever deciding on a resident's referral.
-- ══════════════════════════════════════════════════════════
--
-- SYMPTOM
--
--   Approving or declining a resident's PNP referral request always
--   fails. The panel reports:
--
--     The request could not be reviewed (infinite recursion detected
--     in policy for relation "pnp_referral_requests").
--
--   which is Postgres 42P17. The resident can file a request, the
--   Captain can read it, and then the workflow stops dead at the one
--   step that decides it.
--
-- CAUSE
--
--   "Referring officials review referral requests" (FOR UPDATE) ends
--   in a WITH CHECK that is trying to pin the two columns an officer
--   has no business rewriting:
--
--     ... AND complaint_id     = (SELECT orig.complaint_id
--                                  FROM pnp_referral_requests orig
--                                 WHERE orig.id = pnp_referral_requests.id)
--        AND resident_user_id  = (SELECT orig.resident_user_id
--                                  FROM pnp_referral_requests orig
--                                 WHERE orig.id = pnp_referral_requests.id)
--
--   A subquery with FROM pnp_referral_requests inside a policy ON
--   pnp_referral_requests re-enters that same policy to evaluate the
--   subquery, which re-enters it again, without end. Postgres refuses
--   the whole UPDATE rather than stack overflow, so the write never
--   reaches the row — and every other UPDATE policy in this project
--   that qualifies a column as T.col is fine, because T.col names the
--   current row instead of re-scanning T. This is the only policy in
--   the schema that does it (see the verification below).
--
-- FIX
--
--   Read the original row through a SECURITY DEFINER helper. Running
--   as its owner, the helper is not subject to the table's policies,
--   so the self-scan terminates at depth one instead of recursing.
--   The guard itself is kept: it still refuses a rewrite of
--   complaint_id or resident_user_id, which would silently move a
--   request onto a different case or a different resident.
--
--   The USING clause is untouched — it was already correct.
--
-- WHY NOT JUST DROP THE GUARD
--
--   Because it is there for a reason. Without it a Captain could point
--   an approved request at a complaint they should not be touching.
--   The guard is the policy; only the way it reads the old row was
--   wrong.
--
-- HOW TO APPLY
--   After pnp-referral-requests.sql. Safe to re-run.
-- ══════════════════════════════════════════════════════════


-- ── 1. The non-recursive reader ─────────────────────────────

CREATE OR REPLACE FUNCTION public.pnp_referral_request_is_unchanged(
  p_id                uuid,
  p_complaint_id      uuid,
  p_resident_user_id  uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.pnp_referral_requests r
     WHERE r.id = p_id
       AND r.complaint_id     IS NOT DISTINCT FROM p_complaint_id
       AND r.resident_user_id IS NOT DISTINCT FROM p_resident_user_id
  );
$$;

REVOKE ALL ON FUNCTION public.pnp_referral_request_is_unchanged(uuid, uuid, uuid)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pnp_referral_request_is_unchanged(uuid, uuid, uuid)
  TO authenticated;

COMMENT ON FUNCTION public.pnp_referral_request_is_unchanged(uuid, uuid, uuid) IS
  'Reads the stored row of a referral request without re-entering its '
  'own RLS policy, so the FOR UPDATE WITH CHECK can compare the new '
  'row against the old one. SECURITY DEFINER is what makes this '
  'terminating: a plain subquery on the same table recursed until '
  'Postgres raised 42P17 and the Captain''s decision never saved.';


-- ── 2. Rebuild the UPDATE policy with the helper ────────────
-- DROP + CREATE rather than ALTER POLICY, because ALTER POLICY
-- cannot express a new WITH CHECK without restating the whole
-- policy anyway, and this keeps the definition in one place.
-- The policy is intentionally granted to PUBLIC (the default),
-- matching how it was created.

DROP POLICY IF EXISTS "Referring officials review referral requests"
  ON public.pnp_referral_requests;

CREATE POLICY "Referring officials review referral requests"
  ON public.pnp_referral_requests
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1
        FROM public.profiles
       WHERE profiles.id = auth.uid()
         AND profiles.role IN ('captain'::public.app_role, 'oic'::public.app_role)
         AND profiles.account_status = 'active'::public.account_status
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
        FROM public.profiles
       WHERE profiles.id = auth.uid()
         AND profiles.role IN ('captain'::public.app_role, 'oic'::public.app_role)
         AND profiles.account_status = 'active'::public.account_status
    )
    AND public.pnp_referral_request_is_unchanged(
          id, complaint_id, resident_user_id
        )
  );


-- ── 3. Verification ─────────────────────────────────────────
-- Structural only, deliberately. This script runs as the migration
-- engine, and a superuser bypasses RLS, so an UPDATE issued from here
-- would never evaluate the policy and would pass even with the
-- recursion still in place. The behavioural proof — the same write the
-- Captain's browser issues, with RLS actually applied — is run
-- separately against the real role and rolled back; see the check at
-- the end of this migration's companion verification.

DO $$
DECLARE
  v_self_scan  integer;
  v_helper     integer;
  v_policy     integer;
  v_call       integer;
BEGIN
  -- The original defect: any policy still re-scanning its own table.
  -- T.col (the current row) is allowed and is not counted; FROM/JOIN T
  -- is the recursion and must come back zero.
  SELECT count(*)
    INTO v_self_scan
    FROM pg_policies p
   WHERE p.schemaname = 'public'
     AND ( COALESCE(p.qual, '') ~* ('\m(from|join)\s+(public\.)?' || p.tablename || '\M')
        OR COALESCE(p.with_check, '') ~* ('\m(from|join)\s+(public\.)?' || p.tablename || '\M') );
  IF v_self_scan <> 0 THEN
    RAISE EXCEPTION 'FAIL: % policy(ies) still self-reference their own table', v_self_scan;
  END IF;
  RAISE NOTICE 'PASS 1: no policy re-scans its own table (% remaining)', v_self_scan;

  -- The helper exists, is SECURITY DEFINER, and is executable by the
  -- client role that calls it through the policy.
  SELECT count(*)
    INTO v_helper
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'pnp_referral_request_is_unchanged'
     AND p.prosecdef
     AND has_function_privilege('authenticated', p.oid, 'EXECUTE');
  IF v_helper <> 1 THEN
    RAISE EXCEPTION 'FAIL: helper missing, not SECURITY DEFINER, or not executable by authenticated';
  END IF;
  RAISE NOTICE 'PASS 2: helper is SECURITY DEFINER and executable by authenticated';

  -- The policy is back, still an UPDATE policy, still guarded.
  SELECT count(*)
    INTO v_policy
    FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename = 'pnp_referral_requests'
     AND policyname = 'Referring officials review referral requests'
     AND cmd = 'UPDATE'
     AND with_check LIKE '%pnp_referral_request_is_unchanged%';
  IF v_policy <> 1 THEN
    RAISE EXCEPTION 'FAIL: UPDATE policy not rebuilt with the helper in WITH CHECK';
  END IF;
  RAISE NOTICE 'PASS 3: UPDATE policy rebuilt, immutability guard preserved';

  -- The helper actually runs and agrees the row is unchanged — this is
  -- the expression the WITH CHECK evaluates on every Captain write.
  SELECT count(*)
    INTO v_call
    FROM public.pnp_referral_requests r
   WHERE public.pnp_referral_request_is_unchanged(
           r.id, r.complaint_id, r.resident_user_id
         );
  IF v_call = 0 THEN
    RAISE EXCEPTION 'FAIL: helper returned no TRUE rows against live data';
  END IF;
  RAISE NOTICE 'PASS 4: helper evaluates on % live request(s)', v_call;

  RAISE NOTICE 'ALL CHECKS PASSED';
END $$;
