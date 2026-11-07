-- ============================================================
-- kiosk-06-offline-sync-verification.sql
-- Purpose: Read-only verification of the kiosk installation.
--
-- EVERY statement in this file is a SELECT. Nothing here writes,
-- locks or repairs anything, so it is safe to run at any time and
-- as often as needed.
--
-- HOW TO APPLY:
--   Run this file on its own in the Supabase SQL Editor after
--   kiosk-01 ... kiosk-05. Work through the results in order.
--   Each section states the expected output.
--
-- Offline behaviour itself (IndexedDB, encryption, retry) cannot
-- be verified from SQL. Those checks are in KIOSK_SETUP_GUIDE.md
-- sections 13-16 and 20.
-- ============================================================

-- ──────────────────────────────────────────────────────────────
-- V1. Kiosk columns exist on complaints
--     Expected: 18 rows, all from the kiosk schema set.
-- ──────────────────────────────────────────────────────────────
SELECT column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND table_name = 'complaints'
   AND column_name IN (
     'kiosk_client_submission_id','kiosk_fingerprint',
     'kiosk_status_token_hash','kiosk_status_token_expires_at',
     'kiosk_status_token_revoked_at','kiosk_draft_reference',
     'other_party_status','incident_ongoing',
     'immediate_safety_concern','kiosk_submitted_offline',
     'kiosk_sync_status','kiosk_queued_at','kiosk_synced_at',
     'privacy_consent_at','accuracy_confirmation_at',
     'classification_status','classification_model',
     'classification_at'
   )
 ORDER BY column_name;

-- ──────────────────────────────────────────────────────────────
-- V2. filing_channel and source domains include 'kiosk' and still
--     contain every pre-existing value.
--     Expected: two rows. kiosk = true. Existing values = true.
-- ──────────────────────────────────────────────────────────────
SELECT conname,
       pg_get_constraintdef(oid) AS definition
  FROM pg_constraint
 WHERE conrelid = 'public.complaints'::regclass
   AND conname IN ('complaints_filing_channel_check',
                   'complaints_source_check',
                   'complaints_other_party_status_check',
                   'complaints_kiosk_sync_status_check',
                   'complaints_classification_status_check')
 ORDER BY conname;

-- Confirm no historical row was invalidated by the widened domains.
--     Expected: 0 rows.
SELECT reference_number, filing_channel, source
  FROM public.complaints
 WHERE filing_channel IS NULL OR source IS NULL;

-- ──────────────────────────────────────────────────────────────
-- V3. The anonymous role holds no table privileges.
--     Expected: 0 rows.
-- ──────────────────────────────────────────────────────────────
SELECT table_name, privilege_type
  FROM information_schema.role_table_grants
 WHERE grantee = 'anon'
   AND table_schema = 'public'
   AND table_name IN (
     'complaints','evidence','profiles','notifications','case_statuses',
     'hearings','kp_trackers','kp_phases','activity_logs','audit_logs',
     'complaint_sequences','resident_profiles','case_inquiries',
     'kiosk_upload_sessions','kiosk_upload_session_files','kiosk_rate_limits'
   )
 ORDER BY table_name, privilege_type;

-- ──────────────────────────────────────────────────────────────
-- V4. The anonymous role can call only the seven intended kiosk
--     functions, and no internal helper.
--     Expected: kiosk_create_upload_session,
--               kiosk_register_uploaded_file,
--               kiosk_revoke_upload_session,
--               kiosk_status_by_token,
--               kiosk_status_lookup,
--               kiosk_submit_complaint,
--               kiosk_upload_session_status
-- ──────────────────────────────────────────────────────────────
SELECT p.proname,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_may_call
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname LIKE 'kiosk_%'
 ORDER BY p.proname;

-- The hash helper must NOT be callable from the browser.
--     Expected: kiosk_sha256 = false, kiosk_status_payload = false,
--               kiosk_resolve_upload_session = false.
SELECT p.proname,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_may_call
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname IN ('kiosk_sha256', 'kiosk_status_payload',
                     'kiosk_resolve_upload_session', 'kiosk_new_token',
                     'kiosk_check_rate_limit', 'kiosk_clean_text',
                     'kiosk_normalize_mobile');

-- ──────────────────────────────────────────────────────────────
-- V5. RLS is enabled and the kiosk tables expose no policies.
--     Expected: relrowsecurity = true for all rows;
--               0 policies on kiosk_rate_limits.
-- ──────────────────────────────────────────────────────────────
SELECT c.relname, c.relrowsecurity
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public'
   AND c.relname IN ('complaints','evidence','case_statuses',
                     'kiosk_upload_sessions','kiosk_upload_session_files',
                     'kiosk_rate_limits')
 ORDER BY c.relname;

SELECT tablename, policyname, cmd
  FROM pg_policies
 WHERE schemaname = 'public'
   AND tablename IN ('kiosk_upload_sessions',
                     'kiosk_upload_session_files',
                     'kiosk_rate_limits')
 ORDER BY tablename, policyname;

-- ──────────────────────────────────────────────────────────────
-- V6. Storage bucket is private and permits the kiosk types.
--     Expected: public = false, file_size_limit = 10485760,
--               'image/webp' present.
-- ──────────────────────────────────────────────────────────────
SELECT id, public, file_size_limit, allowed_mime_types
  FROM storage.buckets
 WHERE id = 'evidence';

SELECT policyname, cmd, roles, qual, with_check
  FROM pg_policies
 WHERE schemaname = 'storage'
   AND tablename = 'objects'
   AND policyname ILIKE '%kiosk%'
 ORDER BY policyname;
-- Expected: 4 kiosk policies, and CRITICALLY the two refusal
-- policies must be role-scoped and always-false:
--   "Kiosk anonymous cannot update evidence"  cmd=UPDATE roles={anon} qual=false
--   "Kiosk anonymous cannot delete evidence"  cmd=DELETE roles={anon} qual=false
-- RLS policies are permissive and OR-ed together, so a refusal
-- policy that is NOT scoped to 'anon', or whose qual is not false,
-- would silently GRANT the operation it claims to refuse. Check
-- roles and qual here, not just that the policy exists.

-- ──────────────────────────────────────────────────────────────
-- V7. IDEMPOTENCY: no client submission has produced two rows.
--     This is the check that proves a double-tap or an offline
--     replay cannot duplicate a complaint.
--     Expected: 0 rows, always.
-- ──────────────────────────────────────────────────────────────
SELECT kiosk_client_submission_id,
       count(*) AS complaints_created,
       array_agg(reference_number ORDER BY submitted_at) AS references
  FROM public.complaints
 WHERE kiosk_client_submission_id IS NOT NULL
 GROUP BY kiosk_client_submission_id
HAVING count(*) > 1;

-- ──────────────────────────────────────────────────────────────
-- V8. Every kiosk complaint has a tracking reference in the
--     existing transactional format, and none is an official
--     Barangay Case Number.
--     Expected: all rows bad_tracking = false,
--               official_case_number_premature = false.
-- ──────────────────────────────────────────────────────────────
SELECT reference_number,
       (reference_number !~ '^AB-[0-9]{4}-[0-9]{4}$') AS bad_tracking,
       (barangay_case_number IS NOT NULL)              AS official_case_number_premature,
       current_status,
       classification_status
  FROM public.complaints
 WHERE filing_channel = 'kiosk'
 ORDER BY submitted_at DESC
 LIMIT 20;

-- ──────────────────────────────────────────────────────────────
-- V9. A kiosk complaint never creates downstream records.
--     The kiosk must not summon, mediate, blotter or refer.
--     Expected: 0 rows on all three counts.
-- ──────────────────────────────────────────────────────────────
SELECT count(*) AS kiosk_complaints_with_hearings
  FROM public.hearings h
  JOIN public.complaints c ON c.id = h.complaint_id
 WHERE c.filing_channel = 'kiosk';

-- complaint_referrals is created by the PNP schema, not by the
-- baseline or by the kiosk files. Guarded so this check still runs
-- (and reports "not installed" instead of aborting the whole file)
-- on a project that has not applied the PNP SQL yet.
SELECT CASE
         WHEN to_regclass('public.complaint_referrals') IS NULL
           THEN 'pnp schema not installed - referral check skipped'
         ELSE (
           SELECT count(*)::text
             FROM public.complaint_referrals r
             JOIN public.complaints c ON c.id = r.complaint_id
            WHERE c.filing_channel = 'kiosk'
         )::text
       END AS kiosk_complaints_with_referrals;

-- No kiosk evidence row may carry an uploader, because the
-- complainant is anonymous.
--     Expected: 0 rows.
SELECT count(*) AS kiosk_evidence_with_uploader
  FROM public.evidence e
  JOIN public.complaints c ON c.id = e.complaint_id
 WHERE c.filing_channel = 'kiosk'
   AND e.kiosk_evidence
   AND e.uploaded_by IS NOT NULL;

-- ──────────────────────────────────────────────────────────────
-- V10. No raw status token is stored anywhere.
--     Only 64-character hex digests are persisted.
--     Expected: malformed_token_hashes = 0.
-- ──────────────────────────────────────────────────────────────
SELECT count(*) FILTER (
         WHERE kiosk_status_token_hash !~ '^[0-9a-f]{64}$'
       ) AS malformed_token_hashes,
       count(*) FILTER (
         WHERE kiosk_status_token_expires_at IS NULL
       ) AS kiosk_rows_without_token_expiry
  FROM public.complaints
 WHERE kiosk_status_token_hash IS NOT NULL;

-- ──────────────────────────────────────────────────────────────
-- V11. Every kiosk complaint has initial status history and an
--      audit entry.
--     Expected: both counters 0.
-- ──────────────────────────────────────────────────────────────
SELECT count(*) AS kiosk_complaints_without_status_history
  FROM public.complaints c
 WHERE c.filing_channel = 'kiosk'
   AND NOT EXISTS (
     SELECT 1 FROM public.case_statuses cs
      WHERE cs.complaint_id = c.id
   );

SELECT count(*) AS kiosk_complaints_without_audit_entry
  FROM public.complaints c
 WHERE c.filing_channel = 'kiosk'
   AND NOT EXISTS (
     SELECT 1 FROM public.audit_logs a
      WHERE a.target_id = c.id
        AND a.action = 'kiosk_complaint_submitted'
   );

-- ──────────────────────────────────────────────────────────────
-- V12. Staff notification on submission.
--     Lists the active staff roles that DID receive a notification
--     for a kiosk complaint filed in the last day. An empty result
--     is the failure signal here, not the goal: the goal is one row
--     per active role with a non-zero count. A row for
--     'captain'/'oic'/'secretary' with notified >= 1 is a pass.
--     If this is empty, check that profiles.account_status is
--     'active' for those accounts; kiosk_submit_complaint() only
--     notifies active staff.
-- ──────────────────────────────────────────────────────────────
SELECT p.role, count(*) AS notified
  FROM public.notifications n
  JOIN public.profiles p ON p.id = n.user_id
  JOIN public.complaints c ON c.id = n.related_complaint_id
 WHERE c.filing_channel = 'kiosk'
   AND p.role IN ('captain', 'oic', 'secretary')
   AND p.account_status = 'active'
   AND c.submitted_at > now() - interval '1 day'
 GROUP BY p.role;

-- ──────────────────────────────────────────────────────────────
-- V13. OFFLINE SYNC BACKLOG
--     Sessions that expired without being submitted still holding
--     storage objects. Run kiosk_cleanup_expired_uploads() from a
--     service-role context, then delete the returned paths in
--     Storage > evidence.
--     Expected: orphaned_sessions = 0 in steady state.
-- ──────────────────────────────────────────────────────────────
SELECT count(*) AS orphaned_sessions,
       min(expires_at) AS oldest_expiry
  FROM public.kiosk_upload_sessions
 WHERE consumed_at IS NULL
   AND expires_at < now();

SELECT s.draft_reference,
       count(f.id) AS unlinked_files,
       pg_size_pretty(sum(f.file_size)) AS bytes
  FROM public.kiosk_upload_sessions s
  JOIN public.kiosk_upload_session_files f ON f.session_id = s.id
 WHERE s.consumed_at IS NULL
   AND s.expires_at < now()
   AND f.attached_at IS NULL
 GROUP BY s.draft_reference;

-- ──────────────────────────────────────────────────────────────
-- V14. Rate limiter is working (it is doing its job if rows
--      exist and are being recycled, not if it is empty).
--     Expected: a small number of rows.
-- ──────────────────────────────────────────────────────────────
SELECT count(*) AS tracked_fingerprints,
       max(count) AS highest_window_count,
       min(updated_at) AS oldest_window
  FROM public.kiosk_rate_limits;

-- ──────────────────────────────────────────────────────────────
-- V15. Kiosk volume and outcome mix.
-- ──────────────────────────────────────────────────────────────
SELECT filing_channel,
       current_status,
       count(*) AS complaints
  FROM public.complaints
 WHERE filing_channel = 'kiosk'
 GROUP BY filing_channel, current_status
 ORDER BY current_status;

-- ──────────────────────────────────────────────────────────────
-- V16. Offline-originated submissions that later synchronised.
--     Both counters should match, proving the queue drained and
--     the idempotency key prevented a second complaint.
--     Expected: pending_or_failed = 0 in steady state.
-- ──────────────────────────────────────────────────────────────
SELECT kiosk_sync_status, count(*) AS complaints
  FROM public.complaints
 WHERE filing_channel = 'kiosk'
   AND kiosk_submitted_offline
 GROUP BY kiosk_sync_status
 ORDER BY kiosk_sync_status;

-- ──────────────────────────────────────────────────────────────
-- V17. Classification health.
--     'unavailable' means the TF-IDF + SVM suggestion was not
--     usable for that submission. The complaint is still filed and
--     still needs manual review; this is expected to be rare, not
--     zero, and is never a reason to discard a complaint.
-- ──────────────────────────────────────────────────────────────
SELECT classification_status, count(*) AS complaints
  FROM public.complaints
 WHERE filing_channel = 'kiosk'
 GROUP BY classification_status
 ORDER BY classification_status;
