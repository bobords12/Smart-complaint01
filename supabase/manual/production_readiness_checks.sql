-- Read-only production inventory. Run in the Supabase SQL editor with an
-- authorized operator; results describe THIS connected project, not this repo.
-- No DDL, DML, secrets, complaint rows, or auth.users data are read or changed.

-- Core tables and their RLS setting. A missing name or disabled RLS is a blocker.
WITH expected(name) AS (VALUES
  ('profiles'), ('resident_profiles'), ('complaints'), ('complaint_reviews'),
  ('evidence'), ('hearings'), ('official_documents'), ('document_lifecycle_events'),
  ('audit_logs'), ('notifications'), ('lupon_panels'), ('complaint_referrals'),
  ('pnp_referral_assignments'), ('kiosk_upload_sessions'),
  ('kiosk_upload_session_files'), ('kiosk_sms_outbox')
)
SELECT e.name, c.oid IS NOT NULL AS exists, c.relrowsecurity AS rls_enabled,
       (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = e.name) AS policy_count
FROM expected e
LEFT JOIN pg_class c ON c.oid = to_regclass('public.' || e.name)
ORDER BY e.name;

-- Key deployed functions. Overloads are listed separately to reveal drift.
WITH expected(name) AS (VALUES
  ('create_complaint'), ('create_staff_assisted_complaint'),
  ('confirm_specific_category'), ('kiosk_create_upload_session'),
  ('kiosk_register_uploaded_file'), ('kiosk_upload_session_status'),
  ('kiosk_resolve_upload_session'), ('kiosk_submit_complaint'),
  ('kiosk_enqueue_confirmation_sms')
)
SELECT e.name, p.oid IS NOT NULL AS exists,
       pg_get_function_identity_arguments(p.oid) AS arguments,
       CASE WHEN p.oid IS NOT NULL THEN has_function_privilege('anon', p.oid, 'EXECUTE') END AS anon_can_execute,
       CASE WHEN p.oid IS NOT NULL THEN has_function_privilege('authenticated', p.oid, 'EXECUTE') END AS authenticated_can_execute
FROM expected e
LEFT JOIN pg_proc p ON p.proname = e.name AND p.pronamespace = 'public'::regnamespace
ORDER BY e.name, arguments;

-- Migration 35: both columns and the guard/audit triggers must be present.
SELECT column_name, data_type FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'complaints'
   AND column_name IN ('predicted_specific_category', 'confirmed_specific_category',
                       'prediction_model', 'classification_status', 'barangay_case_number')
 ORDER BY column_name;
SELECT tgname, tgenabled FROM pg_trigger
 WHERE tgrelid = to_regclass('public.complaints') AND NOT tgisinternal
   AND tgname IN ('guard_specific_categorization', 'audit_specific_categorization')
 ORDER BY tgname;
SELECT tgname, tgenabled FROM pg_trigger
 WHERE tgrelid = to_regclass('public.evidence') AND NOT tgisinternal
   AND tgname = 'kiosk_verify_evidence_object';

-- Bucket privacy and local-master keys used by the active generators.
SELECT id, public, file_size_limit, allowed_mime_types
 FROM storage.buckets WHERE id IN ('evidence', 'documents', 'templates') ORDER BY id;
WITH masters(path) AS (VALUES
  ('masters/hearing-notice/Notice_of_Hearing_Template.docx'),
  ('masters/respondent-summons/Summons_Template.docx'),
  ('masters/amicable-settlement/Amicable_settlement.docx')
)
SELECT m.path, EXISTS (SELECT 1 FROM storage.objects o
 WHERE o.bucket_id = 'templates' AND o.name = m.path) AS uploaded
FROM masters m ORDER BY m.path;
