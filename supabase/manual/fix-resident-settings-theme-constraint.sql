-- ============================================================
-- fix-resident-settings-theme-constraint.sql
-- Purpose: Diagnostic query + non-destructive constraint fix
--          for resident_settings.theme column.
--
-- SAFETY:  Preserves all existing rows. Normalizes only invalid
--          theme values to 'light'. Does not drop RLS policies.
--
-- HOW TO USE:
--   1. Open Supabase Dashboard > SQL Editor
--   2. Paste this entire file
--   3. Run the DIAGNOSTIC section first (read results)
--   4. If constraint is missing 'dark', run the FIX section
-- ============================================================

-- ── DIAGNOSTIC ─────────────────────────────────────────────
-- Run this first to inspect the current constraint definition.

SELECT
  conname AS constraint_name,
  pg_get_constraintdef(oid) AS constraint_definition
FROM pg_constraint
WHERE conrelid = 'resident_settings'::regclass
  AND conname = 'resident_settings_theme_check';

-- Also check what theme values currently exist in the table:
SELECT theme, count(*) AS count
FROM resident_settings
GROUP BY theme;

-- ── FIX ────────────────────────────────────────────────────
-- Only run this if the diagnostic shows the constraint
-- does NOT include 'dark'.

-- Step 1: Drop the old check constraint (safe, non-destructive)
ALTER TABLE resident_settings
  DROP CONSTRAINT IF EXISTS resident_settings_theme_check;

-- Step 2: Add the corrected constraint with 'light', 'dark', 'system'
ALTER TABLE resident_settings
  ADD CONSTRAINT resident_settings_theme_check
  CHECK (theme IN ('light', 'dark', 'system'));

-- Step 3: Ensure the default is 'light'
ALTER TABLE resident_settings
  ALTER COLUMN theme SET DEFAULT 'light';

-- Step 4: Normalize any invalid existing values to 'light'
-- (This is a safety net — should affect zero rows if all values are valid)
UPDATE resident_settings
SET theme = 'light'
WHERE theme NOT IN ('light', 'dark', 'system');

-- Step 5: Verify the fix
SELECT
  conname AS constraint_name,
  pg_get_constraintdef(oid) AS constraint_definition
FROM pg_constraint
WHERE conrelid = 'resident_settings'::regclass
  AND conname = 'resident_settings_theme_check';
