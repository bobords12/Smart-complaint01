-- ============================================================
-- pnp-portal-04-referral-rls.sql
-- Purpose: every read and write boundary for a formal referral.
-- Safety:  this is the security boundary. Everything else in the
--          PNP portal is navigation.
-- ============================================================
--
-- THE MODEL, IN ONE PARAGRAPH
--   A PNP officer may read a referral only while an ACTIVE
--   pnp_referral_assignments row names them. There is no
--   'all referrals' policy for a role, no policy that grants a
--   blanket read to pnp_officer, and no policy that exposes the
--   complaint behind a referral. A released assignment revokes
--   access on the next read.
--
--   A Captain or OIC may read every referral. They may also
--   CREATE one, but never through a table write: complaint_referrals
--   has no INSERT policy at all, so the only way in is
--   pnp_create_referral(). Same for every other mutation. This is
--   why there is not a single UPDATE or DELETE policy on
--   complaint_referrals in this file.
--
-- WHAT IS DELIBERATELY ABSENT
--   * No policy for pnp_referral_requests. A resident's request is
--     a request to the barangay. The PNP portal must not see it
--     until the barangay has turned it into a referral.
--   * No policy on complaints, blotter_records, internal_notes or
--     hearing_attendances. A PNP officer is not a barangay
--     official and gets no access to the case file.
--   * No policy on activity_logs. PNP reads referral activity
--     through pnp_referral_activity(), which returns referral
--     rows only.
--   * No UPDATE/DELETE on complaint_referral_updates. The timeline
--     is append-only.
--   * No UPDATE/DELETE on complaint_referral_evidence. Evidence
--     that was shared cannot be quietly un-shared; a referral that
--     needs different evidence is a new referral.
--
-- HOW TO APPLY
--   After pnp-portal-03. Before pnp-portal-05.
-- ============================================================


-- ── Prerequisite check ──────────────────────────────────────
DO $$
DECLARE
  v_missing text;
BEGIN
  SELECT string_agg(expected, ', ')
    INTO v_missing
    FROM unnest(ARRAY['complaint_referrals', 'complaint_referral_evidence',
                      'complaint_referral_updates', 'pnp_referral_assignments'])
       AS expected
   WHERE to_regclass('public.' || expected) IS NULL;

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION
      'pnp-portal-04 cannot finish: these tables are missing: %. '
      'Apply pnp-portal-02-referral-schema.sql and '
      'pnp-portal-03-referral-functions.sql first.', v_missing;
  END IF;

  IF to_regprocedure('public.pnp_referral_is_visible(uuid)') IS NULL THEN
    RAISE EXCEPTION
      'pnp-portal-04 cannot finish: public.pnp_referral_is_visible(uuid) is missing. '
      'Apply pnp-portal-03-referral-functions.sql first.';
  END IF;
END
$$;


-- ── 1. complaint_referrals ──────────────────────────────────
ALTER TABLE public.complaint_referrals ENABLE ROW LEVEL SECURITY;

-- Re-running the file must not leave two policies on one table.
DROP POLICY IF EXISTS "PNP officers read assigned referrals" ON public.complaint_referrals;
DROP POLICY IF EXISTS "Referring officials read referrals" ON public.complaint_referrals;

CREATE POLICY "PNP officers read assigned referrals"
  ON public.complaint_referrals FOR SELECT
  USING (public.pnp_referral_is_visible(id));

CREATE POLICY "Referring officials read referrals"
  ON public.complaint_referrals FOR SELECT
  USING (public.is_referring_official());

-- No INSERT. The only path is pnp_create_referral().
-- No UPDATE. The only path is pnp_update_referral_status(),
--   pnp_assign_referral(), pnp_release_referral(),
--   pnp_set_external_reference(), pnp_request_referral_information()
--   or pnp_respond_to_referral_information().
-- No DELETE. A referral is part of the record. If one was created
--   in error, it is closed with a reason.


-- ── 2. complaint_referral_evidence ──────────────────────────
ALTER TABLE public.complaint_referral_evidence ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "PNP officers read shared referral evidence" ON public.complaint_referral_evidence;
DROP POLICY IF EXISTS "Referring officials read referral evidence" ON public.complaint_referral_evidence;

CREATE POLICY "PNP officers read shared referral evidence"
  ON public.complaint_referral_evidence FOR SELECT
  USING (public.pnp_referral_is_visible(referral_id));

CREATE POLICY "Referring officials read referral evidence"
  ON public.complaint_referral_evidence FOR SELECT
  USING (public.is_referring_official());

-- No INSERT: the only paths are pnp_create_referral() and
-- pnp_share_referral_evidence(). Without an INSERT policy a
-- browser cannot attach a file on its own.


-- ── 3. complaint_referral_updates ───────────────────────────
ALTER TABLE public.complaint_referral_updates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "PNP officers read referral timeline" ON public.complaint_referral_updates;
DROP POLICY IF EXISTS "Referring officials read referral timeline" ON public.complaint_referral_updates;

CREATE POLICY "PNP officers read referral timeline"
  ON public.complaint_referral_updates FOR SELECT
  USING (public.pnp_referral_is_visible(referral_id));

CREATE POLICY "Referring officials read referral timeline"
  ON public.complaint_referral_updates FOR SELECT
  USING (public.is_referring_official());

-- No INSERT, UPDATE or DELETE.
-- Every timeline row is written by a pnp_*() RPC as part of the
-- action it describes, so a client cannot backdate an entry, forge
-- an author, or remove a decision from the history.


-- ── 4. pnp_referral_assignments ─────────────────────────────
-- Officers may see their OWN assignments, which is what lets the
-- dashboard say "assigned to you" without a separate query.
-- They may not see another officer's row, nor the full roster.
ALTER TABLE public.pnp_referral_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Officers read own referral assignments" ON public.pnp_referral_assignments;
DROP POLICY IF EXISTS "Referring officials read referral assignments" ON public.pnp_referral_assignments;

CREATE POLICY "Officers read own referral assignments"
  ON public.pnp_referral_assignments FOR SELECT
  USING (officer_id = auth.uid() AND public.is_pnp_officer());

CREATE POLICY "Referring officials read referral assignments"
  ON public.pnp_referral_assignments FOR SELECT
  USING (public.is_referring_official());

-- No INSERT/UPDATE/DELETE: only pnp_assign_referral() and
-- pnp_release_referral().


-- ── 5. pnp_referral_requests: explicitly still closed ──────
--
-- pnp-portal-01 replaced the old broad staff policies with
-- captain/oic-scoped ones. This block is the assertion that the
-- PNP role was NOT added, repeated here so a future edit of this
-- file cannot open it by accident. It drops any pnp policy that a
-- previous run of this file or a hand edit may have left behind.
DROP POLICY IF EXISTS "PNP officers read referral requests" ON public.pnp_referral_requests;
DROP POLICY IF EXISTS "PNP officers update referral requests" ON public.pnp_referral_requests;
DROP POLICY IF EXISTS "PNP officers insert referral requests" ON public.pnp_referral_requests;

DO $$
DECLARE
  v_leak text;
BEGIN
  -- If any remaining policy on pnp_referral_requests mentions
  -- pnp_officer, say so loudly rather than leaving a silent hole.
  SELECT string_agg(DISTINCT policyname, ', ')
    INTO v_leak
    FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename = 'pnp_referral_requests'
     AND (qual LIKE '%pnp_officer%' OR with_check LIKE '%pnp_officer%');

  IF v_leak IS NOT NULL THEN
    RAISE EXCEPTION
      'pnp_referral_requests has policies mentioning pnp_officer (%). '
      'A pending resident request must stay invisible to the PNP portal. '
      'Remove those policies before continuing.', v_leak;
  END IF;
END
$$;


-- ── 6. Complaints stay with the barangay ────────────────────
--
-- Nothing to grant. This file intentionally contains no policy on
-- public.complaints for pnp_officer. A referral carries its own
-- snapshot columns (summary, incident_date, incident_location,
-- parties_involved) precisely so the PNP portal never has to read
-- the underlying complaint row.
--
-- Sanity check: the existing complaint policies must not have been
-- widened to include pnp_officer either.
DO $$
DECLARE
  v_leak text;
BEGIN
  SELECT string_agg(DISTINCT policyname, ', ')
    INTO v_leak
    FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename IN ('complaints', 'blotter_records',
                       'internal_notes', 'hearing_attendances',
                       'complaint_routing_history')
     AND (qual LIKE '%pnp_officer%' OR with_check LIKE '%pnp_officer%');

  IF v_leak IS NOT NULL THEN
    RAISE WARNING
      'Barangay case-file tables have policies mentioning pnp_officer: %. '
      'A PNP officer must not read the underlying case file. Review these '
      'policies.', v_leak;
  END IF;
END
$$;


-- ── Verification (read-only) ────────────────────────────────
-- Expected table policies for a PNP officer:
--
-- SELECT tablename, policyname, cmd
--   FROM pg_policies
--  WHERE schemaname = 'public'
--    AND tablename IN ('complaint_referrals',
--                      'complaint_referral_evidence',
--                      'complaint_referral_updates',
--                      'pnp_referral_assignments')
--  ORDER BY tablename, cmd, policyname;
--
-- Every cmd must be 'SELECT'. Any INSERT/UPDATE/DELETE row here is
-- a finding: it means a write path exists outside the RPCs.
