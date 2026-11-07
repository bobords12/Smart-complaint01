-- ============================================================
-- 25_realtime_publication.sql
-- Purpose: Publish the tables the app subscribes to on
--          supabase_realtime, and set REPLICA IDENTITY FULL so
--          UPDATE events carry the full row.
--
-- WHY THIS FILE EXISTS:
--   The client subscribes to postgres_changes on 8 tables
--   (context/ and repositories/ set up these channels), but no
--   file in supabase/manual/ ever ran ALTER PUBLICATION. Every
--   realtime subscription in the app was therefore dead: no
--   live updates, no error surfaced.
--
-- TABLES PUBLISHED (matches the client subscriptions):
--   complaints, hearings, summons, notifications,
--   blotter_records, official_documents, lupon_panels,
--   pangkat_trackers
--
-- OPTIONAL:
--   Uncomment pangkat_extensions in both arrays if you add a
--   realtime subscription for pending Pangkat extensions.
--
-- PREREQUISITES:
--   - All of the above tables must exist. This file is safe to
--     run early: it warns and skips any table not yet created,
--     then re-run it later to pick up the rest.
--   - RLS must be enabled on each table, otherwise realtime
--     broadcasts rows to every subscriber. The tables above
--     already have RLS from their own files.
--
-- SAFETY:  Additive only. Membership of an existing table in
--          the publication is never removed. Re-running is a
--          no-op.
--
-- HOW TO APPLY:
--   1. Open Supabase Dashboard > SQL Editor
--   2. Paste this entire file
--   3. Click "Run"
--   4. Run SECTION 3 and confirm 8 rows
-- ============================================================

-- ── 1. Add the tables to the publication (idempotent) ───────
-- ALTER PUBLICATION ... ADD TABLE has no IF NOT EXISTS form,
-- and re-adding a member raises duplicate_object, so membership
-- is checked first.

DO $$
DECLARE
  v_table       text;
  v_missing     text[] := '{}';
  v_added_count int := 0;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'
  ) THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;

  FOREACH v_table IN ARRAY ARRAY[
    'complaints',
    'hearings',
    'summons',
    'notifications',
    'blotter_records',
    'official_documents',
    'lupon_panels',
    'pangkat_trackers'
    -- 'pangkat_extensions',
  ]
  LOOP
    IF to_regclass('public.' || v_table) IS NULL THEN
      v_missing := v_missing || v_table;
      CONTINUE;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname    = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename  = v_table
    ) THEN
      EXECUTE format(
        'ALTER PUBLICATION supabase_realtime ADD TABLE public.%I',
        v_table
      );
      v_added_count := v_added_count + 1;
    END IF;
  END LOOP;

  RAISE NOTICE 'Added % table(s) to supabase_realtime.', v_added_count;

  IF array_length(v_missing, 1) IS NOT NULL THEN
    RAISE WARNING
      'Skipped, table(s) do not exist yet: % . Re-run this file later.',
      v_missing;
  END IF;
END
$$;

-- ── 2. REPLICA IDENTITY FULL (idempotent) ───────────────────
-- Several of these tables are UPDATEd in place (complaint
-- status, hearing status, notification is_read). Without this,
-- the WAL UPDATE record carries only the changed key, so a
-- realtime client filtering on another column receives nothing.

DO $$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'complaints',
    'hearings',
    'summons',
    'notifications',
    'blotter_records',
    'official_documents',
    'lupon_panels',
    'pangkat_trackers'
    -- 'pangkat_extensions',
  ]
  LOOP
    IF to_regclass('public.' || v_table) IS NOT NULL THEN
      EXECUTE format(
        'ALTER TABLE public.%I REPLICA IDENTITY FULL',
        v_table
      );
    END IF;
  END LOOP;
END
$$;

-- ── 3. Verification (expect 8 rows) ────────────────────────

SELECT p.pubname, pt.schemaname, pt.tablename
FROM pg_publication_tables pt
JOIN pg_publication p ON p.pubname = pt.pubname
WHERE pt.pubname = 'supabase_realtime'
  AND pt.schemaname = 'public'
ORDER BY pt.tablename;

-- Cross-check: every table the client subscribes to must appear
-- above. A missing row here is why a channel never fires.
--
-- SELECT unnest(ARRAY[
--   'complaints','hearings','summons','notifications',
--   'blotter_records','official_documents','lupon_panels',
--   'pangkat_trackers'
-- ]) AS expected
-- EXCEPT
-- SELECT tablename FROM pg_publication_tables
-- WHERE pubname = 'supabase_realtime' AND schemaname = 'public';
