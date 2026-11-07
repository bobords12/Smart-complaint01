-- ============================================================
-- 19_add_dark_theme.sql
-- Purpose: Allow 'dark' as a valid theme preference.
-- Safety:  Non-destructive constraint update.
--
-- HOW TO APPLY:
--   1. Open Supabase Dashboard > SQL Editor
--   2. Paste this entire file
--   3. Click "Run"
-- ============================================================

-- Drop the old check constraint and add the new one with 'dark'
ALTER TABLE resident_settings
  DROP CONSTRAINT IF EXISTS resident_settings_theme_check;

ALTER TABLE resident_settings
  ADD CONSTRAINT resident_settings_theme_check
  CHECK (theme IN ('light', 'dark', 'system'));
