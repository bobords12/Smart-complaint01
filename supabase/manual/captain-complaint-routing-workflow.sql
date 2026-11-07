-- ============================================================
-- Captain Complaint Routing — Workflow (Unknown Respondents)
-- ============================================================
-- PURPOSE
--   Adds the data model and the server-side rules for routing a
--   complaint whose respondent is unknown, was never identified, or
--   whose Katarungang Pambarangay (KP) applicability is still undecided.
--   It also records what the submission is (complaint nature), whether
--   it is complete (completeness review), the incident specifics of a
--   reported-incident case, and every outside-assistance referral.
--
--   The whole point of this file is the GATE. While a complaint has
--   not cleared routing assessment, the barangay must not be able to
--   summon a party, hold a hearing, convene a Pangkat, or start a
--   15-day clock. That is enforced HERE, in the database, not only in
--   the user interface, because an interface gate is a suggestion and
--   a database gate is a rule.
--
-- NON-DESTRUCTIVE
--   * No table is dropped, truncated or renamed.
--   * No existing column is retype, renamed or re-constrained.
--   * Existing complaints are backfilled to an OPEN gate so that no
--     live case loses access to summons/hearings it could already use.
--   * NEW complaints get a CLOSED gate by default: the Captain must
--     assess them before party-facing steps become possible.
--   * Every object is created with IF NOT EXISTS / OR REPLACE and
--     every trigger is dropped before it is created, so the file can
--     be applied more than once.
--
-- REUSE (nothing here duplicates an existing table)
--   * blotter_records.complaint_id   — the blotter link already exists.
--   * kp_trackers.kp_applicable      — the KP applicability decision
--                                     is mirrored onto the existing
--                                     tracker, not stored twice.
--   * case_statuses                  — resident-safe status messages.
--   * notifications                  — resident notifications.
--   * activity_logs / log_activity() — the audit trail.
--   * profiles                       — actor references.
--
-- HOW TO USE
--   1. Back up the database.
--   2. Run this file in the Supabase SQL editor.
--   3. Run captain-complaint-routing-rls.sql.
--   4. Run captain-complaint-routing-verification.sql (read-only).
--
-- ORDER NOTE
--   This file is self-contained. It does NOT require
--   captain_workflow_categorization_stage.sql, and it only uses
--   complaint_status values that exist in 01_extensions_and_enums.sql
--   ('Pending Review','Received','In Progress','Resolved','Closed',
--   'Rejected'), so it can be applied before or after that file.
-- ============================================================

-- ── 0. Helper: is the caller allowed to decide routing? ─────────
-- Kept as a function so every RPC and every policy below shares one
-- definition of "may decide routing". Returns FALSE for anon and for
-- residents, so a misconfigured grant cannot open the gate.
CREATE OR REPLACE FUNCTION public.is_routing_official()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND role IN ('captain', 'oic')
      AND account_status = 'active'
  );
$$;

REVOKE ALL ON FUNCTION public.is_routing_official() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_routing_official() TO authenticated;

-- ── 1. Complaints: routing columns ───────────────────────────────
-- All ADD COLUMN IF NOT EXISTS, so re-running is a no-op.
--
-- respondent_status / kp_applicability are the two ASSESSMENTS.
-- routing_status is the DECISION taken from them.
ALTER TABLE public.complaints
  ADD COLUMN IF NOT EXISTS respondent_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS respondent_display_name text,
  ADD COLUMN IF NOT EXISTS respondent_identified_at timestamptz,
  ADD COLUMN IF NOT EXISTS respondent_identified_by uuid
    REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS kp_applicability text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS kp_applicability_reason text,
  ADD COLUMN IF NOT EXISTS kp_applicability_legal_review boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS routing_status text NOT NULL DEFAULT 'pending_assessment',
  ADD COLUMN IF NOT EXISTS routing_reason text,
  ADD COLUMN IF NOT EXISTS routing_remarks text,
  ADD COLUMN IF NOT EXISTS routing_decided_at timestamptz,
  ADD COLUMN IF NOT EXISTS routing_decided_by uuid
    REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS workflow_gate_open boolean;

-- Constraints. Added separately from the columns so a table that
-- already has the column still gets the check it needs.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'complaints_respondent_status_check'
      AND conrelid = 'public.complaints'::regclass
  ) THEN
    ALTER TABLE public.complaints
      ADD CONSTRAINT complaints_respondent_status_check
      CHECK (respondent_status IN (
        'pending', 'identified', 'unknown',
        'insufficient_information', 'not_applicable'
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'complaints_kp_applicability_check'
      AND conrelid = 'public.complaints'::regclass
  ) THEN
    ALTER TABLE public.complaints
      ADD CONSTRAINT complaints_kp_applicability_check
      CHECK (kp_applicability IN (
        'pending', 'applicable', 'not_applicable',
        'deferred_unknown_respondent', 'requires_legal_review'
      ));
  END IF;

  -- Widened for the full complaint path. The extra values cover every
  -- route a Captain can actually decide: incident documentation, police
  -- / external reporting assistance, a service action, an administrative
  -- review, a request for more information, a duplicate review, and an
  -- "other authorized route" escape hatch that is still recorded.
  -- 'administrative_handling' is kept as an accepted legacy value.
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'complaints_routing_status_check'
      AND conrelid = 'public.complaints'::regclass
  ) THEN
    ALTER TABLE public.complaints DROP CONSTRAINT complaints_routing_status_check;
  END IF;

  ALTER TABLE public.complaints
    ADD CONSTRAINT complaints_routing_status_check
    CHECK (routing_status IN (
      'pending_assessment', 'kp_mediation', 'pangkat_conciliation',
      'incident_documentation', 'police_reporting_assistance',
      'external_agency_assistance', 'service_action',
      'administrative_review', 'administrative_handling',
      'request_additional_information', 'duplicate_review',
      'other_authorized_route',
      'resolved_at_intake', 'rejected', 'withdrawn', 'closed'
    ));

  -- An identified respondent must actually be named. This is what
  -- stops a case being waved through with a placeholder.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'complaints_identified_respondent_named_check'
      AND conrelid = 'public.complaints'::regclass
  ) THEN
    ALTER TABLE public.complaints
      ADD CONSTRAINT complaints_identified_respondent_named_check
      CHECK (
        respondent_status <> 'identified'
        OR NULLIF(btrim(COALESCE(respondent_display_name, '')), '') IS NOT NULL
      );
  END IF;

  -- "KP is not applicable" and "deferred because the respondent is
  -- unknown" are both refusals that must carry a written reason.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'complaints_kp_refusal_reason_check'
      AND conrelid = 'public.complaints'::regclass
  ) THEN
    ALTER TABLE public.complaints
      ADD CONSTRAINT complaints_kp_refusal_reason_check
      CHECK (
        kp_applicability NOT IN ('not_applicable', 'deferred_unknown_respondent')
        OR NULLIF(btrim(COALESCE(kp_applicability_reason, '')), '') IS NOT NULL
      );
  END IF;
END
$$;

-- ── 1b. Complaint nature + submission completeness ───────────────
-- complaint_nature is the SINGLE official selection that says what the
-- submission actually is (what the categorization suggested, confirmed
-- by the Captain). completeness_* is the information check the Captain
-- performs before anything else can be decided.
ALTER TABLE public.complaints
  ADD COLUMN IF NOT EXISTS complaint_nature text,
  ADD COLUMN IF NOT EXISTS completeness_status text NOT NULL DEFAULT 'pending_review',
  ADD COLUMN IF NOT EXISTS completeness_complainant_verified boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS completeness_contact_verified boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS completeness_incident_date_provided boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS completeness_incident_location_provided boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS completeness_narrative_sufficient boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS completeness_evidence_reviewed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS completeness_extra_info_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS completeness_remarks text,
  ADD COLUMN IF NOT EXISTS requested_information text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'complaints_complaint_nature_check'
      AND conrelid = 'public.complaints'::regclass
  ) THEN
    ALTER TABLE public.complaints
      ADD CONSTRAINT complaints_complaint_nature_check
      CHECK (complaint_nature IN (
        'two_party_dispute', 'reported_incident',
        'service_concern', 'administrative_concern',
        'incomplete_submission', 'duplicate_submission',
        'other_requires_review'
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'complaints_completeness_status_check'
      AND conrelid = 'public.complaints'::regclass
  ) THEN
    ALTER TABLE public.complaints
      ADD CONSTRAINT complaints_completeness_status_check
      CHECK (completeness_status IN (
        'pending_review', 'complete',
        'needs_information', 'duplicate', 'invalid_unrelated'
      ));
  END IF;

  -- A complete submission has to have been classified, and a request
  -- for more information has to say what is being asked for.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'complaints_completeness_nature_required_check'
      AND conrelid = 'public.complaints'::regclass
  ) THEN
    ALTER TABLE public.complaints
      ADD CONSTRAINT complaints_completeness_nature_required_check
      CHECK (
        completeness_status <> 'complete'
        OR complaint_nature IS NOT NULL
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'complaints_requested_information_required_check'
      AND conrelid = 'public.complaints'::regclass
  ) THEN
    ALTER TABLE public.complaints
      ADD CONSTRAINT complaints_requested_information_required_check
      CHECK (
        completeness_status <> 'needs_information'
        OR NULLIF(btrim(COALESCE(requested_information, '')), '') IS NOT NULL
      );
  END IF;
END
$$;

-- Completion of the completeness check itself is gated by the same
-- "no official | no decision" rule that guards routing_status.
CREATE OR REPLACE FUNCTION public.guard_completeness_official_writer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.completeness_status IS DISTINCT FROM OLD.completeness_status
     OR NEW.completeness_complainant_verified IS DISTINCT FROM OLD.completeness_complainant_verified
     OR NEW.completeness_contact_verified IS DISTINCT FROM OLD.completeness_contact_verified
     OR NEW.completeness_incident_date_provided IS DISTINCT FROM OLD.completeness_incident_date_provided
     OR NEW.completeness_incident_location_provided IS DISTINCT FROM OLD.completeness_incident_location_provided
     OR NEW.completeness_narrative_sufficient IS DISTINCT FROM OLD.completeness_narrative_sufficient
     OR NEW.completeness_evidence_reviewed IS DISTINCT FROM OLD.completeness_evidence_reviewed
     OR NEW.completeness_extra_info_required IS DISTINCT FROM OLD.completeness_extra_info_required
     OR NEW.completeness_remarks IS DISTINCT FROM OLD.completeness_remarks
     OR NEW.complaint_nature IS DISTINCT FROM OLD.complaint_nature
     OR NEW.requested_information IS DISTINCT FROM OLD.requested_information THEN
    IF NOT public.is_routing_official() THEN
      RAISE EXCEPTION 'Only the Captain or OIC can record routing completeness';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_complaints_completeness_official_writer ON public.complaints;
CREATE TRIGGER trg_complaints_completeness_official_writer
  BEFORE UPDATE OF completeness_status, completeness_complainant_verified,
    completeness_contact_verified, completeness_incident_date_provided,
    completeness_incident_location_provided, completeness_narrative_sufficient,
    completeness_evidence_reviewed, completeness_extra_info_required,
    completeness_remarks, complaint_nature, requested_information
  ON public.complaints
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_completeness_official_writer();

-- ── 1d. Information-request bookkeeping ───────────────────────────
-- Declared here, with the other routing columns, because the
-- completeness and route RPCs below both write them. Keeping them next
-- to the rest of the routing state means no function in this file ever
-- refers to a column that a later statement has not created yet.
--
--   requested_information_at      when the current request was made
--   last_information_response_at when the resident last answered
--
-- Comparing the two lets the Captain tell "still waiting" from
-- "answered, needs re-review" without guessing from a response count,
-- because a case can go through several rounds of requests.
ALTER TABLE public.complaints
  ADD COLUMN IF NOT EXISTS requested_information_at      timestamptz,
  ADD COLUMN IF NOT EXISTS last_information_response_at timestamptz,
  ADD COLUMN IF NOT EXISTS information_responses        integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_complaints_awaiting_information
  ON public.complaints (requested_information_at)
  WHERE requested_information_at IS NOT NULL;

COMMENT ON COLUMN public.complaints.requested_information_at IS
  'When the current information request was made. Restamped on every fresh request, cleared when the review is recorded as complete.';
COMMENT ON COLUMN public.complaints.last_information_response_at IS
  'When the resident last answered an information request. Never set by a client write; only by resident_provide_requested_information().';

-- ── 2. The gate flag ─────────────────────────────────────────────
-- Backfill first, then constrain. Ordering matters:
--   UPDATE  : every complaint that exists right now keeps working.
--   DEFAULT : complaints filed from now on start CLOSED.
--   NOT NULL: the flag is never indeterminate, so no policy or
--             trigger has to reason about NULL.
UPDATE public.complaints
   SET workflow_gate_open = true
 WHERE workflow_gate_open IS NULL;

ALTER TABLE public.complaints
  ALTER COLUMN workflow_gate_open SET DEFAULT false;

ALTER TABLE public.complaints
  ALTER COLUMN workflow_gate_open SET NOT NULL;

COMMENT ON COLUMN public.complaints.workflow_gate_open IS
  'false = routing assessment incomplete: summons, hearings, Lupon and 15-day phases are refused. Backfilled true for pre-existing complaints; defaults false for new ones.';

-- Index for the Captain list filter ("show me the unassessed ones").
CREATE INDEX IF NOT EXISTS idx_complaints_routing_status
  ON public.complaints (routing_status);
CREATE INDEX IF NOT EXISTS idx_complaints_gate_open
  ON public.complaints (workflow_gate_open)
  WHERE workflow_gate_open = false;
CREATE INDEX IF NOT EXISTS idx_complaints_respondent_status
  ON public.complaints (respondent_status);

-- ── 3. complaint_routing_history (append-only) ───────────────────
-- Why a table and not just activity_logs: an activity log row can be
-- read, but a routing decision is legal-adjacent history. It records
-- the BEFORE and AFTER of every assessment so that "why was this
-- summons issued in March when the respondent was unknown in
-- February?" has an answer that does not depend on the complaint row
-- still holding its current value.
--
-- Deliberately NO update and NO delete policy is created for this
-- table anywhere in the RLS file.
CREATE TABLE IF NOT EXISTS public.complaint_routing_history (
  id                 uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  complaint_id       uuid NOT NULL REFERENCES public.complaints(id) ON DELETE CASCADE,
  respondent_status_before text,
  respondent_status_after  text,
  respondent_name_before   text,
  respondent_name_after    text,
  kp_applicability_before  text,
  kp_applicability_after   text,
  routing_status_before    text,
  routing_status_after     text,
  reason             text,
  remarks            text,
  resident_message   text,
  -- Denormalised so the trail stays readable if a profile is removed.
  acted_by           uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  acted_by_name      text,
  acted_by_role      text,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_routing_history_complaint
  ON public.complaint_routing_history (complaint_id, created_at DESC);

-- Nature and completeness are part of the routing trail too, so the
-- history records their before/after on the same append-only row.
ALTER TABLE public.complaint_routing_history
  ADD COLUMN IF NOT EXISTS complaint_nature_before text,
  ADD COLUMN IF NOT EXISTS complaint_nature_after text,
  ADD COLUMN IF NOT EXISTS completeness_status_before text,
  ADD COLUMN IF NOT EXISTS completeness_status_after text;

-- ── 4. complaint_assistance_records (append-only) ────────────────
-- A record that the barangay referred or assisted a complainant in
-- obtaining outside help. This is NOT a police report: it asserts
-- only that an official recorded a referral, and never that any
-- agency accepted the case, opened a file, or took action.
--
-- 'police_reporting_assistance' and 'external_agency_assistance'
-- mirror complaints.routing_status so the route and the record can
-- never disagree.
CREATE TABLE IF NOT EXISTS public.complaint_assistance_records (
  id                uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  complaint_id      uuid NOT NULL REFERENCES public.complaints(id) ON DELETE CASCADE,
  assistance_type   text NOT NULL
                    CHECK (assistance_type IN (
                      'police_reporting_assistance',
                      'external_agency_assistance'
                    )),
  -- Free text on purpose. A referral letterhead varies and a rigid
  -- enum would force a wrong value. Required: the column has NOT NULL
  -- and the RPC rejects blank strings.
  agency_name       text NOT NULL,
  -- Optional. The absence of a number is a normal, valid state and is
  -- the reason no column implies an agency has responded.
  reference_number  text,
  assistance_type_detail text,
  -- What the complainant was told / what the barangay did.
  assistance_given  text,
  -- "The barangay assisted the complainant in filing." Nothing more.
  assistance_summary text,
  -- Whether a follow-up is expected. Never auto-answered.
  follow_up_required boolean NOT NULL DEFAULT false,
  follow_up_due_on   date,
  -- Whatever the official recorded. Free text, so it can honestly say
  -- "pending" or "no response received" without inventing a status.
  recorded_outcome  text,
  related_document_id uuid REFERENCES public.official_documents(id) ON DELETE SET NULL,
  recorded_by       uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  recorded_by_name  text,
  recorded_at       timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT assistance_agency_name_required
    CHECK (NULLIF(btrim(agency_name), '') IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_assistance_complaint
  ON public.complaint_assistance_records (complaint_id, recorded_at DESC);

-- ── 4b. complaint_assistance_records granular assistance types ────
-- The current CHECK only allowed the two route-mirrored values. The
-- accepted types are now the granular things an official actually does
-- when assisting a complainant. 'police_reporting_assistance' and
-- 'external_agency_assistance' are kept as accepted legacy values.
--
-- "Receiving office, if known" is optional now, so agency_name is made
-- nullable and the old NOT NULL constraint is replaced by a softer one:
-- each record must name an agency on file OR describe the assistance.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'complaint_assistance_records_assistance_type_check'
      AND conrelid = 'public.complaint_assistance_records'::regclass
  ) THEN
    ALTER TABLE public.complaint_assistance_records
      DROP CONSTRAINT complaint_assistance_records_assistance_type_check;
  END IF;
END
$$;

ALTER TABLE public.complaint_assistance_records
  ADD CONSTRAINT complaint_assistance_records_assistance_type_check
  CHECK (assistance_type IN (
    'advised_to_report',            -- Resident advised to report to the proper authority
    'assisted_preparing_report',    -- Assisted in preparing the external report
    'barangay_endorsement',         -- Barangay endorsement / referral letter issued
    'existing_report_acknowledged', -- A report the resident already filed was acknowledged
    'emergency_assistance_advised', -- Emergency hotline / first-response assistance advised
    'police_reporting_assistance',  -- legacy: police referral
    'external_agency_assistance',   -- legacy: other-agency referral
    'other_authorized_assistance'
  ));

ALTER TABLE public.complaint_assistance_records
  ALTER COLUMN agency_name DROP NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'assistance_agency_name_required'
      AND conrelid = 'public.complaint_assistance_records'::regclass
  ) THEN
    ALTER TABLE public.complaint_assistance_records
      DROP CONSTRAINT assistance_agency_name_required;
  END IF;
END
$$;

ALTER TABLE public.complaint_assistance_records
  ADD CONSTRAINT assistance_agency_name_required
  CHECK (
    NULLIF(btrim(COALESCE(agency_name, '')), '') IS NOT NULL
    OR NULLIF(btrim(COALESCE(assistance_given, '')), '') IS NOT NULL
    OR NULLIF(btrim(COALESCE(assistance_summary, '')), '') IS NOT NULL
  );

COMMENT ON COLUMN public.complaint_assistance_records.agency_name IS
  'Receiving office, if known. Null when no office can be named yet, e.g. the resident was only advised to report.';

-- ── 4c. complaint_incident_details ────────────────────────────────
-- Captured ONLY for reported-incident complaints (no other party, or a
-- respondent the reporting party cannot name). One row per complaint:
-- the reporting party feeds the underlying complaint record, this row
-- holds the incident specifics that matter to the police.
CREATE TABLE IF NOT EXISTS public.complaint_incident_details (
  id                uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  complaint_id      uuid NOT NULL UNIQUE REFERENCES public.complaints(id) ON DELETE CASCADE,
  property_description text,
  incident_value     text,
  proof_of_ownership text,
  plate_number      text,
  serial_number     text,
  engine_chassis_number text,
  identifiable_marks text,
  last_known_location text,
  last_known_at     timestamptz,
  witnesses         text,
  cctv_available    boolean NOT NULL DEFAULT false,
  cctv_notes        text,
  evidence_notes    text,
  safety_concern    boolean NOT NULL DEFAULT false,
  safety_notes      text,
  already_reported_externally boolean NOT NULL DEFAULT false,
  externally_reported_where text,
  external_reference text,
  incident_details_other text,
  recorded_by       uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  recorded_by_name  text,
  updated_by        uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_by_name   text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.complaint_incident_details ENABLE ROW LEVEL SECURITY;

-- ── 5. One active blotter record per complaint ───────────────────
-- blotter_records.complaint_id already exists (captain-portal-schema-
-- additions.sql) with a NON-unique index, so a complaint could be
-- linked to several open blotter records. This adds the uniqueness the
-- workflow needs WITHOUT touching the existing column or index, and
-- without a lock that would break the Blotter Records page:
--   * only OPEN records are constrained, so archiving a blotter entry
--     and filing a corrected one still works;
--   * rows with complaint_id IS NULL are excluded, so every existing
--     standalone blotter record (every one of them, today) is
--     unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS uq_blotter_active_per_complaint
  ON public.blotter_records (complaint_id)
  WHERE complaint_id IS NOT NULL
    AND current_status = 'open';

-- ── 6. The gate trigger on party-facing steps ────────────────────
-- A single function, attached to every table that represents "the
-- barangay and a named respondent are now in contact". The check is
-- deliberately narrow: it only refuses when the gate is CLOSED, so
-- nothing about existing behaviour changes.
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
  -- The row is read through to_jsonb(NEW), NOT through typed NEW.<column>
  -- references. This one function is attached to four tables with different
  -- column layouts (hearings/summons/lupon_panels carry complaint_id,
  -- kp_phases carries tracker_id), and in PL/pgSQL a NEW field is resolved
  -- at RUNTIME. Writing COALESCE(NEW.complaint_id, NEW.tracker_id,
  -- NEW.member_id) therefore aborted EVERY insert on every one of those
  -- tables with 42703 "record new has no field tracker_id", whatever the
  -- gate said. A missing key on to_jsonb is just NULL.
  -- See 26_fix_workflow_gate_trigger.sql for the deployed repair.
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

DO $$
DECLARE
  v_target text;
BEGIN
  FOREACH v_target IN ARRAY ARRAY['summons', 'hearings', 'lupon_panels', 'kp_phases']
  LOOP
    IF to_regclass('public.' || v_target) IS NULL THEN
      RAISE NOTICE 'Skipping gate trigger: public.% does not exist yet.', v_target;
      CONTINUE;
    END IF;

    -- format() needs a conversion character after the percent sign. A bare
    -- '%' followed by the closing quote is read as an unterminated type
    -- specifier and the whole block fails with 22023.
    EXECUTE format('DROP TRIGGER IF EXISTS trg_complaint_workflow_gate ON public.%s', v_target);
    EXECUTE format(
      'CREATE TRIGGER trg_complaint_workflow_gate
         BEFORE INSERT ON public.%s
         FOR EACH ROW EXECUTE FUNCTION public.guard_complaint_workflow_gate()',
      v_target
    );
  END LOOP;
END
$$;

-- ── 7. captain_record_respondent_status ─────────────────────────
-- Records WHAT WE KNOW ABOUT THE RESPONDENT. It deliberately does not
-- set a route: knowing the name does not decide where the case goes.
--
-- Re-identification is allowed and expected (a name is often supplied
-- later). It is never destructive: the old value is written to
-- complaint_routing_history before it is overwritten.
CREATE OR REPLACE FUNCTION public.captain_record_respondent_status(
  p_complaint_id        uuid,
  p_respondent_status   text,
  p_respondent_name     text DEFAULT NULL,
  p_reason              text DEFAULT NULL,
  p_resident_message    text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row        public.complaints%ROWTYPE;
  v_name       text;
  v_reason     text;
  v_actor_name text;
  v_actor_role text;
  v_ref        text;
  v_resident   text;
  v_respondent_label text;
BEGIN
  IF NOT public.is_routing_official() THEN
    RAISE EXCEPTION 'Only the Barangay Captain or OIC may record respondent status.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_respondent_status IS NULL
     OR p_respondent_status NOT IN (
       'pending', 'identified', 'unknown',
       'insufficient_information', 'not_applicable'
     ) THEN
    RAISE EXCEPTION 'Invalid respondent status: %', coalesce(p_respondent_status, 'null')
      USING ERRCODE = 'check_violation';
  END IF;

  v_name   := NULLIF(btrim(COALESCE(p_respondent_name, '')), '');
  v_reason := NULLIF(btrim(COALESCE(p_reason, '')), '');

  -- A named status is not a fabricated identity. Naming a respondent
  -- requires a name; every other status forbids pretending to have one
  -- when the official did not supply it.
  IF p_respondent_status = 'identified' AND v_name IS NULL THEN
    RAISE EXCEPTION
      'Recording an identified respondent requires the respondent name. '
      'Use unknown or insufficient_information instead of inventing one.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_respondent_status <> 'identified' AND p_respondent_name IS NOT NULL
     AND btrim(p_respondent_name) <> '' THEN
    RAISE EXCEPTION
      'A respondent name cannot be supplied when the status is %.', p_respondent_status
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_respondent_status IN ('unknown', 'insufficient_information', 'not_applicable')
     AND v_reason IS NULL THEN
    RAISE EXCEPTION
      'A reason is required when the respondent is recorded as %.', p_respondent_status
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_row
    FROM public.complaints
   WHERE id = p_complaint_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Complaint % does not exist.', p_complaint_id
      USING ERRCODE = 'no_data_found';
  END IF;

  SELECT display_name, role::text INTO v_actor_name, v_actor_role
    FROM public.profiles WHERE id = auth.uid();

  v_ref := v_row.reference_number;

  -- ── Resident-safe wording, written once so the UI and the
  --    database cannot drift apart. Neutral, and it never states or
  --    implies that the allegation is true.
  IF p_resident_message IS NOT NULL AND btrim(p_resident_message) <> '' THEN
    v_resident := btrim(p_resident_message);
  ELSE
    v_resident := CASE p_respondent_status
      WHEN 'identified'
        THEN 'An official recorded information about the other party in your complaint. Processing will continue.'
      WHEN 'pending'
        THEN 'An official is still confirming the parties in your complaint. Processing will continue once confirmed.'
      WHEN 'unknown'
        THEN 'The other party in your complaint could not be identified. An official recorded this and will continue reviewing the complaint.'
      WHEN 'insufficient_information'
        THEN 'The information you provided about the other party was not enough to identify them. An official recorded this and may contact you for clarification.'
      WHEN 'not_applicable'
        THEN 'An official recorded that no other party applies to this complaint. Processing will continue.'
    END CASE;
  END IF;

  v_respondent_label := CASE p_respondent_status
    WHEN 'identified' THEN v_name
    WHEN 'pending' THEN 'Pending confirmation'
    WHEN 'unknown' THEN 'Not identified'
    WHEN 'insufficient_information' THEN 'Insufficient information'
    WHEN 'not_applicable' THEN 'Not applicable'
  END;

  -- ── History first: the before-image must exist even if a later
  --    statement in this function fails.
  INSERT INTO public.complaint_routing_history (
    complaint_id,
    respondent_status_before, respondent_status_after,
    respondent_name_before,   respondent_name_after,
    kp_applicability_before,  kp_applicability_after,
    routing_status_before,    routing_status_after,
    reason, remarks, resident_message,
    acted_by, acted_by_name, acted_by_role
  ) VALUES (
    p_complaint_id,
    v_row.respondent_status, p_respondent_status,
    v_row.respondent_display_name, v_name,
    v_row.kp_applicability, v_row.kp_applicability,
    v_row.routing_status, v_row.routing_status,
    v_reason, NULL, v_resident,
    auth.uid(), v_actor_name, v_actor_role
  );

  UPDATE public.complaints
     SET respondent_status        = p_respondent_status,
         respondent_display_name  = CASE WHEN p_respondent_status = 'identified'
                                         THEN v_name ELSE NULL END,
         respondent_identified_at = CASE WHEN p_respondent_status = 'identified'
                                         THEN now() ELSE NULL END,
         respondent_identified_by = CASE WHEN p_respondent_status = 'identified'
                                         THEN auth.uid() ELSE NULL END,
         -- A newly identified respondent invalidates any KP decision
         -- made while the other party was unknown: the case goes back
         -- to assessment. History keeps the earlier decision.
         kp_applicability         = CASE
                                       WHEN p_respondent_status = 'identified'
                                        AND v_row.kp_applicability IN (
                                          'not_applicable',
                                          'deferred_unknown_respondent'
                                        )
                                       THEN 'pending'
                                       ELSE v_row.kp_applicability
                                     END,
         kp_applicability_reason  = CASE
                                       WHEN p_respondent_status = 'identified'
                                        AND v_row.kp_applicability IN (
                                          'not_applicable',
                                          'deferred_unknown_respondent'
                                        )
                                       THEN NULL
                                       ELSE v_row.kp_applicability_reason
                                     END,
         routing_status           = CASE
                                       WHEN p_respondent_status = 'identified'
                                        AND v_row.routing_status = 'pending_assessment'
                                       THEN 'pending_assessment'
                                       ELSE v_row.routing_status
                                     END,
         updated_at               = now()
   WHERE id = p_complaint_id;

  -- Mirror onto the existing tracker. The tracker already owns
  -- kp_applicable; it is updated here so the KP panel and the routing
  -- decision can never show different answers.
  IF EXISTS (SELECT 1 FROM public.kp_trackers WHERE complaint_id = p_complaint_id) THEN
    UPDATE public.kp_trackers
       SET kp_applicable = (p_respondent_status = 'identified'
                            AND v_row.kp_applicability = 'applicable'),
           updated_at   = now()
     WHERE complaint_id = p_complaint_id;
  END IF;

  INSERT INTO public.case_statuses (
    complaint_id, status, stage, resident_visible_message, changed_by
  ) VALUES (
    p_complaint_id,
    v_row.current_status,
    'Respondent Assessment — ' || v_respondent_label,
    v_resident,
    auth.uid()
  );

  IF v_row.resident_id IS NOT NULL THEN
    INSERT INTO public.notifications (
      user_id, type, title, message, related_complaint_id
    ) VALUES (
      v_row.resident_id, 'complaint',
      'Complaint update — ' || COALESCE(v_ref, 'your complaint'),
      v_resident,
      p_complaint_id
    );
  END IF;

  PERFORM public.log_activity(
    'respondent_status_recorded',
    'complaint', p_complaint_id, v_ref,
    jsonb_build_object(
      'respondent_status_before', v_row.respondent_status,
      'respondent_status_after',  p_respondent_status,
      'respondent_name_after',    v_name,
      'reason',                   v_reason
    ),
    jsonb_build_object('respondent_status', v_row.respondent_status,
                       'respondent_display_name', v_row.respondent_display_name),
    jsonb_build_object('respondent_status', p_respondent_status,
                       'respondent_display_name', v_name)
  );

  RETURN json_build_object(
    'respondent_status', p_respondent_status,
    'respondent_display_name', v_name,
    'kp_applicability', (
      SELECT c.kp_applicability FROM public.complaints c WHERE c.id = p_complaint_id
    ),
    'workflow_gate_open', (
      SELECT c.workflow_gate_open FROM public.complaints c WHERE c.id = p_complaint_id
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.captain_record_respondent_status(uuid, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.captain_record_respondent_status(uuid, text, text, text, text) TO authenticated;

-- ── 8. captain_set_routing ──────────────────────────────────────
-- The decision. This is the only path that opens the workflow gate,
-- and it opens it ONLY when the case is genuinely ready:
--
--   * KP mediation / Pangkat require an identified respondent AND
--     kp_applicability = 'applicable'. No exceptions, no override.
--   * Every non-default route requires a written reason.
--   * 'not_applicable' and 'deferred_unknown_respondent' require a
--     KP reason and CLOSE the gate.
--   * 'requires_legal_review' CLOSES the gate, because a matter held
--     for legal review must not start a 15-day clock.
CREATE OR REPLACE FUNCTION public.captain_set_routing(
  p_complaint_id     uuid,
  p_routing_status   text,
  p_kp_applicability text,
  p_kp_reason        text DEFAULT NULL,
  p_reason           text DEFAULT NULL,
  p_remarks          text DEFAULT NULL,
  p_resident_message text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row        public.complaints%ROWTYPE;
  v_kp         text;
  v_kp_reason  text;
  v_reason     text;
  v_remarks    text;
  v_resident   text;
  v_actor_name text;
  v_actor_role text;
  v_ref        text;
  v_route_label text;
  v_open       boolean;
  v_mirrored   boolean;
BEGIN
  IF NOT public.is_routing_official() THEN
    RAISE EXCEPTION 'Only the Barangay Captain or OIC may decide the case route.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_routing_status IS NULL
     OR p_routing_status NOT IN (
       'pending_assessment', 'kp_mediation', 'pangkat_conciliation',
       'incident_documentation', 'police_reporting_assistance',
       'external_agency_assistance', 'service_action',
       'administrative_review', 'administrative_handling',
       'request_additional_information', 'duplicate_review',
       'other_authorized_route',
       'resolved_at_intake', 'rejected', 'withdrawn', 'closed'
     ) THEN
    RAISE EXCEPTION 'Invalid routing status: %', coalesce(p_routing_status, 'null')
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_kp_applicability IS NULL
     OR p_kp_applicability NOT IN (
       'pending', 'applicable', 'not_applicable',
       'deferred_unknown_respondent', 'requires_legal_review'
     ) THEN
    RAISE EXCEPTION 'Invalid KP applicability: %', coalesce(p_kp_applicability, 'null')
      USING ERRCODE = 'check_violation';
  END IF;

  v_kp        := p_kp_applicability;
  v_kp_reason := NULLIF(btrim(COALESCE(p_kp_reason, '')), '');
  v_reason    := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_remarks   := NULLIF(btrim(COALESCE(p_remarks, '')), '');

  SELECT * INTO v_row
    FROM public.complaints
   WHERE id = p_complaint_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Complaint % does not exist.', p_complaint_id
      USING ERRCODE = 'no_data_found';
  END IF;

  v_ref := v_row.reference_number;

  -- ── The refusal rules. Each has its own message so an official is
  --    told exactly which precondition failed.
  IF v_kp IN ('not_applicable', 'deferred_unknown_respondent')
     AND v_kp_reason IS NULL THEN
    RAISE EXCEPTION
      'A written reason is required when KP applicability is recorded as %.', v_kp
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_kp = 'applicable' AND v_row.respondent_status <> 'identified' THEN
    RAISE EXCEPTION
      'KP applicability cannot be set to applicable while the respondent is not identified '
      '(current status: %). Record the respondent first, or choose a different applicability.',
      v_row.respondent_status
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_routing_status IN ('kp_mediation', 'pangkat_conciliation') THEN
    IF v_row.respondent_status <> 'identified' THEN
      RAISE EXCEPTION
        'KP mediation and Pangkat conciliation require an identified respondent. '
        'Summons and mediation are unavailable until a respondent is identified '
        'and KP applicability is confirmed.'
        USING ERRCODE = 'check_violation';
    END IF;

    IF v_kp <> 'applicable' THEN
      RAISE EXCEPTION
        'KP mediation and Pangkat conciliation require KP applicability = applicable '
        '(currently: %).', v_kp
        USING ERRCODE = 'check_violation';
    END IF;

    IF v_reason IS NULL THEN
      RAISE EXCEPTION
        'A written reason is required to route a case to %.', p_routing_status
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- Every route other than "still assessing" and "KP mediation"
  -- needs someone to have written down why.
  IF p_routing_status NOT IN ('pending_assessment', 'kp_mediation', 'pangkat_conciliation')
     AND v_reason IS NULL THEN
    RAISE EXCEPTION
      'A written reason is required to route this case to %.', p_routing_status
      USING ERRCODE = 'check_violation';
  END IF;

  -- ── Resident-safe message.
  IF p_resident_message IS NOT NULL AND btrim(p_resident_message) <> '' THEN
    v_resident := btrim(p_resident_message);
  ELSE
    v_resident := CASE p_routing_status
      WHEN 'pending_assessment'
        THEN 'An official is still assessing your complaint. Processing will continue once the assessment is complete.'
      WHEN 'kp_mediation'
        THEN 'An official determined your complaint may be handled through mediation before the Punong Barangay. The next step will be notified to you.'
      WHEN 'pangkat_conciliation'
        THEN 'An official determined your complaint may be referred to the Pangkat. The next step will be notified to you.'
      WHEN 'police_reporting_assistance'
        THEN 'An official recorded that your complaint was referred for police reporting assistance. Please coordinate with the Philippine National Police directly.'
      WHEN 'external_agency_assistance'
        THEN 'An official recorded that your complaint was referred to another government office for assistance. Please coordinate with that office directly.'
      WHEN 'incident_documentation'
        THEN 'An official recorded the details of the reported incident and referred your complaint for documentation and possible blotter action.'
      WHEN 'administrative_handling'
        THEN 'An official recorded that your complaint will be handled administratively. The next step will be notified to you.'
      WHEN 'service_action'
        THEN 'An official referred your complaint to the appropriate barangay service. The next step will be notified to you.'
      WHEN 'administrative_review'
        THEN 'An official referred your complaint for administrative review. The next step will be notified to you.'
      WHEN 'request_additional_information'
        THEN 'An official needs more information to continue processing your complaint. The barangay will contact you about what is missing.'
      WHEN 'duplicate_review'
        THEN 'An official marked your complaint for review because it appears to duplicate an existing record. See your case record for details.'
      WHEN 'other_authorized_route'
        THEN 'An official recorded another authorized route for your complaint. See your case record for details.'
      WHEN 'resolved_at_intake'
        THEN 'An official resolved your complaint during intake. See your case record for details.'
      WHEN 'rejected'
        THEN concat_ws(' ', 'An official did not accept your complaint.',
                       CASE WHEN v_reason IS NOT NULL THEN 'Reason: ' || v_reason END)
      WHEN 'withdrawn'
        THEN 'An official recorded your complaint as withdrawn.'
      WHEN 'closed'
        THEN 'Your complaint has been closed.'
    END CASE;
  END IF;

  v_route_label := CASE p_routing_status
    WHEN 'pending_assessment'      THEN 'Pending Assessment'
    WHEN 'kp_mediation'            THEN 'KP Mediation'
    WHEN 'pangkat_conciliation'    THEN 'Pangkat Conciliation'
    WHEN 'police_reporting_assistance' THEN 'Police Reporting Assistance'
    WHEN 'external_agency_assistance'  THEN 'External Agency Assistance'
    WHEN 'incident_documentation'       THEN 'Incident Documentation'
    WHEN 'service_action'               THEN 'Service Action'
    WHEN 'administrative_review'        THEN 'Administrative Review'
    WHEN 'administrative_handling'      THEN 'Administrative Handling'
    WHEN 'request_additional_information' THEN 'Request Additional Information'
    WHEN 'duplicate_review'             THEN 'Duplicate Review'
    WHEN 'other_authorized_route'       THEN 'Other Authorized Route'
    WHEN 'resolved_at_intake'      THEN 'Resolved at Intake'
    WHEN 'rejected'                THEN 'Rejected'
    WHEN 'withdrawn'               THEN 'Withdrawn'
    WHEN 'closed'                  THEN 'Closed'
  END;

  -- ── The gate itself.
  --   OPEN  : the route is one the barangay can actually act on
  --           party-to-party (KP mediation / Pangkat) and the case is
  --           ready for it.
  --   SHUT  : everything else. Summons, hearings, Lupon and the
  --           15-day clocks stay refused.
  v_open := (p_routing_status IN ('kp_mediation', 'pangkat_conciliation')
             AND v_kp = 'applicable'
             AND v_row.respondent_status = 'identified');

  -- Even when open, the complaint_status / current_stage must not be
  -- advanced: a gate that is open only permits the NEXT official
  -- action, it does not move the case on its own.
  SELECT display_name, role::text INTO v_actor_name, v_actor_role
    FROM public.profiles WHERE id = auth.uid();

  INSERT INTO public.complaint_routing_history (
    complaint_id,
    respondent_status_before, respondent_status_after,
    respondent_name_before,   respondent_name_after,
    kp_applicability_before,  kp_applicability_after,
    routing_status_before,    routing_status_after,
    reason, remarks, resident_message,
    acted_by, acted_by_name, acted_by_role
  ) VALUES (
    p_complaint_id,
    v_row.respondent_status, v_row.respondent_status,
    v_row.respondent_display_name, v_row.respondent_display_name,
    v_row.kp_applicability, v_kp,
    v_row.routing_status, p_routing_status,
    v_reason, v_remarks, v_resident,
    auth.uid(), v_actor_name, v_actor_role
  );

  UPDATE public.complaints
     SET kp_applicability         = v_kp,
         kp_applicability_reason  = v_kp_reason,
         kp_applicability_legal_review = (v_kp = 'requires_legal_review'),
         routing_status           = p_routing_status,
         routing_reason           = v_reason,
         routing_remarks          = v_remarks,
         routing_decided_at       = now(),
         routing_decided_by       = auth.uid(),
         workflow_gate_open       = v_open,
         -- A case routed straight to "request more information" (without
         -- a separate completeness pass) still has to tell the resident
         -- what is missing and start the clock on their answer. The
         -- wording is the official's own reason, never invented text.
         requested_information_at = CASE
           WHEN p_routing_status = 'request_additional_information' THEN now()
           ELSE requested_information_at
         END,
         requested_information = CASE
           WHEN p_routing_status = 'request_additional_information'
             AND requested_information IS NULL
           THEN v_reason
           ELSE requested_information
         END,
         updated_at               = now()
   WHERE id = p_complaint_id;

  -- ── Mirror KP applicability onto the existing tracker. The tracker
  --    row is created if missing so the Captain list, the Lupon panel
  --    and the routing decision read from one place.
  IF v_kp = 'applicable' THEN
    INSERT INTO public.kp_trackers (
      complaint_id, kp_applicable, current_phase,
      applicability_confirmed_by, applicability_confirmed_at, updated_at
    ) VALUES (
      p_complaint_id, true, 'Assessment', auth.uid(), now(), now()
    )
    ON CONFLICT (complaint_id) DO UPDATE
      SET kp_applicable              = true,
          -- 'Assessment' is the pre-mediation phase. current_phase is
          -- NOT NULL, so it can never be set to NULL here.
          current_phase              = CASE
                                          WHEN kp_trackers.current_phase = 'Not Applicable'
                                          THEN 'Assessment'::public.kp_phase_type
                                          ELSE kp_trackers.current_phase
                                        END,
          applicability_confirmed_by = EXCLUDED.applicability_confirmed_by,
          applicability_confirmed_at = now(),
          updated_at                 = now();
  ELSIF EXISTS (SELECT 1 FROM public.kp_trackers WHERE complaint_id = p_complaint_id) THEN
    UPDATE public.kp_trackers
       SET kp_applicable = false,
           updated_at    = now()
     WHERE complaint_id = p_complaint_id;
  END IF;

  v_mirrored := COALESCE((
    SELECT kt.kp_applicable FROM public.kp_trackers kt WHERE kt.complaint_id = p_complaint_id
  ), false);

  -- ── Resident-safe status row. case_statuses.status is the
  --    complaint_status enum, so only values from 01_extensions_and_
  --    enums.sql are used here.
  INSERT INTO public.case_statuses (
    complaint_id, status, stage, resident_visible_message, changed_by
  ) VALUES (
    p_complaint_id,
    -- Routing never invents a status. It reuses the complaint's own
    -- status so this row describes the routing decision, not a stage
    -- change the Captain did not make.
    v_row.current_status,
    'Routing Decision — ' || v_route_label,
    v_resident,
    auth.uid()
  );

  IF v_row.resident_id IS NOT NULL THEN
    INSERT INTO public.notifications (
      user_id, type, title, message, related_complaint_id
    ) VALUES (
      v_row.resident_id, 'complaint',
      'Complaint update — ' || COALESCE(v_ref, 'your complaint'),
      v_resident,
      p_complaint_id
    );
  END IF;

  PERFORM public.log_activity(
    'complaint_routed',
    'complaint', p_complaint_id, v_ref,
    jsonb_build_object(
      'routing_status_after', p_routing_status,
      'kp_applicability_after', v_kp,
      'workflow_gate_open', v_open,
      'reason', v_reason,
      'remarks', v_remarks
    ),
    jsonb_build_object(
      'routing_status', v_row.routing_status,
      'kp_applicability', v_row.kp_applicability,
      'workflow_gate_open', v_row.workflow_gate_open
    ),
    jsonb_build_object(
      'routing_status', p_routing_status,
      'kp_applicability', v_kp,
      'workflow_gate_open', v_open
    )
  );

  RETURN json_build_object(
    'routing_status', p_routing_status,
    'kp_applicability', v_kp,
    'workflow_gate_open', v_open,
    'kp_tracker_applicable', v_mirrored
  );
END;
$$;

REVOKE ALL ON FUNCTION public.captain_set_routing(uuid, text, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.captain_set_routing(uuid, text, text, text, text, text, text) TO authenticated;

-- ── 9. captain_link_blotter_record ──────────────────────────────
-- Attaches an EXISTING blotter record to a complaint.
-- blotter_records.complaint_id already exists; this only writes it,
-- guarded so a complaint cannot end up with two OPEN records.
CREATE OR REPLACE FUNCTION public.captain_link_blotter_record(
  p_complaint_id uuid,
  p_blotter_id   uuid,
  p_reason       text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_blotter public.blotter_records%ROWTYPE;
  v_row     public.complaints%ROWTYPE;
  v_reason  text;
  v_actor   text;
BEGIN
  IF NOT public.is_routing_official() THEN
    RAISE EXCEPTION 'Only the Barangay Captain or OIC may link a blotter record.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  v_reason := NULLIF(btrim(COALESCE(p_reason, '')), '');

  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'A reason is required to link a blotter record to a complaint.'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_blotter
    FROM public.blotter_records
   WHERE id = p_blotter_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Blotter record % does not exist.', p_blotter_id
      USING ERRCODE = 'no_data_found';
  END IF;

  IF v_blotter.complaint_id IS NOT NULL AND v_blotter.complaint_id <> p_complaint_id THEN
    RAISE EXCEPTION
      'Blotter record % is already linked to another complaint.', v_blotter.blotter_number
      USING ERRCODE = 'unique_violation';
  END IF;

  -- A complaint may have only one OPEN blotter record. Checked here
  -- as well as by the partial unique index so the official gets a
  -- readable message instead of a raw constraint error.
  IF EXISTS (
    SELECT 1 FROM public.blotter_records b
     WHERE b.complaint_id = p_complaint_id
       AND b.id <> p_blotter_id
       AND b.current_status = 'open'
  ) THEN
    RAISE EXCEPTION
      'This complaint already has an open blotter record. Close or correct it before linking another.'
      USING ERRCODE = 'unique_violation';
  END IF;

  SELECT * INTO v_row
    FROM public.complaints
   WHERE id = p_complaint_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Complaint % does not exist.', p_complaint_id
      USING ERRCODE = 'no_data_found';
  END IF;

  SELECT display_name INTO v_actor FROM public.profiles WHERE id = auth.uid();

  UPDATE public.blotter_records
     SET complaint_id = p_complaint_id,
         last_updated = now()
   WHERE id = p_blotter_id;

  INSERT INTO public.complaint_routing_history (
    complaint_id,
    routing_status_before, routing_status_after,
    reason, remarks, resident_message,
    acted_by, acted_by_name, acted_by_role
  ) VALUES (
    p_complaint_id,
    v_row.routing_status, v_row.routing_status,
    v_reason,
    'Blotter record ' || v_blotter.blotter_number || ' linked to this complaint.',
    NULL,
    auth.uid(), v_actor, (SELECT role::text FROM public.profiles WHERE id = auth.uid())
  );

  PERFORM public.log_activity(
    'blotter_record_linked',
    'complaint', p_complaint_id, v_row.reference_number,
    jsonb_build_object('blotter_id', p_blotter_id,
                       'blotter_number', v_blotter.blotter_number,
                       'reason', v_reason),
    NULL,
    jsonb_build_object('blotter_id', p_blotter_id)
  );

  RETURN json_build_object(
    'blotter_id', p_blotter_id,
    'blotter_number', v_blotter.blotter_number
  );
END;
$$;

REVOKE ALL ON FUNCTION public.captain_link_blotter_record(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.captain_link_blotter_record(uuid, uuid, text) TO authenticated;
-- ── 10. captain_record_assistance ───────────────────────────────
-- Records what the barangay actually did to help a complainant obtain
-- outside assistance. It asserts ONE thing: that a barangay official
-- wrote this down at this time. It never asserts that any agency
-- received, accepted, investigated or resolved anything.
-- The assisted case has to already be on a referral / incident route
-- (police assistance, external agency assistance or incident
-- documentation) so this record can never contradict the route.
CREATE OR REPLACE FUNCTION public.captain_record_assistance(
  p_complaint_id     uuid,
  p_assistance_type  text,
  p_agency_name      text DEFAULT NULL,
  p_reference_number text DEFAULT NULL,
  p_assistance_given text DEFAULT NULL,
  p_assistance_summary text DEFAULT NULL,
  p_follow_up_required boolean DEFAULT false,
  p_follow_up_due_on date DEFAULT NULL,
  p_recorded_outcome text DEFAULT NULL,
  p_related_document_id uuid DEFAULT NULL,
  p_resident_message text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row      public.complaints%ROWTYPE;
  v_agency   text;
  v_ref      text;
  v_reason   text;
  v_actor    text;
  v_id       uuid;
  v_resident text;
  v_given    text;
  v_summary  text;
BEGIN
  IF NOT public.is_routing_official() THEN
    RAISE EXCEPTION 'Only the Barangay Captain or OIC may record an assistance referral.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_assistance_type NOT IN (
       'advised_to_report',
       'assisted_preparing_report',
       'barangay_endorsement',
       'existing_report_acknowledged',
       'emergency_assistance_advised',
       'police_reporting_assistance',
       'external_agency_assistance',
       'other_authorized_assistance'
     ) THEN
    RAISE EXCEPTION 'Invalid assistance type: %', coalesce(p_assistance_type, 'null')
      USING ERRCODE = 'check_violation';
  END IF;

  v_agency  := NULLIF(btrim(COALESCE(p_agency_name, '')), '');
  v_given   := NULLIF(btrim(COALESCE(p_assistance_given, '')), '');
  v_summary := NULLIF(btrim(COALESCE(p_assistance_summary, '')), '');

  -- "Receiving office, if known": an office is NOT required, but a
  -- record must say something about what was done.
  IF v_agency IS NULL AND v_given IS NULL AND v_summary IS NULL THEN
    RAISE EXCEPTION 'Record the assistance given, or the receiving office, or a short summary.'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_row
    FROM public.complaints
   WHERE id = p_complaint_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Complaint % does not exist.', p_complaint_id
      USING ERRCODE = 'no_data_found';
  END IF;

  IF v_row.routing_status NOT IN (
       'police_reporting_assistance',
       'external_agency_assistance',
       'incident_documentation'
     ) THEN
    RAISE EXCEPTION
      'This complaint is routed as %, so an assistance record would contradict the case file. '
      'Route the case to police reporting assistance, an external agency, or incident documentation first.',
      v_row.routing_status
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_related_document_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.official_documents d WHERE d.id = p_related_document_id
  ) THEN
    RAISE EXCEPTION 'Referral document % does not exist.', p_related_document_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  v_ref := v_row.reference_number;
  SELECT display_name INTO v_actor FROM public.profiles WHERE id = auth.uid();

  IF p_resident_message IS NOT NULL AND btrim(p_resident_message) <> '' THEN
    v_resident := btrim(p_resident_message);
  ELSE
    v_resident := CASE p_assistance_type
      WHEN 'advised_to_report'
        THEN 'An official advised you on how to report this matter to the proper authority.'
      WHEN 'assisted_preparing_report'
        THEN 'An official assisted you in preparing an external report about your complaint.'
      WHEN 'barangay_endorsement'
        THEN 'An official issued a barangay endorsement or referral letter for your complaint.'
      WHEN 'existing_report_acknowledged'
        THEN 'An official acknowledged the report you already filed with the proper authority.'
      WHEN 'emergency_assistance_advised'
        THEN 'An official advised you on emergency assistance for this matter.'
      WHEN 'police_reporting_assistance'
        THEN 'An official recorded that your complaint was referred for police reporting assistance. Please coordinate with the Philippine National Police directly.'
      WHEN 'external_agency_assistance'
        THEN 'An official recorded that your complaint was referred to another government office for assistance. Please coordinate with that office directly.'
      WHEN 'other_authorized_assistance'
        THEN 'An official recorded additional authorized assistance for your complaint.'
    END CASE;
  END IF;

  v_reason := 'Assistance recorded'
              || CASE WHEN v_agency IS NOT NULL THEN ' with ' || v_agency END
              || CASE WHEN NULLIF(btrim(COALESCE(p_reference_number, '')), '') IS NOT NULL
                      THEN ' (reference: ' || btrim(p_reference_number) || ')' END;

  INSERT INTO public.complaint_assistance_records (
    complaint_id, assistance_type, agency_name, reference_number,
    assistance_given, assistance_summary, follow_up_required,
    follow_up_due_on, recorded_outcome, related_document_id,
    recorded_by, recorded_by_name
  ) VALUES (
    p_complaint_id, p_assistance_type, v_agency,
    NULLIF(btrim(COALESCE(p_reference_number, '')), ''),
    v_given,
    v_summary,
    COALESCE(p_follow_up_required, false),
    p_follow_up_due_on,
    NULLIF(btrim(COALESCE(p_recorded_outcome, '')), ''),
    p_related_document_id,
    auth.uid(), v_actor
  ) RETURNING id INTO v_id;

  INSERT INTO public.complaint_routing_history (
    complaint_id,
    routing_status_before, routing_status_after,
    reason, remarks, resident_message,
    acted_by, acted_by_name, acted_by_role
  ) VALUES (
    p_complaint_id,
    v_row.routing_status, v_row.routing_status,
    v_reason,
    v_summary,
    v_resident,
    auth.uid(), v_actor, (SELECT role::text FROM public.profiles WHERE id = auth.uid())
  );

  INSERT INTO public.case_statuses (
    complaint_id, status, stage, resident_visible_message, changed_by
  ) VALUES (
    p_complaint_id, v_row.current_status,
    'Referral Recorded' || CASE WHEN v_agency IS NOT NULL THEN ' — ' || v_agency END,
    v_resident, auth.uid()
  );

  IF v_row.resident_id IS NOT NULL THEN
    INSERT INTO public.notifications (
      user_id, type, title, message, related_complaint_id
    ) VALUES (
      v_row.resident_id, 'complaint',
      'Complaint update — ' || COALESCE(v_ref, 'your complaint'),
      v_resident, p_complaint_id
    );
  END IF;

  PERFORM public.log_activity(
    'assistance_referral_recorded',
    'complaint', p_complaint_id, v_ref,
    jsonb_build_object(
      'assistance_type', p_assistance_type,
      'agency_name', v_agency,
      'reference_number', NULLIF(btrim(COALESCE(p_reference_number, '')), ''),
      'follow_up_required', COALESCE(p_follow_up_required, false),
      'related_document_id', p_related_document_id
    ),
    NULL,
    jsonb_build_object('assistance_record_id', v_id, 'agency_name', v_agency)
  );

  RETURN json_build_object(
    'id', v_id,
    'assistance_type', p_assistance_type,
    'agency_name', v_agency
  );
END;
$$;

REVOKE ALL ON FUNCTION public.captain_record_assistance(uuid, text, text, text, text, text, boolean, date, text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.captain_record_assistance(uuid, text, text, text, text, text, boolean, date, text, uuid, text) TO authenticated;

-- ── 10b. New RPCs for the extended routing workflow ─────────────
-- 10b.1 captain_record_completeness
-- Records the completeness review, the single complaint nature, and
-- (when needed) the request for more information. Never invents a
-- status and never opens the gate by itself: opening the gate is still
-- captain_set_routing()'s job. The result always works with
-- captain_set_routing() — a "complete" review spawns the actual Routing
-- Decision next, while "needs_information" tells the official to record
-- the exact items being requested.
CREATE OR REPLACE FUNCTION public.captain_record_completeness(
  p_complaint_id          uuid,
  p_completeness_status   text,
  p_complaint_nature      text DEFAULT NULL,
  p_complainant_verified  boolean DEFAULT false,
  p_contact_verified      boolean DEFAULT false,
  p_incident_date_provided boolean DEFAULT false,
  p_incident_location_provided boolean DEFAULT false,
  p_narrative_sufficient  boolean DEFAULT false,
  p_evidence_reviewed     boolean DEFAULT false,
  p_extra_info_required   boolean DEFAULT false,
  p_remarks               text DEFAULT NULL,
  p_requested_information text DEFAULT NULL,
  p_resident_message      text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row        public.complaints%ROWTYPE;
  v_ref        text;
  v_actor_name text;
  v_label      text;
  v_resident   text;
  v_nature     text;
  v_remarks    text;
  v_requested  text;
BEGIN
  IF NOT public.is_routing_official() THEN
    RAISE EXCEPTION 'Only the Barangay Captain or OIC may record routing completeness.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_completeness_status IS NULL
     OR p_completeness_status NOT IN (
       'pending_review', 'complete', 'needs_information',
       'duplicate', 'invalid_unrelated'
     ) THEN
    RAISE EXCEPTION 'Invalid completeness status: %', coalesce(p_completeness_status, 'null')
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_completeness_status = 'complete' THEN
    IF p_complaint_nature IS NULL OR p_complaint_nature NOT IN (
       'two_party_dispute', 'reported_incident',
       'service_concern', 'administrative_concern',
       'incomplete_submission', 'duplicate_submission',
       'other_requires_review'
     ) THEN
      RAISE EXCEPTION 'A complaint nature is required when the submission is complete.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  v_nature    := NULLIF(btrim(COALESCE(p_complaint_nature, '')), '');
  v_remarks   := NULLIF(btrim(COALESCE(p_remarks, '')), '');
  v_requested := NULLIF(btrim(COALESCE(p_requested_information, '')), '');

  IF p_completeness_status = 'needs_information' AND v_requested IS NULL THEN
    RAISE EXCEPTION 'A request for more information must say what information is being asked for.'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_row
    FROM public.complaints
   WHERE id = p_complaint_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Complaint % does not exist.', p_complaint_id
      USING ERRCODE = 'no_data_found';
  END IF;

  v_ref := v_row.reference_number;
  SELECT display_name INTO v_actor_name FROM public.profiles WHERE id = auth.uid();

  v_label := CASE p_completeness_status
    WHEN 'pending_review'       THEN 'Pending Completeness Review'
    WHEN 'complete'             THEN 'Submission Complete'
    WHEN 'needs_information'    THEN 'Needs Information'
    WHEN 'duplicate'            THEN 'Duplicate Submission'
    WHEN 'invalid_unrelated'    THEN 'Invalid / Unrelated to Barangay'
  END;

  IF p_resident_message IS NOT NULL AND btrim(p_resident_message) <> '' THEN
    v_resident := btrim(p_resident_message);
  ELSIF p_completeness_status = 'needs_information' THEN
    v_resident := concat_ws(' ', 'We need more information to continue processing your complaint.',
      CASE WHEN v_requested IS NOT NULL THEN 'What was requested: ' || v_requested END);
  ELSE
    v_resident := 'An official reviewed your complaint submission. Processing will continue once the assessment is complete.';
  END IF;

  -- The append-only history records the change.
  INSERT INTO public.complaint_routing_history (
    complaint_id,
    kp_applicability_before, kp_applicability_after,
    routing_status_before, routing_status_after,
    complaint_nature_before, complaint_nature_after,
    completeness_status_before, completeness_status_after,
    reason, remarks, resident_message,
    acted_by, acted_by_name, acted_by_role
  ) VALUES (
    p_complaint_id,
    v_row.kp_applicability, v_row.kp_applicability,
    v_row.routing_status, v_row.routing_status,
    v_row.complaint_nature, v_nature,
    v_row.completeness_status, p_completeness_status,
    'Completeness recorded: ' || v_label,
    v_remarks,
    v_resident,
    auth.uid(), v_actor_name, (SELECT role::text FROM public.profiles WHERE id = auth.uid())
  );

  UPDATE public.complaints
     SET completeness_status = p_completeness_status,
         completeness_complainant_verified         = COALESCE(p_complainant_verified, false),
         completeness_contact_verified             = COALESCE(p_contact_verified, false),
         completeness_incident_date_provided       = COALESCE(p_incident_date_provided, false),
         completeness_incident_location_provided   = COALESCE(p_incident_location_provided, false),
         completeness_narrative_sufficient         = COALESCE(p_narrative_sufficient, false),
         completeness_evidence_reviewed            = COALESCE(p_evidence_reviewed, false),
         completeness_extra_info_required          = COALESCE(p_extra_info_required, false),
         completeness_remarks                      = v_remarks,
         complaint_nature                          = v_nature,
         requested_information                     = v_requested,
         -- Stamped on every fresh request, and only on a fresh request:
         -- re-recording the same request must not make an answer that
         -- already arrived look like it arrived before the question was
         -- asked. Clearing on "complete" lets the next request be told
         -- apart from this one.
         requested_information_at = CASE
           WHEN p_completeness_status = 'needs_information' THEN now()
           ELSE NULL
         END,
         updated_at                                = now()
   WHERE id = p_complaint_id;

  INSERT INTO public.case_statuses (
    complaint_id, status, stage, resident_visible_message, changed_by
  ) VALUES (
    p_complaint_id, v_row.current_status,
    'Completeness — ' || v_label, v_resident, auth.uid()
  );

  IF v_row.resident_id IS NOT NULL THEN
    INSERT INTO public.notifications (
      user_id, type, title, message, related_complaint_id
    ) VALUES (
      v_row.resident_id, 'complaint',
      'Complaint update — ' || COALESCE(v_ref, 'your complaint'),
      v_resident, p_complaint_id
    );
  END IF;

  PERFORM public.log_activity(
    'routing_completeness_recorded',
    'complaint', p_complaint_id, v_ref,
    jsonb_build_object(
      'completeness_status', p_completeness_status,
      'complaint_nature', v_nature,
      'requested_information', v_requested,
      'remarks', v_remarks
    ),
    jsonb_build_object(
      'completeness_status', v_row.completeness_status,
      'complaint_nature', v_row.complaint_nature
    ),
    jsonb_build_object(
      'completeness_status', p_completeness_status,
      'complaint_nature', v_nature
    )
  );

  RETURN json_build_object(
    'completeness_status', p_completeness_status,
    'complaint_nature', v_nature,
    'requested_information', v_requested
  );
END;
$$;

REVOKE ALL ON FUNCTION public.captain_record_completeness(uuid, text, text, boolean, boolean, boolean, boolean, boolean, boolean, boolean, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.captain_record_completeness(uuid, text, text, boolean, boolean, boolean, boolean, boolean, boolean, boolean, text, text, text) TO authenticated;

-- 10b.2 captain_save_incident_details
-- Incident specifics for reported-incident complaints (unknown other
-- party, or a respondent the reporting party cannot name). Upsert on
-- the report fields only; recorded_by / recorded_by_name are set once
-- and never rewritten. Only allowed when the case is on a referral /
-- incident route OR has a reported-incident nature.
CREATE OR REPLACE FUNCTION public.captain_save_incident_details(
  p_complaint_id            uuid,
  p_property_description    text DEFAULT NULL,
  p_incident_value          text DEFAULT NULL,
  p_proof_of_ownership      text DEFAULT NULL,
  p_plate_number            text DEFAULT NULL,
  p_serial_number           text DEFAULT NULL,
  p_engine_chassis_number   text DEFAULT NULL,
  p_identifiable_marks      text DEFAULT NULL,
  p_last_known_location     text DEFAULT NULL,
  p_last_known_at           timestamptz DEFAULT NULL,
  p_witnesses               text DEFAULT NULL,
  p_cctv_available          boolean DEFAULT false,
  p_cctv_notes              text DEFAULT NULL,
  p_evidence_notes          text DEFAULT NULL,
  p_safety_concern          boolean DEFAULT false,
  p_safety_notes            text DEFAULT NULL,
  p_already_reported_externally boolean DEFAULT false,
  p_externally_reported_where text DEFAULT NULL,
  p_external_reference      text DEFAULT NULL,
  p_incident_details_other  text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row         public.complaints%ROWTYPE;
  v_ref         text;
  v_actor_name  text;
  v_existing_id uuid;
  v_resident    text;
BEGIN
  IF NOT public.is_routing_official() THEN
    RAISE EXCEPTION 'Only the Barangay Captain or OIC may record incident details.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_row
    FROM public.complaints
   WHERE id = p_complaint_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Complaint % does not exist.', p_complaint_id
      USING ERRCODE = 'no_data_found';
  END IF;

  IF v_row.routing_status NOT IN (
       'police_reporting_assistance',
       'external_agency_assistance',
       'incident_documentation'
     )
     AND v_row.complaint_nature IS DISTINCT FROM 'reported_incident' THEN
    RAISE EXCEPTION
      'Incident details are for reported-incident complaints. '
      'Record a reported-incident nature, or route the case to incident documentation first.'
      USING ERRCODE = 'check_violation';
  END IF;

  v_ref := v_row.reference_number;
  SELECT display_name INTO v_actor_name FROM public.profiles WHERE id = auth.uid();

  SELECT id INTO v_existing_id
    FROM public.complaint_incident_details
   WHERE complaint_id = p_complaint_id;

  IF v_existing_id IS NULL THEN
    INSERT INTO public.complaint_incident_details (
      complaint_id, property_description, incident_value,
      proof_of_ownership, plate_number, serial_number,
      engine_chassis_number, identifiable_marks, last_known_location,
      last_known_at, witnesses, cctv_available, cctv_notes,
      evidence_notes, safety_concern, safety_notes,
      already_reported_externally, externally_reported_where,
      external_reference, incident_details_other,
      recorded_by, recorded_by_name, updated_by, updated_by_name
    ) VALUES (
      p_complaint_id, NULLIF(btrim(COALESCE(p_property_description, '')), ''),
      NULLIF(btrim(COALESCE(p_incident_value, '')), ''),
      NULLIF(btrim(COALESCE(p_proof_of_ownership, '')), ''),
      NULLIF(btrim(COALESCE(p_plate_number, '')), ''),
      NULLIF(btrim(COALESCE(p_serial_number, '')), ''),
      NULLIF(btrim(COALESCE(p_engine_chassis_number, '')), ''),
      NULLIF(btrim(COALESCE(p_identifiable_marks, '')), ''),
      NULLIF(btrim(COALESCE(p_last_known_location, '')), ''),
      p_last_known_at,
      NULLIF(btrim(COALESCE(p_witnesses, '')), ''),
      COALESCE(p_cctv_available, false),
      NULLIF(btrim(COALESCE(p_cctv_notes, '')), ''),
      NULLIF(btrim(COALESCE(p_evidence_notes, '')), ''),
      COALESCE(p_safety_concern, false),
      NULLIF(btrim(COALESCE(p_safety_notes, '')), ''),
      COALESCE(p_already_reported_externally, false),
      NULLIF(btrim(COALESCE(p_externally_reported_where, '')), ''),
      NULLIF(btrim(COALESCE(p_external_reference, '')), ''),
      NULLIF(btrim(COALESCE(p_incident_details_other, '')), ''),
      auth.uid(), v_actor_name, auth.uid(), v_actor_name
    ) RETURNING id INTO v_existing_id;
  ELSE
    UPDATE public.complaint_incident_details
       SET property_description     = NULLIF(btrim(COALESCE(p_property_description, '')), ''),
           incident_value           = NULLIF(btrim(COALESCE(p_incident_value, '')), ''),
           proof_of_ownership       = NULLIF(btrim(COALESCE(p_proof_of_ownership, '')), ''),
           plate_number             = NULLIF(btrim(COALESCE(p_plate_number, '')), ''),
           serial_number            = NULLIF(btrim(COALESCE(p_serial_number, '')), ''),
           engine_chassis_number    = NULLIF(btrim(COALESCE(p_engine_chassis_number, '')), ''),
           identifiable_marks       = NULLIF(btrim(COALESCE(p_identifiable_marks, '')), ''),
           last_known_location      = NULLIF(btrim(COALESCE(p_last_known_location, '')), ''),
           last_known_at            = p_last_known_at,
           witnesses                = NULLIF(btrim(COALESCE(p_witnesses, '')), ''),
           cctv_available           = COALESCE(p_cctv_available, false),
           cctv_notes               = NULLIF(btrim(COALESCE(p_cctv_notes, '')), ''),
           evidence_notes           = NULLIF(btrim(COALESCE(p_evidence_notes, '')), ''),
           safety_concern           = COALESCE(p_safety_concern, false),
           safety_notes             = NULLIF(btrim(COALESCE(p_safety_notes, '')), ''),
           already_reported_externally = COALESCE(p_already_reported_externally, false),
           externally_reported_where   = NULLIF(btrim(COALESCE(p_externally_reported_where, '')), ''),
           external_reference       = NULLIF(btrim(COALESCE(p_external_reference, '')), ''),
           incident_details_other   = NULLIF(btrim(COALESCE(p_incident_details_other, '')), ''),
           updated_by               = auth.uid(),
           updated_by_name          = v_actor_name,
           updated_at               = now()
     WHERE complaint_id = p_complaint_id;
  END IF;

  v_resident := case when v_row.resident_id is not null
    then 'An official recorded the details of the reported incident for documentation.'
    else null end;
  IF v_resident IS NOT NULL THEN
    INSERT INTO public.case_statuses (
      complaint_id, status, stage, resident_visible_message, changed_by
    ) VALUES (
      p_complaint_id, v_row.current_status,
      'Incident Documentation', v_resident, auth.uid()
    );

    INSERT INTO public.notifications (
      user_id, type, title, message, related_complaint_id
    ) VALUES (
      v_row.resident_id, 'complaint',
      'Complaint update — ' || COALESCE(v_ref, 'your complaint'),
      v_resident, p_complaint_id
    );
  END IF;

  PERFORM public.log_activity(
    'incident_details_recorded',
    'complaint', p_complaint_id, v_ref,
    jsonb_build_object(
      'has_property_description', COALESCE(p_property_description, '') <> '',
      'has_witnesses', COALESCE(p_witnesses, '') <> '',
      'cctv_available', COALESCE(p_cctv_available, false),
      'safety_concern', COALESCE(p_safety_concern, false),
      'already_reported_externally', COALESCE(p_already_reported_externally, false)
    ),
    NULL,
    jsonb_build_object('incident_details_id', v_existing_id)
  );

  RETURN json_build_object('id', v_existing_id, 'complaint_id', p_complaint_id);
END;
$$;

REVOKE ALL ON FUNCTION public.captain_save_incident_details(uuid, text, text, text, text, text, text, text, text, timestamptz, text, boolean, text, text, boolean, text, boolean, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.captain_save_incident_details(uuid, text, text, text, text, text, text, text, text, timestamptz, text, boolean, text, text, boolean, text, boolean, text, text, text) TO authenticated;

-- 10b.3 captain_create_blotter_record
-- Opens a blotter record for a complaint from inside the complaint
-- case sheet. Role-guarded (the existing create_blotter_record() in
-- captain-portal-schema-additions.sql is NOT), refuses a second OPEN
-- record for the same complaint, and keeps the record deeply linked to
-- the complaint instead of pasting a respondent name into the ledger.
CREATE OR REPLACE FUNCTION public.captain_create_blotter_record(
  p_complaint_id     uuid,
  p_incident_summary text,
  p_incident_date    date DEFAULT NULL,
  p_incident_location text DEFAULT NULL,
  p_resident_message text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row     public.complaints%ROWTYPE;
  v_ref     text;
  v_actor   text;
  v_blotter text;
  v_id      uuid;
  v_rows    integer;
  v_resident text;
  v_complainant text;
BEGIN
  IF NOT public.is_routing_official() THEN
    RAISE EXCEPTION 'Only the Barangay Captain or OIC may create a blotter record.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_row
    FROM public.complaints
   WHERE id = p_complaint_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Complaint % does not exist.', p_complaint_id
      USING ERRCODE = 'no_data_found';
  END IF;

  IF NULLIF(btrim(COALESCE(p_incident_summary, '')), '') IS NULL THEN
    RAISE EXCEPTION 'An incident summary is required for the blotter record.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Already linked to an OPEN blotter? Then there is nothing to do.
  IF EXISTS (
    SELECT 1 FROM public.blotter_records
     WHERE complaint_id = p_complaint_id
       AND current_status = 'open'
  ) THEN
    RAISE EXCEPTION 'This complaint already has an open blotter record. Link or view it instead of creating another.'
      USING ERRCODE = 'check_violation';
  END IF;

  v_ref := v_row.reference_number;
  SELECT display_name INTO v_actor FROM public.profiles WHERE id = auth.uid();

  -- The complainant is the resident who filed (may be NULL for
  -- staff-assisted submissions; the ledger then keeps the name empty
  -- rather than inventing one).
  IF v_row.resident_id IS NOT NULL THEN
    SELECT p.display_name INTO v_complainant
      FROM public.profiles p
     WHERE p.id = v_row.resident_id;
  END IF;

  v_blotter := public.generate_blotter_number();

  INSERT INTO public.blotter_records (
    blotter_number, complaint_id, incident_summary,
    complainant_name, respondent_name,
    incident_date, incident_location,
    confirmed_category, current_status, recorded_by
  ) VALUES (
    v_blotter, p_complaint_id,
    btrim(p_incident_summary),
    v_complainant,
    -- Never fabricate a respondent. An unknown/inapplicable other party
    -- stays NULL on the ledger exactly as in the complaints row.
    CASE WHEN v_row.respondent_status = 'identified'
         THEN v_row.respondent_display_name END,
    p_incident_date, NULLIF(btrim(COALESCE(p_incident_location, '')), ''),
    v_row.confirmed_category,
    'open', auth.uid()
  ) RETURNING id INTO v_id;

  v_resident := 'An official opened a barangay blotter record for your complaint. If you choose to report to the police, the record is available to you.';
  IF p_resident_message IS NOT NULL AND btrim(p_resident_message) <> '' THEN
    v_resident := btrim(p_resident_message);
  END IF;

  INSERT INTO public.complaint_routing_history (
    complaint_id,
    routing_status_before, routing_status_after,
    reason, remarks, resident_message,
    acted_by, acted_by_name, acted_by_role
  ) VALUES (
    p_complaint_id,
    v_row.routing_status, v_row.routing_status,
    'Blotter record created (' || v_blotter || ')',
    btrim(p_incident_summary),
    v_resident,
    auth.uid(), v_actor, (SELECT role::text FROM public.profiles WHERE id = auth.uid())
  );

  INSERT INTO public.case_statuses (
    complaint_id, status, stage, resident_visible_message, changed_by
  ) VALUES (
    p_complaint_id, v_row.current_status,
    'Blotter Record Created — ' || v_blotter, v_resident, auth.uid()
  );

  IF v_row.resident_id IS NOT NULL THEN
    INSERT INTO public.notifications (
      user_id, type, title, message, related_complaint_id
    ) VALUES (
      v_row.resident_id, 'complaint',
      'Complaint update — ' || COALESCE(v_ref, 'your complaint'),
      v_resident, p_complaint_id
    );
  END IF;

  PERFORM public.log_activity(
    'blotter_record_created',
    'complaint', p_complaint_id, v_ref,
    jsonb_build_object(
      'blotter_number', v_blotter,
      'blotter_id', v_id,
      'incident_date', p_incident_date
    ),
    NULL,
    jsonb_build_object('blotter_id', v_id, 'blotter_number', v_blotter)
  );

  RETURN json_build_object(
    'id', v_id,
    'blotter_number', v_blotter
  );
END;
$$;

REVOKE ALL ON FUNCTION public.captain_create_blotter_record(uuid, text, date, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.captain_create_blotter_record(uuid, text, date, text, text) TO authenticated;

-- ── 11. Resident information responses ───────────────────────────
-- The answer half of "Needs Information". When an official records
-- `needs_information` (or routes a case to `request_additional_information`)
-- the resident must be able to SEE what was asked for and SEND an answer
-- back. Without this the case is a dead end: the Captain asks, the
-- resident is notified, and nothing can ever be supplied in-system.
--
-- The three bookkeeping columns on `complaints` were created in 1d
-- above, next to the rest of the routing state.

-- A case that is already sitting on a needs-information state was
-- requested before this migration existed, so it has a request with no
-- timestamp. Backfilled from updated_at rather than left NULL, because a
-- NULL would read as "no request made" and send the Captain back to
-- requesting information the resident already has.
UPDATE public.complaints
   SET requested_information_at = COALESCE(requested_information_at, updated_at)
 WHERE completeness_status = 'needs_information'
   AND requested_information_at IS NULL;

-- One row per answer. The text is optional because the resident may
-- answer with attachments only; the RPC enforces "text OR at least one
-- file" so an empty row can never be created.
CREATE TABLE IF NOT EXISTS public.complaint_information_responses (
  id            uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  complaint_id  uuid NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
  resident_id   uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  response_text text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_information_responses_complaint
  ON public.complaint_information_responses(complaint_id, created_at DESC);

-- Attachments are ordinary `evidence` rows (the resident uploads them
-- through the same Storage bucket as their original filing); this table
-- only records WHICH evidence answers WHICH request.
CREATE TABLE IF NOT EXISTS public.complaint_information_response_files (
  response_id uuid NOT NULL REFERENCES complaint_information_responses(id) ON DELETE CASCADE,
  evidence_id uuid NOT NULL REFERENCES evidence(id) ON DELETE CASCADE,
  PRIMARY KEY (response_id, evidence_id)
);

CREATE INDEX IF NOT EXISTS idx_information_response_files_evidence
  ON public.complaint_information_response_files(evidence_id);

-- 11.1 resident_provide_requested_information
-- SECURITY DEFINER because the resident must not be able to write
-- `complaints` directly. The function re-checks ownership, the waiting
-- state, and the ownership of every evidence id it is handed, so a
-- crafted RPC call cannot attach another resident's file or write to a
-- complaint that is not waiting on them.
CREATE OR REPLACE FUNCTION public.resident_provide_requested_information(
  p_complaint_id  uuid,
  p_response_text text    DEFAULT NULL,
  p_evidence_ids  uuid[]  DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row        public.complaints%ROWTYPE;
  v_text       text;
  v_ids        uuid[];
  v_id         uuid;
  v_ref        text;
  v_officials  integer;
  v_missing    integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'You must be signed in to answer an information request.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_row
    FROM public.complaints
   WHERE id = p_complaint_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Complaint % does not exist.', p_complaint_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- Only the complainant may answer, and staff-filed complaints have no
  -- resident portal to answer from.
  IF v_row.resident_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'You can only answer an information request on your own complaint.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_row.completeness_status IS DISTINCT FROM 'needs_information'
     AND v_row.routing_status IS DISTINCT FROM 'request_additional_information' THEN
    RAISE EXCEPTION 'This complaint is not waiting for additional information.'
      USING ERRCODE = 'check_violation';
  END IF;

  v_text := NULLIF(btrim(COALESCE(p_response_text, '')), '');

  IF cardinality(COALESCE(p_evidence_ids, ARRAY[]::uuid[])) > 0 THEN
    SELECT array_agg(DISTINCT e.id) INTO v_ids
      FROM public.evidence e
     WHERE e.id = ANY (p_evidence_ids)
       AND e.complaint_id = p_complaint_id
       AND e.uploaded_by = auth.uid();
  ELSE
    v_ids := ARRAY[]::uuid[];
  END IF;

  -- Every id handed in must survive the ownership filter above, otherwise
  -- a caller could try to attach a file that belongs to someone else.
  SELECT count(*) INTO v_missing
    FROM unnest(COALESCE(p_evidence_ids, ARRAY[]::uuid[])) AS requested(id)
   WHERE NOT EXISTS (SELECT 1 FROM unnest(v_ids) AS kept(id) WHERE kept.id = requested.id);

  IF v_missing > 0 THEN
    RAISE EXCEPTION 'One or more attachments could not be used. Upload the file again.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_text IS NULL AND cardinality(v_ids) = 0 THEN
    RAISE EXCEPTION 'Please write an answer or attach a file.'
      USING ERRCODE = 'check_violation';
  END IF;

  v_ref := v_row.reference_number;

  INSERT INTO public.complaint_information_responses (
    complaint_id, resident_id, response_text
  ) VALUES (
    p_complaint_id, auth.uid(), v_text
  ) RETURNING id INTO v_id;

  INSERT INTO public.complaint_information_response_files (response_id, evidence_id)
  SELECT v_id, unnest(v_ids)
  ON CONFLICT DO NOTHING;

  -- Authorises the guarded UPDATE below. guard_complaint_routing_columns()
  -- refuses these columns for everyone except routing officials unless it
  -- sees this transaction-local flag, so a direct client write cannot fake
  -- an answer. The third argument scopes it to this transaction only.
  PERFORM set_config('app.information_response', 'true', true);

  UPDATE public.complaints
     SET last_information_response_at = now(),
         information_responses = information_responses + 1
   WHERE id = p_complaint_id;

  -- The stage row is what the resident sees on their own timeline, so it
  -- is written from the resident's own action rather than by an official.
  INSERT INTO public.case_statuses (
    complaint_id, status, stage, resident_visible_message, changed_by
  ) VALUES (
    p_complaint_id, v_row.current_status,
    'Information Provided by Resident',
    'You submitted the requested information. An official will review it and update your complaint.',
    auth.uid()
  );

  -- Notify the routing officials, not the resident: the ball is in the
  -- Captain's court again.
  SELECT count(*) INTO v_officials
    FROM public.profiles
   WHERE role IN ('captain', 'oic')
     AND account_status = 'active';

  IF v_officials > 0 THEN
    INSERT INTO public.notifications (
      user_id, type, title, message, related_complaint_id
    )
    SELECT p.id, 'complaint',
           'Information received — ' || COALESCE(v_ref, 'a complaint'),
           'The resident supplied the requested information for ' || COALESCE(v_ref, 'their complaint') || '.',
           p_complaint_id
      FROM public.profiles p
     WHERE p.role IN ('captain', 'oic')
       AND p.account_status = 'active';
  END IF;

  PERFORM public.log_activity(
    'resident_information_provided',
    'complaint', p_complaint_id, v_ref,
    jsonb_build_object(
      'response_id', v_id,
      'has_text', v_text IS NOT NULL,
      'attachment_count', cardinality(v_ids)
    ),
    NULL,
    jsonb_build_object('response_id', v_id)
  );

  RETURN json_build_object(
    'id', v_id,
    'attachment_count', cardinality(v_ids)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.resident_provide_requested_information(uuid, text, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resident_provide_requested_information(uuid, text, uuid[]) TO authenticated;

-- ── 12. Resident-safe read helper ───────────────────────────────
-- The resident portal must never see the internal routing fields.
-- This view-like function is granted to `authenticated` but returns
-- only the resident-safe projection, so a mis-scoped client query
-- cannot leak an internal reason to a complainant.
CREATE OR REPLACE FUNCTION public.complaint_routing_resident_view(p_complaint_id uuid)
RETURNS TABLE (
  reference_number text,
  respondent_status text,
  routing_status text,
  stage_label text,
  resident_message text,
  updated_at timestamptz,
  completeness_status text,
  requested_information text,
  requested_information_at timestamptz,
  information_answered boolean,
  information_responses integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.reference_number,
         c.respondent_status,
         c.routing_status,
         coalesce(
           (SELECT cs.stage FROM public.case_statuses cs
             WHERE cs.complaint_id = c.id
               AND cs.stage LIKE 'Routing Decision — %'
             ORDER BY cs.created_at DESC LIMIT 1),
           (SELECT cs.stage FROM public.case_statuses cs
             WHERE cs.complaint_id = c.id
             ORDER BY cs.created_at DESC LIMIT 1)
         ),
         (SELECT cs.resident_visible_message FROM public.case_statuses cs
           WHERE cs.complaint_id = c.id
           ORDER BY cs.created_at DESC LIMIT 1),
         c.updated_at,
         c.completeness_status,
         -- What the official asked for. This is the resident's own
         -- business: they must be able to read it in order to answer it.
         c.requested_information,
         c.requested_information_at,
         -- True only when an answer arrived AFTER the request was made.
         -- The two timestamps are the only honest signal, because a case
         -- can carry several rounds of requests.
         (c.requested_information_at IS NOT NULL
          AND c.last_information_response_at IS NOT NULL
          AND c.last_information_response_at >= c.requested_information_at),
         c.information_responses
    FROM public.complaints c
   WHERE c.id = p_complaint_id
     AND (
       c.resident_id = auth.uid()
       OR public.is_routing_official()
     );
$$;

REVOKE ALL ON FUNCTION public.complaint_routing_resident_view(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complaint_routing_resident_view(uuid) TO authenticated;

-- ── 13. Summary ─────────────────────────────────────────────────
DO $$
DECLARE
  v_missing text;
BEGIN
  SELECT string_agg(expected, ', ')
    INTO v_missing
  FROM unnest(ARRAY['complaints','case_statuses','notifications','activity_logs'])
       AS expected
  WHERE to_regclass('public.' || expected) IS NULL;

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION
      'captain-complaint-routing-workflow.sql cannot finish: these required tables are missing: %. '
      'Apply the base migrations first (04_complaints.sql, 06_case_tracking.sql, '
      '08_notifications.sql, captain-portal-schema-additions.sql).', v_missing;
  END IF;

  RAISE NOTICE 'Captain complaint routing workflow installed.';
  RAISE NOTICE 'New complaints default to a CLOSED workflow gate; pre-existing complaints were left OPEN.';
  RAISE NOTICE 'Run captain-complaint-routing-rls.sql next, then the verification file.';
END
$$;
