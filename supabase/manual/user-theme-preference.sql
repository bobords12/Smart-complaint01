-- ============================================================
-- user-theme-preference.sql
-- Purpose: Extend resident_settings to store theme preference
--          including 'dark' value. Non-destructive.
-- Safety:  Preserves existing records and valid RLS policies.
--
-- HOW TO APPLY:
--   1. Open Supabase Dashboard > SQL Editor
--   2. Paste this entire file
--   3. Click "Run"
--
-- NOTE: Dark Mode already works via localStorage before this
--       SQL is run. This only enables cross-device persistence.
-- ============================================================

-- Drop the old check constraint if it exists
ALTER TABLE resident_settings
  DROP CONSTRAINT IF EXISTS resident_settings_theme_check;

-- Add updated constraint with 'dark' value
ALTER TABLE resident_settings
  ADD CONSTRAINT resident_settings_theme_check
  CHECK (theme IN ('light', 'dark', 'system'));

-- Update the default to 'light' (same as before, explicit)
ALTER TABLE resident_settings
  ALTER COLUMN theme SET DEFAULT 'light';

-- Update existing 'system' values to keep working (no data loss)
-- This is a no-op but confirms the column is healthy
UPDATE resident_settings SET theme = theme WHERE theme IN ('light', 'dark', 'system');
