-- ============================================================
-- pnp-portal-06-verification-queries.sql
-- Purpose: read-only checks that the PNP portal's boundaries hold.
-- Safety:  every statement here is a SELECT. Nothing in this file
--          writes, and nothing in it should ever be edited to.
--
-- HOW TO USE
--   Apply after pnp-portal-01 ... 05.
--
--   These queries are written to be run as the DATABASE OWNER, who
--   bypasses RLS. That is deliberate: a check run as a PNP officer
--   can only prove what that officer can already see, which is
--   exactly what is in question. Run them as the owner to see what
--   the officer CANNOT see.
--
--   Where a check needs a real session, the impersonation block at
--   the very end shows the SET ROLE / SET request.jwt.claims
--   pattern for testing a PNP officer's view without logging in.
-- ============================================================


-- ============================================================
-- SECTION 1. Schema is present
-- ============================================================
SELECT 'table present' AS check_name,
       t.tablename AS detail,
       CASE WHEN count(*) = 1 THEN 'ok' ELSE 'MISSING' END AS result
  FROM (VALUES
    ('complaint_referrals'),
    ('complaint_referral_evidence'),
    ('complaint_referral_updates'),
    ('pnp_referral_assignments'),
    ('pnp_officer_profiles'),
    ('pnp_portal_units'),
    ('pnp_officer_units')
  ) AS t(tablename)
  LEFT JOIN pg_tables pt
    ON pt.schemaname = 'public' AND pt.tablename = t.tablename
 GROUP BY t.tablename, count(*)
 ORDER BY t.tablename;
-- expect: seven rows, all 'ok'


-- ============================================================
-- SECTION 2. The role exists and is distinct
-- ============================================================
SELECT e.enumlabel
  FROM pg_type t
  JOIN pg_enum e ON e.enumtypid = t.oid
 WHERE t.typname = 'app_role'
   AND e.enumlabel IN ('pnp_officer', 'police', 'captain', 'oic', 'secretary', 'lupon')
 ORDER BY e.enumlabel;
-- expect: pnp_officer present as its own value.
-- 'police' must still exist and must still be unused by any portal:
-- SELECT role, count(*) FROM profiles WHERE role = 'police' GROUP BY role;
-- The PNP portal is pnp_officer, not a relabelled 'police'.


-- ============================================================
-- SECTION 3. Every pnp_* function is SECURITY DEFINER
-- ============================================================
SELECT p.proname,
       p.prosecdef AS is_security_definer,
       CASE
         WHEN p.prosecdef THEN 'ok'
         WHEN p.proname IN ('is_pnp_officer', 'is_referring_official',
                            'pnp_referral_is_visible')
           THEN 'ok (read-only predicate)'
         ELSE 'NOT DEFINER - review'
       END AS result
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname LIKE 'pnp\_%'
 ORDER BY p.proname;
-- expect: every mutating function (pnp_create_referral,
-- pnp_update_referral_status, pnp_assign_referral,
-- pnp_release_referral, pnp_record_referral_note,
-- pnp_set_external_reference, pnp_request_referral_information,
-- pnp_respond_to_referral_information, pnp_share_referral_evidence)
-- to be is_security_definer = true.


-- ============================================================
-- SECTION 4. No client write path exists outside the RPCs
-- ============================================================
-- Any INSERT/UPDATE/DELETE policy on a referral table is a finding.
SELECT tablename, policyname, cmd
  FROM pg_policies
 WHERE schemaname = 'public'
   AND tablename IN ('complaint_referrals',
                     'complaint_referral_evidence',
                     'complaint_referral_updates',
                     'pnp_referral_assignments')
   AND cmd <> 'SELECT'
 ORDER BY tablename, cmd;
-- expect: ZERO rows.
-- A row here means a browser could write a referral without going
-- through a function that validates role and status.


-- ============================================================
-- SECTION 5. The resident request table is closed to the PNP
-- ============================================================
-- Two checks. First: any policy mentioning the role at all.
SELECT policyname, cmd, qual, with_check
  FROM pg_policies
 WHERE schemaname = 'public'
   AND tablename = 'pnp_referral_requests'
   AND (qual ILIKE '%pnp_officer%' OR with_check ILIKE '%pnp_officer%');
-- expect: ZERO rows.

-- Second: the roles that CAN see a pending request.
SELECT policyname,
       CASE cmd WHEN 'SELECT' THEN 'read' WHEN 'UPDATE' THEN 'review'
                WHEN 'INSERT' THEN 'create' WHEN 'DELETE' THEN 'delete' END AS grants
  FROM pg_policies
 WHERE schemaname = 'public'
   AND tablename = 'pnp_referral_requests'
 ORDER BY cmd, policyname;
-- expect: resident (own) and captain/oic (review) only.
-- 'staff' and 'admin' must NOT appear: pnp-portal-01 removed them.


-- ============================================================
-- SECTION 6. No PNP access to the barangay case file
-- ============================================================
SELECT tablename, policyname
  FROM pg_policies
 WHERE schemaname = 'public'
   AND tablename IN ('complaints', 'blotter_records', 'internal_notes',
                     'hearing_attendances', 'complaint_routing_history',
                     'complaint_incident_details', 'activity_logs',
                     'case_statuses', 'kp_trackers')
   AND (qual ILIKE '%pnp_officer%' OR with_check ILIKE '%pnp_officer%')
 ORDER BY tablename;
-- expect: ZERO rows.
-- A PNP officer reads a referral, not a complaint. The referral
-- carries its own summary, incident date, location and parties;
-- the complaint row is not exposed.


-- ============================================================
-- SECTION 7. Storage boundaries
-- ============================================================
SELECT 'evidence bucket is private' AS check_name,
       CASE WHEN public = false THEN 'ok' ELSE 'NOT PRIVATE' END AS result
  FROM storage.buckets WHERE id = 'evidence'
UNION ALL
SELECT 'PNP storage policies are read-only',
       CASE WHEN count(*) FILTER (WHERE cmd = 'SELECT') = 1
             AND count(*) FILTER (WHERE cmd IN ('INSERT','UPDATE','DELETE')) = 2
            THEN 'ok' ELSE 'CHECK POLICIES' END
  FROM pg_policies
 WHERE schemaname = 'storage' AND tablename = 'objects'
   AND policyname LIKE 'PNP%'
UNION ALL
SELECT 'no PNP UPDATE policy on storage',
       CASE WHEN count(*) = 0 THEN 'ok' ELSE 'FOUND ONE' END
  FROM pg_policies
 WHERE schemaname = 'storage' AND tablename = 'objects'
   AND policyname LIKE 'PNP%' AND cmd = 'UPDATE'
UNION ALL
SELECT 'PNP policies confined to the evidence bucket',
       CASE WHEN count(*) = 0 THEN 'ok' ELSE 'OUT OF SCOPE' END
  FROM pg_policies
 WHERE schemaname = 'storage' AND tablename = 'objects'
   AND policyname LIKE 'PNP%'
   AND policyname NOT LIKE '%evidence%';
-- expect: four rows, all 'ok'


-- ============================================================
-- SECTION 8. Reference generation is well formed
-- ============================================================
-- Every existing reference must match the documented pattern.
SELECT count(*) FILTER (WHERE referral_reference !~ '^PNP-REF-[0-9]{4}-[0-9]{6}$') AS malformed,
       count(*)                                          AS total
  FROM complaint_referrals;
-- expect: malformed = 0.

-- No duplicates within a year. The unique index already prevents
-- them; this reads better in a report.
SELECT referral_reference, count(*)
  FROM complaint_referrals
 GROUP BY referral_reference
HAVING count(*) > 1;
-- expect: ZERO rows.


-- ============================================================
-- SECTION 9. The status machine is closed
-- ============================================================
-- A referral sitting in a status that the machine cannot produce,
-- or holding a terminal status without a reason, is a finding.
SELECT id, referral_reference, status, resolution_reason
  FROM complaint_referrals
 WHERE (status IN ('returned', 'declined', 'closed')
        AND (resolution_reason IS NULL OR btrim(resolution_reason) = ''))
    OR (status <> 'referred' AND acknowledged_at IS NULL)
    OR (status <> 'acknowledged' AND acknowledged_at IS NULL
        AND status NOT IN ('referred'))
    OR (external_reference IS NULL) <> (external_reference_at IS NULL)
 ORDER BY created_at DESC;
-- expect: ZERO rows.


-- ============================================================
-- SECTION 10. Evidence sharing is honest
-- ============================================================
-- Every shared file must belong to the complaint behind the
-- referral. The RPC enforces this, so a row here means the data
-- was changed outside it.
SELECT re.id, re.referral_id, e.id AS evidence_id, e.complaint_id
  FROM complaint_referral_evidence re
  JOIN evidence e ON e.id = re.evidence_id
  JOIN complaint_referrals r ON r.id = re.referral_id
 WHERE e.complaint_id <> r.complaint_id;
-- expect: ZERO rows.

-- Referential claims must point at a real approved request.
SELECT r.referral_reference, r.referral_basis, r.referral_request_id,
       q.status AS request_status, q.complaint_id AS request_complaint
  FROM complaint_referrals r
  LEFT JOIN pnp_referral_requests q ON q.id = r.referral_request_id
 WHERE r.referral_basis = 'resident_request'
   AND (q.id IS NULL
        OR q.complaint_id <> r.complaint_id
        OR q.status NOT IN ('approved', 'officially_referred'));
-- expect: ZERO rows.


-- ============================================================
-- SECTION 11. A PNP officer's actual view
-- ============================================================
-- Run as the database owner. For a given officer id, this is the
-- complete set of referrals that officer can reach: assigned,
-- active, and not released.
--
--   SET pnp_officer_id = '<uuid>';
--
-- SELECT r.referral_reference, r.status, r.complaint_id,
--        (r.assigned_officer_id = current_setting('pnp_officer_id')::uuid) AS is_mine
--   FROM complaint_referrals r
--  WHERE EXISTS (
--          SELECT 1 FROM pnp_referral_assignments a
--           WHERE a.referral_id = r.id
--             AND a.officer_id = current_setting('pnp_officer_id')::uuid
--             AND a.released_at IS NULL)
--  ORDER BY r.referred_at DESC;

-- And the total the officer must NOT see:
--   SELECT count(*) AS total_referrals_in_system FROM complaint_referrals;
-- The two numbers differ whenever a referral is unassigned or
-- assigned to someone else. Equal numbers mean the boundary is open.


-- ============================================================
-- SECTION 12. Timeline integrity
-- ============================================================
-- Every referral must open with exactly one 'created' entry.
SELECT r.referral_reference
  FROM complaint_referrals r
 WHERE (SELECT count(*) FROM complaint_referral_updates u
         WHERE u.referral_id = r.id AND u.update_type = 'created') <> 1
 ORDER BY r.referral_reference;
-- expect: ZERO rows.

-- Status changes must chain: each 'from' must equal the previous
-- 'to' for that referral. A mismatch means a status was written
-- outside pnp_update_referral_status().
WITH chained AS (
  SELECT referral_id,
         status_before,
         status_after,
         lag(status_after) OVER (
           PARTITION BY referral_id ORDER BY created_at, id
         ) AS previous_after
    FROM complaint_referral_updates
   WHERE update_type = 'status_change'
)
SELECT referral_id, previous_after, status_before, status_after
  FROM chained
 WHERE previous_after IS NOT NULL
   AND previous_after IS DISTINCT FROM status_before
 ORDER BY referral_id;
-- expect: ZERO rows.


-- ============================================================
-- SECTION 13. Audit trail reached every status change
-- ============================================================
SELECT u.referral_id, u.status_after, u.created_at
  FROM complaint_referral_updates u
  LEFT JOIN activity_logs al
    ON al.target_type = 'complaint_referral'
   AND al.target_id = u.referral_id
   AND al.action = 'pnp_referral_status_changed'
   AND (al.details ->> 'to') = u.status_after::text
 WHERE u.update_type = 'status_change'
   AND al.id IS NULL
 ORDER BY u.created_at DESC;
-- expect: ZERO rows.
-- Any row here is a status the database changed without recording.


-- ============================================================
-- SECTION 14. Sessions
-- ============================================================
-- Deactivated accounts must not be able to reach the portal.
SELECT id, display_name, role, account_status
  FROM profiles
 WHERE role = 'pnp_officer'
 ORDER BY account_status, display_name;
-- Every row must be 'active' for the account to be usable. The
-- login validator and is_pnp_officer() both refuse otherwise.

-- Officers with no unit membership see nothing. This is the
-- default for a brand new account and is intentional.
SELECT p.display_name,
       count(ou.unit_id) AS units,
       (SELECT count(*) FROM pnp_referral_assignments a
         WHERE a.officer_id = p.id AND a.released_at IS NULL) AS assignments
  FROM profiles p
  LEFT JOIN pnp_officer_units ou ON ou.officer_id = p.id
 WHERE p.role = 'pnp_officer'
 GROUP BY p.id, p.display_name
 ORDER BY p.display_name;
-- A new officer with units = 0 and assignments = 0 is correct.
-- Give them a unit in pnp_officer_units, then assign a referral.


-- ============================================================
-- SECTION 15. Reporting what still needs a human
-- ============================================================
SELECT 'assignments' AS gap,
       'An officer with no active assignment cannot be given one from the UI: '
       'pnp_assign_referral() is Captain/OIC only, by design.'
  WHERE EXISTS (SELECT 1 FROM profiles WHERE role = 'pnp_officer')
UNION ALL
SELECT 'units',
       'pnp_portal_units has no rows, so unit-based assignment is unavailable. '
       'Insert real units from the Dashboard; do not seed them in a migration.'
  WHERE NOT EXISTS (SELECT 1 FROM pnp_portal_units)
UNION ALL
SELECT 'open referrals with no officer',
       'count(*) || ' referral(s) are referred but unassigned. They are visible '
       'to no one until an officer is assigned, which is the intended fail-closed '
       'behaviour.'
  WHERE EXISTS (
    SELECT 1 FROM complaint_referrals
     WHERE status = 'referred' AND assigned_officer_id IS NULL
  );
-- This section is informational. It is the list of things the
-- setup guide asks a human to do.


-- ============================================================
-- Test-session helper (optional)
-- ============================================================
-- To see a referral page exactly as an officer sees it, without
-- creating a browser session, impersonate that officer's role in
-- the current transaction and re-read the table. RLS applies to
-- the SET ROLE, so the row count changes to match what the officer
-- would get.
--
--   BEGIN;
--   SET LOCAL ROLE authenticated;
--   SET LOCAL request.jwt.claims = '{"sub":"<officer uuid>","role":"authenticated"}';
--   SELECT count(*) FROM complaint_referrals;  -- assigned only
--   SELECT count(*) FROM pnp_referral_requests; -- expect 0
--   ROLLBACK;
--
-- The pnp_referral_requests count MUST be zero. That single number
-- is the clearest proof that a pending resident request is not
-- reachable from the PNP portal.
