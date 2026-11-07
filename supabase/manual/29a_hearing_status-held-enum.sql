-- ============================================================
-- 29a_hearing_status-held-enum.sql
--
-- PURPOSE
--   Add the single enum value 'Held' to public.hearing_status.
--
-- WHY THIS IS ITS OWN FILE
--   PostgreSQL will not let a value added to an enum type be USED in
--   the same transaction that added it. Every other statement in
--   29_captain-hearing-casework.sql is a single transaction, and that
--   file has to write status = 'Held', so the value has to exist in a
--   committed transaction before it runs.
--
--   Splitting this one ALTER out is the whole reason the two runs work.
--   An alternative - comparing status::text everywhere - is not enough,
--   because an UPDATE that assigns the literal still has to resolve the
--   label.
--
-- ORDER
--   1. Run THIS file, and let it commit.
--   2. Run 29_captain-hearing-casework.sql.
--
-- SAFETY
--   Additive and idempotent. Nothing is dropped, no existing value is
--   removed or renamed, and no row is touched. 'Completed' stays in the
--   enum so any code still writing it keeps working.
-- ============================================================

ALTER TYPE public.hearing_status ADD VALUE IF NOT EXISTS 'Held';

COMMENT ON TYPE public.hearing_status IS
  'Lifecycle of a scheduled session. Upcoming -> Held, Cancelled or Rescheduled. ''Completed'' is a legacy value retained for older rows; it is not written by the Captain workflow.';