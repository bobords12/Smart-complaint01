-- ============================================================
-- kiosk-04-status-payload-null-safety.sql
--
-- FIX for a defect that broke the QR status screen.
--
-- SYMPTOM
--   Immediately after filing a complaint, both status routes returned
--   HTTP 503 and the citizen's QR code showed nothing but an error.
--   Server log:
--     [kiosk] kiosk_status_by_token failed:
--       "55000" "record \"v_mediation\" is not assigned yet"
--
-- CAUSE
--   public.kiosk_status_payload() declared three plpgsql `record`
--   variables -- v_kp, v_mediation and v_hearing -- and assigned them
--   with SELECT ... INTO.
--
--   A plpgsql `record` variable raises
--     record "v_mediation" is not assigned yet   (SQLSTATE 55000)
--   the moment any field is read from it while the variable has never
--   been the target of an *executed* SELECT INTO.
--
--   The mediation lookup sits inside:
--
--     IF v_kp.kp_applicable AND v_kp.applicability_confirmed_at IS NOT NULL THEN
--       SELECT ... INTO v_mediation ...
--     END IF;
--
--   so for any complaint that is not a confirmed KP case the SELECT
--   never ran. A newly filed complaint is by definition not yet a
--   confirmed KP case -- staff confirm applicability later -- so the
--   status page failed for exactly the people who most needed it: those
--   who had just filed.
--
--   Two further instances of the same mistake were latent rather than
--   active: `SELECT INTO v_kp` and `SELECT INTO v_hearing` also assign
--   NULL when they match no rows, and reading a field of a NULL record
--   is legal but silently yields NULL. That works today only because
--   those two SELECTs always execute. The mediation one does not.
--
-- FIX
--   Replace all three `record` variables with typed scalar columns.
--   Scalars default to NULL, so "matched no row" and "was never
--   assigned" become the same state and cannot be confused. A missing
--   mediation or hearing phase now yields JSON null, which is exactly
--   what the status screen already renders for a not-yet-scheduled
--   phase.
--
-- PRIVACY
--   Unchanged. The allow-list of resident-safe fields is identical, no
--   new column is read, and no raw token is touched. The fix only
--   changes how the same values are held in a local variable.
--
-- HOW TO APPLY
--   Run this whole file in the Supabase SQL Editor. It is idempotent.
--   Then confirm with the verification block at the bottom.
-- ============================================================

CREATE OR REPLACE FUNCTION public.kiosk_status_payload(p_complaint_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c             record;
  v_last_msg    text;
  v_last_at     timestamptz;
  v_timeline    jsonb;

  -- See the header note. Scalars, not `record`.
  v_kp_applicable      boolean;
  v_kp_confirmed_at    timestamptz;
  v_mediation_phase    public.kp_phase_type;
  v_mediation_deadline timestamptz;
  v_mediation_status   public.kp_phase_status;
  v_hearing_date       date;
  v_hearing_time       time;
  v_hearing_venue      text;
  v_hearing_status     public.hearing_status;
  v_hearing_title      text;
BEGIN
  SELECT reference_number,
         current_status,
         current_stage,
         submitted_at,
         updated_at,
         confirmed_category,
         confirmed_urgency,
         other_party_status,
         incident_ongoing,
         immediate_safety_concern,
         classification_status
    INTO c
    FROM public.complaints
   WHERE id = p_complaint_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- Most recent resident-facing wording only. changed_by is a
  -- staff user id and is never exposed.
  SELECT resident_visible_message, created_at
    INTO v_last_msg, v_last_at
    FROM public.case_statuses
   WHERE complaint_id = p_complaint_id
   ORDER BY created_at DESC, id DESC
   LIMIT 1;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'status',   cs.status,
           'stage',    coalesce(cs.stage, cs.status::text),
           'message',  cs.resident_visible_message,
           'at',       cs.created_at
         ) ORDER BY cs.created_at ASC, cs.id ASC), '[]'::jsonb)
    INTO v_timeline
    FROM public.case_statuses cs
   WHERE cs.complaint_id = p_complaint_id;

  SELECT kp_applicable, applicability_confirmed_at
    INTO v_kp_applicable, v_kp_confirmed_at
    FROM public.kp_trackers
   WHERE complaint_id = p_complaint_id;

  -- Guarded lookup, but the variables are scalars, so skipping it is
  -- harmless: they simply stay NULL.
  IF v_kp_applicable
     AND v_kp_confirmed_at IS NOT NULL THEN
    SELECT kp.phase_type, kp.deadline_date, kp.status
      INTO v_mediation_phase, v_mediation_deadline, v_mediation_status
      FROM public.kp_phases kp
      JOIN public.kp_trackers t ON t.id = kp.tracker_id
     WHERE t.complaint_id = p_complaint_id
       AND kp.phase_type IN ('Mediation', 'Conciliation')
       AND kp.start_date IS NOT NULL
     ORDER BY kp.start_date DESC
     LIMIT 1;
  END IF;

  SELECT hearing_date, hearing_time, venue, status, title
    INTO v_hearing_date, v_hearing_time, v_hearing_venue,
         v_hearing_status, v_hearing_title
    FROM public.hearings
   WHERE complaint_id = p_complaint_id
     AND status = 'Upcoming'
   ORDER BY hearing_date ASC, hearing_time ASC NULLS LAST
   LIMIT 1;

  RETURN jsonb_build_object(
    'reference_number',   c.reference_number,
    'current_status',     c.current_status,
    'current_stage',      c.current_stage,
    'submitted_at',       c.submitted_at,
    'last_updated_at',    greatest(coalesce(c.updated_at, c.submitted_at), coalesce(v_last_at, c.submitted_at)),
    'last_message',       v_last_msg,
    -- Official values only. These stay null while unconfirmed, so an
    -- unconfirmed AI suggestion can never be presented to the resident
    -- as fact.
    'confirmed_category', c.confirmed_category,
    'confirmed_urgency',  c.confirmed_urgency,
    'classification_status', c.classification_status,
    'other_party_status', c.other_party_status,
    'incident_ongoing',   c.incident_ongoing,
    'immediate_safety_concern', c.immediate_safety_concern,
    'timeline',           v_timeline,
    'is_kp_case',         coalesce(v_kp_applicable, false)
                           AND v_kp_confirmed_at IS NOT NULL,
    'mediation',          CASE WHEN v_mediation_phase IS NULL THEN NULL ELSE jsonb_build_object(
                              'phase',     v_mediation_phase,
                              'deadline',  v_mediation_deadline,
                              'status',    v_mediation_status
                            ) END,
    'next_hearing',       CASE WHEN v_hearing_date IS NULL THEN NULL ELSE jsonb_build_object(
                              'date',   v_hearing_date,
                              'time',   v_hearing_time,
                              'venue',  v_hearing_venue,
                              'status', v_hearing_status,
                              'title',  v_hearing_title
                            ) END
  );
END;

-- ============================================================
-- VERIFICATION
--
-- Run after applying. Expect one row per complaint, and NULL in the
-- mediation and hearing columns for a freshly filed complaint.
--
-- If any row errors with 55000 the function did not replace.
-- ============================================================
--
-- SELECT c.reference_number,
--        public.kiosk_status_payload(c.id) -> 'mediation'    AS mediation,
--        public.kiosk_status_payload(c.id) -> 'next_hearing' AS next_hearing,
--        public.kiosk_status_payload(c.id) -> 'is_kp_case'    AS is_kp_case
--   FROM public.complaints c
--  WHERE c.submission_channel = 'kiosk'
--  ORDER BY c.submitted_at DESC
--  LIMIT 5;
