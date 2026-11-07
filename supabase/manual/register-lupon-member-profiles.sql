-- ============================================================
-- register-lupon-member-profiles.sql
-- Purpose: Promote existing Supabase Auth users to the
--          'lupon' role so they can sign in to the Lupon
--          Member Portal.
--
-- READ THIS FIRST
-- --------------
-- This file does NOT create accounts.
--
--   * It never inserts, updates or deletes anything in
--     auth.users.
--   * It never sets, stores or references a password.
--   * It provides no default, shared or demo credentials.
--   * There is no public sign-up path to this role. The
--     /register route creates residents only.
--
-- To add a Lupon member, an administrator does this by hand:
--   1. Supabase Dashboard -> Authentication -> Users ->
--      "Add user". Create ONE individual account for ONE
--      person, set the email, and let the admin set the
--      password directly in the dashboard (or have the person
--      use "Forgot password" to set their own).
--   2. Copy that user's UUID.
--   3. Add their UUID to the list in Section A below.
--   4. Run this file.
--
-- Sharing one account between several people is explicitly
-- unsupported: RLS isolation is per auth.uid(), so a shared
-- login would let one member see another member's assigned
-- cases. One person, one account.
--
-- PREREQUISITES:
--   1. Files 01-23, captain-portal-schema-additions.sql and
--      official-rbac-oic-secretary.sql must be applied.
--      The last one is what adds 'lupon' to the app_role enum.
--   2. lupon-member-portal-and-pakat-rls.sql must be applied
--      (it creates the portal tables and RLS).
--
-- HOW TO APPLY:
--   1. Edit Section A.
--   2. Supabase Dashboard > SQL Editor > New query.
--   3. Paste and Run.
--   4. Check the NOTICE lines, then confirm with the queries
--      in Section C.
-- ============================================================


-- ============================================================
-- SECTION A. Your Lupon members — EDIT THIS
-- ============================================================
--
-- One row per person. Use the UUID from Authentication > Users.
-- Leave display_name as '' to keep the existing name.
--
-- To REMOVE someone's portal access later, set their
-- account_status to 'suspended' in Section C's checklist rather
-- than deleting the row: the auth account stays intact and the
-- audit trail of their past assignments is preserved.
--
-- Do NOT edit the UUIDs here into a guess. A wrong UUID either
-- fails the foreign key to auth.users (reported as a NOTICE) or,
-- worse, promotes the wrong person. Copy and paste.

--   ┌────────────────────────────────┬──────────────────────────┐
--   │ user_id (from Auth > Users)    │ display_name             │
--   ├────────────────────────────────┼──────────────────────────┤
--   │ '00000000-0000-0000-0000-0000'│ 'Juan Dela Cruz'         │
--   │ '00000000-0000-0000-0000-0000'│ 'Maria Santos'           │
--   └────────────────────────────────┴──────────────────────────┘

CREATE TEMP TABLE lupon_seed (
  user_id      uuid PRIMARY KEY,
  display_name text
) ON COMMIT DROP;

-- Uncomment this INSERT, replace the placeholder UUID with the
-- real one from Authentication > Users, and add one VALUES row
-- per person. It is left commented out so the file is valid SQL
-- as shipped: running it unchanged will create no accounts and
-- will tell you so in a NOTICE.
--
-- INSERT INTO lupon_seed (user_id, display_name) VALUES
--   ('11111111-1111-1111-1111-111111111111', 'Juan Dela Cruz'),
--   ('22222222-2222-2222-2222-222222222222', 'Maria Santos');
--
-- Nothing configured yet? Stop here rather than running an
-- empty update.
DO $$
DECLARE
  v RECORD;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM lupon_seed) THEN
    RAISE NOTICE
      'No members configured in Section A — nothing to do. Add at least one row and re-run.';
    RETURN;
  END IF;

  -- ── Validate every seed row before changing anything ────
  -- A typo in a UUID must not leave the table half-promoted.
  IF EXISTS (
    SELECT 1
    FROM lupon_seed s
    WHERE NOT EXISTS (SELECT 1 FROM auth.users a WHERE a.id = s.user_id)
  ) THEN
    RAISE EXCEPTION
      'At least one user_id in Section A does not match an existing Auth user. No changes were made. Copy the exact UUID from Authentication > Users and re-run.';
  END IF;

  -- Refuse to demote a sitting official. A captain who is also
  -- listed as a Lupon member would lose access to the Captain
  -- portal, which is never what was intended.
  IF EXISTS (
    SELECT 1
    FROM lupon_seed s
    JOIN public.profiles p ON p.id = s.user_id
    WHERE p.role IN ('captain', 'oic', 'secretary')
  ) THEN
    RAISE EXCEPTION
      'A user in Section A is already an active official. No changes were made. Remove that row and re-run.';
  END IF;

  -- Promote. profiles.id is the Auth UUID, so this is the only
  -- join key available; the email lives in auth.users and is
  -- never used to decide a role.
  INSERT INTO public.profiles (id, role, display_name, account_status)
  SELECT
    s.user_id,
    'lupon',
    NULLIF(btrim(s.display_name), ''),
    'active'
  FROM lupon_seed s
  ON CONFLICT (id) DO UPDATE
    SET role           = 'lupon',
        display_name   = COALESCE(NULLIF(btrim(s.display_name), ''), public.profiles.display_name),
        account_status = 'active',
        updated_at     = now();

  RAISE NOTICE 'Promoted % row(s) to role ''lupon''.', (SELECT count(*) FROM lupon_seed);

  FOR v IN
    SELECT s.user_id, COALESCE(NULLIF(btrim(s.display_name), ''), '(name unchanged)') AS nm
    FROM lupon_seed s
  LOOP
    RAISE NOTICE '  Lupon member ready: % (%)', v.nm, v.user_id;
  END LOOP;

  RAISE NOTICE
    'Next: the Captain assigns each member to a case via Captain Portal -> Lupon Panels. A member with no assignment sees an empty portal by design.';
END
$$;


-- ============================================================
-- SECTION B. What this deliberately does NOT do
-- ============================================================
-- No INSERT into auth.users          -> no account creation
-- No password column anywhere       -> no credential handling
-- No shared or seeded accounts      -> one person, one login
-- No role derived from an email     -> role comes from profiles
-- No auto-assignment to a case      -> the Captain decides
--
-- Assignment is the Captain's job, not a side effect of
-- creating an account. A brand-new Lupon member therefore has
-- zero visible cases until assigned, which is the correct
-- isolation behaviour, not a bug.


-- ============================================================
-- SECTION C. Verification
-- ============================================================

-- C1. Everyone with the lupon role, and their account status.
SELECT 'C1 lupon_members' AS check_name,
       p.id,
       p.display_name,
       p.role,
       p.account_status,
       p.created_at
FROM public.profiles p
WHERE p.role = 'lupon'
ORDER BY p.display_name NULLS LAST;

-- C2. Active assignments per member. A member with 0 rows has
--     not been assigned to a case yet.
SELECT 'C2 assignments' AS check_name,
       p.display_name,
       count(lp.id) FILTER (WHERE lp.status = 'active') AS active_assignments,
       count(lp.id) FILTER (WHERE lp.status = 'replaced') AS replaced_assignments
FROM public.profiles p
LEFT JOIN public.lupon_panels lp ON lp.member_id = p.id
WHERE p.role = 'lupon'
GROUP BY p.id, p.display_name
ORDER BY p.display_name NULLS LAST;

-- C3. Nobody was accidentally demoted. Expect zero rows.
SELECT 'C3 demoted_official' AS check_name, id, display_name, role
FROM public.profiles
WHERE role IN ('captain', 'oic', 'secretary')
  AND account_status <> 'active';

-- C4. Any Lupon profile whose Auth account has been deleted.
--     profiles.id cascades from auth.users, so this should be
--     empty; a non-empty result means RLS or FK drift.
SELECT 'C4 orphaned_profile' AS check_name, p.id, p.display_name
FROM public.profiles p
WHERE p.role = 'lupon'
  AND NOT EXISTS (SELECT 1 FROM auth.users a WHERE a.id = p.id);
