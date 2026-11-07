-- ============================================================
-- 24_hearings_online_fields.sql
-- Purpose: Add online-hearing support to the hearings table.
--
-- WHY THIS FILE EXISTS:
--   The Lupon schedule UI reads hearings.is_online and
--   hearings.online_link:
--     - components/lupon/LuponSchedule.jsx:65
--     - components/lupon/LuponCaseDetail.jsx:748
--     - repositories/luponRepository.js:97,159
--   But no file in supabase/manual/ ever created these columns,
--   so those two repository selects failed with 42703 and the
--   Lupon schedule rendered nothing.
--
-- PREREQUISITES:
--   - 07_hearings_and_summons.sql applied (creates public.hearings)
--   - 04_complaints.sql applied (hearings FK target)
--
-- SAFETY:  Additive only. No existing rows are modified or
--          deleted. is_online defaults to false, so every current
--          hearing keeps its physical venue.
--
-- HOW TO APPLY:
--   1. Open Supabase Dashboard > SQL Editor
--   2. Paste this entire file
--   3. Click "Run"
--   4. Expect 2 rows from the SECTION 4 verification query
-- ============================================================

-- ── 1. Columns (idempotent) ────────────────────────────────

ALTER TABLE public.hearings
  ADD COLUMN IF NOT EXISTS is_online  boolean NOT NULL DEFAULT false;

ALTER TABLE public.hearings
  ADD COLUMN IF NOT EXISTS online_link text;

COMMENT ON COLUMN public.hearings.is_online IS
  'True when the hearing is conducted online. When true, the UI shows "Online hearing" instead of the venue.';

COMMENT ON COLUMN public.hearings.online_link IS
  'Join URL (http/https) for the online hearing. Required when is_online is true.';

-- ── 2. Integrity constraint (idempotent) ───────────────────
-- An online hearing is useless without a link, and a link must
-- be an http(s) URL so a stored value can never be rendered as
-- a javascript: or data: URI.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'hearings_online_link_check'
      AND conrelid = 'public.hearings'::regclass
  ) THEN
    ALTER TABLE public.hearings
      ADD CONSTRAINT hearings_online_link_check CHECK (
        (NOT is_online)
        OR (
          online_link IS NOT NULL
          AND btrim(online_link) <> ''
          AND online_link ~* '^https?://'
        )
      );
  END IF;
END
$$;

-- ── 3. Index for the upcoming-hearings queries ─────────────
-- luponRepository.js:159 filters on complaint_id and orders by
-- hearing_date; this partial index serves the is_online lookup
-- without indexing rows that are physical hearings.

CREATE INDEX IF NOT EXISTS idx_hearings_online
  ON public.hearings(hearing_date)
  WHERE is_online;

-- ── 4. Verification (expect 2 rows) ────────────────────────

SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'hearings'
  AND column_name IN ('is_online', 'online_link')
ORDER BY column_name;
