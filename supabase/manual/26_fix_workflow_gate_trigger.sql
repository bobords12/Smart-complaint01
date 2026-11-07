-- ============================================================
-- 26_fix_workflow_gate_trigger.sql
-- Purpose: Repair public.guard_complaint_workflow_gate(), which made every
--          insert into hearings / summons / lupon_panels / kp_phases fail.
--
-- THE BUG
--   captain-complaint-routing-workflow.sql:581 declared:
--
--     v_complaint := COALESCE(NEW.complaint_id, NEW.tracker_id, NEW.member_id);
--
--   One function is attached to four tables that do NOT share a column
--   layout:
--
--     hearings      -> complaint_id
--     summons       -> complaint_id
--     lupon_panels  -> complaint_id, member_id
--     kp_phases     -> tracker_id
--
--   In PL/pgSQL, NEW is a record whose fields are resolved at RUNTIME.
--   COALESCE evaluates every argument, so the moment the trigger fired on
--   a row from any of those tables, Postgres raised:
--
--     ERROR:  42703: record "new" has no field "tracker_id"
--     CONTEXT: PL/pgSQL assignment
--               "v_complaint := COALESCE(NEW.complaint_id, NEW.tracker_id, NEW.member_id)"
--
--   That aborted the INSERT. The gate check never even ran, so it failed
--   for EVERY complaint, whether the routing gate was open or closed.
--
--   Reproduced against the live project before this fix:
--     INSERT INTO hearings  ... -> 42703 (no field "tracker_id")
--     INSERT INTO kp_phases ... -> 42703 (no field "complaint_id")
--     INSERT INTO lupon_panels ... -> 42703 (no field "tracker_id")
--   public.hearings held 0 rows as a result.
--
-- WHY IT WAS NOT VISIBLE
--   SummonsTracker.handleSchedule() caught the error with a bare
--   `catch { toast.error("Could not schedule the hearing.") }`, so the
--   Captain saw a generic failure and no cause.
--
-- THE FIX
--   Read the incoming row through to_jsonb(NEW) instead of through typed
--   field references. to_jsonb works on any table, so a missing key simply
--   yields NULL rather than raising 42703. The gate semantics are
--   unchanged: still refuses only when workflow_gate_open IS FALSE, with
--   the same SQLSTATE (23514) and the same message.
--
-- SAFETY
--   Additive and idempotent. No table, column, index or policy is touched.
--   No existing row is modified or deleted. CREATE OR REPLACE only
--   redefines the function body, so the four attached triggers keep
--   working without being recreated.
--
-- HOW TO APPLY
--   1. Supabase Dashboard > SQL Editor
--   2. Paste this whole file
--   3. Run
--   4. Run the SECTION 3 verification query; expect "insert path OK"
-- ============================================================

-- ── 1. Repaired guard function (idempotent) ────────────────────

CREATE OR REPLACE FUNCTION public.guard_complaint_workflow_gate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_complaint uuid;
  v_open boolean;
  v_ref text;
  v_respondent text;
  v_kp text;
BEGIN
  -- to_jsonb(NEW) is the whole incoming row as JSON, so a column this
  -- particular table does not have comes back as a missing key (-> NULL)
  -- instead of aborting the statement. Direct NEW.<column> references
  -- cannot be used here: they are resolved per-table at runtime.
  v_complaint := NULLIF(to_jsonb(NEW) ->> 'complaint_id', '')::uuid;

  -- kp_phases points at its complaint through kp_trackers.
  IF v_complaint IS NULL THEN
    SELECT kt.complaint_id INTO v_complaint
    FROM public.kp_trackers kt
    WHERE kt.id = NULLIF(to_jsonb(NEW) ->> 'tracker_id', '')::uuid;
  END IF;

  IF v_complaint IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT c.workflow_gate_open, c.reference_number,
         c.respondent_status, c.kp_applicability
    INTO v_open, v_ref, v_respondent, v_kp
  FROM public.complaints c
   WHERE c.id = v_complaint
     FOR SHARE;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF v_open THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'This complaint cannot proceed to a summons, hearing, Lupon or 15-day period yet. '
    'Complete routing assessment first (respondent status, then KP applicability). '
    'Complaint: %, respondent: %, KP: %.',
    COALESCE(v_ref, v_complaint::text),
    COALESCE(v_respondent, 'unknown'),
    COALESCE(v_kp, 'unknown')
    USING ERRCODE = 'check_violation';
END;
$$;

COMMENT ON FUNCTION public.guard_complaint_workflow_gate() IS
  'Refuses a summons/hearing/Lupon/15-day row only while the complaint''s routing gate is closed. Reads NEW via to_jsonb so it is safe on tables with different column layouts.';

-- ── 2. The four triggers are unchanged and still attached ──────
-- No re-create needed: CREATE OR REPLACE keeps the same function
-- identity, so trg_complaint_workflow_gate keeps resolving to the new
-- body. Recreating them anyway would be a no-op, so it is not done.

-- ── 3. Verification ────────────────────────────────────────────
-- Rolls back, so it leaves no test rows behind.

DO $$
DECLARE
  v_id uuid;
BEGIN
  SELECT id INTO v_id
  FROM public.complaints
  WHERE workflow_gate_open
  LIMIT 1;

  IF v_id IS NULL THEN
    RAISE NOTICE 'SKIPPED: no complaint with an open routing gate.';
    RETURN;
  END IF;

  BEGIN
    INSERT INTO public.hearings
      (complaint_id, hearing_type, title, hearing_date, hearing_time, venue, status)
    VALUES
      (v_id, 'Mediation', '__gate_verification__', CURRENT_DATE, '09:00:00',
       'Barangay Abuno Hall', 'Upcoming');

    INSERT INTO public.summons
      (complaint_id, storage_path)
    VALUES
      (v_id, '__gate_verification__');

    DELETE FROM public.summons WHERE storage_path = '__gate_verification__';
    DELETE FROM public.hearings WHERE title = '__gate_verification__';

    RAISE NOTICE 'insert path OK (hearings + summons accepted and cleaned up)';
  EXCEPTION WHEN others THEN
    RAISE NOTICE 'insert path FAILED: % %', SQLSTATE, SQLERRM;
  END;
END
$$;

-- ── 4. Confirm the function body in use ────────────────────────

SELECT
  (SELECT count(*) FROM public.hearings WHERE title = '__gate_verification__') AS leftover_hearings,
  (SELECT count(*) FROM public.summons WHERE storage_path = '__gate_verification__') AS leftover_summons;