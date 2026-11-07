-- ============================================================
-- 99_verification_queries.sql
-- Purpose: Run these after executing all SQL files to verify
--          the database schema was created correctly.
-- ============================================================

-- ── Check enum types ──────────────────────────────────────
SELECT typname, enumlabel
FROM pg_type t
JOIN pg_enum e ON t.oid = e.enumtypid
WHERE typname LIKE 'app_%'
   OR typname LIKE 'complaint_%'
   OR typname LIKE 'case_%'
   OR typname LIKE 'urgency_%'
   OR typname LIKE 'account_%'
   OR typname LIKE 'kp_%'
   OR typname LIKE 'hearing_%'
   OR typname LIKE 'inquiry_%'
ORDER BY typname, enumsortorder;

-- ── Check tables exist ────────────────────────────────────
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_type = 'BASE TABLE'
ORDER BY table_name;

-- ── Check RLS is enabled ──────────────────────────────────
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;

-- ── Check policies count per table ────────────────────────
SELECT
  schemaname,
  tablename,
  COUNT(*) as policy_count
FROM pg_policies
WHERE schemaname = 'public'
GROUP BY schemaname, tablename
ORDER BY tablename;

-- ── Check functions exist ─────────────────────────────────
SELECT routine_name, routine_type
FROM information_schema.routines
WHERE routine_schema = 'public'
ORDER BY routine_name;

-- ── Check triggers exist ──────────────────────────────────
SELECT trigger_name, event_object_table, action_timing
FROM information_schema.triggers
WHERE trigger_schema = 'public'
ORDER BY event_object_table, trigger_name;

-- ── Check indexes ─────────────────────────────────────────
SELECT indexname, tablename
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname LIKE 'idx_%'
ORDER BY tablename, indexname;

-- ── Check Storage buckets ─────────────────────────────────
SELECT id, name, public, file_size_limit
FROM storage.buckets
ORDER BY name;

-- ── Check complaint_sequences table ───────────────────────
SELECT * FROM complaint_sequences;
