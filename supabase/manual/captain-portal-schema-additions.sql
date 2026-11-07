-- ============================================================
-- captain-portal-schema-additions.sql
-- Purpose: Add oic, secretary, lupon roles; create activity
--          logs, lupon panels, blotter records, documents,
--          and official-related tables for the Captain portal.
--          Add RLS policies for officials to manage complaints.
-- Safety:  All additive, non-destructive. Preserves existing data.
--
-- PREREQUISITES:
--   1. All prior SQL files (01-19) must be applied first.
--   2. The app_role enum already has: resident, captain, staff, police, admin
--   3. We ADD oic, secretary, lupon to the enum.
--
-- HOW TO APPLY:
--   1. Open Supabase Dashboard > SQL Editor
--   2. Paste this entire file
--   3. Click "Run"
--   4. Verify with: SELECT unnest(enum_range(NULL::app_role));
-- ============================================================

-- ── 1. Extend app_role enum ────────────────────────────────
-- IMPORTANT: Each ALTER TYPE must run as a separate statement.
-- PostgreSQL cannot add multiple enum values referencing each other
-- in a single transaction. Run each block separately in the SQL Editor.

-- Step 1a: Add 'oic'
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'oic' AND enumtypid = 'app_role'::regtype) THEN
    ALTER TYPE app_role ADD VALUE 'oic';
  END IF;
END
$$;

-- Step 1b: Add 'secretary' (run AFTER step 1a succeeds)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'secretary' AND enumtypid = 'app_role'::regtype) THEN
    ALTER TYPE app_role ADD VALUE 'secretary';
  END IF;
END
$$;

-- Step 1c: Add 'lupon' (run AFTER step 1b succeeds)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'lupon' AND enumtypid = 'app_role'::regtype) THEN
    ALTER TYPE app_role ADD VALUE 'lupon';
  END IF;
END
$$;

-- ── 2. Activity logs ───────────────────────────────────────
-- Records official actions for audit trail
CREATE TABLE IF NOT EXISTS activity_logs (
  id            uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  actor_id      uuid REFERENCES profiles(id) ON DELETE SET NULL,
  actor_role    app_role,
  action        text NOT NULL,
  target_type   text,
  target_id     uuid,
  entity_ref    text,
  details       jsonb DEFAULT '{}',
  old_values    jsonb,
  new_values    jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_activity_logs_actor_id ON activity_logs(actor_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at ON activity_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_activity_logs_action ON activity_logs(action);
CREATE INDEX IF NOT EXISTS idx_activity_logs_target ON activity_logs(target_type, target_id);

ALTER TABLE activity_logs ENABLE ROW LEVEL SECURITY;

-- Officials (captain, oic, secretary) can read activity logs
CREATE POLICY "Officials read activity logs"
  ON activity_logs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('captain', 'oic', 'secretary')
    )
  );

-- Officials can insert activity logs
CREATE POLICY "Officials insert activity logs"
  ON activity_logs FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('captain', 'oic', 'secretary')
    )
  );

-- ── 3. Lupon panels ────────────────────────────────────────
-- Tracks lupon member assignments to complaints
CREATE TABLE IF NOT EXISTS lupon_panels (
  id              uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  complaint_id    uuid NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
  member_id       uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role            text NOT NULL DEFAULT 'member'
                  CHECK (role IN ('chairperson', 'member', 'alternate')),
  assigned_by     uuid REFERENCES profiles(id),
  assigned_at     timestamptz NOT NULL DEFAULT now(),
  replaced_by     uuid REFERENCES profiles(id),
  replaced_at     timestamptz,
  replace_reason  text,
  status          text NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'replaced', 'removed')),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lupon_complaint_id ON lupon_panels(complaint_id);
CREATE INDEX IF NOT EXISTS idx_lupon_member_id ON lupon_panels(member_id);

ALTER TABLE lupon_panels ENABLE ROW LEVEL SECURITY;

-- Officials can read all lupon panels
CREATE POLICY "Officials read lupon panels"
  ON lupon_panels FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('captain', 'oic', 'secretary')
    )
  );

-- Officials can manage lupon panels
CREATE POLICY "Officials manage lupon panels"
  ON lupon_panels FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('captain', 'oic', 'secretary')
    )
  );

-- Lupon members can read their own assignments
CREATE POLICY "Lupon read own assignments"
  ON lupon_panels FOR SELECT
  USING (
    auth.uid() = member_id
    AND EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role = 'lupon'
    )
  );

-- ── 4. Blotter records ─────────────────────────────────────
-- Official blotter records linked to complaints
CREATE TABLE IF NOT EXISTS blotter_records (
  id              uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  blotter_number  text UNIQUE NOT NULL,
  complaint_id    uuid REFERENCES complaints(id) ON DELETE SET NULL,
  incident_summary text NOT NULL,
  complainant_name text,
  respondent_name text,
  incident_date   date,
  incident_location text,
  confirmed_category case_category,
  confirmed_urgency  urgency_level,
  current_status  text NOT NULL DEFAULT 'open'
                  CHECK (current_status IN ('open', 'resolved', 'archived', 'corrected')),
  action_taken    text,
  resolution      text,
  recorded_by     uuid REFERENCES profiles(id),
  recorded_at     timestamptz NOT NULL DEFAULT now(),
  last_updated    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_blotter_complaint_id ON blotter_records(complaint_id);
CREATE INDEX IF NOT EXISTS idx_blotter_number ON blotter_records(blotter_number);

ALTER TABLE blotter_records ENABLE ROW LEVEL SECURITY;

-- Officials can read all blotter records
CREATE POLICY "Officials read blotter records"
  ON blotter_records FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('captain', 'oic', 'secretary')
    )
  );

-- Officials can manage blotter records
CREATE POLICY "Officials manage blotter records"
  ON blotter_records FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('captain', 'oic', 'secretary')
    )
  );

-- ── 5. Official documents ──────────────────────────────────
-- Documents generated or uploaded by officials
CREATE TABLE IF NOT EXISTS official_documents (
  id              uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  complaint_id    uuid REFERENCES complaints(id) ON DELETE SET NULL,
  document_type   text NOT NULL
                  CHECK (document_type IN (
                    'complaint_summary', 'summons', 'hearing_notice',
                    'minutes', 'settlement', 'certificate_to_file_action',
                    'blotter_report', 'referral_note', 'resolution',
                    'proof_of_service', 'other'
                  )),
  title           text NOT NULL,
  filename        text NOT NULL,
  storage_path    text NOT NULL,
  mime_type       text NOT NULL DEFAULT 'application/pdf',
  file_size       bigint,
  visibility      text NOT NULL DEFAULT 'official'
                  CHECK (visibility IN ('official', 'resident_visible', 'public')),
  status          text NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'archived', 'superseded')),
  uploaded_by     uuid REFERENCES profiles(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_documents_complaint_id ON official_documents(complaint_id);
CREATE INDEX IF NOT EXISTS idx_documents_type ON official_documents(document_type);

ALTER TABLE official_documents ENABLE ROW LEVEL SECURITY;

-- Officials can read all documents
CREATE POLICY "Officials read documents"
  ON official_documents FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('captain', 'oic', 'secretary')
    )
  );

-- Officials can manage documents
CREATE POLICY "Officials manage documents"
  ON official_documents FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('captain', 'oic', 'secretary')
    )
  );

-- Residents can read documents marked as resident_visible
CREATE POLICY "Residents read visible documents"
  ON official_documents FOR SELECT
  USING (
    visibility = 'resident_visible'
    AND EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role = 'resident'
    )
  );

-- ── 6. Document storage bucket ─────────────────────────────
-- Add 'documents' bucket for official documents
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('documents', 'documents', false, 10485760, ARRAY['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','image/jpeg','image/png'])
ON CONFLICT (id) DO NOTHING;

-- Officials can upload documents
CREATE POLICY "Officials upload documents"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'documents'
    AND EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('captain', 'oic', 'secretary')
    )
  );

-- Officials can read all documents
CREATE POLICY "Officials read documents storage"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'documents'
    AND EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('captain', 'oic', 'secretary')
    )
  );

-- Officials can delete documents
CREATE POLICY "Officials delete documents storage"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'documents'
    AND EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('captain', 'oic', 'secretary')
    )
  );

-- ── 7. Officials can read evidence ─────────────────────────
-- Officers need to read evidence for complaint review
CREATE POLICY "Officials read all evidence"
  ON evidence FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('captain', 'oic', 'secretary')
    )
  );

-- Officials can read evidence storage
CREATE POLICY "Officials read all evidence storage"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'evidence'
    AND EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('captain', 'oic', 'secretary')
    )
  );

-- ── 8. Officials can read/update all complaints ────────────
-- Captain, OIC, Secretary need full complaint access
CREATE POLICY "Officials read all complaints"
  ON complaints FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('captain', 'oic', 'secretary')
    )
  );

CREATE POLICY "Officials update complaints"
  ON complaints FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('captain', 'oic', 'secretary')
    )
  );

-- ── 9. Officials can manage complaint reviews ──────────────
CREATE POLICY "Officials read all reviews"
  ON complaint_reviews FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('captain', 'oic', 'secretary')
    )
  );

CREATE POLICY "Officials insert reviews"
  ON complaint_reviews FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('captain', 'oic', 'secretary')
    )
  );

CREATE POLICY "Officials update reviews"
  ON complaint_reviews FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('captain', 'oic', 'secretary')
    )
  );

-- ── 10. Officials can manage case statuses ─────────────────
CREATE POLICY "Officials read all case statuses"
  ON case_statuses FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('captain', 'oic', 'secretary')
    )
  );

CREATE POLICY "Officials insert case statuses"
  ON case_statuses FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('captain', 'oic', 'secretary')
    )
  );

-- ── 11. Officials can manage KP trackers ───────────────────
CREATE POLICY "Officials read all KP trackers"
  ON kp_trackers FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('captain', 'oic', 'secretary')
    )
  );

CREATE POLICY "Officials manage KP trackers"
  ON kp_trackers FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('captain', 'oic', 'secretary')
    )
  );

-- ── 12. Officials can manage KP phases ─────────────────────
CREATE POLICY "Officials read all KP phases"
  ON kp_phases FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('captain', 'oic', 'secretary')
    )
  );

CREATE POLICY "Officials manage KP phases"
  ON kp_phases FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('captain', 'oic', 'secretary')
    )
  );

-- ── 13. Officials can manage hearings ──────────────────────
CREATE POLICY "Officials read all hearings"
  ON hearings FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('captain', 'oic', 'secretary')
    )
  );

CREATE POLICY "Officials insert hearings"
  ON hearings FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('captain', 'oic', 'secretary')
    )
  );

CREATE POLICY "Officials update hearings"
  ON hearings FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('captain', 'oic', 'secretary')
    )
  );

-- ── 14. Officials can manage summons ───────────────────────
CREATE POLICY "Officials read all summons"
  ON summons FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('captain', 'oic', 'secretary')
    )
  );

CREATE POLICY "Officials insert summons"
  ON summons FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('captain', 'oic', 'secretary')
    )
  );

-- ── 15. Officials can read/manage classification logs ──────
CREATE POLICY "Officials read classification logs"
  ON complaint_classification_logs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('captain', 'oic', 'secretary')
    )
  );

CREATE POLICY "Officials insert classification logs"
  ON complaint_classification_logs FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('captain', 'oic', 'secretary')
    )
  );

-- ── 16. Officials can manage case inquiries ────────────────
CREATE POLICY "Officials read all inquiries"
  ON case_inquiries FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('captain', 'oic', 'secretary')
    )
  );

CREATE POLICY "Officials update inquiries"
  ON case_inquiries FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('captain', 'oic', 'secretary')
    )
  );

-- ── 17. Officials can read all profiles ────────────────────
CREATE POLICY "Officials read all profiles"
  ON profiles FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('captain', 'oic', 'secretary')
    )
  );

-- Allow authenticated users to insert their own profile (needed for login auto-heal)
CREATE POLICY "Authenticated users insert own profile"
  ON profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

-- Allow authenticated users to insert own resident_profile (needed for login auto-heal)
CREATE POLICY "Authenticated users insert own resident profile"
  ON resident_profiles FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Allow authenticated users to insert own resident settings (needed for login auto-heal)
CREATE POLICY "Authenticated users insert own resident settings"
  ON resident_settings FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Officials can read all resident profiles
CREATE POLICY "Officials read all resident profiles"
  ON resident_profiles FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('captain', 'oic', 'secretary')
    )
  );

-- ── 18. Officials can manage notifications ─────────────────
CREATE POLICY "Officials insert notifications"
  ON notifications FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('captain', 'oic', 'secretary')
    )
  );

-- ── 19. Officials can read/update PNP referrals ───────────
-- (pnp-referral-requests.sql already has staff policies for captain/staff/admin)
-- We add oic and secretary
CREATE POLICY "Officials read all referral requests v2"
  ON pnp_referral_requests FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('oic', 'secretary')
    )
  );

CREATE POLICY "Officials update all referral requests v2"
  ON pnp_referral_requests FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('oic', 'secretary')
    )
  );

-- ── 20. Blotter number generator ───────────────────────────
CREATE TABLE IF NOT EXISTS blotter_sequences (
  year        integer PRIMARY KEY,
  last_seq    integer NOT NULL DEFAULT 0
);

CREATE OR REPLACE FUNCTION public.generate_blotter_number()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_year  integer;
  v_seq   integer;
  v_ref   text;
BEGIN
  v_year := EXTRACT(YEAR FROM now())::integer;

  INSERT INTO public.blotter_sequences (year, last_seq)
  VALUES (v_year, 1)
  ON CONFLICT (year) DO UPDATE
    SET last_seq = blotter_sequences.last_seq + 1
  RETURNING last_seq INTO v_seq;

  v_ref := 'BL-' || v_year || '-' || LPAD(v_seq::text, 4, '0');
  RETURN v_ref;
END;
$$;

GRANT EXECUTE ON FUNCTION public.generate_blotter_number() TO authenticated;

-- ── 21. Create blotter record function ─────────────────────
CREATE OR REPLACE FUNCTION public.create_blotter_record(
  p_complaint_id uuid,
  p_incident_summary text,
  p_complainant_name text,
  p_respondent_name text,
  p_incident_date date,
  p_incident_location text,
  p_confirmed_category text,
  p_confirmed_urgency text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_blotter_ref text;
  v_id uuid;
  v_result json;
BEGIN
  v_blotter_ref := public.generate_blotter_number();

  INSERT INTO public.blotter_records (
    blotter_number, complaint_id, incident_summary,
    complainant_name, respondent_name,
    incident_date, incident_location,
    confirmed_category, confirmed_urgency,
    recorded_by
  ) VALUES (
    v_blotter_ref, p_complaint_id, p_incident_summary,
    p_complainant_name, p_respondent_name,
    p_incident_date, p_incident_location,
    p_confirmed_category::case_category,
    p_confirmed_urgency::urgency_level,
    auth.uid()
  )
  RETURNING id INTO v_id;

  v_result := json_build_object(
    'id', v_id,
    'blotter_number', v_blotter_ref
  );

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_blotter_record(uuid, text, text, text, date, text, text, text) TO authenticated;

-- ── 22. Activity log helper function ───────────────────────
CREATE OR REPLACE FUNCTION public.log_activity(
  p_action text,
  p_target_type text,
  p_target_id uuid,
  p_entity_ref text,
  p_details jsonb DEFAULT '{}',
  p_old_values jsonb DEFAULT NULL,
  p_new_values jsonb DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role app_role;
BEGIN
  SELECT role INTO v_role FROM profiles WHERE id = auth.uid();

  INSERT INTO activity_logs (actor_id, actor_role, action, target_type, target_id, entity_ref, details, old_values, new_values)
  VALUES (auth.uid(), v_role, p_action, p_target_type, p_target_id, p_entity_ref, p_details, p_old_values, p_new_values);
END;
$$;

GRANT EXECUTE ON FUNCTION public.log_activity(text, text, uuid, text, jsonb, jsonb, jsonb) TO authenticated;

-- ── 23. Official profiles for captain/oic/secretary ────────
-- Officials don't need resident_profiles; they use display_name from profiles.
-- But we create a lightweight official_profiles table for additional info.
CREATE TABLE IF NOT EXISTS official_profiles (
  id            uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  user_id       uuid UNIQUE NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  position      text,
  phone         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE official_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Officials read own official profile"
  ON official_profiles FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Officials update own official profile"
  ON official_profiles FOR UPDATE
  USING (auth.uid() = user_id);

-- Admins/captains can read all official profiles
CREATE POLICY "Admins read all official profiles"
  ON official_profiles FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('captain', 'admin')
    )
  );

-- ── 24. Setup official account (run manually per account) ──
-- HOW TO USE:
--   1. Create the user in Supabase Dashboard > Authentication > Users
--   2. Copy the user's UUID
--   3. Replace the placeholders below and run in SQL Editor
--
-- Example:
--   SELECT public.setup_official_account(
--     'PASTE-AUTH-USER-UUID-HERE',
--     'captain',
--     'Juan Dela Cruz'
--   );
--
-- Valid roles: 'captain', 'oic', 'secretary', 'lupon'

CREATE OR REPLACE FUNCTION public.setup_official_account(
  p_user_id uuid,
  p_role text,
  p_display_name text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role app_role;
BEGIN
  -- Validate role
  IF p_role NOT IN ('captain', 'oic', 'secretary', 'lupon') THEN
    RAISE EXCEPTION 'Invalid role: %. Must be captain, oic, secretary, or lupon', p_role;
  END IF;

  v_role := p_role::app_role;

  -- Check auth user exists
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'User % does not exist in auth.users', p_user_id;
  END IF;

  -- Create or update profile with correct role
  INSERT INTO public.profiles (id, role, display_name, account_status)
  VALUES (p_user_id, v_role, p_display_name, 'active')
  ON CONFLICT (id) DO UPDATE
    SET role = v_role,
        display_name = p_display_name,
        account_status = 'active';

  -- Create official profile record
  INSERT INTO public.official_profiles (user_id, position)
  VALUES (p_user_id, p_role)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN 'Official account setup complete: ' || p_display_name || ' (' || p_role || ')';
END;
$$;

GRANT EXECUTE ON FUNCTION public.setup_official_account(uuid, text, text) TO authenticated;
