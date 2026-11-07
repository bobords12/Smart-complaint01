-- ============================================================
-- repair-categorization-stage-advance.sql
-- Purpose: Release cases whose recorded stage was left behind by
--          their own classification decision.
-- Apply   : safe to re-run. A case that has already moved on is
--           never touched a second time.
-- ============================================================
--
-- WHY THIS EXISTS
--
--   `receive_complaint_official()` stamps a complaint
--   'For Official Categorization'. The Stage 2 action modal advanced
--   the stage again after the official confirmed a category, but the
--   Review & Classification tab — the control the "Review
--   Classification" button opens — wrote only the confirmed columns.
--
--   A case classified from that tab was therefore left parked on
--   'For Official Categorization' with its category and urgency
--   already on record, and routing completed on top of it. Two parts
--   of the case file then disagreed:
--
--     * the Case Progress stepper, which derives its steps from the
--       records (confirmed category, saved route, summons), showed
--       Step 5 — Notice of Hearing; and
--     * the next-action ladder, which refuses to offer a rung the
--       recorded stage could not execute, kept offering "Review
--       Classification" — a button that could not move the case on.
--
--   The client fix (lib/complaintQueries.js
--   `advancePastCategorization()`, run by both the Stage 2 action and
--   the Review & Classification tab) stops this from happening again.
--   This file repairs the rows the bug already produced, writing
--   exactly what the Stage 2 action would have written:
--
--     complaints.current_status = 'Received'
--     complaints.current_stage  = 'Received — Pending Summons'
--     one case_statuses row, so the resident's timeline shows the
--     confirmation instead of jumping straight to a hearing.
--
-- WHO IS RELEASED
--
--   Only a case that is still on the categorization stage AND already
--   carries BOTH official values. A case waiting for its category, or
--   waiting for routing assessment, is left exactly where it is.
--
-- UNDO
--
--   The previous values are 'For Official Categorization' for both
--   columns; run the UPDATE at the bottom of this file in reverse.

-- ── 1. The stage, for every case still parked on it ─────────────
WITH advanced AS (
  UPDATE public.complaints
     SET current_status = 'Received',
         current_stage  = 'Received — Pending Summons',
         updated_at     = now()
   WHERE current_status = 'For Official Categorization'
     AND current_stage  = 'For Official Categorization'
     AND confirmed_category IS NOT NULL
     AND confirmed_urgency  IS NOT NULL
  RETURNING id, reference_number
)
INSERT INTO public.case_statuses (
  complaint_id, status, stage, resident_visible_message, changed_by, created_at
)
SELECT
  a.id,
  'Received',
  'Categorization Confirmed — Pending Summons',
  'An official confirmed the category of your complaint. Summons scheduling follows.',
  NULL,
  now()
FROM advanced a
WHERE NOT EXISTS (
  SELECT 1
  FROM public.case_statuses cs
  WHERE cs.complaint_id = a.id
    AND cs.stage = 'Categorization Confirmed — Pending Summons'
);

-- ── 2. Verification ─────────────────────────────────────────────
-- No row should come back: every classified case has been released.
SELECT reference_number, current_status, current_stage,
       confirmed_category, confirmed_urgency, routing_status, workflow_gate_open
FROM public.complaints
WHERE current_status = 'For Official Categorization'
  AND confirmed_category IS NOT NULL
  AND confirmed_urgency  IS NOT NULL;

-- The released cases, with the timeline row each one received.
SELECT c.reference_number, c.current_status, c.current_stage,
       cs.stage AS timeline_stage, cs.created_at
FROM public.complaints c
LEFT JOIN public.case_statuses cs
  ON cs.complaint_id = c.id
 AND cs.stage = 'Categorization Confirmed — Pending Summons'
WHERE c.current_stage = 'Received — Pending Summons'
ORDER BY c.reference_number;

-- ── Undo (only if this repair has to be reversed) ───────────────
-- UPDATE public.complaints
--    SET current_status = 'For Official Categorization',
--        current_stage  = 'For Official Categorization',
--        updated_at     = now()
--  WHERE current_stage = 'Received — Pending Summons'
--    AND reference_number IN ('AB-2026-0051', 'AB-2026-0052',
--                             'AB-2026-0055', 'AB-2026-0056');
-- DELETE FROM public.case_statuses
--  WHERE stage = 'Categorization Confirmed — Pending Summons'
--    AND created_at >= <the timestamp of this repair>
--    AND changed_by IS NULL;
