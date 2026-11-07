-- ============================================================
-- 12_functions_and_triggers.sql
-- Purpose: Reusable database functions for automatic profile
--          creation, updated_at timestamps, reference number
--          generation, and notification marking.
-- Safety:  all SECURITY DEFINER functions use search_path
--          restrictions to prevent injection.
-- ============================================================

-- ── Updated-at trigger function ───────────────────────────
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ── Auto-create profile + resident_profile on signup ──────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_first_name text;
  v_middle_name text;
  v_last_name  text;
  v_suffix     text;
  v_dob        date;
  v_sex        text;
  v_mobile     text;
  v_house      text;
  v_purok      text;
  v_display    text;
  v_role       text;
BEGIN
  -- Extract metadata safely (never trust role from client)
  v_first_name := NULLIF(TRIM(COALESCE(NEW.raw_user_meta_data ->> 'first_name', '')), '');
  v_middle_name := COALESCE(NEW.raw_user_meta_data ->> 'middle_name', '');
  v_last_name := NULLIF(TRIM(COALESCE(NEW.raw_user_meta_data ->> 'last_name', '')), '');
  v_suffix := COALESCE(NEW.raw_user_meta_data ->> 'suffix', '');

  BEGIN
    v_dob := NULLIF(NEW.raw_user_meta_data ->> 'date_of_birth', '')::date;
  EXCEPTION WHEN others THEN
    v_dob := '2000-01-01'::date;
  END;

  v_sex := COALESCE(NULLIF(NEW.raw_user_meta_data ->> 'sex', ''), 'Other');
  v_mobile := COALESCE(NEW.raw_user_meta_data ->> 'mobile_number', 'N/A');
  v_house := COALESCE(NEW.raw_user_meta_data ->> 'house_street', 'N/A');
  v_purok := COALESCE(NEW.raw_user_meta_data ->> 'purok', 'N/A');

  IF v_first_name IS NULL THEN v_first_name := 'Resident'; END IF;
  IF v_last_name IS NULL THEN v_last_name := 'User'; END IF;
  IF v_dob IS NULL THEN v_dob := '2000-01-01'::date; END IF;

  -- Build display name
  v_display := TRIM(v_first_name || ' ' || v_last_name);

  -- Check metadata for role hint; default to 'resident'
  v_role := COALESCE(NEW.raw_user_meta_data ->> 'role', 'resident');
  IF v_role NOT IN ('resident', 'captain', 'oic', 'secretary', 'lupon') THEN
    v_role := 'resident';
  END IF;

  -- 1. Insert into profiles with correct role
  INSERT INTO public.profiles (id, role, display_name, account_status)
  VALUES (NEW.id, v_role::app_role, v_display, 'active')
  ON CONFLICT (id) DO NOTHING;

  -- 2. Only create resident profile for resident role
  IF v_role = 'resident' THEN
    INSERT INTO public.resident_profiles (
      user_id, first_name, middle_name, last_name, suffix,
      date_of_birth, sex, mobile_number, house_street, purok
    ) VALUES (
      NEW.id, v_first_name, v_middle_name, v_last_name, v_suffix,
      v_dob, v_sex, v_mobile, v_house, v_purok
    )
    ON CONFLICT (user_id) DO NOTHING;

    -- 3. Insert default resident settings
    INSERT INTO public.resident_settings (user_id)
    VALUES (NEW.id)
    ON CONFLICT (user_id) DO NOTHING;
  ELSE
    -- For officials, create official_profiles record
    INSERT INTO public.official_profiles (user_id, position)
    VALUES (NEW.id, v_role)
    ON CONFLICT (user_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

-- Attach trigger to auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- ── Apply updated_at triggers ─────────────────────────────
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'profiles', 'resident_profiles', 'complaints',
    'kp_trackers', 'hearings', 'resident_settings'
  ] LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS set_updated_at ON %I; CREATE TRIGGER set_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();',
      t, t
    );
  END LOOP;
END
$$;

-- ── Reference number generator (collision-safe) ───────────
-- Uses a dedicated sequence per year to avoid MAX()+1 races.
CREATE TABLE IF NOT EXISTS complaint_sequences (
  year        integer PRIMARY KEY,
  last_seq    integer NOT NULL DEFAULT 0
);

CREATE OR REPLACE FUNCTION public.generate_reference_number()
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

  -- Upsert the sequence row (locks the row to prevent races)
  INSERT INTO public.complaint_sequences (year, last_seq)
  VALUES (v_year, 1)
  ON CONFLICT (year) DO UPDATE
    SET last_seq = complaint_sequences.last_seq + 1
  RETURNING last_seq INTO v_seq;

  v_ref := 'AB-' || v_year || '-' || LPAD(v_seq::text, 4, '0');
  RETURN v_ref;
END;
$$;

-- ── Mark notification as read ─────────────────────────────
CREATE OR REPLACE FUNCTION public.mark_notification_read(p_notification_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.notifications
  SET read_at = now()
  WHERE id = p_notification_id
    AND user_id = auth.uid()
    AND read_at IS NULL;
END;
$$;

-- ── Mark all notifications as read ────────────────────────
CREATE OR REPLACE FUNCTION public.mark_all_notifications_read()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.notifications
  SET read_at = now()
  WHERE user_id = auth.uid()
    AND read_at IS NULL;
END;
$$;

-- ── Heal missing profile (RPC for application auto-healing) ─
-- Updated: now checks user metadata for role hint; defaults to 'resident'
CREATE OR REPLACE FUNCTION public.heal_missing_profile(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_meta      jsonb;
  v_first     text;
  v_middle    text;
  v_last      text;
  v_suffix    text;
  v_dob       date;
  v_sex       text;
  v_mobile    text;
  v_house     text;
  v_purok     text;
  v_display   text;
  v_role      text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'User % does not exist in auth.users', p_user_id;
  END IF;

  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id) THEN
    RETURN;
  END IF;

  SELECT raw_user_meta_data INTO v_meta
  FROM auth.users WHERE id = p_user_id;

  v_first  := COALESCE(v_meta ->> 'first_name', '');
  v_middle := COALESCE(v_meta ->> 'middle_name', '');
  v_last   := COALESCE(v_meta ->> 'last_name', '');
  v_suffix := COALESCE(v_meta ->> 'suffix', '');
  v_dob    := NULLIF(v_meta ->> 'date_of_birth', '')::date;
  v_sex    := COALESCE(v_meta ->> 'sex', 'Other');
  v_mobile := COALESCE(v_meta ->> 'mobile_number', '');
  v_house  := COALESCE(v_meta ->> 'house_street', '');
  v_purok  := COALESCE(v_meta ->> 'purok', '');

  v_display := TRIM(v_first || ' ' || v_last);

  -- Check metadata for role hint; default to 'resident'
  v_role := COALESCE(v_meta ->> 'role', 'resident');
  IF v_role NOT IN ('resident', 'captain', 'oic', 'secretary', 'lupon') THEN
    v_role := 'resident';
  END IF;

  INSERT INTO public.profiles (id, role, display_name, account_status)
  VALUES (p_user_id, v_role::app_role, v_display, 'active')
  ON CONFLICT (id) DO NOTHING;

  -- Only create resident profile for resident role
  IF v_role = 'resident' THEN
    INSERT INTO public.resident_profiles (
      user_id, first_name, middle_name, last_name, suffix,
      date_of_birth, sex, mobile_number, house_street, purok
    ) VALUES (
      p_user_id, v_first, v_middle, v_last, v_suffix,
      v_dob, v_sex, v_mobile, v_house, v_purok
    )
    ON CONFLICT (user_id) DO NOTHING;

    INSERT INTO public.resident_settings (user_id)
    VALUES (p_user_id)
    ON CONFLICT (user_id) DO NOTHING;
  ELSE
    -- For officials, create official_profiles record
    INSERT INTO public.official_profiles (user_id, position)
    VALUES (p_user_id, v_role)
    ON CONFLICT (user_id) DO NOTHING;
  END IF;
END;
$$;

-- Grant execute to authenticated and anon roles
GRANT EXECUTE ON FUNCTION public.heal_missing_profile(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.heal_missing_profile(uuid) TO anon;

-- ── Create complaint with reference number (atomic) ───────
CREATE OR REPLACE FUNCTION public.create_complaint(
  p_title text,
  p_description text,
  p_incident_date date,
  p_incident_time time,
  p_incident_location text,
  p_persons_involved text,
  p_witnesses text,
  p_predicted_category text,
  p_predicted_case_type text,
  p_predicted_urgency text,
  p_prediction_confidence numeric
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ref   text;
  v_id    uuid;
  v_result json;
BEGIN
  v_ref := public.generate_reference_number();

  INSERT INTO public.complaints (
    resident_id, reference_number, title, description,
    incident_date, incident_time, incident_location,
    persons_involved, witnesses,
    predicted_category, predicted_case_type, predicted_urgency,
    prediction_confidence, current_status, current_stage
  ) VALUES (
    auth.uid(), v_ref, p_title, p_description,
    p_incident_date, p_incident_time, p_incident_location,
    p_persons_involved, p_witnesses,
    p_predicted_category::case_category,
    p_predicted_case_type::case_category,
    p_predicted_urgency::urgency_level,
    p_prediction_confidence,
    'Pending Review', 'Pending Review'
  )
  RETURNING id INTO v_id;

  -- Create initial status entry
  INSERT INTO public.case_statuses (complaint_id, status, stage, resident_visible_message, changed_by)
  VALUES (v_id, 'Pending Review', 'Pending Review', 'Complaint received and submitted for review.', auth.uid());

  v_result := json_build_object(
    'id', v_id,
    'reference_number', v_ref
  );

  RETURN v_result;
END;
$$;
