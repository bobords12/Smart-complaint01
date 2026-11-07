-- ============================================================
-- pnp-portal-01-role-and-profile-support.sql
-- Purpose: add the pnp_officer role and the PNP officer's own
--          profile extension. No referral tables yet.
-- Safety:  additive only. Adds one enum value and one new table.
--          Creates no user, no credential, and no seeded station.
-- ============================================================
--
-- WHAT THIS FILE ADDS
--   A. app_role enum          -> 'pnp_officer'
--   B. pnp_officer_profiles   - rank / unit / station / personnel
--                               number / contact, all optional, so
--                               a PNP account can be created from
--                               the Supabase Dashboard without a
--                               second admin tool.
--   C. pnp_portal_units       - optional assignment scope. Kept
--                               EMPTY by this file: a unit is real
--                               world data and must be typed in by
--                               an administrator, never guessed.
--   D. is_pnp_officer()       - the role predicate every RLS policy
--                               and RPC uses.
--   E. Notifications link     - related_referral_id column so a PNP
--                               notification can deep-link to the
--                               referral it is about.
--   F. Referral request RLS   - pnp_referral_requests policies are
--                               rewritten so an authorised Captain
--                               or OIC can review them. NO policy
--                               is created for pnp_officer: a
--                               pending resident request must be
--                               invisible to the PNP until it has
--                               become a formal referral.
--
-- PREREQUISITES
--   Apply 01_extensions_and_enums.sql, 02_profiles_and_roles.sql,
--   08_notifications.sql and pnp-referral-requests.sql first.
--
-- HOW TO APPLY
--   1. Back up the database.
--   2. Supabase Dashboard > SQL Editor > paste this file > Run.
--   3. Then apply pnp-portal-02 ... 06 in order.
--
-- IMPORTANT: ALTER TYPE ... ADD VALUE cannot run inside a
-- transaction block on older PostgreSQL. This file therefore
-- commits the enum change on its own, exactly as Supabase's SQL
-- editor does for a plain script. It is safe to re-run.
-- ============================================================


-- ── A. app_role: pnp_officer ─────────────────────────────────
--
-- 'police' already exists in the enum and is NOT reused. It is a
-- legacy value with no portal, and repointing it at the PNP portal
-- would silently promote any account already holding it. The PNP
-- portal is a distinct role with a distinct shell.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'app_role' AND e.enumlabel = 'pnp_officer'
  ) THEN
    ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'pnp_officer';
  END IF;
END
$$;

COMMENT ON TYPE public.app_role IS
  'SCBMS roles. pnp_officer is an external partner account for the PNP Coordination Portal and is deliberately separate from the legacy ''police'' value.';


-- ── Prerequisite check ──────────────────────────────────────
-- Fail loudly and early rather than half-creating the portal.
DO $$
DECLARE
  v_missing text;
BEGIN
  SELECT string_agg(expected, ', ')
    INTO v_missing
    FROM unnest(ARRAY['profiles', 'notifications', 'pnp_referral_requests'])
       AS expected
   WHERE to_regclass('public.' || expected) IS NULL;

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION
      'pnp-portal-01 cannot finish: these required tables are missing: %. '
      'Apply the base migrations first (01_extensions_and_enums.sql, '
      '02_profiles_and_roles.sql, 08_notifications.sql, '
      'pnp-referral-requests.sql).', v_missing;
  END IF;
END
$$;


-- ── B. pnp_officer_profiles ──────────────────────────────────
--
-- Separate from public.profiles on purpose. public.profiles is the
-- shared account record every portal reads; this table holds only
-- the fields that are meaningless outside the PNP (a barangay
-- captain has no rank). A new officer is created by inserting into
-- auth.users + public.profiles in the Dashboard, then adding one
-- row here. The row is optional: a PNP officer with no row here
-- still works, they just have no rank or unit on their referral
-- actions.
CREATE TABLE IF NOT EXISTS public.pnp_officer_profiles (
  id                 uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  rank               text,
  unit_name          text,
  station_name       text,
  personnel_number   text,
  contact_number     text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.pnp_officer_profiles IS
  'Optional PNP-specific details for a pnp_officer profile. Real-world data entered by an administrator; never seeded by a migration.';

CREATE OR REPLACE FUNCTION public.touch_pnp_officer_profiles()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_pnp_officer_profiles ON public.pnp_officer_profiles;
CREATE TRIGGER trg_touch_pnp_officer_profiles
  BEFORE UPDATE ON public.pnp_officer_profiles
  FOR EACH ROW EXECUTE FUNCTION public.touch_pnp_officer_profiles();


-- ── C. pnp_portal_units ─────────────────────────────────────
--
-- Assignment scope. A referral is offered to the officers of one
-- unit; a unit that does not exist yet simply has no officers and
-- sees nothing, which is the correct fail-closed default.
CREATE TABLE IF NOT EXISTS public.pnp_portal_units (
  id            uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  unit_code     text NOT NULL UNIQUE,
  unit_name     text NOT NULL,
  station_name  text,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.pnp_portal_units IS
  'PNP units/stations that referrals can be assigned to. Intentionally seeded with no rows: unit data is real world data and is entered by an administrator.';

CREATE TABLE IF NOT EXISTS public.pnp_officer_units (
  officer_id  uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  unit_id     uuid NOT NULL REFERENCES public.pnp_portal_units(id) ON DELETE CASCADE,
  is_primary  boolean NOT NULL DEFAULT false,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (officer_id, unit_id)
);

COMMENT ON TABLE public.pnp_officer_units IS
  'Which PNP units an officer belongs to. Membership is a label for assignment, NOT an access grant: unit rows neither give nor withhold visibility of a referral. pnp_referral_assignments is the only thing that decides what an officer can read. An officer with no row here still receives referrals normally, they just carry no unit label.';

CREATE INDEX IF NOT EXISTS idx_pnp_officer_units_unit
  ON public.pnp_officer_units(unit_id);


-- ── D. is_pnp_officer() ─────────────────────────────────────
--
-- SECURITY DEFINER on purpose. This reads public.profiles, whose
-- RLS deliberately does not let a user read another user's row;
-- a plain policy expression calling get_my_role() from inside a
-- profiles policy is exactly the recursion trap that
-- 99_fix_circular_rls_profiles.sql exists to fix. A definer
-- function reads the role without tripping that.
CREATE OR REPLACE FUNCTION public.is_pnp_officer()
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
       AND p.role = 'pnp_officer'::public.app_role
       AND p.account_status = 'active'::public.account_status
  );
$$;

REVOKE ALL ON FUNCTION public.is_pnp_officer() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_pnp_officer() TO authenticated;


-- ── E. notifications: link to a referral ────────────────────
--
-- The existing SELECT/UPDATE policies on notifications are keyed
-- on user_id = auth.uid(), so a PNP officer can already read and
-- mark read their own notifications. All that is missing is a way
-- to deep-link one to the referral it concerns.
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS related_referral_id uuid;

CREATE INDEX IF NOT EXISTS idx_notifications_related_referral
  ON public.notifications(related_referral_id)
  WHERE related_referral_id IS NOT NULL;

-- The FK is added separately and only if complaint_referrals exists
-- (that table arrives in pnp-portal-02). Until then the column is a
-- plain uuid so this file stays independently runnable.
DO $$
BEGIN
  IF to_regclass('public.complaint_referrals') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
         FROM pg_constraint
        WHERE conname = 'notifications_related_referral_id_fkey'
          AND conrelid = 'public.notifications'::regclass
     )
  THEN
    ALTER TABLE public.notifications
      ADD CONSTRAINT notifications_related_referral_id_fkey
      FOREIGN KEY (related_referral_id)
      REFERENCES public.complaint_referrals(id) ON DELETE CASCADE;
  END IF;
END
$$;


-- ── F. pnp_referral_requests: authorised review only ────────
--
-- pnp-referral-requests.sql shipped policies granting ALL access
-- to ('captain','staff','admin'). Two problems:
--   1. 'oic' is the Captain's designated backup and must be able to
--      review a request; it was not in the list at all.
--   2. The UPDATE policy had no WITH CHECK on the new row, so any
--      role in that list could rewrite decision_note, reviewed_by
--      or status arbitrarily.
--
-- They are replaced with narrow read/update policies for captain
-- and oic only, and INSERT/DELETE are left without any policy at
-- all. Note what is NOT here: pnp_officer. A resident's request is
-- a request to the barangay, and the PNP portal has no business
-- seeing it before the barangay decides to refer the case.
DROP POLICY IF EXISTS "Staff read all referral requests" ON public.pnp_referral_requests;
DROP POLICY IF EXISTS "Staff update all referral requests" ON public.pnp_referral_requests;

CREATE POLICY "Referring officials read referral requests"
  ON public.pnp_referral_requests FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
       WHERE profiles.id = auth.uid()
         AND profiles.role IN ('captain', 'oic')
         AND profiles.account_status = 'active'
    )
  );

-- WITH CHECK pins the columns a reviewer may set. The request's
-- complaint_id and resident_user_id are not in the list, so they
-- cannot be repointed at another case mid-review.
CREATE POLICY "Referring officials review referral requests"
  ON public.pnp_referral_requests FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
       WHERE profiles.id = auth.uid()
         AND profiles.role IN ('captain', 'oic')
         AND profiles.account_status = 'active'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
       WHERE profiles.id = auth.uid()
         AND profiles.role IN ('captain', 'oic')
         AND profiles.account_status = 'active'
    )
    AND complaint_id = (SELECT complaint_id FROM public.pnp_referral_requests AS orig WHERE orig.id = pnp_referral_requests.id)
    AND resident_user_id = (SELECT resident_user_id FROM public.pnp_referral_requests AS orig WHERE orig.id = pnp_referral_requests.id)
  );


-- ── G. RLS on the new tables ────────────────────────────────
-- Read-only for the officer themselves; every other write path
-- goes through an RPC in pnp-portal-03.
ALTER TABLE public.pnp_officer_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pnp_portal_units  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pnp_officer_units  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Officers read own PNP profile"
  ON public.pnp_officer_profiles FOR SELECT
  USING (id = auth.uid());

CREATE POLICY "Active PNP officers read units"
  ON public.pnp_portal_units FOR SELECT
  USING (public.is_pnp_officer() AND is_active);

CREATE POLICY "Officers read own unit membership"
  ON public.pnp_officer_units FOR SELECT
  USING (officer_id = auth.uid());

-- No INSERT/UPDATE/DELETE policy on any of the three: membership
-- and unit data are administrative and are written from the
-- Dashboard (service role), never from a browser session.


-- ── Verification (read-only) ────────────────────────────────
-- SELECT e.enumlabel
--   FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
--  WHERE t.typname = 'app_role' AND e.enumlabel = 'pnp_officer';
--
-- SELECT rolname FROM pg_policies
--  WHERE tablename = 'pnp_referral_requests'
--    AND policyname LIKE '%pnp_officer%';
--  -- expect: zero rows. A pending request must stay invisible.
