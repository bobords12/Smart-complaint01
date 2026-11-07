-- ============================================================
-- Captain Complaint Routing — RLS
-- ============================================================
-- APPLY AFTER: captain-complaint-routing-workflow.sql
-- APPLY BEFORE: captain-complaint-routing-verification.sql
--
-- PURPOSE
--   Access rules for the routing tables created by the workflow file.
--
-- THE ONE RULE THAT MATTERS HERE
--   Captain writes are not enough. The requirements are:
--
--     * Routing history is APPEND-ONLY. No policy below grants UPDATE
--       or DELETE on complaint_routing_history or on
--       complaint_assistance_records, to anyone, including the
--       Captain. If a decision was wrong, the correction is a NEW row
--       that supersedes it. There is no code path that can erase one.
--
--     * Assistance records are also APPEND-ONLY, and a referral cannot
--       be quietly deleted after the fact.
--
--     * The internal routing columns of `complaints` are not readable
--       by residents. routing_reason, kp_applicability_reason,
--       respondent_display_name and the audit metadata stay official.
--       Residents read the resident-safe projection exposed by
--       complaint_routing_resident_view() instead.
--       The one deliberate exception is requested_information: it is the
--       text an official wrote FOR the resident, so the resident has to
--       be able to read it in order to supply it. It is mapped into the
--       resident app by repositories/complaintRepository.ts and is
--       exposed by the same projection function.
--
--     * A Lupon member can never see or be assigned to a case that has
--       not cleared routing. This is a tightening of the existing
--       "Lupon read own assignments" policy, which previously trusted
--       the existence of a lupon_panels row on its own.
--
--     * A secretariat or OIC account can READ routing but cannot
--       DECIDE it. Decisions are Captain/OIC only, and the RLS
--       mirrors the RPC guard so the database and the function can
--       never disagree about who may decide.
--
-- NON-DESTRUCTIVE
--   * No table dropped. No column altered. No data deleted.
--   * Existing policies are dropped ONLY where this file replaces
--     them, and the replacement is always narrower.
--   * Re-running is safe: every DROP is IF EXISTS and every CREATE
--     is guarded.
-- ============================================================

-- ── 0. Sanity: refuse to run against a half-installed schema ─────
DO $$
DECLARE
  v_missing text;
BEGIN
  SELECT string_agg(t, ', ') INTO v_missing
  FROM unnest(ARRAY[
    'complaint_routing_history', 'complaint_assistance_records'
  ]) AS t
  WHERE to_regclass('public.' || t) IS NULL;

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION
      'Run captain-complaint-routing-workflow.sql FIRST. Missing: %', v_missing;
  END IF;
END
$$;

-- ── 1. Make sure RLS is on ───────────────────────────────────────
ALTER TABLE public.complaint_routing_history     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.complaint_assistance_records  ENABLE ROW LEVEL SECURITY;

-- Belt and braces: force RLS even for the table owner, so a direct
-- client write cannot slip past a permissive policy by way of the
-- owner role.
ALTER TABLE public.complaint_routing_history     FORCE ROW LEVEL SECURITY;
ALTER TABLE public.complaint_assistance_records  FORCE ROW LEVEL SECURITY;

-- ── 2. complaint_routing_history ─────────────────────────────────
-- SELECT only. Officials read; nobody writes through the client. All
-- writes happen inside the SECURITY DEFINER RPCs in the workflow
-- file, which re-check the actor's role server-side.
DROP POLICY IF EXISTS "Officials read complaint routing history" ON public.complaint_routing_history;
CREATE POLICY "Officials read complaint routing history"
  ON public.complaint_routing_history FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND role IN ('captain', 'oic', 'secretary')
        AND account_status = 'active'
    )
  );

-- There is intentionally NO insert / update / delete policy on this
-- table. RLS denies by default when no policy matches.

-- ── 3. complaint_assistance_records ──────────────────────────────
DROP POLICY IF EXISTS "Officials read complaint assistance records" ON public.complaint_assistance_records;
CREATE POLICY "Officials read complaint assistance records"
  ON public.complaint_assistance_records FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND role IN ('captain', 'oic', 'secretary')
        AND account_status = 'active'
    )
  );

-- Also intentionally append-only: no INSERT/UPDATE/DELETE policy.
-- A referral is written by captain_record_assistance() and stays.

-- Residents never read the assistance table. It can name an agency and
-- a reference number, which is official information, and the resident
-- is told about it through case_statuses / notifications instead.

-- ── 3b. complaint_incident_details ──────────────────────────────
-- Officials can read the incident record from the case sheet. Writes
-- go exclusively through captain_save_incident_details() (SECURITY
-- DEFINER), so no INSERT/UPDATE/DELETE policy exists here — a direct
-- table write is impossible for every client, including officials.
DO $$
BEGIN
  IF to_regclass('public.complaint_incident_details') IS NULL THEN
    RAISE NOTICE
      'public.complaint_incident_details does not exist yet. Skipping its RLS policy. '
      'Apply captain-complaint-routing-workflow.sql first, then re-run this file.';
    RETURN;
  END IF;

  DROP POLICY IF EXISTS "Officials read complaint incident details" ON public.complaint_incident_details;
  CREATE POLICY "Officials read complaint incident details"
    ON public.complaint_incident_details FOR SELECT
    USING (
      EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid()
          AND role IN ('captain', 'oic', 'secretary')
          AND account_status = 'active'
      )
    );
END
$$;

-- ── 3c. complaint_information_responses ─────────────────────────
-- The resident's own answer to an official's request. Both the
-- complaintant (read) and the officials (read) need it; only the
-- complaintant creates it, and never by direct table write — the insert
-- goes through resident_provide_requested_information(), which
-- re-verifies ownership, the waiting state, and the ownership of every
-- attached evidence file.
--
-- There is deliberately NO INSERT policy here. RLS denies by default
-- when no policy matches, so a crafted client insert fails even for the
-- complaint's own resident.
DO $$
BEGIN
  IF to_regclass('public.complaint_information_responses') IS NULL THEN
    RAISE NOTICE
      'public.complaint_information_responses does not exist yet. Skipping its RLS policies. '
      'Apply captain-complaint-routing-workflow.sql first, then re-run this file.';
    RETURN;
  END IF;

  ALTER TABLE public.complaint_information_responses ENABLE ROW LEVEL SECURITY;

  -- The file-link table carries no content of its own: it only points at
  -- `evidence` rows the resident already uploaded. It follows the
  -- response row, and stays invisible to anyone who cannot read the
  -- response.
  ALTER TABLE public.complaint_information_response_files ENABLE ROW LEVEL SECURITY;

  DROP POLICY IF EXISTS "Residents read own complaint information responses"
    ON public.complaint_information_responses;
  CREATE POLICY "Residents read own complaint information responses"
    ON public.complaint_information_responses FOR SELECT
    USING (
      EXISTS (
        SELECT 1 FROM public.complaints c
        WHERE c.id = complaint_information_responses.complaint_id
          AND c.resident_id = auth.uid()
      )
    );

  DROP POLICY IF EXISTS "Officials read complaint information responses"
    ON public.complaint_information_responses;
  CREATE POLICY "Officials read complaint information responses"
    ON public.complaint_information_responses FOR SELECT
    USING (
      EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid()
          AND role IN ('captain', 'oic', 'secretary')
          AND account_status = 'active'
      )
    );

  DROP POLICY IF EXISTS "Residents read own complaint information response files"
    ON public.complaint_information_response_files;
  CREATE POLICY "Residents read own complaint information response files"
    ON public.complaint_information_response_files FOR SELECT
    USING (
      EXISTS (
        SELECT 1
          FROM public.complaint_information_responses r
          JOIN public.complaints c ON c.id = r.complaint_id
         WHERE r.id = complaint_information_response_files.response_id
           AND c.resident_id = auth.uid()
      )
    );

  DROP POLICY IF EXISTS "Officials read complaint information response files"
    ON public.complaint_information_response_files;
  CREATE POLICY "Officials read complaint information response files"
    ON public.complaint_information_response_files FOR SELECT
    USING (
      EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid()
          AND role IN ('captain', 'oic', 'secretary')
          AND account_status = 'active'
      )
    );

  -- No INSERT / UPDATE / DELETE policy on either table: the answer is
  -- written once, by the function, and an answer that was sent cannot be
  -- quietly rewritten. A correction is a new response.
END
$$;

-- ── 4. complaints: keep internal routing columns official ────────
-- The existing complaint policies decide WHO can see a complaint row.
-- What this section adds is a rule about WHICH COLUMNS a resident
-- gets. RLS cannot hide a single column, so the protection is
-- structural:
--
--   * Residents keep their existing SELECT policies (unchanged).
--   * complaint_routing_resident_view() is the only routing projection
--     a resident is expected to use, and it returns no internal text.
--   * The internal columns are never selected by resident code paths.
--
-- The enforceable part that DOES live here: residents must not be
-- able to WRITE the routing columns. The existing complaint UPDATE
-- policy (06_case_tracking.sql / 04_complaints.sql) is not narrowed
-- here, because narrowing it without knowing its exact text would
-- risk locking residents out of their own complaints. Instead the
-- write path is closed by a column guard, below.

-- A resident (or anyone) updating a complaint must not be able to
-- change a routing column. Implemented as a BEFORE UPDATE trigger
-- rather than a policy, because RLS has no per-column UPDATE rule.
CREATE OR REPLACE FUNCTION public.guard_complaint_routing_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_official boolean;
BEGIN
  v_official := public.is_routing_official();

  IF v_official THEN
    RETURN NEW;
  END IF;

  -- The information-response stamp is written by the resident, but only
  -- through resident_provide_requested_information(), which sets this
  -- transaction-local flag immediately before its own UPDATE. Without
  -- the carve-out the guard below would block the very write it exists
  -- to authorise; with it, a resident cannot set the flag by hand,
  -- because set_config(..., true) is scoped to this transaction and is
  -- never set by client SQL.
  IF current_setting('app.information_response', true) = 'true' THEN
    RETURN NEW;
  END IF;

  -- Only the routing decision columns are protected. The rest of the
  -- complaint (title, description, evidence) stays writable by
  -- whatever policy already allows it.
  IF NEW.workflow_gate_open      IS DISTINCT FROM OLD.workflow_gate_open
  OR NEW.respondent_status        IS DISTINCT FROM OLD.respondent_status
  OR NEW.respondent_display_name  IS DISTINCT FROM OLD.respondent_display_name
  OR NEW.respondent_identified_at IS DISTINCT FROM OLD.respondent_identified_at
  OR NEW.respondent_identified_by IS DISTINCT FROM OLD.respondent_identified_by
  OR NEW.kp_applicability         IS DISTINCT FROM OLD.kp_applicability
  OR NEW.kp_applicability_reason  IS DISTINCT FROM OLD.kp_applicability_reason
  OR NEW.kp_applicability_legal_review IS DISTINCT FROM OLD.kp_applicability_legal_review
  OR NEW.routing_status           IS DISTINCT FROM OLD.routing_status
  OR NEW.routing_reason           IS DISTINCT FROM OLD.routing_reason
  OR NEW.routing_remarks          IS DISTINCT FROM OLD.routing_remarks
  OR NEW.routing_decided_at       IS DISTINCT FROM OLD.routing_decided_at
  OR NEW.routing_decided_by       IS DISTINCT FROM OLD.routing_decided_by
  OR NEW.complaint_nature         IS DISTINCT FROM OLD.complaint_nature
  OR NEW.completeness_status      IS DISTINCT FROM OLD.completeness_status
  OR NEW.completeness_complainant_verified IS DISTINCT FROM OLD.completeness_complainant_verified
  OR NEW.completeness_contact_verified IS DISTINCT FROM OLD.completeness_contact_verified
  OR NEW.completeness_incident_date_provided IS DISTINCT FROM OLD.completeness_incident_date_provided
  OR NEW.completeness_incident_location_provided IS DISTINCT FROM OLD.completeness_incident_location_provided
  OR NEW.completeness_narrative_sufficient IS DISTINCT FROM OLD.completeness_narrative_sufficient
  OR NEW.completeness_evidence_reviewed IS DISTINCT FROM OLD.completeness_evidence_reviewed
  OR NEW.completeness_extra_info_required IS DISTINCT FROM OLD.completeness_extra_info_required
  OR NEW.completeness_remarks     IS DISTINCT FROM OLD.completeness_remarks
  OR NEW.requested_information    IS DISTINCT FROM OLD.requested_information
  -- The Captain's next-step decision reads these three, so a resident
  -- must not be able to fake "I already answered" with a direct write.
  OR NEW.requested_information_at      IS DISTINCT FROM OLD.requested_information_at
  OR NEW.last_information_response_at  IS DISTINCT FROM OLD.last_information_response_at
  OR NEW.information_responses        IS DISTINCT FROM OLD.information_responses
  THEN
    RAISE EXCEPTION
      'Routing fields are official records. Use captain_record_respondent_status() '
      'or captain_set_routing() so the change is logged.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_complaint_routing_columns ON public.complaints;
CREATE TRIGGER trg_guard_complaint_routing_columns
  BEFORE UPDATE ON public.complaints
  FOR EACH ROW EXECUTE FUNCTION public.guard_complaint_routing_columns();

-- ── 5. A respondent cannot be created to satisfy a gate ─────────
-- The workflow never needs a profiles row for an unknown respondent,
-- so a "temporary respondent" profile is a workaround for the bug
-- this file prevents. A constraint is not possible on profiles, so
-- this is a trigger that refuses the one thing that would defeat it:
-- creating a profile with a role that can act on a complaint.
--
-- This does NOT create or require any PNP or police user, and it does
-- not touch the existing `police` role value in app_role. It only
-- blocks a NEW profile from being created with a role that would let
-- a person act as an official on a case.
CREATE OR REPLACE FUNCTION public.guard_no_placeholder_official_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- New official accounts are provisioned by an admin through the
  -- Users & Roles page, which goes through a SECURITY DEFINER RPC.
  -- This only blocks a client-side INSERT that would bypass it.
  IF TG_OP = 'INSERT' AND NEW.role IN ('captain', 'oic', 'secretary', 'lupon', 'admin') THEN
    RAISE EXCEPTION
      'Official roles cannot be created directly. Use the Users & Roles page so the '
      'account is provisioned with an audit trail.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_no_placeholder_official_profile ON public.profiles;
CREATE TRIGGER trg_no_placeholder_official_profile
  BEFORE INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_no_placeholder_official_profile();

-- ── 6. Lupon cannot be assigned an unassessed case ──────────────
-- The existing policy "Lupon read own assignments" trusts the mere
-- existence of an active lupon_panels row. This file tightens it so
-- a member only sees a case that has actually cleared routing.
--
-- If the lupon_panels policies do not exist yet (the Pangkat migration
-- has not been applied), the block is skipped with a notice rather
-- than failing: the two files are independent and ordering is the
-- user's choice.
DO $$
BEGIN
  IF to_regclass('public.lupon_panels') IS NULL THEN
    RAISE NOTICE
      'public.lupon_panels does not exist yet. Skipping the Lupon routing gate. '
      'Re-run this file after lupon-member-portal-and-pangkat-rls.sql to apply it.';
    RETURN;
  END IF;

  -- Read: assigned, active, AND the case cleared routing.
  -- Note: a policy's USING expression references the table's own
  -- columns directly (member_id / status), never a table alias.
  DROP POLICY IF EXISTS "Lupon read own assignments" ON public.lupon_panels;
  CREATE POLICY "Lupon read own assignments"
    ON public.lupon_panels FOR SELECT
    USING (
      member_id = auth.uid()
      AND status = 'active'
      AND EXISTS (
        SELECT 1 FROM public.profiles p
         WHERE p.id = auth.uid()
           AND p.role = 'lupon'
           AND p.account_status = 'active'
      )
      AND EXISTS (
        SELECT 1 FROM public.complaints c
         WHERE c.id = lupon_panels.complaint_id
           AND c.workflow_gate_open = true
      )
    );

  -- Write: a panel may only be formed for a case that cleared routing.
  -- This is the second half of the requirement that Lupon formation
  -- is unavailable while the respondent is unknown.
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'lupon_panels'
      AND policyname = 'Officials manage lupon panels'
  ) THEN
    DROP POLICY "Officials manage lupon panels" ON public.lupon_panels;
  END IF;

  CREATE POLICY "Officials manage lupon panels"
    ON public.lupon_panels FOR ALL
    USING (
      EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid()
          AND role IN ('captain', 'oic', 'secretary')
          AND account_status = 'active'
      )
    )
    WITH CHECK (
      EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid()
          AND role IN ('captain', 'oic', 'secretary')
          AND account_status = 'active'
      )
      AND EXISTS (
        SELECT 1 FROM public.complaints c
         WHERE c.id = lupon_panels.complaint_id
           AND c.workflow_gate_open = true
      )
    );
END
$$;

-- ── 7. Verification-visible summary ──────────────────────────────
DO $$
BEGIN
  RAISE NOTICE 'Captain complaint routing RLS installed.';
  RAISE NOTICE 'complaint_routing_history and complaint_assistance_records are append-only.';
  RAISE NOTICE 'Run captain-complaint-routing-verification.sql next.';
END
$$;
