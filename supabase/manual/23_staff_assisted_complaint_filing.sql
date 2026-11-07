-- ============================================================
-- 23_staff_assisted_complaint_filing.sql
-- Purpose: Support staff-assisted / Barangay Hall complaint
--          encoding by authorized officials (captain, oic,
--          secretary).
--
-- WHY THIS IS REQUIRED:
--   complaints.resident_id is currently NOT NULL and is the
--   only complainant link. A walk-in resident with no portal
--   account has no profiles row, so a complaint cannot be
--   filed without inventing a fake authenticated user.
--   This file makes resident_id nullable and stores a
--   complainant snapshot on the complaint for walk-ins, while
--   preserving every existing row and policy.
--
-- Safety:  All changes are additive / non-destructive.
--          Existing rows keep resident_id and gain default
--          filing_channel = 'online'. No records are deleted.
--
-- PREREQUISITES:
--   1. Files 01-22 + captain-portal-schema-additions.sql
--      must already be applied.
--
-- HOW TO APPLY (Supabase Dashboard > SQL Editor):
--   1. Open SQL Editor → New query.
--   2. Paste this entire file.
--   3. Click Run.
--   4. Expected: Success. No rows returned for DDL; the final
--      verification SELECT should return one row per officer
--      column check.
-- ============================================================

-- ──────────────────────────────────────────────────────────────
-- A. Staff-assisted columns on complaints
-- ──────────────────────────────────────────────────────────────
ALTER TABLE public.complaints
  ADD COLUMN IF NOT EXISTS filing_channel text NOT NULL DEFAULT 'online',
  ADD COLUMN IF NOT EXISTS encoded_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS encoded_at timestamptz,
  ADD COLUMN IF NOT EXISTS assisted_filing_reason text,
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'resident_portal',
  ADD COLUMN IF NOT EXISTS complainant_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS respondent_name text,
  ADD COLUMN IF NOT EXISTS respondent_address text,
  ADD COLUMN IF NOT EXISTS respondent_contact text,
  ADD COLUMN IF NOT EXISTS incident_purok text,
  ADD COLUMN IF NOT EXISTS other_involved text,
  ADD COLUMN IF NOT EXISTS resident_confirmation_method text,
  ADD COLUMN IF NOT EXISTS resident_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS resident_ack_note text,
  ADD COLUMN IF NOT EXISTS duplicate_override_reason text;

-- Restrict filing_channel to known values (idempotent-safe via DO)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'complaints_filing_channel_check'
      AND conrelid = 'public.complaints'::regclass
  ) THEN
    ALTER TABLE public.complaints
      ADD CONSTRAINT complaints_filing_channel_check
      CHECK (filing_channel IN ('online', 'staff_assisted', 'barangay_hall'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'complaints_source_check'
      AND conrelid = 'public.complaints'::regclass
  ) THEN
    ALTER TABLE public.complaints
      ADD CONSTRAINT complaints_source_check
      CHECK (source IN ('resident_portal', 'staff_assisted', 'manual'));
  END IF;

  -- Walk-in must have a snapshot; linked residents keep resident_id.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'complaints_complainant_presence_check'
      AND conrelid = 'public.complaints'::regclass
  ) THEN
    ALTER TABLE public.complaints
      ADD CONSTRAINT complaints_complainant_presence_check
      CHECK (resident_id IS NOT NULL OR complainant_snapshot IS NOT NULL);
  END IF;
END
$$;

-- Allow walk-in complaints (nullable resident_id). Non-destructive.
ALTER TABLE public.complaints ALTER COLUMN resident_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_complaints_encoded_by ON public.complaints(encoded_by);
CREATE INDEX IF NOT EXISTS idx_complaints_filing_channel ON public.complaints(filing_channel);
CREATE INDEX IF NOT EXISTS idx_complaints_incident_date ON public.complaints(incident_date);

-- ──────────────────────────────────────────────────────────────
-- B. RLS — officials may insert staff-assisted complaints only
-- ──────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Officials insert staff-assisted complaints" ON public.complaints;
CREATE POLICY "Officials insert staff-assisted complaints"
  ON public.complaints FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('captain', 'oic', 'secretary')
    )
    AND encoded_by = auth.uid()
    AND filing_channel IN ('staff_assisted', 'barangay_hall')
    AND source = 'staff_assisted'
    AND (resident_id IS NOT NULL OR complainant_snapshot IS NOT NULL)
  );

-- ──────────────────────────────────────────────────────────────
-- C. RLS — officials may attach evidence they upload
-- ──────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Officials insert complaint evidence" ON public.evidence;
CREATE POLICY "Officials insert complaint evidence"
  ON public.evidence FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('captain', 'oic', 'secretary')
    )
    AND uploaded_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.complaints c
      WHERE c.id = evidence.complaint_id
        AND c.encoded_by = auth.uid()
    )
  );

-- Officials may delete evidence they uploaded while still encoding
-- (mirrors resident editable-status rule).
DROP POLICY IF EXISTS "Officials delete own complaint evidence" ON public.evidence;
CREATE POLICY "Officials delete own complaint evidence"
  ON public.evidence FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('captain', 'oic', 'secretary')
    )
    AND uploaded_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.complaints c
      WHERE c.id = evidence.complaint_id
        AND c.encoded_by = auth.uid()
        AND c.current_status IN ('Pending Review', 'Received')
    )
  );

-- ──────────────────────────────────────────────────────────────
-- D. Storage — officials upload under their own uid folder
--      Path convention: {encoderUid}/{complaintId}/file.ext
--      Matches existing (storage.foldername(name))[1] = auth.uid() rule.
-- ──────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Officials upload own evidence storage" ON storage.objects;
CREATE POLICY "Officials upload own evidence storage"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'evidence'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('captain', 'oic', 'secretary')
    )
  );

DROP POLICY IF EXISTS "Officials read own evidence storage" ON storage.objects;
CREATE POLICY "Officials read own evidence storage"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'evidence'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('captain', 'oic', 'secretary')
    )
  );

-- ──────────────────────────────────────────────────────────────
-- E. Atomic server-side submission RPC
--      - Verifies caller is an authorized official (auth.uid())
--      - Generates reference_number server-side
--      - Sets encoded_by from auth.uid() only (never from client body)
--      - Creates initial status history + audit log
--      - Returns { id, reference_number }
-- ──────────────────────────────────────────────────────────────
    CREATE OR REPLACE FUNCTION public.create_staff_assisted_complaint(
      p_title text,
      p_description text,
      p_incident_date date,
      p_incident_time time,
      p_incident_location text,
      p_incident_purok text,
      p_persons_involved text,
      p_witnesses text,
      p_resident_user_id uuid,
      p_complainant_snapshot jsonb,
      p_respondent_name text,
      p_respondent_address text,
      p_respondent_contact text,
      p_other_involved text,
      p_assisted_filing_reason text,
      p_confirmation_method text,
      p_resident_ack_note text,
      p_duplicate_override_reason text,
      p_predicted_category text,
      p_predicted_case_type text,
      p_predicted_urgency text,
      p_prediction_confidence numeric,
      p_filing_channel text DEFAULT 'staff_assisted'
    )
    RETURNS json
    LANGUAGE plpgsql
    SECURITY DEFINER
  SET search_path = public
  AS $$
  DECLARE
    v_role app_role;
    v_ref text;
    v_id uuid;
    v_channel text;
  BEGIN
    -- 1. Server-side authorization (never trust client metadata alone)
    SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
    IF v_role IS NULL OR v_role NOT IN ('captain', 'oic', 'secretary') THEN
      RAISE EXCEPTION 'Not authorized to encode complaints';
    END IF;

    IF auth.uid() IS NULL THEN
      RAISE EXCEPTION 'Not authenticated';
    END IF;

    -- 2. Validate filing channel
    IF p_filing_channel NOT IN ('staff_assisted', 'barangay_hall') THEN
      RAISE EXCEPTION 'Invalid filing channel for staff-assisted encoding';
    END IF;
    v_channel := p_filing_channel;

    -- 3. Validate complainant presence
    IF p_resident_user_id IS NULL AND (p_complainant_snapshot IS NULL OR p_complainant_snapshot = '{}'::jsonb) THEN
      RAISE EXCEPTION 'A linked resident or walk-in complainant snapshot is required';
    END IF;

    -- 4. If linked, verify that profile exists and is a resident (or at least exists)
    IF p_resident_user_id IS NOT NULL THEN
      IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_resident_user_id) THEN
        RAISE EXCEPTION 'Linked resident profile not found';
      END IF;
    END IF;

    -- 5. Required fields
    IF p_title IS NULL OR length(trim(p_title)) = 0 THEN
      RAISE EXCEPTION 'Complaint title is required';
    END IF;
    IF p_description IS NULL OR length(trim(p_description)) < 20 THEN
      RAISE EXCEPTION 'Complaint narrative must be at least 20 characters';
    END IF;
    IF p_incident_location IS NULL OR length(trim(p_incident_location)) = 0 THEN
      RAISE EXCEPTION 'Incident location is required';
    END IF;
    IF p_incident_date IS NOT NULL AND p_incident_date > current_date THEN
      RAISE EXCEPTION 'Incident date cannot be in the future';
    END IF;

    -- 6. Server-side reference number (not browser-generated)
    v_ref := public.generate_reference_number();

    -- 7. Create complaint
    INSERT INTO public.complaints (
      resident_id,
      reference_number,
      title,
      description,
      incident_date,
      incident_time,
      incident_location,
      persons_involved,
      witnesses,
      predicted_category,
      predicted_case_type,
      predicted_urgency,
      prediction_confidence,
      current_status,
      current_stage,
      filing_channel,
      encoded_by,
      encoded_at,
      assisted_filing_reason,
      source,
      complainant_snapshot,
      respondent_name,
      respondent_address,
      respondent_contact,
      incident_purok,
      other_involved,
      resident_confirmation_method,
      resident_confirmed_at,
      resident_ack_note,
      duplicate_override_reason
    ) VALUES (
      p_resident_user_id,
      v_ref,
      trim(p_title),
      trim(p_description),
      p_incident_date,
      p_incident_time,
      trim(p_incident_location),
      p_persons_involved,
      p_witnesses,
      p_predicted_category::case_category,
      p_predicted_case_type::case_category,
      p_predicted_urgency::urgency_level,
      p_prediction_confidence,
      'Pending Review',
      'Pending Review',
      v_channel,
      auth.uid(),
      now(),
      p_assisted_filing_reason,
      'staff_assisted',
      p_complainant_snapshot,
      p_respondent_name,
      p_respondent_address,
      p_respondent_contact,
      p_incident_purok,
      p_other_involved,
      p_confirmation_method,
      CASE WHEN p_confirmation_method IS NOT NULL THEN now() ELSE NULL END,
      p_resident_ack_note,
      p_duplicate_override_reason
    )
    RETURNING id INTO v_id;

    -- 8. Initial status history
    INSERT INTO public.case_statuses (
      complaint_id, status, stage, resident_visible_message, changed_by
    ) VALUES (
      v_id, 'Pending Review', 'Pending Review',
      'Complaint received at the barangay hall and is awaiting review.',
      auth.uid()
    );

    -- 9. Immutable audit entry
    PERFORM public.log_activity(
      'staff_assisted_complaint_created',
      'complaint',
      v_id,
      v_ref,
      jsonb_build_object(
        'filing_channel', v_channel,
        'resident_linked', (p_resident_user_id IS NOT NULL),
        'walk_in', (p_resident_user_id IS NULL),
        'assisted_reason', p_assisted_filing_reason,
        'confirmation_method', p_confirmation_method
      )
    );

    -- 10. ML recommendation log (unconfirmed recommendation only)
    PERFORM public.log_activity(
      'ml_recommendation_generated',
      'complaint',
      v_id,
      v_ref,
      jsonb_build_object(
        'suggested_category', p_predicted_category,
        'suggested_urgency', p_predicted_urgency,
        'confidence', p_prediction_confidence,
        'officially_confirmed', false
      )
    );

    RETURN json_build_object('id', v_id, 'reference_number', v_ref);
  END;
  $$;

GRANT EXECUTE ON FUNCTION public.create_staff_assisted_complaint(
  text, text, date, time, text, text, text, text, uuid, jsonb,
  text, text, text, text, text, text, text, text,
  text, text, text, numeric, text
) TO authenticated;

-- ──────────────────────────────────────────────────────────────
-- F. Verification helpers (run after applying)
-- ──────────────────────────────────────────────────────────────
-- SELECT column_name FROM information_schema.columns
-- WHERE table_name = 'complaints' AND column_name IN (
--   'filing_channel','encoded_by','encoded_at','complainant_snapshot',
--   'respondent_name','resident_confirmation_method'
-- ) ORDER BY column_name;
-- Should return 6 rows.
