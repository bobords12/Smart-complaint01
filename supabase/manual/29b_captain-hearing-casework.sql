-- ============================================================
-- 29b_captain-hearing-casework.sql
--
-- PURPOSE
--   Give the Captain Portal a truthful, auditable mediation-hearing
--   lifecycle:
--
--     scheduled -> attendance recorded -> meeting record -> outcome
--     -> next action
--
--   Every rung is backed by a persisted record. Nothing is inferred
--   from a schedule, a date, or a login, and no legal rule is applied
--   by the database.
--
-- WHAT WAS WRONG
--   1. hearings.status could only be 'Completed', and nothing in the
--      schema required a meeting record before a hearing could be
--      treated as over. The Captain UI therefore marked a hearing
--      completed as a side effect of saving attendance.
--   2. hearing_minutes had no way to say whether the meeting actually
--      happened, and no way to hold the outcome of that meeting.
--   3. hearings had no cancellation reason and no reschedule links, so
--      a reschedule had to overwrite the original row and a
--      cancellation had to discard why it happened.
--   4. summons_service_records had no acknowledgment fields, so
--      "acknowledged" could only be guessed at from free text.
--   5. hearing_attendances could not express "Not recorded", which is
--      the state every hearing starts in.
--
-- ORDER
--   Run AFTER 28 (lupon-member-portal-and-pangkat-rls.sql), because
--   hearing_minutes and public.is_active_official() are created there.
--
-- TWO RUNS REQUIRED
--   SECTION H writes the literal status = 'Held'. PostgreSQL refuses to
--   let a value added to an enum type be USED in the same transaction
--   that added it, and that value cannot be added here without
--   breaking this file. So:
--
--   1. Run 29a_hearing_status-held-enum.sql, and let it commit.
--   2. Run this whole file.
--   3. Optionally run the SECTION J backfill as a separate statement.
--
--   Comparisons inside the functions are still written as
--   `status::text = '...'` where a comparison is what is needed. That is
--   for readability against the text comparisons used for the other
--   statuses, not for transaction safety.
--
-- SAFETY
--   Additive and idempotent. No table, column, index or policy is
--   dropped. One column is widened (the attendance_status CHECK) and
--   one row set is updated (SECTION J, optional). Safe to re-run.
-- ============================================================


-- ============================================================
-- SECTION B. hearings: why a session changed, and what replaced it
-- ============================================================

ALTER TABLE public.hearings
  ADD COLUMN IF NOT EXISTS cancel_reason      text,
  ADD COLUMN IF NOT EXISTS rescheduled_from_id uuid REFERENCES public.hearings(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS rescheduled_to_id   uuid REFERENCES public.hearings(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.hearings.cancel_reason IS
  'Why a hearing was cancelled. Required whenever status = ''Cancelled''.';
COMMENT ON COLUMN public.hearings.rescheduled_from_id IS
  'The superseded hearing this row replaced. Set on the NEW row.';
COMMENT ON COLUMN public.hearings.rescheduled_to_id IS
  'The replacement hearing created for this row. Set on the OLD row.';

CREATE INDEX IF NOT EXISTS idx_hearings_rescheduled_from
  ON public.hearings (rescheduled_from_id)
  WHERE rescheduled_from_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_hearings_rescheduled_to
  ON public.hearings (rescheduled_to_id)
  WHERE rescheduled_to_id IS NOT NULL;


-- ============================================================
-- SECTION C. hearing_minutes becomes the Meeting Record
-- ============================================================
--
-- The Captain's Meeting Record is one row here, per hearing:
--
--   conducted            did the meeting actually take place
--   outcome              what was decided, if anything
--   outcome_explanation  required when outcome = 'Other'
--   narrative            the minutes
--   agreements           what the parties agreed to
--   next_step            what happens after this meeting
--   document_id          the optional attached official document
--   author_id            the authenticated recording official
--
-- status stays in the existing Draft -> Submitted -> Attested -> Final
-- review lifecycle. A Captain save writes 'Draft', so the record is
-- persisted and honest about not having been attested yet, and the
-- existing one-live-record-per-hearing index
-- (idx_hearing_minutes_one_live_per_hearing, WHERE status <> 'Final')
-- still applies.
-- ============================================================

ALTER TABLE public.hearing_minutes
  ADD COLUMN IF NOT EXISTS conducted           text NOT NULL DEFAULT 'Not recorded',
  ADD COLUMN IF NOT EXISTS outcome             text,
  ADD COLUMN IF NOT EXISTS outcome_explanation text,
  ADD COLUMN IF NOT EXISTS document_id         uuid REFERENCES public.official_documents(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.hearing_minutes.conducted IS
  'Whether the meeting actually took place. ''Not recorded'' is the default and is never an inference.';
COMMENT ON COLUMN public.hearing_minutes.outcome IS
  'Outcome of the meeting: Settled / No settlement / Continued / Party failed to appear / Other.';
COMMENT ON COLUMN public.hearing_minutes.outcome_explanation IS
  'Required when outcome = ''Other''. Never a legal conclusion the system reaches on its own.';

-- ── C1. conducted vocabulary ────────────────────────────────────
-- Constraint names are dropped first so this block is re-runnable.
ALTER TABLE public.hearing_minutes
  DROP CONSTRAINT IF EXISTS hearing_minutes_conducted_check;

ALTER TABLE public.hearing_minutes
  ADD CONSTRAINT hearing_minutes_conducted_check
  CHECK (conducted IN ('Yes', 'No', 'Not recorded'));

-- ── C2. outcome vocabulary ──────────────────────────────────────
ALTER TABLE public.hearing_minutes
  DROP CONSTRAINT IF EXISTS hearing_minutes_outcome_check;

ALTER TABLE public.hearing_minutes
  ADD CONSTRAINT hearing_minutes_outcome_check
  CHECK (
    outcome IS NULL
    OR outcome IN (
      'Settled',
      'No settlement',
      'Continued',
      'Party failed to appear',
      'Other'
    )
  );

-- ── C3. 'Other' must be explained ───────────────────────────────
ALTER TABLE public.hearing_minutes
  DROP CONSTRAINT IF EXISTS hearing_minutes_other_explained_check;

ALTER TABLE public.hearing_minutes
  ADD CONSTRAINT hearing_minutes_other_explained_check
  CHECK (
    outcome IS DISTINCT FROM 'Other'
    OR btrim(COALESCE(outcome_explanation, '')) <> ''
  );

-- ── C4. a meeting that happened must say what came of it ───────
-- Nothing is recorded as conducted without an outcome, so a Held
-- hearing can never be a hearing with no recorded result.
ALTER TABLE public.hearing_minutes
  DROP CONSTRAINT IF EXISTS hearing_minutes_conducted_needs_outcome_check;

ALTER TABLE public.hearing_minutes
  ADD CONSTRAINT hearing_minutes_conducted_needs_outcome_check
  CHECK (
    conducted <> 'Yes'
    OR btrim(COALESCE(outcome, '')) <> ''
  );

-- ── C5. a meeting that did not happen has no outcome ───────────
-- The inverse of C4, and the rule that stops the system from
-- recording an agreement for a session that never occurred.
ALTER TABLE public.hearing_minutes
  DROP CONSTRAINT IF EXISTS hearing_minutes_not_conducted_no_outcome_check;

ALTER TABLE public.hearing_minutes
  ADD CONSTRAINT hearing_minutes_not_conducted_no_outcome_check
  CHECK (
    conducted = 'Yes'
    OR outcome IS NULL
  );


-- ============================================================
-- SECTION D. Service acknowledgment is recorded, not guessed
-- ============================================================
--
-- Before this, "acknowledged" was inferred by searching the free-text
-- notes and mode_of_service for words like "received" or "signed".
-- That both missed real acknowledgments and invented false ones.
-- ============================================================

ALTER TABLE public.summons_service_records
  ADD COLUMN IF NOT EXISTS acknowledged_on date,
  ADD COLUMN IF NOT EXISTS acknowledged_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.summons_service_records.acknowledged_on IS
  'Date the recipient acknowledged receipt. NULL means not acknowledged. Never inferred from free text.';
COMMENT ON COLUMN public.summons_service_records.acknowledged_by IS
  'The official who recorded the acknowledgment.';

-- Both or neither: an acknowledgment with no recorder is not a fact.
ALTER TABLE public.summons_service_records
  DROP CONSTRAINT IF EXISTS summons_service_records_ack_fields_check;

ALTER TABLE public.summons_service_records
  ADD CONSTRAINT summons_service_records_ack_fields_check
  CHECK (
    (acknowledged_on IS NULL AND acknowledged_by IS NULL)
    OR (acknowledged_on IS NOT NULL AND acknowledged_by IS NOT NULL)
  );


-- ============================================================
-- SECTION E. Attendance can say "Not recorded"
-- ============================================================
--
-- Every hearing starts here. The old CHECK could only hold Present,
-- Absent, Late or Excused, so there was no way to record that nothing
-- had been recorded yet -- and the UI filled that gap by defaulting to
-- Present.
--
-- SPELLING, and why both are allowed
--   Migration 28 (lupon_record_attendance) writes 'Not Recorded' with
--   a capital R. Dropping that spelling would break the Lupon write
--   path, and rewriting the existing rows would edit historical data
--   during a migration that is supposed to be additive. So the CHECK
--   accepts BOTH spellings, existing rows are left exactly as they are,
--   and the reading layer treats them as the same state. New Captain
--   writes use 'Not recorded'.
--
--   'Late' is kept because rows already use it, and it still means the
--   party was in the room.
-- ============================================================

ALTER TABLE public.hearing_attendances
  DROP CONSTRAINT IF EXISTS hearing_attendances_attendance_status_check;

ALTER TABLE public.hearing_attendances
  ADD CONSTRAINT hearing_attendances_attendance_status_check
  CHECK (
    attendance_status IS NULL
    OR attendance_status IN ('Present', 'Absent', 'Late', 'Excused',
                             'Not recorded', 'Not Recorded')
  );

-- An excused party has to say why. This was only enforced inside the
-- Lupon RPC, so a direct write could record "Excused" with no reason.
ALTER TABLE public.hearing_attendances
  DROP CONSTRAINT IF EXISTS hearing_attendances_excused_reason_check;

ALTER TABLE public.hearing_attendances
  ADD CONSTRAINT hearing_attendances_excused_reason_check
  CHECK (
    attendance_status IS DISTINCT FROM 'Excused'
    OR btrim(COALESCE(excuse_reason, '')) <> ''
  );


-- ── E2. `attended` stops disagreeing with `attendance_status` ──
--
-- Migration 28 defines hearing_attendance_sync_attended() as
--
--   NEW.attended := COALESCE(NEW.attendance_status, 'Not Recorded') = 'Present';
--
-- which is wrong in two ways:
--
--   * 'Late' means the party WAS in the room, so it set attended =
--     false, contradicting the status written beside it
--   * an unrecognised or NULL status set attended = false, so a row
--     nobody had recorded anything about read as a recorded absence
--
-- The boolean is a derived mirror, so it is redefined here to match the
-- status instead of overriding it. Nothing in the Captain workflow reads
-- `attended`; it is kept only so older code keeps working.
CREATE OR REPLACE FUNCTION public.hearing_attendance_sync_attended()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.attended := COALESCE(NEW.attendance_status, 'Not recorded') IN ('Present', 'Late');
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.hearing_attendance_sync_attended() IS
  'Keeps the legacy `attended` boolean consistent with attendance_status. Present and Late mean the party was in the room; nothing else does.';


-- ============================================================
-- SECTION F. A real 'viewed' event on a document
-- ============================================================
--
-- "Digital Copy Viewed" was previously hardcoded to false. It can
-- only be truthfully true when someone actually opened the document,
-- so it is read from a recorded lifecycle event instead of guessed.
--
-- Adding the value here only makes the event writable when the
-- resident-side tracking lands; nothing in this file records a view,
-- and no Resident Portal code is touched.
-- ============================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.document_lifecycle_events'::regclass
      AND conname = 'document_lifecycle_events_event_type_check'
  ) THEN
    ALTER TABLE public.document_lifecycle_events
      DROP CONSTRAINT document_lifecycle_events_event_type_check;

    ALTER TABLE public.document_lifecycle_events
      ADD CONSTRAINT document_lifecycle_events_event_type_check
      CHECK (
        event_type IN ('prepared', 'authorized', 'signed', 'served',
                       'received', 'finalized', 'archived',
                       'superseded', 'released', 'uploaded', 'rejected',
                       'viewed')
      );
  END IF;
END
$$;


-- ============================================================
-- SECTION G. The lifecycle rules the database enforces
-- ============================================================
--
-- These are deliberately in the database rather than in the UI. The
-- bug this migration exists to fix was a UI that marked a hearing
-- completed as a side effect of saving attendance; a rule that lives
-- only in a component can be bypassed by the next component.
--
-- 'Held' already exists in the enum by the time this file runs - see
-- 29a_hearing_status-held-enum.sql - so these functions may assign it
-- directly.
-- ============================================================

CREATE OR REPLACE FUNCTION public.hearings_guard_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- A cancellation has to say why. Without this, "Cancelled" is a
  -- status and not a record.
  IF NEW.status::text = 'Cancelled'
     AND btrim(COALESCE(NEW.cancel_reason, '')) = '' THEN
    RAISE EXCEPTION
      'A cancelled hearing needs a recorded reason.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- A reschedule has to point at its replacement, so the original date
  -- stays in the record instead of being overwritten.
  IF NEW.status::text = 'Rescheduled'
     AND NEW.rescheduled_to_id IS NULL THEN
    RAISE EXCEPTION
      'A rescheduled hearing must point at the replacement hearing that replaced it.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- 'Held' is a claim about reality, so it requires a saved meeting
  -- record that says the meeting took place. This is the rule the old
  -- code broke by setting status on the way out of an attendance save.
  IF NEW.status::text = 'Held'
     AND NOT EXISTS (
       SELECT 1
       FROM public.hearing_minutes m
       WHERE m.hearing_id = NEW.id
         AND m.conducted = 'Yes'
     ) THEN
    RAISE EXCEPTION
      'A hearing can only be marked Held after a meeting record has been saved with Meeting Conducted = Yes.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.hearings_guard_lifecycle() IS
  'Requires a reason for a cancellation, a replacement for a reschedule, and a real meeting record before a hearing may be Held.';

DROP TRIGGER IF EXISTS trg_hearings_guard_lifecycle ON public.hearings;
CREATE TRIGGER trg_hearings_guard_lifecycle
  BEFORE INSERT OR UPDATE OF status, cancel_reason, rescheduled_to_id
    ON public.hearings
  FOR EACH ROW
  EXECUTE FUNCTION public.hearings_guard_lifecycle();


-- ============================================================
-- SECTION H. RPCs
-- ============================================================
--
-- SECURITY DEFINER, so each lifecycle step is one transaction:
-- a meeting record and the hearing status it justifies cannot end up
-- half-written, and a client cannot write one without the other.
-- ============================================================

-- ── H1. captain_save_meeting_record ────────────────────────────
--
-- Saves the whole Meeting Record in one call:
--
--   attendance  jsonb array, one object per party:
--               { "party_role":     "complainant",
--                 "attendee_label": "…",
--                 "attendance_status": "Present" | "Absent" |
--                                      "Excused" | "Not recorded",
--                 "excuse_reason":  "…" }
--
-- Rules enforced here:
--   * a missing attendance_status is stored as 'Not recorded', never
--     as 'Present'
--   * 'Excused' requires a reason
--   * conducted = 'Yes' requires an outcome
--   * conducted = 'Yes' is the ONLY thing that sets status to 'Held'
--   * conducted <> 'Yes' leaves the hearing status alone
--   * a Finalised record is never overwritten
--   * a Cancelled or already-Rescheduled hearing cannot be recorded
CREATE OR REPLACE FUNCTION public.captain_save_meeting_record(
  p_hearing_id          uuid,
  p_conducted           text,
  p_outcome             text DEFAULT NULL,
  p_outcome_explanation text DEFAULT NULL,
  p_minutes             text DEFAULT NULL,
  p_agreements          text DEFAULT NULL,
  p_next_step           text DEFAULT NULL,
  p_attendance          jsonb  DEFAULT '[]'::jsonb,
  p_document_id         uuid   DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hearing   public.hearings%ROWTYPE;
  v_minutes   public.hearing_minutes%ROWTYPE;
  v_actor     uuid := auth.uid();
  v_entry     jsonb;
  v_status    text;
  v_label     text;
  v_reason    text;
  v_against   uuid;
  v_written   integer := 0;
BEGIN
  IF NOT public.is_active_official() THEN
    RAISE EXCEPTION 'Only an active barangay official can record a meeting.'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_hearing
  FROM public.hearings
  WHERE id = p_hearing_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'That hearing no longer exists on this case.'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_hearing.status::text IN ('Cancelled', 'Rescheduled') THEN
    RAISE EXCEPTION
      'This hearing is % and cannot take a meeting record. Schedule a replacement hearing first.',
      v_hearing.status::text
      USING ERRCODE = 'check_violation';
  END IF;

  -- ── conducted ────────────────────────────────────────────────
  IF p_conducted IS NULL
     OR p_conducted NOT IN ('Yes', 'No', 'Not recorded') THEN
    RAISE EXCEPTION 'Meeting Conducted must be Yes, No, or Not recorded.'
      USING ERRCODE = '22023';
  END IF;

  -- ── outcome ──────────────────────────────────────────────────
  IF p_outcome IS NOT NULL
     AND p_outcome NOT IN ('Settled', 'No settlement', 'Continued',
                           'Party failed to appear', 'Other') THEN
    RAISE EXCEPTION 'That is not a meeting outcome this system records.'
      USING ERRCODE = '22023';
  END IF;

  IF p_outcome = 'Other'
     AND btrim(COALESCE(p_outcome_explanation, '')) = '' THEN
    RAISE EXCEPTION 'An outcome of Other needs an explanation.'
      USING ERRCODE = '22023';
  END IF;

  IF p_conducted = 'Yes' AND btrim(COALESCE(p_outcome, '')) = '' THEN
    RAISE EXCEPTION 'A meeting that was conducted needs a recorded outcome.'
      USING ERRCODE = '22023';
  END IF;

  IF p_conducted <> 'Yes' AND p_outcome IS NOT NULL THEN
    RAISE EXCEPTION
      'A meeting that was not conducted cannot have an outcome.'
      USING ERRCODE = '22023';
  END IF;

  -- ── the optional attached document must belong to this case ──
  IF p_document_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.official_documents d
      WHERE d.id = p_document_id
        AND d.complaint_id = v_hearing.complaint_id
    ) THEN
      RAISE EXCEPTION 'That document does not belong to this complaint.'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  -- ── upsert the meeting record ────────────────────────────────
  SELECT * INTO v_minutes
  FROM public.hearing_minutes
  WHERE hearing_id = p_hearing_id
    AND status <> 'Final'
  FOR UPDATE;

  IF FOUND AND v_minutes.id IS NOT NULL THEN
    -- The existing Final immutability trigger also guards this, but the
    -- error is raised here so the officer is told what to do.
    IF v_minutes.status = 'Final' THEN
      RAISE EXCEPTION
        'This meeting record has been finalised and cannot be changed. Record a new hearing instead.'
        USING ERRCODE = 'check_violation';
    END IF;

    UPDATE public.hearing_minutes
       SET conducted           = p_conducted,
           outcome             = p_outcome,
           outcome_explanation = NULLIF(btrim(COALESCE(p_outcome_explanation, '')), ''),
           narrative           = NULLIF(btrim(COALESCE(p_minutes, '')), ''),
           agreements          = NULLIF(btrim(COALESCE(p_agreements, '')), ''),
           next_step           = NULLIF(btrim(COALESCE(p_next_step, '')), ''),
           document_id         = p_document_id,
           author_id           = v_actor,
           updated_at          = now()
     WHERE id = v_minutes.id;
  ELSE
    INSERT INTO public.hearing_minutes (
      complaint_id, hearing_id, minute_number, status,
      conducted, outcome, outcome_explanation,
      narrative, agreements, next_step, document_id, author_id
    )
    VALUES (
      v_hearing.complaint_id, p_hearing_id, 1, 'Draft',
      p_conducted, p_outcome,
      NULLIF(btrim(COALESCE(p_outcome_explanation, '')), ''),
      NULLIF(btrim(COALESCE(p_minutes, '')), ''),
      NULLIF(btrim(COALESCE(p_agreements, '')), ''),
      NULLIF(btrim(COALESCE(p_next_step, '')), ''),
      p_document_id, v_actor
    );
  END IF;

  -- ── attendance, party by party ───────────────────────────────
  FOR v_entry IN
    SELECT e FROM jsonb_array_elements(COALESCE(p_attendance, '[]'::jsonb)) AS e
  LOOP
    v_label  := btrim(COALESCE(v_entry ->> 'attendee_label', ''));
    v_status := btrim(COALESCE(v_entry ->> 'attendance_status', ''));
    v_reason := NULLIF(btrim(COALESCE(v_entry ->> 'excuse_reason', '')), '');

    IF v_label = '' THEN
      CONTINUE;
    END IF;

    -- The core of the attendance fix. An absent or blank status is
    -- stored as 'Not recorded'. It is never promoted to 'Present',
    -- because "we did not write it down" and "the party was there"
    -- are different facts.
    IF v_status NOT IN ('Present', 'Absent', 'Late', 'Excused', 'Not recorded') THEN
      v_status := 'Not recorded';
    END IF;

    IF v_status = 'Excused' AND v_reason IS NULL THEN
      RAISE EXCEPTION 'An excused party needs a reason.'
        USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.hearing_attendances (
      complaint_id, hearing_id, attendee_label, party_role,
      attendance_status, excuse_reason, attended, recorded_by, recorded_at
    )
    VALUES (
      v_hearing.complaint_id, p_hearing_id, v_label,
      COALESCE(NULLIF(btrim(COALESCE(v_entry ->> 'party_role', '')), ''), 'other'),
      v_status, v_reason,
      v_status IN ('Present', 'Late'),
      v_actor, now()
    )
    ON CONFLICT (hearing_id, attendee_label) DO UPDATE
      SET attendance_status = EXCLUDED.attendance_status,
          excuse_reason     = EXCLUDED.excuse_reason,
          party_role        = EXCLUDED.party_role,
          recorded_by       = EXCLUDED.recorded_by,
          recorded_at       = now()
    WHERE public.hearing_attendances.attendance_status
          IS DISTINCT FROM EXCLUDED.attendance_status
       OR public.hearing_attendances.excuse_reason
          IS DISTINCT FROM EXCLUDED.excuse_reason
       OR public.hearing_attendances.party_role
          IS DISTINCT FROM EXCLUDED.party_role;

    v_written := v_written + 1;
  END LOOP;

  -- ── only a real meeting moves the hearing to Held ────────────
  --
  -- The status is written AFTER the meeting record above, because the
  -- lifecycle trigger refuses Held on a hearing with no conducted
  -- record. The order is the whole point: the record is the evidence
  -- and the status is the label on it.
  IF p_conducted = 'Yes' THEN
    UPDATE public.hearings
       SET status = 'Held', updated_at = now()
     WHERE id = p_hearing_id;
    v_status := 'Held';
  ELSE
    -- Left alone on purpose. A session that did not happen is not
    -- evidence that it was held, and it is not evidence that it was
    -- cancelled either. It stays scheduled so it can be rescheduled
    -- or cancelled with a reason.
    SELECT status::text INTO v_status
    FROM public.hearings WHERE id = p_hearing_id;
  END IF;

  RETURN jsonb_build_object(
    'hearing_id',        p_hearing_id,
    'complaint_id',      v_hearing.complaint_id,
    'hearing_status',    v_status,
    'conducted',         p_conducted,
    'outcome',           p_outcome,
    'attendance_rows',   v_written,
    'recorded_by',       v_actor
  );
END;
$$;

COMMENT ON FUNCTION public.captain_save_meeting_record(uuid, text, text, text, text, text, text, jsonb, uuid) IS
  'Saves a mediation Meeting Record: attendance, whether the meeting was conducted, its outcome, minutes and next step. Sets the hearing to Held only when conducted = Yes.';

REVOKE EXECUTE ON FUNCTION public.captain_save_meeting_record(uuid, text, text, text, text, text, text, jsonb, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.captain_save_meeting_record(uuid, text, text, text, text, text, text, jsonb, uuid) TO authenticated;


-- ── H2. captain_record_attendance ──────────────────────────────
--
-- Attendance for one party, on its own. Used when the officer records
-- what happened at a hearing without writing the full meeting record
-- yet. It never touches the hearing status.
--
-- Passing NULL for p_status records 'Not recorded', which is how an
-- officer clears a mistaken entry.
CREATE OR REPLACE FUNCTION public.captain_record_attendance(
  p_hearing_id        uuid,
  p_party_role        text,
  p_attendee_label    text,
  p_attendance_status text DEFAULT NULL,
  p_excuse_reason     text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_complaint uuid;
  v_status    text;
  v_reason    text;
  v_label     text;
  v_id        uuid;
BEGIN
  IF NOT public.is_active_official() THEN
    RAISE EXCEPTION 'Only an active barangay official can record attendance.'
      USING ERRCODE = '42501';
  END IF;

  SELECT h.complaint_id INTO v_complaint
  FROM public.hearings h
  WHERE h.id = p_hearing_id;

  IF v_complaint IS NULL THEN
    RAISE EXCEPTION 'That hearing no longer exists on this case.'
      USING ERRCODE = 'P0002';
  END IF;

  v_label := btrim(COALESCE(p_attendee_label, ''));
  IF v_label = '' THEN
    RAISE EXCEPTION 'Name the party whose attendance is being recorded.'
      USING ERRCODE = '22023';
  END IF;

  v_status := btrim(COALESCE(p_attendance_status, ''));
  IF v_status NOT IN ('Present', 'Absent', 'Late', 'Excused', 'Not recorded') THEN
    -- Includes the NULL case. Nothing becomes Present by omission.
    v_status := 'Not recorded';
  END IF;

  v_reason := NULLIF(btrim(COALESCE(p_excuse_reason, '')), '');
  IF v_status = 'Excused' AND v_reason IS NULL THEN
    RAISE EXCEPTION 'An excused party needs a reason.'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.hearing_attendances (
    complaint_id, hearing_id, attendee_label, party_role,
    attendance_status, excuse_reason, attended, recorded_by, recorded_at
  )
  VALUES (
    v_complaint, p_hearing_id, v_label,
    COALESCE(NULLIF(btrim(COALESCE(p_party_role, '')), ''), 'other'),
    v_status, v_reason,
    v_status IN ('Present', 'Late'),
    auth.uid(), now()
  )
  ON CONFLICT (hearing_id, attendee_label) DO UPDATE
    SET attendance_status = EXCLUDED.attendance_status,
        excuse_reason     = EXCLUDED.excuse_reason,
        party_role        = EXCLUDED.party_role,
        recorded_by       = EXCLUDED.recorded_by,
        recorded_at       = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.captain_record_attendance(uuid, text, text, text, text) IS
  'Records one party''s attendance. A NULL or unrecognised status is stored as ''Not recorded''. Never marks a hearing Held.';

REVOKE EXECUTE ON FUNCTION public.captain_record_attendance(uuid, text, text, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.captain_record_attendance(uuid, text, text, text, text) TO authenticated;


-- ── H3. captain_reschedule_hearing ─────────────────────────────
--
-- The old behaviour updated the existing row in place, which erased
-- the original date and made the history unreadable. This preserves
-- the original row as 'Rescheduled', creates the replacement as a new
-- 'Upcoming' row, and cross-links the two.
CREATE OR REPLACE FUNCTION public.captain_reschedule_hearing(
  p_hearing_id uuid,
  p_new_date   date,
  p_new_time   time,
  p_new_venue  text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old       public.hearings%ROWTYPE;
  v_new_id    uuid;
  v_venue     text := btrim(COALESCE(p_new_venue, ''));
BEGIN
  IF NOT public.is_active_official() THEN
    RAISE EXCEPTION 'Only an active barangay official can reschedule a hearing.'
      USING ERRCODE = '42501';
  END IF;

  IF p_new_date IS NULL OR p_new_time IS NULL THEN
    RAISE EXCEPTION 'A rescheduled hearing needs a date and a time.'
      USING ERRCODE = '22023';
  END IF;

  IF v_venue = '' THEN
    RAISE EXCEPTION 'A rescheduled hearing needs a venue.'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_old
  FROM public.hearings
  WHERE id = p_hearing_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'That hearing no longer exists on this case.'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_old.status::text IN ('Cancelled', 'Rescheduled') THEN
    RAISE EXCEPTION
      'This hearing is already % and cannot be rescheduled again.',
      v_old.status::text
      USING ERRCODE = 'check_violation';
  END IF;

  -- A session that actually happened cannot be rescheduled. Its record
  -- is the record of what occurred.
  IF EXISTS (
    SELECT 1 FROM public.hearing_minutes m
    WHERE m.hearing_id = v_old.id
      AND m.conducted = 'Yes'
  ) THEN
    RAISE EXCEPTION
      'This hearing already has a meeting record saying it was conducted, so it cannot be rescheduled.'
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.hearings (
    complaint_id, hearing_type, title, hearing_date, hearing_time,
    venue, status, created_by, rescheduled_from_id
  )
  VALUES (
    v_old.complaint_id, v_old.hearing_type, v_old.title,
    p_new_date, p_new_time, v_venue,
    'Upcoming', auth.uid(), v_old.id
  )
  RETURNING id INTO v_new_id;

  -- The original row is kept and marked, never overwritten and never
  -- deleted. rescheduled_to_id satisfies the lifecycle trigger.
  UPDATE public.hearings
     SET status = 'Rescheduled',
         rescheduled_to_id = v_new_id,
         updated_at = now()
   WHERE id = v_old.id;

  RETURN v_new_id;
END;
$$;

COMMENT ON FUNCTION public.captain_reschedule_hearing(uuid, date, time, text) IS
  'Preserves the original hearing as Rescheduled and creates a linked replacement as Upcoming.';

REVOKE EXECUTE ON FUNCTION public.captain_reschedule_hearing(uuid, date, time, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.captain_reschedule_hearing(uuid, date, time, text) TO authenticated;


-- ── H4. captain_cancel_hearing ─────────────────────────────────
--
-- Cancelling requires a reason. The reason is the record; the status
-- is only the label on it.
CREATE OR REPLACE FUNCTION public.captain_cancel_hearing(
  p_hearing_id uuid,
  p_reason     text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reason text := btrim(COALESCE(p_reason, ''));
BEGIN
  IF NOT public.is_active_official() THEN
    RAISE EXCEPTION 'Only an active barangay official can cancel a hearing.'
      USING ERRCODE = '42501';
  END IF;

  IF v_reason = '' THEN
    RAISE EXCEPTION 'A cancelled hearing needs a reason.'
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.hearings WHERE id = p_hearing_id) THEN
    RAISE EXCEPTION 'That hearing no longer exists on this case.'
      USING ERRCODE = 'P0002';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.hearing_minutes m
    WHERE m.hearing_id = p_hearing_id
      AND m.conducted = 'Yes'
  ) THEN
    RAISE EXCEPTION
      'This hearing has a meeting record saying it was conducted, so it cannot be cancelled.'
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public.hearings
     SET status = 'Cancelled',
         cancel_reason = v_reason,
         updated_at = now()
   WHERE id = p_hearing_id;
END;
$$;

COMMENT ON FUNCTION public.captain_cancel_hearing(uuid, text) IS
  'Cancels a hearing with a required reason. Refuses a hearing whose meeting record says it was conducted.';

REVOKE EXECUTE ON FUNCTION public.captain_cancel_hearing(uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.captain_cancel_hearing(uuid, text) TO authenticated;


-- ============================================================
-- SECTION I. Verification
-- ============================================================
-- All read-only. Run after the migration to confirm the shape.
-- ============================================================

DO $$
DECLARE
  v_missing text;
  v_count   integer;
BEGIN
  SELECT string_agg(c.column_name, ', ')
    INTO v_missing
  FROM (
    SELECT 'hearings.cancel_reason'          AS column_name
    UNION ALL SELECT 'hearings.rescheduled_from_id'
    UNION ALL SELECT 'hearings.rescheduled_to_id'
    UNION ALL SELECT 'hearing_minutes.conducted'
    UNION ALL SELECT 'hearing_minutes.outcome'
    UNION ALL SELECT 'hearing_minutes.outcome_explanation'
    UNION ALL SELECT 'hearing_minutes.document_id'
    UNION ALL SELECT 'summons_service_records.acknowledged_on'
    UNION ALL SELECT 'summons_service_records.acknowledged_by'
  ) c
  WHERE NOT EXISTS (
    SELECT 1
    FROM information_schema.columns ic
    WHERE ic.table_schema = 'public'
      AND ic.table_name    = split_part(c.column_name, '.', 1)
      AND ic.column_name   = split_part(c.column_name, '.', 2)
  );

  IF v_missing IS NULL THEN
    RAISE NOTICE 'columns: ok (all 9 added)';
  ELSE
    RAISE NOTICE 'columns MISSING: %', v_missing;
  END IF;

  -- 'Held' must exist in the enum. Casting to text avoids needing the
  -- label to be usable, so this works in the same transaction.
  SELECT count(*) INTO v_count
  FROM pg_enum e
  JOIN pg_type t ON t.oid = e.enumtypid
  WHERE t.typname = 'hearing_status'
    AND e.enumlabel = 'Held';

  IF v_count = 1 THEN
    RAISE NOTICE 'hearing_status: ok (''Held'' present)';
  ELSE
    RAISE NOTICE 'hearing_status: ''Held'' MISSING';
  END IF;

  -- Every function must exist with the expected arity.
  IF to_regprocedure('public.captain_save_meeting_record(uuid,text,text,text,text,text,text,jsonb,uuid)') IS NULL THEN
    RAISE NOTICE 'RPC MISSING: captain_save_meeting_record';
  END IF;
  IF to_regprocedure('public.captain_record_attendance(uuid,text,text,text,text)') IS NULL THEN
    RAISE NOTICE 'RPC MISSING: captain_record_attendance';
  END IF;
  IF to_regprocedure('public.captain_reschedule_hearing(uuid,date,time,text)') IS NULL THEN
    RAISE NOTICE 'RPC MISSING: captain_reschedule_hearing';
  END IF;
  IF to_regprocedure('public.captain_cancel_hearing(uuid,text)') IS NULL THEN
    RAISE NOTICE 'RPC MISSING: captain_cancel_hearing';
  END IF;

  RAISE NOTICE 'verification complete';
END
$$;


-- ============================================================
-- SECTION J. Optional backfill — RUN AS A SEPARATE STATEMENT
-- ============================================================
--
-- Run this only AFTER the rest of the file has been committed. It
-- converts legacy 'Completed' hearings to 'Held', but ONLY those that
-- already have a meeting record saying the meeting was conducted.
--
-- Why the filter matters:
--   The old Captain flow set status = 'Completed' as a side effect of
--   saving attendance. Those rows are not evidence that a meeting
--   happened. Marking them Held would carry the old bug forward into
--   new data. Any 'Completed' row without a conducted meeting record
--   is left alone and reported, so an officer can record the meeting
--   record properly or correct it.
-- ============================================================

-- J1. Convert the hearings that genuinely have a conducted meeting.
-- UPDATE public.hearings h
--    SET status = 'Held', updated_at = now()
--  WHERE h.status = 'Completed'
--    AND EXISTS (
--      SELECT 1 FROM public.hearing_minutes m
--      WHERE m.hearing_id = h.id
--        AND m.conducted = 'Yes'
--    );

-- J2. Report what was deliberately left behind.
-- SELECT h.id, h.complaint_id, h.hearing_date, h.title
--   FROM public.hearings h
--  WHERE h.status = 'Completed'
--    AND NOT EXISTS (
--      SELECT 1 FROM public.hearing_minutes m
--      WHERE m.hearing_id = h.id
--        AND m.conducted = 'Yes'
--    );