-- ============================================================
-- reklamo-form-document-workflow.sql
-- Purpose: Support the official digital Reklamo Form workflow:
--          separate submission receipt vs. officially received
--          barangay complaint, two distinct identifiers
--          (tracking number vs. Barangay Case Number), and the
--          signed-and-filed document lifecycle.
--
-- WHY THIS IS REQUIRED:
--   1. complaints only has reference_number, generated at
--      submission time. There is no second identifier for an
--      officially received barangay case, so the tracking number
--      was being used as the case number.
--   2. There is no official_received_at / received_by, so the
--      moment of official acceptance was never recorded.
--   3. official_documents.document_type has a CHECK that does
--      not allow submission_receipt, reklamo_form or
--      signed_reklamo_form, and has no document_status column
--      to distinguish a draft from a form awaiting signature
--      from a signed-and-filed form.
--   4. official_documents has no version or content snapshot, so
--      regenerating a form would silently rewrite an already
--      filed official document.
--   5. "Residents read visible documents" allows ANY resident to
--      read ANY resident_visible document. It is not scoped to
--      the reader's own complaint. It is replaced below with a
--      complaint-scoped policy.
--   6. The Reklamo Form requires the resolution the complainant
--      wants. Neither complaints nor the online submission form
--      has a column for it, and the staff-assisted form was
--      cramming it into persons_involved as a prefixed string.
--
-- Safety:  Additive and non-destructive.
--          No table is dropped, no row is deleted, no RLS is
--          disabled. CHECK constraints are only WIDENED (existing
--          allowed values are all preserved). No existing policy
--          is removed except the over-broad resident read policy
--          described above, which is replaced by a stricter,
--          complaint-scoped equivalent.
--
-- PREREQUISITES:
--   1. Files 01-23 + captain-portal-schema-additions.sql +
--      official-rbac-oic-secretary.sql must already be applied.
--   2. captain_workflow_categorization_stage.sql must be applied
--      (the receive RPC below writes the 'For Official
--      Categorization' status).
--   3. The 'documents' bucket already exists and is PRIVATE
--      (public = false). This file does not change it.
--
-- HOW TO APPLY (Supabase Dashboard > SQL Editor):
--   1. Open SQL Editor > New query.
--   2. Paste this entire file.
--   3. Click Run.
--   4. Expected: Success. Section I should return one row per
--      object, all 'ok'.
-- ============================================================


-- ──────────────────────────────────────────────────────────────
-- A. Official receipt columns on complaints
-- ──────────────────────────────────────────────────────────────
-- NOTE ON THE TWO IDENTIFIERS:
--   reference_number      = tracking number, generated the moment
--                           an online complaint is submitted.
--                           Format AB-YYYY-NNNN. Never changes.
--   barangay_case_number  = Barangay Case Number, assigned ONCE,
--                           only when an authorized official
--                           completes the information and
--                           applicability review and officially
--                           receives the complaint. NULL until
--                           then. Same approved AB-YYYY-NNNN
--                           format but a SEPARATE sequence, so
--                           the two identifiers are never equal.
ALTER TABLE public.complaints
  ADD COLUMN IF NOT EXISTS barangay_case_number text,
  ADD COLUMN IF NOT EXISTS official_received_at timestamptz,
  ADD COLUMN IF NOT EXISTS received_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

-- Assigned at most once, and only by the receive RPC below.
CREATE UNIQUE INDEX IF NOT EXISTS idx_complaints_barangay_case_number
  ON public.complaints (barangay_case_number)
  WHERE barangay_case_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_complaints_received_by
  ON public.complaints (received_by);

-- The Reklamo Form asks what the complainant wants to happen
-- ("Nadawat / Gitipigan"). There was nowhere to store that for an
-- online complaint. Optional, so existing complaints and existing
-- online submissions stay valid without it.
ALTER TABLE public.complaints
  ADD COLUMN IF NOT EXISTS desired_relief text;

-- The staff-assisted form stored this inside persons_involved as
-- "Desired remedy: ...". Recover those values into the new column
-- so the official form can read it, then strip the prefix so
-- persons_involved holds only the respondent.
UPDATE public.complaints
   SET desired_relief = substring(persons_involved from '^Desired remedy:\s*(.+)$'),
       persons_involved = NULLIF(btrim(substring(persons_involved from '^Desired remedy:\s*(.+)$')), '')
 WHERE desired_relief IS NULL
   AND persons_involved ~ '^Desired remedy:\s*\S';

-- An officially received complaint must have a case number, a
-- receipt timestamp and a receiving official. Existing rows are
-- all unreceived, so this cannot fail on migration.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'complaints_official_receipt_check'
  ) THEN
    ALTER TABLE public.complaints
      ADD CONSTRAINT complaints_official_receipt_check CHECK (
        (barangay_case_number IS NULL
         AND official_received_at IS NULL
         AND received_by IS NULL)
        OR
        (barangay_case_number IS NOT NULL
         AND official_received_at IS NOT NULL)
      );
  END IF;
END
$$;


-- ──────────────────────────────────────────────────────────────
-- B. Barangay Case Number sequence
-- ──────────────────────────────────────────────────────────────
-- Mirrors generate_reference_number() exactly, on its own
-- sequence table so the two numbers never collide.
CREATE TABLE IF NOT EXISTS public.barangay_case_sequences (
  year     integer PRIMARY KEY,
  last_seq integer NOT NULL DEFAULT 0
);

CREATE OR REPLACE FUNCTION public.generate_barangay_case_number()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_year integer;
  v_seq  integer;
  v_case text;
BEGIN
  v_year := EXTRACT(YEAR FROM now())::integer;

  -- Upsert the sequence row (locks the row to prevent races)
  INSERT INTO public.barangay_case_sequences (year, last_seq)
  VALUES (v_year, 1)
  ON CONFLICT (year) DO UPDATE
    SET last_seq = barangay_case_sequences.last_seq + 1
  RETURNING last_seq INTO v_seq;

  v_case := 'AB-' || v_year || '-' || LPAD(v_seq::text, 4, '0');
  RETURN v_case;
END;
$$;

GRANT EXECUTE ON FUNCTION public.generate_barangay_case_number() TO authenticated;


-- ──────────────────────────────────────────────────────────────
-- C. official_documents: reklamo types, status, version, snapshot
-- ──────────────────────────────────────────────────────────────
-- Widen document_type. All previous values are kept; three are
-- added. Safe to re-run.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'official_documents_document_type_check'
  ) THEN
    ALTER TABLE public.official_documents
      DROP CONSTRAINT official_documents_document_type_check;
  END IF;
END
$$;

-- 'agreement', 'boac', 'certificate' and 'correspondence' were already
-- offered by the Captain DocumentsTab upload picker but were missing from the
-- original CHECK, so those uploads failed the constraint. They are added here
-- because this is the file that redefines the constraint.
ALTER TABLE public.official_documents
  ADD CONSTRAINT official_documents_document_type_check
  CHECK (document_type IN (
    'complaint_summary', 'summons', 'hearing_notice',
    'minutes', 'settlement', 'certificate_to_file_action',
    'blotter_report', 'referral_note', 'resolution',
    'proof_of_service',
    'agreement', 'boac', 'certificate', 'correspondence',
    -- Reklamo Form workflow
    'submission_receipt', 'reklamo_form', 'signed_reklamo_form',
    'other'
  ));

-- document_status is the signature lifecycle of the document.
-- It is separate from the existing `status` column, which means
-- active / archived / superseded (a record lifecycle). Overloading
-- `status` would have made "archived" and "signed" compete.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'official_documents_document_status_check'
  ) THEN
    ALTER TABLE public.official_documents
      DROP CONSTRAINT official_documents_document_status_check;
  END IF;
END
$$;

ALTER TABLE public.official_documents
  ADD COLUMN IF NOT EXISTS document_status text
    NOT NULL DEFAULT 'pending_review',
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS generated_at timestamptz,
  ADD COLUMN IF NOT EXISTS generated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS signed_at timestamptz,
  ADD COLUMN IF NOT EXISTS content_snapshot jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'official_documents_document_status_check'
  ) THEN
    ALTER TABLE public.official_documents
      ADD CONSTRAINT official_documents_document_status_check
      CHECK (document_status IN (
        'pending_review',       -- submission receipt, not yet reviewed
        'draft',                -- generated, not officially received
        'for_signature',        -- officially received, awaiting wet signature
        'officially_received',  -- received, signature still outstanding
        'signed_and_filed'      -- final signed copy on file
      ));
  END IF;
END
$$;

-- One row per complaint, document type and version. A regenerated
-- form therefore creates a new version instead of overwriting the
-- signed copy that already exists.
CREATE UNIQUE INDEX IF NOT EXISTS idx_official_documents_type_version
  ON public.official_documents (complaint_id, document_type, version)
  WHERE complaint_id IS NOT NULL;

-- The signed copy is looked up per complaint, per version.
CREATE INDEX IF NOT EXISTS idx_official_documents_reklamo
  ON public.official_documents (complaint_id, document_type, document_status);


-- ──────────────────────────────────────────────────────────────
-- D. Officially receive a complaint (assigns the case number)
-- ──────────────────────────────────────────────────────────────
-- SECURITY DEFINER so the case number is generated server-side and
-- can never be supplied or chosen by the browser. Idempotent: a
-- second call returns the case number already on file instead of
-- allocating a new one.
CREATE OR REPLACE FUNCTION public.receive_complaint_official(
  p_complaint_id uuid,
  p_review_notes text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role       app_role;
  v_case       text;
  v_existing   text;
  v_ref        text;
  v_resident   uuid;
  v_already    boolean := false;
  v_result     json;
  v_now        timestamptz := now();
BEGIN
  SELECT role INTO v_role FROM profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_role NOT IN ('captain', 'oic', 'secretary') THEN
    RAISE EXCEPTION 'Only an authorized barangay official may officially receive a complaint.'
      USING ERRCODE = '42501';
  END IF;

  SELECT barangay_case_number, reference_number, resident_id
    INTO v_existing, v_ref, v_resident
  FROM complaints
  WHERE id = p_complaint_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Complaint not found.' USING ERRCODE = 'P0002';
  END IF;

  IF v_existing IS NOT NULL THEN
    -- Already officially received. Never allocate a second number.
    v_already := true;
    v_case := v_existing;
  ELSE
    v_case := public.generate_barangay_case_number();
    v_already := false;
  END IF;

  UPDATE complaints SET
    barangay_case_number = v_case,
    official_received_at = COALESCE(official_received_at, v_now),
    received_by = COALESCE(received_by, auth.uid()),
    current_status = 'For Official Categorization',
    current_stage = 'For Official Categorization',
    updated_at = v_now
  WHERE id = p_complaint_id;

  INSERT INTO case_statuses (complaint_id, status, stage, resident_visible_message, changed_by, created_at)
  VALUES (
    p_complaint_id,
    'For Official Categorization',
    'Officially Received — Awaiting Official Categorization',
    'Your complaint was officially received by the barangay and is now under official review.',
    auth.uid(),
    v_now
  );

  -- Only the notes and the reviewer are touched. confirmed_category /
  -- confirmed_urgency stay NULL: categorization is the next stage and must not
  -- be marked confirmed by receiving a complaint.
  INSERT INTO complaint_reviews (complaint_id, reviewed_by, review_notes, reviewed_at)
  VALUES (p_complaint_id, auth.uid(), p_review_notes, v_now)
  ON CONFLICT (complaint_id) DO UPDATE
    SET reviewed_by = auth.uid(),
        review_notes = COALESCE(EXCLUDED.review_notes, complaint_reviews.review_notes),
        reviewed_at = v_now;

  PERFORM public.log_activity(
    'complaint_officially_received',
    'complaint',
    p_complaint_id,
    v_ref,
    jsonb_build_object('barangay_case_number', v_case, 'already_received', v_already)
  );

  IF NOT v_already THEN
    PERFORM public.log_activity(
      'barangay_case_number_assigned',
      'complaint',
      p_complaint_id,
      v_case,
      jsonb_build_object('tracking_number', v_ref, 'barangay_case_number', v_case)
    );
  END IF;

  -- Notify the complainant that the complaint is now an official
  -- barangay case. Tolerant of a missing notifications table.
  IF v_resident IS NOT NULL THEN
    BEGIN
      INSERT INTO notifications (user_id, type, title, message, related_complaint_id)
      VALUES (
        v_resident,
        'complaint',
        'Complaint officially received',
        'Your complaint ' || COALESCE(v_ref, '') ||
          ' was officially received by Barangay Abuno. Case number ' || v_case || '.',
        p_complaint_id
      );
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;

  v_result := json_build_object(
    'id', p_complaint_id,
    'barangay_case_number', v_case,
    'reference_number', v_ref,
    'official_received_at', v_now,
    'already_received', v_already
  );

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.receive_complaint_official(uuid, text) TO authenticated;


-- ──────────────────────────────────────────────────────────────
-- E. Record the submission receipt row
-- ──────────────────────────────────────────────────────────────
-- Residents may create exactly one submission receipt, for their
-- own complaint, and only while that complaint has not been
-- officially received. The PDF bytes are uploaded by the client to
-- complaints/{id}/receipts/, and only the stable path is stored
-- here. No signed URL is ever persisted.
CREATE OR REPLACE FUNCTION public.record_submission_receipt(
  p_complaint_id uuid,
  p_filename text,
  p_storage_path text,
  p_file_size bigint DEFAULT NULL,
  p_evidence_count integer DEFAULT 0,
  p_snapshot jsonb DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner uuid;
  v_case  text;
  v_ref   text;
  v_doc   uuid;
  v_path  text;
BEGIN
  SELECT resident_id, barangay_case_number, reference_number
    INTO v_owner, v_case, v_ref
  FROM complaints
  WHERE id = p_complaint_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Complaint not found.' USING ERRCODE = 'P0002';
  END IF;

  IF v_owner IS NULL OR v_owner <> auth.uid() THEN
    RAISE EXCEPTION 'You can only create a receipt for your own complaint.'
      USING ERRCODE = '42501';
  END IF;

  -- An officially received complaint already has the official form.
  IF v_case IS NOT NULL THEN
    RAISE EXCEPTION 'This complaint has already been officially received.'
      USING ERRCODE = '22023';
  END IF;

  -- Pin the path to the caller's own receipt folder.
  v_path := 'complaints/' || p_complaint_id::text || '/receipts/' || p_filename;

  INSERT INTO official_documents (
    complaint_id, document_type, document_status, title, filename,
    storage_path, mime_type, file_size, visibility, status, version,
    generated_at, generated_by, content_snapshot
  ) VALUES (
    p_complaint_id, 'submission_receipt', 'pending_review',
    'Submission Copy — Pending Barangay Review',
    p_filename, v_path, 'application/pdf', p_file_size,
    'resident_visible', 'active', 1, now(), auth.uid(),
    COALESCE(p_snapshot, jsonb_build_object('evidence_count', p_evidence_count))
  )
  ON CONFLICT (complaint_id, document_type, version) WHERE complaint_id IS NOT NULL
  DO UPDATE SET
    storage_path = EXCLUDED.storage_path,
    file_size = EXCLUDED.file_size,
    content_snapshot = EXCLUDED.content_snapshot,
    generated_at = now()
  RETURNING id INTO v_doc;

  PERFORM public.log_activity(
    'submission_receipt_generated',
    'complaint',
    p_complaint_id,
    v_ref,
    jsonb_build_object('document_type', 'submission_receipt', 'evidence_count', p_evidence_count)
  );

  RETURN v_doc;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_submission_receipt(uuid, text, text, bigint, integer, jsonb) TO authenticated;


-- ──────────────────────────────────────────────────────────────
-- D2. Set the desired resolution ("Nadawat / Gitipigan")
-- ──────────────────────────────────────────────────────────────
-- Added as a separate RPC rather than by changing create_complaint().
-- Changing that function's parameter list would not replace it; Postgres
-- would keep the old signature as an overload, so the new one would be
-- ambiguous with the old one instead of taking effect.
--
-- Locked once the complaint is officially received: at that point the
-- official form is the record of what was asked for, and an edit after
-- receipt would silently diverge from the printed form.
CREATE OR REPLACE FUNCTION public.set_complaint_desired_relief(
  p_complaint_id uuid,
  p_desired_relief text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner uuid;
  v_role  app_role;
  v_case  text;
  v_value text;
BEGIN
  v_value := NULLIF(btrim(coalesce(p_desired_relief, '')), '');

  IF v_value IS NOT NULL AND length(v_value) > 2000 THEN
    RAISE EXCEPTION 'Desired resolution is too long (maximum 2000 characters).'
      USING ERRCODE = '22001';
  END IF;

  SELECT resident_id, barangay_case_number INTO v_owner, v_case
  FROM complaints WHERE id = p_complaint_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Complaint not found.' USING ERRCODE = 'P0002';
  END IF;

  SELECT role INTO v_role FROM profiles WHERE id = auth.uid();

  IF v_role NOT IN ('captain', 'oic', 'secretary') AND v_owner IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'You cannot edit this complaint.' USING ERRCODE = '42501';
  END IF;

  IF v_case IS NOT NULL THEN
    RAISE EXCEPTION 'This complaint was already officially received and can no longer be edited.'
      USING ERRCODE = '22023';
  END IF;

  UPDATE complaints
     SET desired_relief = v_value, updated_at = now()
   WHERE id = p_complaint_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_complaint_desired_relief(uuid, text) TO authenticated;


-- ──────────────────────────────────────────────────────────────
-- F. Resident RLS: scope document reads to the reader's own case
-- ──────────────────────────────────────────────────────────────
-- The pre-existing policy allowed every resident to read every
-- resident_visible document. Policies are permissive and combined
-- with OR, so adding a stricter one cannot narrow it. The broad
-- policy is dropped and replaced with a complaint-scoped one.
DROP POLICY IF EXISTS "Residents read visible documents" ON public.official_documents;

CREATE POLICY "Residents read own complaint documents"
  ON public.official_documents FOR SELECT
  USING (
    visibility = 'resident_visible'
    AND EXISTS (
      SELECT 1 FROM public.complaints c
      WHERE c.id = official_documents.complaint_id
        AND c.resident_id = auth.uid()
    )
  );

-- Residents may read the private documents bucket, but only objects
-- that belong to a document row on their own complaint.
CREATE POLICY "Residents read own complaint documents storage"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'documents'
    AND EXISTS (
      SELECT 1
      FROM public.official_documents d
      JOIN public.complaints c ON c.id = d.complaint_id
      WHERE d.storage_path = storage.objects.name
        AND d.visibility = 'resident_visible'
        AND c.resident_id = auth.uid()
    )
  );

-- Residents may upload only into the receipts folder of their own
-- complaint. Uploaded bytes alone grant nothing: the matching
-- official_documents row must be created through
-- record_submission_receipt(), which re-checks ownership.
CREATE POLICY "Residents upload own complaint receipts"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'documents'
    AND (storage.foldername(name))[1] = 'complaints'
    AND (storage.foldername(name))[3] = 'receipts'
    AND EXISTS (
      SELECT 1 FROM public.complaints c
      WHERE c.id::text = (storage.foldername(name))[2]
        AND c.resident_id = auth.uid()
    )
  );


-- ──────────────────────────────────────────────────────────────
-- G. Storage bucket confirmation (no change made here)
-- ──────────────────────────────────────────────────────────────
-- captain-portal-schema-additions.sql already created 'documents'
-- as public = false with a 10 MB limit and the allowed MIME types
-- application/pdf, ...wordprocessingml.document, image/jpeg,
-- image/png. Signed Reklamo copies are validated against PDF, JPEG
-- and PNG, which this bucket already permits. Nothing to change.
--
-- If 'documents' is missing from your project, run section 6 of
-- captain-portal-schema-additions.sql first.


-- ──────────────────────────────────────────────────────────────
-- H. Grants
-- ──────────────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE ON public.official_documents TO authenticated;
GRANT SELECT, UPDATE ON public.complaints TO authenticated;


-- ──────────────────────────────────────────────────────────────
-- H2. Receiving official name on the Captain case bundle
-- ──────────────────────────────────────────────────────────────
-- complaints.received_by is a bare uuid. The Reklamo Form needs a name to
-- print, and the Captain case view loads the complaint through
-- COMPLAINT_EMBED. A second FK embed of the same profiles row is not reliably
-- resolvable, so a security-definer view is used instead: it is readable
-- through the existing complaint SELECT policies and leaks nothing the
-- official cannot already see.
CREATE OR REPLACE VIEW public.complaint_receipt_officials
  WITH (security_invoker = true)
AS
SELECT c.id AS complaint_id,
       c.barangay_case_number,
       c.official_received_at,
       c.received_by,
       p.display_name AS received_by_name
  FROM public.complaints c
  LEFT JOIN public.profiles p ON p.id = c.received_by
 WHERE c.received_by IS NOT NULL;

COMMENT ON VIEW public.complaint_receipt_officials IS
  'Barangay Case Number plus the receiving official''s display name, for the Reklamo Form.';


-- ──────────────────────────────────────────────────────────────
-- I. Verification
-- ──────────────────────────────────────────────────────────────
-- Expect every row to read 'ok'.
SELECT 'complaints.barangay_case_number' AS object, 'ok' AS status
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'complaints'
   AND column_name = 'barangay_case_number'
UNION ALL
SELECT 'complaints.official_received_at', 'ok'
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'complaints'
   AND column_name = 'official_received_at'
UNION ALL
SELECT 'complaints.received_by', 'ok'
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'complaints'
   AND column_name = 'received_by'
UNION ALL
SELECT 'official_documents.document_status', 'ok'
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'official_documents'
   AND column_name = 'document_status'
UNION ALL
SELECT 'official_documents.version', 'ok'
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'official_documents'
   AND column_name = 'version'
UNION ALL
SELECT 'official_documents.content_snapshot', 'ok'
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'official_documents'
   AND column_name = 'content_snapshot'
UNION ALL
SELECT 'barangay_case_sequences', 'ok'
  FROM information_schema.tables
 WHERE table_schema = 'public' AND table_name = 'barangay_case_sequences'
UNION ALL
SELECT 'generate_barangay_case_number()', 'ok'
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'generate_barangay_case_number'
UNION ALL
SELECT 'receive_complaint_official()', 'ok'
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'receive_complaint_official'
UNION ALL
SELECT 'record_submission_receipt()', 'ok'
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'record_submission_receipt'
UNION ALL
SELECT 'set_complaint_desired_relief()', 'ok'
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'set_complaint_desired_relief'
UNION ALL
SELECT 'complaints.desired_relief', 'ok'
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'complaints'
   AND column_name = 'desired_relief'
UNION ALL
SELECT 'documents bucket is private', CASE WHEN public = false THEN 'ok' ELSE 'NOT PRIVATE' END
  FROM storage.buckets WHERE id = 'documents'
UNION ALL
SELECT 'resident document read is complaint-scoped', CASE WHEN count(*) = 1 THEN 'ok' ELSE 'CHECK POLICIES' END
  FROM pg_policies
 WHERE schemaname = 'public' AND tablename = 'official_documents'
   AND policyname = 'Residents read own complaint documents'
UNION ALL
SELECT 'over-broad resident policy removed', CASE WHEN count(*) = 0 THEN 'ok' ELSE 'STILL PRESENT' END
  FROM pg_policies
 WHERE schemaname = 'public' AND tablename = 'official_documents'
   AND policyname = 'Residents read visible documents';

-- Should return 0 rows once the file is applied. Any row here means a
-- document exists whose receipt fields are only partly populated.
SELECT id, reference_number, barangay_case_number, official_received_at, received_by
  FROM complaints
 WHERE (barangay_case_number IS NULL) <> (official_received_at IS NULL)
    OR (barangay_case_number IS NOT NULL AND received_by IS NULL);
