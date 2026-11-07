-- ============================================================
-- lupon-member-portal-and-pangkat-rls.sql
-- Purpose: Data model, RLS and RPCs for the Lupon Member
--          Portal and the Pangkat conciliation workflow.
--
-- WHY THIS IS REQUIRED:
--   1. lupon_panels.role CHECK allows only
--      ('chairperson','member','alternate'). The Pangkat
--      Secretary is a required case-specific role and cannot
--      be assigned today. The CHECK is WIDENED, never narrowed:
--      all three existing values stay valid.
--   2. There is no pangkat_trackers table. The 15-day
--      conciliation period must start when the Pangkat
--      OFFICIALLY CONVENES and must be tracked SEPARATELY from
--      the Captain's mediation period (kp_phases). Coupling them
--      would let a KP flow mutate the Pangkat clock.
--   3. There is no hearing_minutes table. hearing_attendances
--      has a free-text `minutes` column, which cannot enforce the
--      Draft -> Submitted for Review -> Returned for Correction
--      -> Attested -> Final lifecycle.
--   4. There is no case_outcomes table. A Pangkat that settles a
--      case has no way to record HOW it was resolved.
--   5. hearing_attendances.attended is a boolean, so it cannot
--      represent Absent vs. Excused vs. Late vs. Not Recorded.
--   6. A Lupon member with profiles.role = 'lupon' currently
--      has almost no read access: officials-only policies cover
--      complaints, hearings and official_documents. Members
--      could see their assignment row and nothing else.
--   7. middleware.jsx currently lets a 'lupon' role into
--      /resident/*, and getPostLoginRoute() sends them to the
--      resident dashboard. Both are fixed in application code,
--      not here.
--
-- ISOLATION MODEL (the core security rule):
--   A Lupon member may read a complaint, its hearings, its
--   attendance rows, its minutes, its outcome and its documents
--   ONLY when public.lupon_panels contains an ACTIVE assignment
--   linking auth.uid() to that complaint_id.
--   lupon_is_assigned_to() is the single source of truth and is
--   used by every policy and every RPC below. Replaced and
--   removed members lose access immediately.
--
-- SAFETY:  Additive, with exactly one documented exception.
--          No table is dropped, no RLS is disabled, and the one
--          CHECK constraint change is a strict WIDENING. No
--          existing policy is removed.
--          THE EXCEPTION: Section H removes duplicate rows from
--          hearing_attendances where two rows record the same
--          attendee at the same hearing, keeping the earliest.
--          This is required so the one-row-per-attendee unique
--          constraint can be created at all. It is reported with
--          RAISE NOTICE and is the only DELETE in this file.
--
-- PREREQUISITES:
--   Files 01-23 + captain-portal-schema-additions.sql +
--   official-rbac-oic-secretary.sql + reklamo-form-document-
--   workflow.sql must already be applied.
--   official-rbac-oic-secretary.sql is what adds 'lupon' to the
--   app_role enum; this file re-checks it defensively but cannot
--   add an enum value outside its own transaction block on
--   older PostgreSQL, so apply that file first.
--
-- HOW TO APPLY (Supabase Dashboard > SQL Editor):
--   1. Open SQL Editor > New query.
--   2. Paste this entire file.
--   3. Click Run.
--   4. Verify with the SELECT statements in Section J.
-- ============================================================


-- ============================================================
-- SECTION A. Role and helper functions
-- ============================================================

-- Defensive: 'lupon' should already exist from
-- official-rbac-oic-secretary.sql. Re-checked so this file is
-- safe to run on its own.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'app_role' AND e.enumlabel = 'lupon'
  ) THEN
    RAISE EXCEPTION
      'app_role enum has no ''lupon'' value. Apply official-rbac-oic-secretary.sql first.';
  END IF;
END
$$;

-- Is the caller an active barangay official?
-- SECURITY DEFINER so the profiles lookup does not recurse
-- through the profiles RLS policy.
CREATE OR REPLACE FUNCTION public.is_active_official()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role IN ('captain', 'oic', 'secretary')
      AND p.account_status = 'active'
  );
$$;

-- Is the caller an active Lupon member?
CREATE OR REPLACE FUNCTION public.is_active_lupon()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role = 'lupon'
      AND p.account_status = 'active'
  );
$$;

-- THE core isolation predicate. TRUE only for an ACTIVE
-- assignment. Replaced/removed members are excluded.
-- Caller-supplied complaint id is validated as a uuid so a
-- malformed value cannot raise inside a policy.
CREATE OR REPLACE FUNCTION public.lupon_is_assigned_to(p_complaint_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_active_lupon()
    AND EXISTS (
      SELECT 1
      FROM public.lupon_panels lp
      WHERE lp.complaint_id = $1
        AND lp.member_id = auth.uid()
        AND lp.status = 'active'
    );
$$;

-- TRUE when the caller is the Chairperson or Secretary of the
-- Pangkat for this case. Used to gate convening, minute
-- attestation and outcome recording.
CREATE OR REPLACE FUNCTION public.lupon_leads_case(p_complaint_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_active_lupon()
    AND EXISTS (
      SELECT 1
      FROM public.lupon_panels lp
      WHERE lp.complaint_id = $1
        AND lp.member_id = auth.uid()
        AND lp.status = 'active'
        AND lp.role IN ('chairperson', 'secretary')
    );
$$;

-- TRUE when the caller is the Pangkat Secretary specifically.
-- Only the Secretary finalises attested minutes.
CREATE OR REPLACE FUNCTION public.lupon_is_case_secretary(p_complaint_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_active_lupon()
    AND EXISTS (
      SELECT 1
      FROM public.lupon_panels lp
      WHERE lp.complaint_id = $1
        AND lp.member_id = auth.uid()
        AND lp.status = 'active'
        AND lp.role = 'secretary'
    );
$$;

COMMENT ON FUNCTION public.lupon_is_assigned_to(uuid) IS
  'TRUE when the caller is an active Lupon member assigned to the given case. Single source of truth for case-level read isolation.';


-- ============================================================
-- SECTION B. Widen lupon_panels to allow a Pangkat Secretary
-- ============================================================

-- The existing constraint is implicitly named
-- lupon_panels_role_check. Dropping and re-adding it is the only
-- way to change a CHECK in PostgreSQL. This is a WIDENING: every
-- previously valid value (chairperson, member, alternate)
-- remains valid, and no row is touched.
ALTER TABLE public.lupon_panels
  DROP CONSTRAINT IF EXISTS lupon_panels_role_check;

ALTER TABLE public.lupon_panels
  ADD CONSTRAINT lupon_panels_role_check
  CHECK (role IN ('chairperson', 'secretary', 'member', 'alternate'));

-- One active chairperson / secretary per case.
--
-- Created defensively. If pre-existing data already has two
-- active chairpersons for one case, a plain CREATE UNIQUE INDEX
-- would abort the ENTIRE migration and leave the portal tables
-- uncreated. That is not an acceptable failure mode for a
-- deployment script, so the duplicate is reported as a NOTICE
-- and the index is skipped; the Captain's panel UI already
-- blocks a second chairperson at the application layer, and the
-- duplicate can be resolved afterwards.
DO $$
DECLARE
  v_dupes integer;
BEGIN
  SELECT count(*) INTO v_dupes FROM (
    SELECT complaint_id
    FROM public.lupon_panels
    WHERE role = 'chairperson' AND status = 'active'
    GROUP BY complaint_id
    HAVING count(*) > 1
  ) x;

  IF v_dupes > 0 THEN
    RAISE NOTICE
      'Skipped idx_lupon_one_active_chairperson: % case(s) have more than one active chairperson. Resolve in the Captain panel UI, then re-run this file.',
      v_dupes;
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS idx_lupon_one_active_chairperson
      ON public.lupon_panels (complaint_id)
      WHERE role = 'chairperson' AND status = 'active';
  END IF;

  SELECT count(*) INTO v_dupes FROM (
    SELECT complaint_id
    FROM public.lupon_panels
    WHERE role = 'secretary' AND status = 'active'
    GROUP BY complaint_id
    HAVING count(*) > 1
  ) x;

  IF v_dupes > 0 THEN
    RAISE NOTICE
      'Skipped idx_lupon_one_active_secretary: % case(s) have more than one active secretary.',
      v_dupes;
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS idx_lupon_one_active_secretary
      ON public.lupon_panels (complaint_id)
      WHERE role = 'secretary' AND status = 'active';
  END IF;
END
$$;

-- Fast lookup for the "my assignments" list.
CREATE INDEX IF NOT EXISTS idx_lupon_active_member_assignments
  ON public.lupon_panels (member_id, complaint_id)
  WHERE status = 'active';


-- ============================================================
-- SECTION C. Pangkat conciliation tracker (Day X of 15)
-- ============================================================

-- Deliberately NOT built on kp_trackers / kp_phases.
-- The Captain's mediation period and the Pangkat's conciliation
-- period are legally and procedurally distinct:
--   * the KP flow only exists when kp_trackers.kp_applicable
--     is true, which is not the case for an ordinary case
--     escalated to the Pangkat;
--   * sharing kp_phases would let KP logic reset or extend the
--     Pangkat clock.
-- One tracker per complaint, created when the Pangkat is formed
-- but NOT started. The clock starts only when the Pangkat
-- OFFICIALLY CONVENES (convenes_at), and never before.
CREATE TABLE IF NOT EXISTS public.pangkat_trackers (
  id                uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  complaint_id      uuid UNIQUE NOT NULL REFERENCES public.complaints(id) ON DELETE CASCADE,

  -- NULL until lupon_convene_pangkat() runs. While NULL the
  -- tracker is 'Not Convened' and no day count is shown.
  convenes_at       timestamptz,
  convened_by       uuid REFERENCES public.profiles(id) ON DELETE SET NULL,

  -- Base conciliation period. Fixed at 15 by policy; exposed as
  -- a column only so an amendment can be recorded without a
  -- migration.
  period_days       integer NOT NULL DEFAULT 15
                    CHECK (period_days > 0 AND period_days <= 15),

  -- Total extension granted, summed from pangkat_extensions.
  -- Capped at 15 additional days by the guard on the extension
  -- RPC, so the maximum total is 30 days.
  extension_days    integer NOT NULL DEFAULT 0
                    CHECK (extension_days >= 0 AND extension_days <= 15),
  extension_reason  text,
  extension_approved_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  extension_approved_at timestamptz,

  -- 'Not Convened' -> 'Active' -> 'Concluded'
  -- ('Terminated' is for a withdrawn/dismissed case.)
  status            text NOT NULL DEFAULT 'Not Convened'
                    CHECK (status IN ('Not Convened', 'Active', 'Concluded', 'Terminated')),

  -- Set when the Pangkat reports the conciliation result. Kept
  -- denormalised from case_outcomes for list rendering only;
  -- case_outcomes is the authoritative record.
  concluded_at      timestamptz,
  conclusion_note   text,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pangkat_trackers_status
  ON public.pangkat_trackers (status);
CREATE INDEX IF NOT EXISTS idx_pangkat_trackers_convened_by
  ON public.pangkat_trackers (convened_by);

ALTER TABLE public.pangkat_trackers ENABLE ROW LEVEL SECURITY;

-- Immutable ledger of every extension request and approval.
-- The sum of approved days is what pangkat_trackers.extension_days
-- mirrors; the RPC is the only writer, so the two cannot drift.
CREATE TABLE IF NOT EXISTS public.pangkat_extensions (
  id                uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  complaint_id      uuid NOT NULL REFERENCES public.complaints(id) ON DELETE CASCADE,
  requested_days    integer NOT NULL CHECK (requested_days BETWEEN 1 AND 15),
  reason            text NOT NULL,
  status            text NOT NULL DEFAULT 'Pending'
                    CHECK (status IN ('Pending', 'Approved', 'Rejected')),
  requested_by      uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  requested_at      timestamptz NOT NULL DEFAULT now(),
  decided_by        uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  decided_at        timestamptz,
  decision_note     text
);

CREATE INDEX IF NOT EXISTS idx_pangkat_extensions_complaint
  ON public.pangkat_extensions (complaint_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_pangkat_extensions_pending
  ON public.pangkat_extensions (complaint_id)
  WHERE status = 'Pending';

ALTER TABLE public.pangkat_extensions ENABLE ROW LEVEL SECURITY;

-- Day X of Y, as the portal displays it. Returns NULL until the
-- Pangkat has officially convened, so an unconvened Pangkat can
-- never show a day count.
--   day_number  1-based day since convening, capped at total_days
--   total_days  base period plus approved extensions
--   days_left   days remaining, never negative
CREATE OR REPLACE FUNCTION public.pangkat_day_progress(p_conplaint_id uuid)
RETURNS TABLE (
  status       text,
  day_number   integer,
  total_days   integer,
  days_left    integer,
  deadline_on  date
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH t AS (
    SELECT
      pt.status,
      pt.convenes_at,
      pt.concluded_at,
      pt.period_days,
      pt.extension_days
    FROM public.pangkat_trackers pt
    WHERE pt.complaint_id = $1
  ),
  calc AS (
    SELECT
      t.status,
      t.convenes_at,
      t.concluded_at,
      (t.period_days + t.extension_days)::integer AS total_days,
      (t.convenes_at::date
        + (t.period_days + t.extension_days)
        - 1)::date AS deadline_on
    FROM t
  ),
  -- The clock must stop the day the Pangkat records an outcome.
  -- A Concluded or Terminated tracker keeps reporting the day it
  -- finished, not the day the page happened to be opened: a case
  -- resolved in April must not still read "Day 400 of 15" in
  -- June. Days are counted against LEAST(today, concluded date).
  anchored AS (
    SELECT
      c.status,
      c.convenes_at,
      c.total_days,
      c.deadline_on,
      LEAST(
        CURRENT_DATE,
        COALESCE(c.concluded_at::date, CURRENT_DATE)
      ) AS as_of
    FROM calc c
  )
  SELECT
    a.status,
    CASE
      WHEN a.convenes_at IS NULL THEN NULL
      ELSE LEAST(
        GREATEST(
          (a.as_of - a.convenes_at::date) + 1,
          1
        ),
        a.total_days
      )
    END,
    CASE WHEN a.convenes_at IS NULL THEN NULL ELSE a.total_days END,
    CASE
      WHEN a.convenes_at IS NULL THEN NULL
      ELSE GREATEST(a.deadline_on - a.as_of, 0)
    END,
    CASE WHEN a.convenes_at IS NULL THEN NULL ELSE a.deadline_on END
  FROM anchored a;
$$;

COMMENT ON FUNCTION public.pangkat_day_progress(uuid) IS
  'Day X of Y for the Pangkat conciliation period. NULL day_number until the Pangkat officially convenes. The count freezes on the date the outcome was recorded.';

-- PostgreSQL grants EXECUTE to PUBLIC on every new function by
-- default. This one must NOT be reachable from the client: it
-- returns the tracker state for ANY complaint id, so leaving it
-- public would let any signed-in resident enumerate case uuids
-- and learn whether a Pangkat has convened and how many days
-- remain. Only lupon_my_assignments() needs it, and that
-- function is SECURITY DEFINER, so it still resolves.
REVOKE EXECUTE ON FUNCTION public.pangkat_day_progress(uuid) FROM PUBLIC, anon, authenticated;



-- ============================================================
-- SECTION D. Attendance status (widening the boolean)
-- ============================================================

-- hearing_attendances.attended is a boolean and cannot express
-- Absent vs. Excused vs. Late vs. Not Recorded, which the minutes
-- template needs. A new column is added rather than replacing
-- `attended`, so existing rows and existing code keep working.
-- `attended` is backfilled from the new column and kept in sync
-- by a trigger for the duration of the compatibility window.
ALTER TABLE public.hearing_attendances
  ADD COLUMN IF NOT EXISTS attendance_status text,
  ADD COLUMN IF NOT EXISTS excuse_reason  text,
  ADD COLUMN IF NOT EXISTS recorded_at    timestamptz;

ALTER TABLE public.hearing_attendances
  DROP CONSTRAINT IF EXISTS hearing_attendances_attendance_status_check;

ALTER TABLE public.hearing_attendances
  ADD CONSTRAINT hearing_attendances_attendance_status_check
  CHECK (
    attendance_status IS NULL
    OR attendance_status IN ('Present', 'Absent', 'Late', 'Excused', 'Not Recorded')
  );

-- Backfill once, from the pre-existing boolean.
UPDATE public.hearing_attendances
SET attendance_status = CASE WHEN attended THEN 'Present' ELSE 'Absent' END
WHERE attendance_status IS NULL;

-- Keep the legacy boolean consistent for older reads.
CREATE OR REPLACE FUNCTION public.hearing_attendance_sync_attended()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.attended := COALESCE(NEW.attendance_status, 'Not Recorded') = 'Present';
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_hearing_attendance_sync_attended ON public.hearing_attendances;
CREATE TRIGGER trg_hearing_attendance_sync_attended
  BEFORE INSERT OR UPDATE ON public.hearing_attendances
  FOR EACH ROW
  EXECUTE FUNCTION public.hearing_attendance_sync_attended();


-- ============================================================
-- SECTION E. Hearing minutes with a review lifecycle
-- ============================================================

-- The required lifecycle:
--   Draft -> Submitted for Review -> (Attested | Returned for
--   Correction -> Draft) -> Final
-- A Returned-for-Correction minute returns to 'Draft' so the
-- author can edit; the return reason is kept in returned_reason
-- and return_count tracks how many rounds have happened.
CREATE TABLE IF NOT EXISTS public.hearing_minutes (
  id                  uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  complaint_id        uuid NOT NULL REFERENCES public.complaints(id) ON DELETE CASCADE,
  hearing_id          uuid NOT NULL REFERENCES public.hearings(id) ON DELETE CASCADE,

  -- One current minutes record per hearing session. The RPC
  -- refuses to overwrite a Finalised record.
  minute_number       integer NOT NULL DEFAULT 1 CHECK (minute_number > 0),

  status              text NOT NULL DEFAULT 'Draft'
                      CHECK (status IN (
                        'Draft',
                        'Submitted for Review',
                        'Returned for Correction',
                        'Attested',
                        'Final'
                      )),

  -- Content. narrative is the session body; agreements is what
  -- the parties agreed to, if anything.
  narrative           text,
  agreements          text,
  next_step           text,
  adjourned_at        timestamptz,

  author_id           uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  submitted_at        timestamptz,
  submitted_by        uuid REFERENCES public.profiles(id) ON DELETE SET NULL,

  -- Set by an official on Returned for Correction.
  returned_reason     text,
  returned_at         timestamptz,
  returned_by         uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  return_count        integer NOT NULL DEFAULT 0 CHECK (return_count >= 0),

  -- Attested by the Pangkat Chairperson or Secretary: the body
  -- is accurate, but it is not yet the official record.
  attested_at         timestamptz,
  attested_by         uuid REFERENCES public.profiles(id) ON DELETE SET NULL,

  -- Finalised. Immutable afterwards.
  finalized_at        timestamptz,
  finalized_by        uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);

-- One live minutes record per hearing session.
CREATE UNIQUE INDEX IF NOT EXISTS idx_hearing_minutes_one_live_per_hearing
  ON public.hearing_minutes (hearing_id)
  WHERE status <> 'Final';

CREATE INDEX IF NOT EXISTS idx_hearing_minutes_complaint
  ON public.hearing_minutes (complaint_id, created_at DESC);

ALTER TABLE public.hearing_minutes ENABLE ROW LEVEL SECURITY;

-- Attestation is a certification of accuracy. It is tracked, and
-- the signed copy is uploaded as an official document, but NO
-- signature image or seal is ever generated by this system.
-- Finalised minutes are immutable: block any edit to a Final row.
CREATE OR REPLACE FUNCTION public.hearing_minutes_freeze_final()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.status = 'Final' THEN
    RAISE EXCEPTION 'Finalised minutes are immutable and cannot be modified.';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_hearing_minutes_freeze_final ON public.hearing_minutes;
CREATE TRIGGER trg_hearing_minutes_freeze_final
  BEFORE UPDATE ON public.hearing_minutes
  FOR EACH ROW
  EXECUTE FUNCTION public.hearing_minutes_freeze_final();


-- ============================================================
-- SECTION F. Case outcomes
-- ============================================================

-- Recording an outcome does NOT close the complaint and does NOT
-- release a Certificate to File Action. The complaint's own
-- status and the certificate release remain Captain decisions.
CREATE TABLE IF NOT EXISTS public.case_outcomes (
  id                uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  complaint_id      uuid UNIQUE NOT NULL REFERENCES public.complaints(id) ON DELETE CASCADE,

  outcome_type      text NOT NULL
                    CHECK (outcome_type IN (
                      'Amicably Settled',
                      'Failed to Settle',
                      'Withdrawn',
                      'Referred to Court',
                      'Referred to Another Office',
                      'No Appearance'
                    )),

  summary           text NOT NULL,

  -- When outcome_type is 'Amicably Settled', the terms agreed.
  terms             text,

  -- TRUE when either party failed to appear. The Captain decides
  -- whether that leads to a Certificate to File Action; this
  -- table only records the fact.
  absence_recorded  boolean NOT NULL DEFAULT false,

  recorded_by       uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  recorded_at       timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_case_outcomes_type
  ON public.case_outcomes (outcome_type);

ALTER TABLE public.case_outcomes ENABLE ROW LEVEL SECURITY;

-- Deliberately NO trigger that updates complaints.status.
-- A Pangkat outcome is evidence for the Captain, not an order.
COMMENT ON TABLE public.case_outcomes IS
  'Pangkat conciliation result. Recording an outcome never changes complaints.status and never releases a Certificate to File Action; both remain Captain decisions.';


-- ============================================================
-- SECTION G. Row Level Security
-- ============================================================
--
-- Every policy below is scoped through lupon_is_assigned_to(),
-- which requires an ACTIVE lupon_panels row for auth.uid().
-- Removing or replacing a member revokes access on the next
-- query without touching any row.
--
-- Lupon members are READ-ONLY on the complaint record itself.
-- Only the Captain/OIC/Secretary change complaints.current_status.
-- A Pangkat records its work in its own tables.

-- ── complaints: read assigned cases only ───────────────────
DROP POLICY IF EXISTS "Lupon read assigned complaints" ON public.complaints;
CREATE POLICY "Lupon read assigned complaints"
  ON public.complaints FOR SELECT
  USING (public.lupon_is_assigned_to(id));

-- ── hearings: read the schedule for assigned cases ────────
DROP POLICY IF EXISTS "Lupon read assigned hearings" ON public.hearings;
CREATE POLICY "Lupon read assigned hearings"
  ON public.hearings FOR SELECT
  USING (public.lupon_is_assigned_to(complaint_id));

-- ── summons: read for assigned cases ──────────────────────
DROP POLICY IF EXISTS "Lupon read assigned summons" ON public.summons;
CREATE POLICY "Lupon read assigned summons"
  ON public.summons FOR SELECT
  USING (public.lupon_is_assigned_to(complaint_id));

-- ── hearing_attendances: read AND record for assigned cases
-- Officials keep their existing FOR ALL policy. Members may add
-- and correct attendance for a case they are assigned to, which
-- is how the secretary takes attendance. They may not delete.
DROP POLICY IF EXISTS "Lupon read assigned attendance" ON public.hearing_attendances;
CREATE POLICY "Lupon read assigned attendance"
  ON public.hearing_attendances FOR SELECT
  USING (public.lupon_is_assigned_to(complaint_id));

DROP POLICY IF EXISTS "Lupon record assigned attendance" ON public.hearing_attendances;
CREATE POLICY "Lupon record assigned attendance"
  ON public.hearing_attendances FOR INSERT
  WITH CHECK (
    public.lupon_is_assigned_to(complaint_id)
    AND recorded_by = auth.uid()
  );

DROP POLICY IF EXISTS "Lupon update assigned attendance" ON public.hearing_attendances;
CREATE POLICY "Lupon update assigned attendance"
  ON public.hearing_attendances FOR UPDATE
  USING (public.lupon_is_assigned_to(complaint_id))
  WITH CHECK (public.lupon_is_assigned_to(complaint_id));

-- ── hearing_minutes ───────────────────────────────────────
-- Read for assigned cases. The Secretary or Chairperson drafts
-- and submits. A member who is neither may still READ drafts so
-- the panel can see what is being prepared.
DROP POLICY IF EXISTS "Lupon read assigned minutes" ON public.hearing_minutes;
CREATE POLICY "Lupon read assigned minutes"
  ON public.hearing_minutes FOR SELECT
  USING (public.lupon_is_assigned_to(complaint_id));

-- Lupon members get NO direct INSERT or UPDATE policy on
-- hearing_minutes. Writes go exclusively through
-- lupon_save_minutes_draft() and lupon_minutes_action(), which
-- are SECURITY DEFINER (so they are unaffected by the absence of
-- these policies) and which enforce the real rules:
-- authorship is limited to the Chairperson/Secretary, and the
-- status may only move along the declared lifecycle.
--
-- A direct UPDATE policy cannot enforce that lifecycle, and the
-- earlier version of this file shipped one. RLS WITH CHECK can
-- only see the NEW row values, never the old ones, so the clause
--   USING (status <> 'Final')
-- blocks editing a finalized record but does nothing to stop a
-- member writing
--   UPDATE hearing_minutes SET status = 'Final'
-- on their own draft, which the trigger does not catch because it
-- only freezes records that were ALREADY final. That single
-- statement would have let a plain member self-finalize the
-- minutes and defeat the whole review step, so the policy is
-- removed rather than patched.
DROP POLICY IF EXISTS "Lupon draft assigned minutes" ON public.hearing_minutes;
DROP POLICY IF EXISTS "Lupon update assigned minutes" ON public.hearing_minutes;

-- Officials must be able to review, return and read minutes.
DROP POLICY IF EXISTS "Officials read all minutes" ON public.hearing_minutes;
CREATE POLICY "Officials read all minutes"
  ON public.hearing_minutes FOR SELECT
  USING (public.is_active_official());

DROP POLICY IF EXISTS "Officials manage minutes" ON public.hearing_minutes;
CREATE POLICY "Officials manage minutes"
  ON public.hearing_minutes FOR ALL
  USING (public.is_active_official())
  WITH CHECK (public.is_active_official());

-- ── case_outcomes ─────────────────────────────────────────
-- Any assigned member may read the outcome. Only the
-- Chairperson or Secretary records it.
DROP POLICY IF EXISTS "Lupon read assigned outcome" ON public.case_outcomes;
CREATE POLICY "Lupon read assigned outcome"
  ON public.case_outcomes FOR SELECT
  USING (public.lupon_is_assigned_to(complaint_id));

DROP POLICY IF EXISTS "Lupon record assigned outcome" ON public.case_outcomes;
CREATE POLICY "Lupon record assigned outcome"
  ON public.case_outcomes FOR INSERT
  WITH CHECK (
    public.lupon_leads_case(complaint_id)
    AND recorded_by = auth.uid()
  );

DROP POLICY IF EXISTS "Lupon update assigned outcome" ON public.case_outcomes;
CREATE POLICY "Lupon update assigned outcome"
  ON public.case_outcomes FOR UPDATE
  USING (public.lupon_leads_case(complaint_id))
  WITH CHECK (public.lupon_leads_case(complaint_id));

DROP POLICY IF EXISTS "Officials read all outcomes" ON public.case_outcomes;
CREATE POLICY "Officials read all outcomes"
  ON public.case_outcomes FOR SELECT
  USING (public.is_active_official());

-- ── pangkat_trackers ──────────────────────────────────────
-- Read for assigned cases. Writes go exclusively through the
-- convene / conclude RPCs, which are SECURITY DEFINER, so there
-- is deliberately no INSERT or UPDATE policy here. Without a
-- policy, a direct client write fails closed.
DROP POLICY IF EXISTS "Lupon read assigned tracker" ON public.pangkat_trackers;
CREATE POLICY "Lupon read assigned tracker"
  ON public.pangkat_trackers FOR SELECT
  USING (public.lupon_is_assigned_to(complaint_id));

DROP POLICY IF EXISTS "Officials read all trackers" ON public.pangkat_trackers;
CREATE POLICY "Officials read all trackers"
  ON public.pangkat_trackers FOR SELECT
  USING (public.is_active_official());

-- ── pangkat_extensions ────────────────────────────────────
-- A member may READ the extension history of an assigned case
-- and REQUEST one. Only an official may approve it, and that
-- happens inside the RPC.
DROP POLICY IF EXISTS "Lupon read assigned extensions" ON public.pangkat_extensions;
CREATE POLICY "Lupon read assigned extensions"
  ON public.pangkat_extensions FOR SELECT
  USING (public.lupon_is_assigned_to(complaint_id));

DROP POLICY IF EXISTS "Lupon request extension" ON public.pangkat_extensions;
CREATE POLICY "Lupon request extension"
  ON public.pangkat_extensions FOR INSERT
  WITH CHECK (
    public.lupon_is_assigned_to(complaint_id)
    AND requested_by = auth.uid()
    AND status = 'Pending'
  );

DROP POLICY IF EXISTS "Officials read all extensions" ON public.pangkat_extensions;
CREATE POLICY "Officials read all extensions"
  ON public.pangkat_extensions FOR SELECT
  USING (public.is_active_official());

-- ── lupon_panels: see the rest of your own panel ──────────
-- The existing "Lupon read own assignments" policy only exposes
-- the caller's own row. A Pangkat also needs the names of the
-- other members of its own case to take attendance, so allow
-- read access to co-members of a shared case. Still scoped: only
-- cases the caller is actively assigned to.
DROP POLICY IF EXISTS "Lupon read panel co-members" ON public.lupon_panels;
CREATE POLICY "Lupon read panel co-members"
  ON public.lupon_panels FOR SELECT
  USING (
    public.lupon_is_assigned_to(complaint_id)
  );

-- The pre-existing "Lupon read own assignments" policy from
-- captain-portal-schema-additions.sql only proves the caller has
-- the lupon ROLE. It never checks the account status, so a
-- suspended or disabled member keeps reading their own
-- assignment row even though is_active_lupon() denies them
-- everything else.
--
-- Permissive policies are OR-ed together, so this cannot be
-- tightened by adding a second policy: the old one would still
-- grant the row. It has to be replaced outright. The new clause
-- is strictly narrower and preserves exactly the intended
-- behaviour for a healthy member, plus for the Captain/OIC who
-- manage panels through the separate Officials policies.
DROP POLICY IF EXISTS "Lupon read own assignments" ON public.lupon_panels;
CREATE POLICY "Lupon read own assignments"
  ON public.lupon_panels FOR SELECT
  USING (
    member_id = auth.uid()
    AND public.is_active_lupon()
  );

-- ── official_documents: read documents for assigned cases ─
-- Note this is NOT the resident_visible rule. A member sees the
-- case file, not whatever a resident may happen to see.
DROP POLICY IF EXISTS "Lupon read assigned documents" ON public.official_documents;
CREATE POLICY "Lupon read assigned documents"
  ON public.official_documents FOR SELECT
  USING (public.lupon_is_assigned_to(complaint_id));

-- ── evidence: read supporting evidence for assigned cases ──
DROP POLICY IF EXISTS "Lupon read assigned evidence" ON public.evidence;
CREATE POLICY "Lupon read assigned evidence"
  ON public.evidence FOR SELECT
  USING (public.lupon_is_assigned_to(complaint_id));

-- ── storage: private buckets, assigned cases only ──────────
-- Object names are NOT parsed. Official document paths are
-- 'complaints/<complaint_id>/<file>' but OfficialDocuments.jsx
-- also writes 'documents/<timestamp>-<file>', and evidence paths
-- are '<resident uid>/<file>'. Parsing the name would both miss
-- rows and risk a cast error on a non-uuid segment.
--
-- Instead each object is authorised by joining its name to the
-- metadata table that already owns that path and carries
-- complaint_id. This is convention-independent and cannot throw.
DROP POLICY IF EXISTS "Lupon read assigned documents storage" ON storage.objects;
CREATE POLICY "Lupon read assigned documents storage"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'documents'
    AND EXISTS (
      SELECT 1
      FROM public.official_documents od
      WHERE od.storage_path = storage.objects.name
        AND public.lupon_is_assigned_to(od.complaint_id)
    )
  );

DROP POLICY IF EXISTS "Lupon read assigned evidence storage" ON storage.objects;
CREATE POLICY "Lupon read assigned evidence storage"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'evidence'
    AND EXISTS (
      SELECT 1
      FROM public.evidence e
      WHERE e.storage_path = storage.objects.name
        AND public.lupon_is_assigned_to(e.complaint_id)
    )
  );

-- Members upload nothing: minutes and attendance are text rows,
-- and any signed scan is attached by an official. An INSERT
-- policy of (false) is explicit rather than relying on absence.
DROP POLICY IF EXISTS "Lupon upload documents storage" ON storage.objects;
CREATE POLICY "Lupon upload documents storage"
  ON storage.objects FOR INSERT
  WITH CHECK (false);

-- Avatars stay outside the case file. No Lupon storage policy
-- touches the 'avatars' bucket, so a member can read no
-- unrelated resident's profile picture.


-- ── activity_logs: members may not read the audit trail ───
-- The audit log is an official-only surface. A member's own
-- actions are visible to them on the case, not in the log.
-- No policy is created here, so access fails closed.


-- ============================================================
-- SECTION H. RPCs (the only sanctioned write paths)
-- ============================================================
--
-- Each RPC re-checks the caller's assignment and role server
-- side. RLS alone is not relied upon for authorisation decisions
-- made inside a function, and no RPC trusts a role value passed
-- in by the client.


-- ── H1. Convene the Pangkat (starts Day 1 of 15) ──────────
-- Chairperson or Secretary only. Idempotent: calling it twice
-- does not restart the clock or reset extensions.
CREATE OR REPLACE FUNCTION public.lupon_convene_pangkat(p_complaint_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ref        text;
  v_tracker_id uuid;
  v_already    boolean := false;
BEGIN
  IF NOT public.lupon_leads_case(p_complaint_id) THEN
    RAISE EXCEPTION 'Only the Pangkat Chairperson or Secretary may convene the panel.'
      USING ERRCODE = '42501';
  END IF;

  SELECT c.reference_number INTO v_ref
  FROM public.complaints c
  WHERE c.id = p_complaint_id;

  IF v_ref IS NULL THEN
    RAISE EXCEPTION 'Complaint not found.'
      USING ERRCODE = 'P0002';
  END IF;

  -- Was the clock already running BEFORE this call? Captured up
  -- front so the response can report it honestly and so a repeat
  -- call does not silently re-report a first convening.
  SELECT true INTO v_already
  FROM public.pangkat_trackers
  WHERE complaint_id = p_complaint_id
    AND convenes_at IS NOT NULL;

  IF v_already THEN
    RETURN json_build_object(
      'ok', true,
      'already_convened', true,
      'convenes_at', (
        SELECT pt.convenes_at FROM public.pangkat_trackers pt
        WHERE pt.complaint_id = p_complaint_id
      )
    );
  END IF;

  INSERT INTO public.pangkat_trackers (complaint_id)
  VALUES (p_complaint_id)
  ON CONFLICT (complaint_id) DO NOTHING;

  UPDATE public.pangkat_trackers
  SET convenes_at   = now(),
      convened_by   = auth.uid(),
      status        = 'Active',
      updated_at    = now()
  WHERE complaint_id = p_complaint_id
  RETURNING id INTO v_tracker_id;

  PERFORM public.log_activity(
    'pangkat_convened',
    'complaint',
    p_complaint_id,
    v_ref,
    jsonb_build_object('tracker_id', v_tracker_id, 'actor_role', 'lupon')
  );

  -- Every active member of the panel is told the clock started.
  PERFORM public.notify_panel_members(
    p_complaint_id,
    'Pangkat Convened',
    'The Pangkat for case ' || v_ref || ' has officially convened. '
      || 'The 15-day conciliation period has started.'
  );

  RETURN json_build_object(
    'ok', true,
    'tracker_id', v_tracker_id,
    'convenes_at', (
      SELECT pt.convenes_at FROM public.pangkat_trackers pt
      WHERE pt.complaint_id = p_complaint_id
    ),
    'already_convened', COALESCE(v_already, false)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.lupon_convene_pangkat(uuid) TO authenticated;


-- ── H2. Request a deadline extension ──────────────────────
-- A member may REQUEST. Only an official may APPROVE, and the
-- total approved extension is hard-capped at 15 additional days
-- by both the column CHECK and the guard below.
CREATE OR REPLACE FUNCTION public.lupon_request_extension(
  p_complaint_id uuid,
  p_days         integer,
  p_reason       text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT public.lupon_is_assigned_to(p_complaint_id) THEN
    RAISE EXCEPTION 'You are not assigned to this case.'
      USING ERRCODE = '42501';
  END IF;

  -- An extension only has meaning once the 15-day period is
  -- actually running. Before the Pangkat convenes there is no
  -- deadline to move, so a request raised at that point would sit
  -- Pending forever with nothing to extend.
  IF NOT EXISTS (
    SELECT 1
    FROM public.pangkat_trackers pt
    WHERE pt.complaint_id = p_complaint_id
      AND pt.convenes_at IS NOT NULL
      AND pt.status NOT IN ('Concluded', 'Terminated')
  ) THEN
    RAISE EXCEPTION 'The Pangkat has not convened yet, so there is no period to extend.'
      USING ERRCODE = '22023';
  END IF;

  IF p_days IS NULL OR p_days < 1 OR p_days > 15 THEN
    RAISE EXCEPTION 'An extension must be between 1 and 15 days.'
      USING ERRCODE = '22023';
  END IF;

  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'A reason is required for a deadline extension.'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.pangkat_extensions (complaint_id, requested_days, reason, requested_by)
  VALUES (p_complaint_id, p_days, btrim(p_reason), auth.uid())
  RETURNING id INTO v_id;

  PERFORM public.log_activity(
    'pangkat_extension_requested',
    'complaint',
    p_complaint_id,
    (SELECT c.reference_number FROM public.complaints c WHERE c.id = p_complaint_id),
    jsonb_build_object('requested_days', p_days, 'extension_id', v_id, 'actor_role', 'lupon')
  );

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.lupon_request_extension(uuid, integer, text) TO authenticated;


-- ── H3. Approve or reject an extension (official only) ─────
CREATE OR REPLACE FUNCTION public.decide_pangkat_extension(
  p_extension_id uuid,
  p_approve      boolean,
  p_note         text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ext      public.pangkat_extensions%ROWTYPE;
  v_granted  integer;
  v_total    integer;
BEGIN
  IF NOT public.is_active_official() THEN
    RAISE EXCEPTION 'Only an active barangay official may decide an extension.'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_ext
  FROM public.pangkat_extensions
  WHERE id = p_extension_id
  FOR UPDATE;

  IF v_ext.id IS NULL THEN
    RAISE EXCEPTION 'Extension request not found.'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_ext.status <> 'Pending' THEN
    RAISE EXCEPTION 'This request has already been decided.'
      USING ERRCODE = '22023';
  END IF;

  IF p_approve THEN
    -- Sum of approved days must stay within the 15-day cap.
    SELECT COALESCE(SUM(requested_days), 0) INTO v_total
    FROM public.pangkat_extensions
    WHERE complaint_id = v_ext.complaint_id
      AND status = 'Approved';

    IF v_total + v_ext.requested_days > 15 THEN
      RAISE EXCEPTION
        'The total extension cannot exceed 15 days (already approved: %, requested: %).',
        v_total, v_ext.requested_days
        USING ERRCODE = '22023';
    END IF;

    v_granted := v_ext.requested_days;

    UPDATE public.pangkat_extensions
    SET status = 'Approved', decided_by = auth.uid(), decided_at = now(), decision_note = p_note
    WHERE id = p_extension_id;

    UPDATE public.pangkat_trackers
    SET extension_days       = extension_days + v_granted,
        extension_reason     = v_ext.reason,
        extension_approved_by = auth.uid(),
        extension_approved_at = now(),
        updated_at           = now()
    WHERE complaint_id = v_ext.complaint_id;
  ELSE
    v_granted := 0;

    UPDATE public.pangkat_extensions
    SET status = 'Rejected', decided_by = auth.uid(), decided_at = now(), decision_note = p_note
    WHERE id = p_extension_id;
  END IF;

  PERFORM public.log_activity(
    CASE WHEN p_approve THEN 'pangkat_extension_approved' ELSE 'pangkat_extension_rejected' END,
    'complaint',
    v_ext.complaint_id,
    (SELECT c.reference_number FROM public.complaints c WHERE c.id = v_ext.complaint_id),
    jsonb_build_object('days', v_granted, 'extension_id', p_extension_id, 'actor_role', 'official')
  );

  PERFORM public.notify_panel_members(
    v_ext.complaint_id,
    CASE WHEN p_approve THEN 'Deadline Extension Approved' ELSE 'Deadline Extension Declined' END,
    CASE
      WHEN p_approve THEN 'An extension of ' || v_granted || ' day(s) was approved for this case.'
      ELSE 'The requested deadline extension was declined.'
    END
  );

  RETURN json_build_object('ok', true, 'granted_days', v_granted);
END;
$$;

GRANT EXECUTE ON FUNCTION public.decide_pangkat_extension(uuid, boolean, text) TO authenticated;


-- ── H4. Record attendance ─────────────────────────────────
-- The upsert needs a unique key on (hearing_id, attendee_label)
-- so a re-save corrects the row instead of duplicating the
-- attendee.
--
-- Deduplication MUST happen before the constraint is added, not
-- after: if legacy duplicate rows exist, a standalone
-- "ADD CONSTRAINT" aborts the whole migration before a cleanup
-- block placed later in the script ever runs. Both steps
-- therefore live in one block, in that order.
--
-- Deletion policy for this block, which contains the ONLY
-- destructive statement in the entire file:
--   * It removes only exact repeats of the same attendee at the
--     same hearing, keeping the earliest row by id.
--   * It never touches rows whose attendee_label differs.
--   * It reports the removed count with RAISE NOTICE, so the
--     removal is never silent.
--   * Nothing else in this migration deletes or truncates data.
DO $$
DECLARE
  v_removed integer;
BEGIN
  DELETE FROM public.hearing_attendances a
  USING public.hearing_attendances b
  WHERE a.id > b.id
    AND a.hearing_id = b.hearing_id
    AND a.attendee_label = b.attendee_label;

  GET DIAGNOSTICS v_removed = ROW_COUNT;

  IF v_removed > 0 THEN
    RAISE NOTICE
      'Removed % duplicate hearing_attendances row(s) to satisfy the one-row-per-attendee constraint.',
      v_removed;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.hearing_attendances'::regclass
      AND conname = 'hearing_attendances_one_per_label'
  ) THEN
    ALTER TABLE public.hearing_attendances
      ADD CONSTRAINT hearing_attendances_one_per_label
      UNIQUE (hearing_id, attendee_label);
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.lupon_record_attendance(
  p_hearing_id     uuid,
  p_attendee_label text,
  p_party_role     text,
  p_status         text,
  p_excuse_reason  text DEFAULT NULL,
  p_attended       boolean DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_complaint_id uuid;
  v_id           uuid;
BEGIN
  SELECT h.complaint_id INTO v_complaint_id
  FROM public.hearings h
  WHERE h.id = p_hearing_id;

  IF v_complaint_id IS NULL THEN
    RAISE EXCEPTION 'Hearing not found.'
      USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.lupon_is_assigned_to(v_complaint_id) THEN
    RAISE EXCEPTION 'You are not assigned to this case.'
      USING ERRCODE = '42501';
  END IF;

  IF p_status IS NULL
     OR p_status NOT IN ('Present', 'Absent', 'Late', 'Excused', 'Not Recorded') THEN
    RAISE EXCEPTION 'Invalid attendance status.'
      USING ERRCODE = '22023';
  END IF;

  IF p_status = 'Excused' AND (p_excuse_reason IS NULL OR btrim(p_excuse_reason) = '') THEN
    RAISE EXCEPTION 'An excused attendee needs a reason.'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.hearing_attendances (
    complaint_id, hearing_id, attendee_label, party_role,
    attendance_status, excuse_reason, attended, recorded_by, recorded_at
  )
  VALUES (
    v_complaint_id, p_hearing_id, btrim(p_attendee_label), p_party_role,
    p_status, NULLIF(btrim(COALESCE(p_excuse_reason, '')), ''),
    COALESCE(p_attended, p_status = 'Present'),
    auth.uid(), now()
  )
  ON CONFLICT (hearing_id, attendee_label) DO UPDATE
    SET attendance_status = EXCLUDED.attendance_status,
        excuse_reason     = EXCLUDED.excuse_reason,
        party_role        = EXCLUDED.party_role,
        recorded_by       = EXCLUDED.recorded_by,
        recorded_at       = EXCLUDED.recorded_at
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.lupon_record_attendance(uuid, text, text, text, text, boolean) TO authenticated;


-- ── H5. Save a DRAFT of the minutes ───────────────────────
-- Only the Secretary or Chairperson writes. A plain member may
-- read a draft but cannot author one, so attendance notes and
-- the agreed terms are never entered by an unauthorised hand.
CREATE OR REPLACE FUNCTION public.lupon_save_minutes_draft(
  p_hearing_id   uuid,
  p_narrative    text,
  p_agreements   text DEFAULT NULL,
  p_next_step    text DEFAULT NULL,
  p_hearing_date date DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_complaint_id uuid;
  v_minutes_id   uuid;
BEGIN
  SELECT h.complaint_id INTO v_complaint_id
  FROM public.hearings h
  WHERE h.id = p_hearing_id;

  IF v_complaint_id IS NULL THEN
    RAISE EXCEPTION 'Hearing not found.'
      USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.lupon_leads_case(v_complaint_id) THEN
    RAISE EXCEPTION 'Only the Pangkat Chairperson or Secretary may draft the minutes.'
      USING ERRCODE = '42501';
  END IF;

  IF p_narrative IS NULL OR btrim(p_narrative) = '' THEN
    RAISE EXCEPTION 'The minutes narrative cannot be empty.'
      USING ERRCODE = '22023';
  END IF;

  SELECT id INTO v_minutes_id
  FROM public.hearing_minutes
  WHERE hearing_id = p_hearing_id
    AND status <> 'Final'
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_minutes_id IS NULL THEN
    INSERT INTO public.hearing_minutes (
      complaint_id, hearing_id, status, narrative,
      agreements, next_step, author_id
    )
    VALUES (
      v_complaint_id, p_hearing_id, 'Draft', btrim(p_narrative),
      NULLIF(btrim(COALESCE(p_agreements, '')), ''),
      NULLIF(btrim(COALESCE(p_next_step, '')), ''),
      auth.uid()
    )
    RETURNING id INTO v_minutes_id;
  ELSE
    -- A returned record is reopened as a fresh draft so the
    -- author can address the reviewer's note.
    UPDATE public.hearing_minutes
    SET narrative  = btrim(p_narrative),
        agreements = NULLIF(btrim(COALESCE(p_agreements, '')), ''),
        next_step  = NULLIF(btrim(COALESCE(p_next_step, '')), ''),
        status     = 'Draft',
        submitted_at = NULL,
        submitted_by = NULL,
        updated_at = now()
    WHERE id = v_minutes_id
    RETURNING id INTO v_minutes_id;
  END IF;

  RETURN v_minutes_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.lupon_save_minutes_draft(uuid, text, text, text, date) TO authenticated;


-- ── H6. Minutes lifecycle transitions ─────────────────────
-- One function, one explicit transition table. The client never
-- supplies the new status as a free string; it supplies an
-- action, and the server decides the resulting state.
CREATE OR REPLACE FUNCTION public.lupon_minutes_action(
  p_minutes_id uuid,
  p_action     text,
  p_note       text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_m   public.hearing_minutes%ROWTYPE;
  v_ref text;
  v_to  text;
BEGIN
  SELECT * INTO v_m
  FROM public.hearing_minutes
  WHERE id = p_minutes_id
  FOR UPDATE;

  IF v_m.id IS NULL THEN
    RAISE EXCEPTION 'Minutes record not found.'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT c.reference_number INTO v_ref
  FROM public.complaints c
  WHERE c.id = v_m.complaint_id;

  -- ── submit: author or either lead, Draft -> Submitted ───
  IF p_action = 'submit' THEN
    IF NOT public.lupon_leads_case(v_m.complaint_id) THEN
      RAISE EXCEPTION 'Only the Pangkat Chairperson or Secretary may submit minutes.'
        USING ERRCODE = '42501';
    END IF;
    IF v_m.status NOT IN ('Draft', 'Returned for Correction') THEN
      RAISE EXCEPTION 'Only a draft can be submitted (current: %).', v_m.status
        USING ERRCODE = '22023';
    END IF;

    v_to := 'Submitted for Review';
    UPDATE public.hearing_minutes
    SET status = v_to, submitted_at = now(), submitted_by = auth.uid(), updated_at = now()
    WHERE id = p_minutes_id;

  -- ── return: official only, Submitted -> Returned ─────────
  ELSIF p_action = 'return' THEN
    IF NOT public.is_active_official() THEN
      RAISE EXCEPTION 'Only an active barangay official may return minutes for correction.'
        USING ERRCODE = '42501';
    END IF;
    IF v_m.status <> 'Submitted for Review' THEN
      RAISE EXCEPTION 'Only minutes awaiting review can be returned (current: %).', v_m.status
        USING ERRCODE = '22023';
    END IF;
    IF p_note IS NULL OR btrim(p_note) = '' THEN
      RAISE EXCEPTION 'A correction note is required when returning minutes.'
        USING ERRCODE = '22023';
    END IF;

    v_to := 'Returned for Correction';
    UPDATE public.hearing_minutes
    SET status         = v_to,
        returned_reason = btrim(p_note),
        returned_at     = now(),
        returned_by     = auth.uid(),
        return_count    = return_count + 1,
        updated_at      = now()
    WHERE id = p_minutes_id;

  -- ── attest: Chairperson or Secretary, Submitted -> Attested
  ELSIF p_action = 'attest' THEN
    IF NOT public.lupon_leads_case(v_m.complaint_id) THEN
      RAISE EXCEPTION 'Only the Pangkat Chairperson or Secretary may attest the minutes.'
        USING ERRCODE = '42501';
    END IF;
    IF v_m.status <> 'Submitted for Review' THEN
      RAISE EXCEPTION 'Only submitted minutes can be attested (current: %).', v_m.status
        USING ERRCODE = '22023';
    END IF;

    v_to := 'Attested';
    UPDATE public.hearing_minutes
    SET status = v_to, attested_at = now(), attested_by = auth.uid(), updated_at = now()
    WHERE id = p_minutes_id;

  -- ── finalize: SECRETARY ONLY, Attested -> Final ──────────
  ELSIF p_action = 'finalize' THEN
    IF NOT public.lupon_is_case_secretary(v_m.complaint_id) THEN
      RAISE EXCEPTION 'Only the Pangkat Secretary may finalise the minutes.'
        USING ERRCODE = '42501';
    END IF;
    IF v_m.status <> 'Attested' THEN
      RAISE EXCEPTION 'Only attested minutes can be finalised (current: %).', v_m.status
        USING ERRCODE = '22023';
    END IF;

    v_to := 'Final';
    UPDATE public.hearing_minutes
    SET status = v_to, finalized_at = now(), finalized_by = auth.uid(), updated_at = now()
    WHERE id = p_minutes_id;

  ELSE
    RAISE EXCEPTION 'Unknown minutes action: %', p_action
      USING ERRCODE = '22023';
  END IF;

  PERFORM public.log_activity(
    'lupon_minutes_' || p_action,
    'hearing_minutes',
    p_minutes_id,
    v_ref,
    jsonb_build_object('from_status', v_m.status, 'to_status', v_to, 'actor_role', 'lupon')
  );

  PERFORM public.notify_panel_members(
    v_m.complaint_id,
    'Minutes ' || v_to,
    'The minutes for case ' || v_ref || ' are now: ' || v_to || '.'
  );

  RETURN json_build_object('ok', true, 'status', v_to);
END;
$$;

GRANT EXECUTE ON FUNCTION public.lupon_minutes_action(uuid, text, text) TO authenticated;


-- ── H7. Record the conciliation outcome ───────────────────
-- Chairperson or Secretary only. This NEVER changes
-- complaints.current_status and NEVER releases a Certificate to
-- File Action. It marks the Pangkat tracker concluded and stops
-- the day counter, leaving the disposition to the Captain.
CREATE OR REPLACE FUNCTION public.lupon_record_outcome(
  p_complaint_id      uuid,
  p_outcome_type      text,
  p_summary           text,
  p_terms             text DEFAULT NULL,
  p_absence_recorded boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id  uuid;
  v_ref text;
BEGIN
  IF NOT public.lupon_leads_case(p_complaint_id) THEN
    RAISE EXCEPTION 'Only the Pangkat Chairperson or Secretary may record the outcome.'
      USING ERRCODE = '42501';
  END IF;

  IF p_outcome_type IS NULL OR p_outcome_type NOT IN (
    'Amicably Settled', 'Failed to Settle', 'Withdrawn',
    'Referred to Court', 'Referred to Another Office', 'No Appearance'
  ) THEN
    RAISE EXCEPTION 'Invalid outcome type.'
      USING ERRCODE = '22023';
  END IF;

  IF p_summary IS NULL OR btrim(p_summary) = '' THEN
    RAISE EXCEPTION 'A summary is required.'
      USING ERRCODE = '22023';
  END IF;

  IF p_outcome_type = 'Amicably Settled'
     AND (p_terms IS NULL OR btrim(p_terms) = '') THEN
    RAISE EXCEPTION 'An amicable settlement must record the terms agreed.'
      USING ERRCODE = '22023';
  END IF;

  SELECT c.reference_number INTO v_ref
  FROM public.complaints c
  WHERE c.id = p_complaint_id;

  IF v_ref IS NULL THEN
    RAISE EXCEPTION 'Complaint not found.'
      USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.case_outcomes (
    complaint_id, outcome_type, summary, terms,
    absence_recorded, recorded_by
  )
  VALUES (
    p_complaint_id, p_outcome_type, btrim(p_summary),
    NULLIF(btrim(COALESCE(p_terms, '')), ''),
    COALESCE(p_absence_recorded, false),
    auth.uid()
  )
  ON CONFLICT (complaint_id) DO UPDATE
    SET outcome_type     = EXCLUDED.outcome_type,
        summary          = EXCLUDED.summary,
        terms            = EXCLUDED.terms,
        absence_recorded = EXCLUDED.absence_recorded,
        recorded_by      = EXCLUDED.recorded_by,
        updated_at       = now()
  RETURNING id INTO v_id;

  -- Stop the clock. The complaint status is intentionally NOT
  -- touched: the Captain decides the disposition.
  UPDATE public.pangkat_trackers
  SET status         = CASE WHEN p_outcome_type = 'Withdrawn' THEN 'Terminated' ELSE 'Concluded' END,
      concluded_at   = now(),
      conclusion_note = p_outcome_type,
      updated_at     = now()
  WHERE complaint_id = p_complaint_id;

  PERFORM public.log_activity(
    'lupon_outcome_recorded',
    'complaint',
    p_complaint_id,
    v_ref,
    jsonb_build_object(
      'outcome_type', p_outcome_type,
      'absence_recorded', COALESCE(p_absence_recorded, false),
      'actor_role', 'lupon'
    )
  );

  PERFORM public.notify_panel_members(
    p_complaint_id,
    'Conciliation Outcome Recorded',
    'The Pangkat recorded "' || p_outcome_type || '" for case ' || v_ref
      || '. The case status remains with the Barangay Captain.'
  );

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.lupon_record_outcome(uuid, text, text, text, boolean) TO authenticated;


-- ── H8. My assignments (the dashboard query) ──────────────
-- Assignment isolation enforced in one place so the portal
-- never builds a query it could accidentally widen later.
CREATE OR REPLACE FUNCTION public.lupon_my_assignments()
RETURNS TABLE (
  complaint_id       uuid,
  reference_number   text,
  title              text,
  current_status     text,
  my_role            text,
  assigned_at        timestamptz,
  convenes_at        timestamptz,
  tracker_status     text,
  day_number         integer,
  total_days         integer,
  days_left          integer,
  deadline_on        date,
  next_hearing_id    uuid,
  next_hearing_date  date,
  next_hearing_time  time,
  minutes_status     text,
  outcome_type       text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    c.id,
    c.reference_number,
    c.title,
    c.current_status,
    lp.role,
    lp.assigned_at,
    pt.convenes_at,
    pt.status,
    pr.day_number,
    pr.total_days,
    pr.days_left,
    pr.deadline_on,
    nh.id,
    nh.hearing_date,
    nh.hearing_time,
    hm.status,
    co.outcome_type
  FROM public.lupon_panels lp
  JOIN public.complaints c
    ON c.id = lp.complaint_id
  LEFT JOIN public.pangkat_trackers pt
    ON pt.complaint_id = c.id
  LEFT JOIN LATERAL public.pangkat_day_progress(c.id) pr ON true
  LEFT JOIN LATERAL (
    SELECT h.id, h.hearing_date, h.hearing_time
    FROM public.hearings h
    WHERE h.complaint_id = c.id
      AND h.hearing_date >= CURRENT_DATE
    ORDER BY h.hearing_date ASC, COALESCE(h.hearing_time, '00:00') ASC
    LIMIT 1
  ) nh ON true
  LEFT JOIN LATERAL (
    SELECT m.status
    FROM public.hearing_minutes m
    WHERE m.complaint_id = c.id
      AND m.status <> 'Final'
    ORDER BY m.created_at DESC
    LIMIT 1
  ) hm ON true
  LEFT JOIN public.case_outcomes co
    ON co.complaint_id = c.id
  WHERE lp.member_id = auth.uid()
    AND lp.status = 'active'
    AND public.is_active_lupon()
  ORDER BY
    -- Unconvened first, then the most urgent day counter.
    (pt.convenes_at IS NULL) DESC,
    pr.days_left NULLS LAST,
    nh.hearing_date NULLS LAST;
$$;

GRANT EXECUTE ON FUNCTION public.lupon_my_assignments() TO authenticated;


-- ============================================================
-- SECTION I. Panel notification helper
-- ============================================================

-- Notifies every ACTIVE member of the panel. Reads lupon_panels
-- as the definer so a member's own notification is not blocked
-- by a policy that only exposes their co-members.
-- Defined here but called from Section H; PL/pgSQL resolves
-- function names at execution time, so definition order inside
-- a single script does not matter.
CREATE OR REPLACE FUNCTION public.notify_panel_members(
  p_complaint_id uuid,
  p_title        text,
  p_message      text,
  p_type         text DEFAULT 'general'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.notifications (user_id, type, title, message, related_complaint_id)
  SELECT lp.member_id, p_type, p_title, p_message, p_complaint_id
  FROM public.lupon_panels lp
  WHERE lp.complaint_id = p_complaint_id
    AND lp.status = 'active';
END;
$$;

-- PostgreSQL grants EXECUTE to PUBLIC on every new function. This
-- one is SECURITY DEFINER and takes an arbitrary complaint id, so
-- leaving it callable by anon/authenticated would let a signed-in
-- resident insert notification rows for any case they can guess a
-- uuid for. It is only ever called from other SECURITY DEFINER
-- functions, which bypass this grant, so restricting it is safe.
REVOKE EXECUTE ON FUNCTION public.notify_panel_members(uuid, text, text, text)
  FROM PUBLIC, anon, authenticated;

-- Notify the panel the moment the Captain assigns or replaces a
-- member, so an assignment is not something a member has to
-- discover by opening the portal.
CREATE OR REPLACE FUNCTION public.trg_notify_panel_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ref text;
BEGIN
  IF NEW.status <> 'active' THEN
    RETURN NEW;
  END IF;

  SELECT c.reference_number INTO v_ref
  FROM public.complaints c
  WHERE c.id = NEW.complaint_id;

  INSERT INTO public.notifications (user_id, type, title, message, related_complaint_id)
  VALUES (
    NEW.member_id,
    'complaint',
    CASE WHEN TG_OP = 'INSERT' THEN 'New Pangkat Assignment' ELSE 'Pangkat Assignment Updated' END,
    'You have been assigned to case ' || COALESCE(v_ref, NEW.complaint_id::text)
      || ' as ' || NEW.role || '.',
    NEW.complaint_id
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_panel_assignment ON public.lupon_panels;
CREATE TRIGGER trg_notify_panel_assignment
  AFTER INSERT OR UPDATE ON public.lupon_panels
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_notify_panel_assignment();


-- ============================================================
-- SECTION J. Verification
-- ============================================================

-- J1. Every table the portal reads/writes has RLS enabled.
SELECT 'J1 rls_enabled' AS check_name,
       c.relname AS object,
       c.relrowsecurity AS ok
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN (
    'pangkat_trackers', 'pangkat_extensions', 'hearing_minutes',
    'case_outcomes', 'hearing_attendances', 'lupon_panels',
    'complaints', 'hearings', 'official_documents', 'evidence'
  )
ORDER BY c.relname;

-- J2. No policy lets a lupon member write complaints.current_status.
-- Expect zero rows.
SELECT 'J2 lupon_write_leak' AS check_name, policyname, tablename
FROM pg_policies
WHERE schemaname = 'public'
  AND 'lupon' ILIKE policyname
  AND (cmd IN ('INSERT', 'UPDATE', 'ALL', 'DELETE'))
  AND tablename = 'complaints';

-- J3. The role CHECK now accepts a secretary.
-- NOTE: the alias is required. The bare `oid` reference resolves against the
-- FROM-clause scope in the Supabase SQL editor and fails with
-- "column \"oid\" does not exist" (42703). `c.oid` is an unambiguous
-- system-column reference.
SELECT 'J3 panel_roles' AS check_name, c.conname AS constraint_name,
       pg_get_constraintdef(c.oid) AS definition
FROM pg_constraint c
WHERE c.conname = 'lupon_panels_role_check';

-- J4. Helper functions exist and are executable by authenticated.
SELECT 'J4 rpcs' AS check_name, p.proname, pg_get_function_identity_arguments(p.oid) AS args
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname LIKE 'lupon%'
ORDER BY p.proname;
