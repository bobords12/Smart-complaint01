-- ============================================================
-- pnp-portal-02-referral-schema.sql
-- Purpose: the FORMAL referral record that the PNP portal reads.
--          This is a different object from pnp_referral_requests,
--          which is a resident's request to the barangay.
-- Safety:  additive only. Creates tables, enums, indexes and
--          triggers. No policy is granted to a browser here (that
--          is pnp-portal-04) and no RPC is defined (pnp-portal-03).
-- ============================================================
--
-- WHAT THIS FILE ADDS
--   A. complaint_referrals         - one formal referral, created by
--                                    an authorised Captain/OIC from
--                                    an approved resident request or
--                                    from a direct barangay decision.
--   B. complaint_referral_evidence - explicit, per-referral evidence
--                                    sharing. Nothing is shared by
--                                    default.
--   C. complaint_referral_updates  - append-only timeline of every
--                                    status change, note and
--                                    information exchange.
--   D. pnp_referral_assignments    - which PNP officers may see a
--                                    referral. RLS reads this.
--   E. notifications FK            - now that complaint_referrals
--                                    exists, the deferred
--                                    related_referral_id FK added
--                                    in pnp-portal-01 is attached.
--
-- PREREQUISITES
--   pnp-portal-01-role-and-profile-support.sql
--   pnp-referral-requests.sql
--
-- HOW TO APPLY
--   Supabase Dashboard > SQL Editor > paste > Run. Then apply
--   pnp-portal-03, -04, -05, -06 in order.
-- ============================================================


-- ── Prerequisite check ──────────────────────────────────────
DO $$
DECLARE
  v_missing text;
BEGIN
  SELECT string_agg(expected, ', ')
    INTO v_missing
    FROM unnest(ARRAY['profiles', 'complaints', 'evidence', 'notifications',
                      'pnp_referral_requests', 'pnp_officer_units'])
       AS expected
   WHERE to_regclass('public.' || expected) IS NULL;

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION
      'pnp-portal-02 cannot finish: these required tables are missing: %. '
      'Apply pnp-portal-01-role-and-profile-support.sql and '
      'pnp-referral-requests.sql first.', v_missing;
  END IF;
END
$$;


-- ── A. Status vocabulary ────────────────────────────────────
--
-- Deliberately different from referral_request_status. A request
-- is about the barangay's decision ('pending_review'); a referral
-- is about the PNP's handling of a case it was given.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'referral_status') THEN
    CREATE TYPE referral_status AS ENUM (
      'referred',            -- handed to the PNP, not yet picked up
      'acknowledged',        -- an officer has taken it on
      'in_progress',         -- being worked
      'needs_information',   -- PNP asked the barangay something
      'information_submitted',-- barangay answered
      'completed',           -- PNP finished its own handling
      'returned',            -- returned to the barangay
      'declined',            -- PNP declined to take it on
      'closed'               -- terminal
    );
  END IF;
END
$$;

COMMENT ON TYPE referral_status IS
  'Lifecycle of a FORMAL PNP referral. Separate from referral_request_status, which tracks the resident''s request to the barangay before any referral exists.';


-- ── B. complaint_referrals ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public.complaint_referrals (
  id                    uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),

  -- Human reference, e.g. PNP-REF-2026-000001. Assigned by
  -- pnp_create_referral() under a table lock so two concurrent
  -- referrals can never collide. This is NOT a PNP blotter number
  -- and is not derived from one.
  referral_reference    text NOT NULL UNIQUE,

  complaint_id          uuid NOT NULL REFERENCES public.complaints(id) ON DELETE CASCADE,
  referral_request_id   uuid REFERENCES public.pnp_referral_requests(id) ON DELETE SET NULL,

  -- Snapshot of the minimum an officer needs. Copied, not joined:
  -- if the barangay later edits the complaint's own wording, the
  -- referral's record of what was actually sent must not change.
  summary               text NOT NULL,
  incident_date         date,
  incident_location     text,
  parties_involved      text,

  -- The referral basis. One of these must be set; the CHECK below
  -- enforces it. 'resident_request' means the resident asked and
  -- the barangay agreed; 'barangay_initiated' means the barangay
  -- referred on its own assessment.
  referral_basis        text NOT NULL
                          CHECK (referral_basis IN ('resident_request', 'barangay_initiated')),
  referral_reason       text NOT NULL,
  has_safety_concern    boolean NOT NULL DEFAULT false,

  -- NOT NULL and populated at creation: a referral is only ever
  -- created in the 'referred' state, never pre-acknowledged.
  status                referral_status NOT NULL DEFAULT 'referred',

  referred_by           uuid NOT NULL REFERENCES public.profiles(id),
  referred_at           timestamptz NOT NULL DEFAULT now(),

  acknowledged_by       uuid REFERENCES public.profiles(id),
  acknowledged_at       timestamptz,

  -- PNP side
  assigned_officer_id   uuid REFERENCES public.profiles(id),
  assigned_at           timestamptz,
  assigned_unit_id      uuid REFERENCES public.pnp_portal_units(id),

  -- An external reference is OPTIONAL and only ever supplied by a
  -- PNP officer who holds a real one. Nothing in this system
  -- generates, predicts or invents a police reference number.
  external_reference    text,
  external_reference_at timestamptz,

  -- Returned / declined / closed all require a reason. Enforced
  -- here and again in the transition RPC.
  resolution_reason     text,

  due_at                timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT complaint_referrals_reason_required
    CHECK (status NOT IN ('returned', 'declined', 'closed')
           OR (resolution_reason IS NOT NULL AND length(trim(resolution_reason)) > 0)),

  CONSTRAINT complaint_referrals_acknowledged_fields
    CHECK (status = 'referred' OR acknowledged_at IS NOT NULL),

  CONSTRAINT complaint_referrals_external_reference_paired
    CHECK ((external_reference IS NULL) = (external_reference_at IS NULL))
);

COMMENT ON TABLE public.complaint_referrals IS
  'A formal barangay-to-PNP referral. Created only by an authorised Captain or OIC, and visible in the PNP portal only through an active pnp_referral_assignments row.';

COMMENT ON COLUMN public.complaint_referrals.referral_reference IS
  'Internal reference in the form PNP-REF-YYYY-NNNNNN. This is a coordination reference generated by the barangay, NOT a PNP blotter number and NOT an official police record number.';

COMMENT ON COLUMN public.complaint_referrals.external_reference IS
  'Optional external reference supplied by a PNP officer who holds a genuine one. Never generated, inferred, or fabricated by this system.';

COMMENT ON COLUMN public.complaint_referrals.summary IS
  'The referral narrative written by the referring official. This is the only case narrative the PNP sees; the complaint description is not exposed.';

-- A referral that claims to rest on a resident request must actually
-- point at one. This is what makes "PNP cannot see an unapproved
-- request" a structural fact rather than a UI convention: the
-- bridge from request to referral is a real, non-null foreign key.
ALTER TABLE public.complaint_referrals
  DROP CONSTRAINT IF EXISTS complaint_referrals_basis_check;
ALTER TABLE public.complaint_referrals
  ADD CONSTRAINT complaint_referrals_basis_check
  CHECK (referral_basis <> 'resident_request' OR referral_request_id IS NOT NULL);


-- ── C. complaint_referral_evidence ──────────────────────────
--
-- Explicit sharing. A referral starts with zero evidence and gains
-- a row only when a Captain or OIC ticks a file. The complaint's
-- other evidence is NOT reachable from here.
CREATE TABLE IF NOT EXISTS public.complaint_referral_evidence (
  id                uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  referral_id       uuid NOT NULL REFERENCES public.complaint_referrals(id) ON DELETE CASCADE,
  evidence_id       uuid NOT NULL REFERENCES public.evidence(id) ON DELETE CASCADE,
  shared_by        uuid NOT NULL REFERENCES public.profiles(id),
  shared_at        timestamptz NOT NULL DEFAULT now(),
  note             text,
  UNIQUE (referral_id, evidence_id)
);

COMMENT ON TABLE public.complaint_referral_evidence IS
  'Exactly the complaint evidence files a referring official chose to share with the PNP. No default sharing: an unlisted file is invisible to the PNP portal.';

CREATE INDEX IF NOT EXISTS idx_referral_evidence_referral
  ON public.complaint_referral_evidence(referral_id);

CREATE INDEX IF NOT EXISTS idx_referral_evidence_evidence
  ON public.complaint_referral_evidence(evidence_id);


-- ── D. complaint_referral_updates ───────────────────────────
--
-- Append-only. There is no UPDATE or DELETE path for this table
-- anywhere in pnp-portal-04; the immutability is deliberate, the
-- same reasoning as complaint_routing_history.
CREATE TABLE IF NOT EXISTS public.complaint_referral_updates (
  id                 uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  referral_id        uuid NOT NULL REFERENCES public.complaint_referrals(id) ON DELETE CASCADE,
  update_type        text NOT NULL
                       CHECK (update_type IN (
                         'created', 'status_change', 'assigned',
                         'note', 'information_request',
                         'information_response', 'evidence_shared',
                         'external_reference'
                       )),
  status_before      referral_status,
  status_after       referral_status,
  message            text,
  author_id          uuid REFERENCES public.profiles(id),
  author_role        public.app_role,
  created_at         timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.complaint_referral_updates IS
  'Append-only referral timeline. No UPDATE or DELETE policy is ever created for this table.';

CREATE INDEX IF NOT EXISTS idx_referral_updates_referral
  ON public.complaint_referral_updates(referral_id, created_at DESC);


-- ── E. pnp_referral_assignments ─────────────────────────────
--
-- The access grant. A PNP officer sees a referral only while an
-- active row points at their own profile id, for a referral in a
-- unit they belong to. Removing the row revokes access
-- immediately, without touching the referral.
CREATE TABLE IF NOT EXISTS public.pnp_referral_assignments (
  id            uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  referral_id   uuid NOT NULL REFERENCES public.complaint_referrals(id) ON DELETE CASCADE,
  officer_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  assigned_by   uuid NOT NULL REFERENCES public.profiles(id),
  assigned_at   timestamptz NOT NULL DEFAULT now(),
  released_at   timestamptz,
  UNIQUE (referral_id, officer_id)
);

COMMENT ON TABLE public.pnp_referral_assignments IS
  'Per-officer access grant for a formal referral. pnp_officer SELECT policies on complaint_referrals and its children read this table; a released row revokes access at once.';

CREATE INDEX IF NOT EXISTS idx_pnp_assignments_officer
  ON public.pnp_referral_assignments(officer_id)
  WHERE released_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_pnp_assignments_referral
  ON public.pnp_referral_assignments(referral_id)
  WHERE released_at IS NULL;


-- ── F. Referential integrity for the officer/unit columns ───
-- complaint_referrals.assigned_officer_id must be a real PNP
-- officer, and assigned_unit_id must be a real unit. Enforced with
-- triggers because Postgres CHECK constraints cannot reference
-- another table.
CREATE OR REPLACE FUNCTION public.guard_referral_officer_and_unit()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.assigned_officer_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.profiles
        WHERE profiles.id = NEW.assigned_officer_id
          AND profiles.role = 'pnp_officer'
     ) THEN
    RAISE EXCEPTION
      'assigned_officer_id must be an account with role pnp_officer (got %)',
      NEW.assigned_officer_id;
  END IF;

  IF NEW.assigned_unit_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.pnp_portal_units
        WHERE pnp_portal_units.id = NEW.assigned_unit_id
     ) THEN
    RAISE EXCEPTION
      'assigned_unit_id must be an existing pnp_portal_units row (got %)',
      NEW.assigned_unit_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_referral_officer_unit ON public.complaint_referrals;
CREATE TRIGGER trg_guard_referral_officer_unit
  BEFORE INSERT OR UPDATE OF assigned_officer_id, assigned_unit_id
  ON public.complaint_referrals
  FOR EACH ROW EXECUTE FUNCTION public.guard_referral_officer_and_unit();


-- ── G. Deferred notifications FK ────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'notifications_related_referral_id_fkey'
       AND conrelid = 'public.notifications'::regclass
  ) THEN
    ALTER TABLE public.notifications
      ADD CONSTRAINT notifications_related_referral_id_fkey
      FOREIGN KEY (related_referral_id)
      REFERENCES public.complaint_referrals(id) ON DELETE CASCADE;
  END IF;
END
$$;


-- ── H. updated_at maintenance ───────────────────────────────
CREATE OR REPLACE FUNCTION public.touch_complaint_referrals()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_complaint_referrals ON public.complaint_referrals;
CREATE TRIGGER trg_touch_complaint_referrals
  BEFORE UPDATE ON public.complaint_referrals
  FOR EACH ROW EXECUTE FUNCTION public.touch_complaint_referrals();


-- ── Verification (read-only) ────────────────────────────────
-- SELECT unnest(enum_range(NULL::referral_status));
-- SELECT tablename FROM pg_tables
--  WHERE schemaname = 'public'
--    AND tablename IN ('complaint_referrals',
--                      'complaint_referral_evidence',
--                      'complaint_referral_updates',
--                      'pnp_referral_assignments');
--
-- SELECT conname FROM pg_constraint
--  WHERE conrelid = 'public.complaint_referrals'::regclass
--    AND contype = 'c'
--  ORDER BY conname;
