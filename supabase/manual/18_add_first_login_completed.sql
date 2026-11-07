-- ============================================================
-- 18_add_first_login_completed.sql
-- Purpose: Add a persistent first-login flag to profiles.
-- Safety:  non-destructive; defaults to false for all rows.
-- ============================================================

-- Add the column (existing rows get false = "returning user")
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS first_login_completed boolean NOT NULL DEFAULT false;
