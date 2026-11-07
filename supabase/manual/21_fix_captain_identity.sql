-- ============================================================
-- 21_fix_captain_identity.sql
-- Purpose: Correct the displayed identity of the Barangay
--          Captain account ONLY. The shared layout (top-right
--          profile menu + bottom-left sidebar card) renders the
--          name from the authenticated session, which reads
--          resident_profiles (first/last name) first, then
--          profiles.display_name.
--
--          This fixes the record currently named "Resident User"
--          to "Eduard Laranio". It targets ONLY the Captain's own
--          account by its unique Auth email (or UUID) -- it never
--          updates other accounts or every profile row.
--
-- SAFETY:  All statements are additive/fixative. Nothing is
--          deleted, no roles change, and no other rows are touched.
--
-- HOW TO USE (Supabase Dashboard > SQL Editor):
--   1. Run the SELECT below to confirm the Captain's email/uuid.
--   2. Copy that email, then run the two UPDATE statements
--      (replace 'PASTE-CAPTAIN-EMAIL-HERE').
--      OR, if you prefer the UUID, run the UUID alternatives in
--      section 2b instead and skip section 2a.
--   3. Re-run the verification SELECT to confirm.
--   4. Log out and log back in (or press refresh) so the session
--      picks up the corrected name.
-- ============================================================

-- ── 1) Inspect: confirm the Captain's id / email / current name ──
SELECT
  au.id,
  au.email,
  p.role,
  p.display_name,
  rp.first_name,
  rp.last_name,
  rp.middle_name,
  rp.suffix
FROM auth.users au
JOIN profiles p ON p.id = au.id
LEFT JOIN resident_profiles rp ON rp.user_id = au.id
WHERE p.role = 'captain';

-- ── 2a) Fix the name the session reads first (resident_profiles) ──
-- Replace the email with the one shown in step 1.
UPDATE resident_profiles rp
SET first_name = 'Eduard',
    last_name  = 'Laranio',
    updated_at = now()
FROM auth.users au
WHERE au.email = 'PASTE-CAPTAIN-EMAIL-HERE'
  AND au.id = rp.user_id;

-- ── 2a) Fix the fallback display_name (profiles) ────────────────
UPDATE profiles p
SET display_name = 'Eduard Laranio',
    updated_at  = now()
FROM auth.users au
WHERE au.email = 'PASTE-CAPTAIN-EMAIL-HERE'
  AND au.id = p.id;

-- ── 2b) UUID alternatives (uncomment and paste the UUID instead) ─
-- UPDATE resident_profiles rp
-- SET first_name = 'Eduard',
--     last_name  = 'Laranio',
--     updated_at = now()
-- WHERE rp.user_id = 'PASTE-CAPTAIN-UUID-HERE';
--
-- UPDATE profiles p
-- SET display_name = 'Eduard Laranio',
--     updated_at  = now()
-- WHERE p.id = 'PASTE-CAPTAIN-UUID-HERE';

-- ── 3) Verify the corrected identity ────────────────────────────
-- Shows the Captain account(s) that were fixed (same filter as step 1).
SELECT
  au.id,
  au.email,
  p.role,
  p.display_name,
  rp.first_name,
  rp.last_name
FROM auth.users au
JOIN profiles p ON p.id = au.id
LEFT JOIN resident_profiles rp ON rp.user_id = au.id
WHERE p.role = 'captain';