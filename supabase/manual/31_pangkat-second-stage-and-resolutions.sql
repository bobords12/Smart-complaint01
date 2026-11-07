-- ============================================================
-- 31 · PANGKAT TAGAPAGKASUNDO (SECOND STAGE) + RESOLUTION
-- ============================================================
--
-- Apply by pasting into the Supabase SQL editor AFTER
--   30_*.sql, captain-portal-schema-additions.sql and
--   lupon-member-portal-and-pangkat-rls.sql
--
-- WHAT THIS ADDS
--   1. lupon_panels.selected_by — WHICH PARTY chose each Pangkat
--      member. The Katarungang Pambarangay rule is that the
--      complainant and the respondent each pick one member from the
--      Lupon list, and those two then pick the third who chairs.
--      The column is what makes "the Captain assigns a Lupon member
--      for each party" a recorded fact rather than a convention.
--
--   2. case_resolutions — the single Captain-side record of how a
--      case ended, holding the three endings the statute allows:
--
--        · Amicable Settlement  — the written terms, the date they
--          were signed, who attested (the Barangay Captain or the
--          Pangkat Chairman), and the date the agreement acquires
--          the force and effect of a court judgment (10 days from
--          settlement, stored as a generated column so it cannot
--          drift from the settlement date).
--
--        · Repudiation          — either party may repudiate within
--          10 days of the settlement when consent was obtained
--          through fraud, violence or intimidation. The 10-day
--          window and the required grounds are enforced by CHECK
--          constraints, not by the form.
--
--        · Certificate to File Action — issued when every
--          conciliation effort has failed. The fact that a CFA is
--          owed, why, and when it was actually released.
--
--   3. captain_convene_pangkat() — starts the Pangkat's own 15-day
--      clock from the Captain's side. The existing
--      lupon_convene_pangkat() is gated on lupon_leads_case(), so a
--      Captain who is not personally on the panel could not start
--      the clock even though constituting the Pangkat is a Captain
--      decision. This is the same lifecycle, gated on the Captain
--      role instead.
--
-- WHAT THIS DOES NOT DO
--   · It does not change kp_phase_type. 'Conciliation' is already a
--     member of that enum; the client was writing the free-text
--     'Pangkat Conciliation' into it, which is fixed in
--     WorkflowActions.jsx rather than by widening the enum.
--   · It does not touch complaints.current_status. Recording a
--     resolution is evidence the Captain records; closing the case
--     remains the "Mark Settled / Mark Completed" decision.
--   · It does not generate the CFA document itself. The document
--     type already exists in official_documents and is produced
--     from Case Documents, as every other official document is.
-- ============================================================


-- ── 1. Which party chose each Pangkat member ────────────────
--
-- 'complainant'  the member named by the complainant
-- 'respondent'   the member named by the respondent
-- 'jointly'      the third member, chosen by the two above (and so
--                the default for rows written before this column
--                existed — a panel already recorded was formed
--                jointly by definition)
ALTER TABLE public.lupon_panels
  ADD COLUMN IF NOT EXISTS selected_by text
  CHECK (selected_by IN ('complainant', 'respondent', 'jointly'));

UPDATE public.lupon_panels SET selected_by = 'jointly' WHERE selected_by IS NULL;

ALTER TABLE public.lupon_panels ALTER COLUMN selected_by SET DEFAULT 'jointly';
ALTER TABLE public.lupon_panels ALTER COLUMN selected_by SET NOT NULL;

-- A person sits on a complaint's Pangkat once. Without this the
-- three dropdowns can quietly save the same member twice and the
-- panel would be three names but two people.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_lupon_active_member_per_complaint
  ON public.lupon_panels (complaint_id, member_id)
  WHERE status = 'active';


-- ── 2. Case resolutions ─────────────────────────────────────
--
-- One row per complaint. The three endings are recorded as
-- columns on that one row rather than as three tables, because
-- they are sequential facts about one case: a settlement can be
-- repudiated, and a repudiated settlement is what then draws the
-- Certificate to File Action. The displayed outcome is derived
-- from which of those facts are set; there is no `outcome_type`
-- to keep in sync with them.
CREATE TABLE IF NOT EXISTS public.case_resolutions (
  id                        uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  complaint_id              uuid UNIQUE NOT NULL
                            REFERENCES public.complaints(id) ON DELETE CASCADE,

  -- ── Amicable Settlement ───────────────────────────────────
  settlement_terms          text,
  settlement_date           date,
  attested_by               uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  attestation_role          text
                            CHECK (attestation_role IN ('Barangay Captain', 'Pangkat Chairperson')),

  -- "…and shall have the force and effect of a final judgment of
  -- a court of law upon the expiry of ten (10) days." Generated
  -- rather than stored-and-updated so the two can never disagree.
  effectiveness_date        date
                            GENERATED ALWAYS AS (settlement_date + 10) STORED,

  -- ── Repudiation ───────────────────────────────────────────
  repudiated                boolean NOT NULL DEFAULT false,
  repudiating_party         text CHECK (repudiating_party IN ('Complainant', 'Respondent')),
  repudiation_grounds       text CHECK (repudiation_grounds IN ('Fraud', 'Violence', 'Intimidation')),
  repudiation_particulars   text,
  repudiated_on             date,

  -- ── Certificate to File Action ────────────────────────────
  -- cfa_required is the finding that conciliation failed. The CFA
  -- itself is an official document; cfa_issued_at records when it
  -- was actually released to the complainant.
  cfa_required              boolean NOT NULL DEFAULT false,
  cfa_reason                text,
  cfa_issued_at             timestamptz,
  cfa_issued_by             uuid REFERENCES public.profiles(id) ON DELETE SET NULL,

  recorded_by               uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  recorded_at               timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),

  -- A settlement is a written, attested agreement. Terms without a
  -- date, or a date without terms, is a note — not a settlement.
  CONSTRAINT case_resolutions_settlement_shape
    CHECK (
      settlement_date IS NULL
      OR (settlement_terms IS NOT NULL
          AND btrim(settlement_terms) <> ''
          AND attestation_role IS NOT NULL)
    ),

  -- Repudiation is all-or-nothing: either none of its fields are
  -- set, or the party, the ground and the date all are.
  CONSTRAINT case_resolutions_repudiation_shape
    CHECK (
      (repudiated = false
        AND repudiating_party IS NULL
        AND repudiation_grounds IS NULL
        AND repudiated_on IS NULL
        AND repudiation_particulars IS NULL)
      OR
      (repudiated = true
        AND repudiating_party IS NOT NULL
        AND repudiation_grounds IS NOT NULL
        AND repudiated_on IS NOT NULL
        AND settlement_date IS NOT NULL)
    ),

  -- Ten days from the date of settlement, counted in calendar days,
  -- and never before it. Enforced in SQL so a backdated entry
  -- cannot reopen a closed window.
  CONSTRAINT case_resolutions_repudiation_window
    CHECK (
      repudiated_on IS NULL
      OR (settlement_date IS NOT NULL
          AND repudiated_on >= settlement_date
          AND repudiated_on <= settlement_date + 10)
    ),

  CONSTRAINT case_resolutions_cfa_shape
    CHECK (cfa_issued_at IS NULL OR cfa_required = true)
);

COMMENT ON TABLE public.case_resolutions IS
  'How a Captain-side case ended: an amicable settlement (with its attestation and the date it becomes binding), any repudiation of that settlement within ten days, and any Certificate to File Action released when conciliation failed. One row per complaint; the outcome shown is derived from which facts are set. Recording a resolution never closes the complaint — that remains the Mark Settled / Mark Completed decision.';

CREATE INDEX IF NOT EXISTS idx_case_resolutions_complaint
  ON public.case_resolutions (complaint_id);
CREATE INDEX IF NOT EXISTS idx_case_resolutions_cfa_pending
  ON public.case_resolutions (complaint_id)
  WHERE cfa_required = true AND cfa_issued_at IS NULL;

-- keep updated_at honest on every write path
CREATE OR REPLACE FUNCTION public.case_resolutions_touch()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_case_resolutions_touch ON public.case_resolutions;
CREATE TRIGGER trg_case_resolutions_touch
  BEFORE UPDATE ON public.case_resolutions
  FOR EACH ROW
  EXECUTE FUNCTION public.case_resolutions_touch();


-- ── 3. Row Level Security ───────────────────────────────────
ALTER TABLE public.case_resolutions ENABLE ROW LEVEL SECURITY;

-- Officials decide outcomes, so officials write them. The policy is
-- on the whole table rather than on a complaint: a resolution is
-- about a case the caller already has open, and every read of the
-- complaint they can perform already goes through the same role
-- check.
DROP POLICY IF EXISTS "Officials manage resolutions" ON public.case_resolutions;
CREATE POLICY "Officials manage resolutions"
  ON public.case_resolutions FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('captain', 'oic', 'secretary')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('captain', 'oic', 'secretary')
    )
  );

-- A member of this case's Pangkat may read the outcome the panel
-- itself recorded.
DROP POLICY IF EXISTS "Lupon read assigned resolution" ON public.case_resolutions;
CREATE POLICY "Lupon read assigned resolution"
  ON public.case_resolutions FOR SELECT
  TO authenticated
  USING (public.lupon_is_assigned_to(complaint_id));

-- The complainant may read their own case's resolution. Internal
-- reasoning is not stored here at all — the table holds the terms,
-- the dates and the release of the certificate — so there is no
-- resident-visible flag to respect, as there is on case_statuses.
DROP POLICY IF EXISTS "Residents read own resolution" ON public.case_resolutions;
CREATE POLICY "Residents read own resolution"
  ON public.case_resolutions FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.complaints c
      WHERE c.id = case_resolutions.complaint_id
        AND c.resident_id = auth.uid()
    )
  );

-- Who chose each Pangkat member is read through the policies that
-- already sit on lupon_panels ("Officials read lupon panels" and
-- "Lupon read own assignments"), so no new policy is needed for the
-- selected_by column added above.


-- ── 4. Start the Pangkat clock from the Captain's side ──────
--
-- lupon_convene_pangkat() requires lupon_leads_case(), i.e. the
-- caller must already be the panel's chairperson or secretary.
-- Constituting the Pangkat is a Captain decision, so the Captain
-- needs the same lifecycle under a role check of their own.
--
-- Same table, same single tracker per complaint, same "the clock
-- starts only on convening" rule — so the Lupon portal and the
-- Captain portal cannot show two different day counts.
CREATE OR REPLACE FUNCTION public.captain_convene_pangkat(
  p_complaint_id uuid,
  p_convenes_at  timestamptz DEFAULT now()
) RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role       text;
  v_ref        text;
  v_tracker_id uuid;
  v_already    boolean := false;
  v_at         timestamptz;
BEGIN
  SELECT p.role INTO v_role
  FROM public.profiles p
  WHERE p.id = auth.uid();

  IF v_role IS NULL OR v_role NOT IN ('captain', 'oic') THEN
    RAISE EXCEPTION 'Only the Barangay Captain or OIC may convene the Pangkat.'
      USING ERRCODE = '42501';
  END IF;

  SELECT c.reference_number INTO v_ref
  FROM public.complaints c
  WHERE c.id = p_complaint_id;

  IF v_ref IS NULL THEN
    RAISE EXCEPTION 'Complaint not found.'
      USING ERRCODE = 'P0002';
  END IF;

  v_at := COALESCE(p_convenes_at, now());

  -- A Pangkat convened once stays convened. The first convening is
  -- what starts the 15-day period; re-running must not restart it
  -- and must not silently re-report a first convening.
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
  SET convenes_at   = v_at,
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
    jsonb_build_object(
      'tracker_id', v_tracker_id,
      'actor_role', v_role,
      'convenes_at', v_at
    )
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
    'convenes_at', v_at,
    'already_convened', false
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.captain_convene_pangkat(uuid, timestamptz) TO authenticated;


-- ── 5. Realtime ─────────────────────────────────────────────
-- Tolerant: the publication exists only once
-- 25_realtime_publication.sql has been applied.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'case_resolutions'
  ) THEN
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.case_resolutions;
  END IF;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;
