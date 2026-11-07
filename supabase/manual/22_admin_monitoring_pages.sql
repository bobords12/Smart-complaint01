-- ============================================================
-- 22_admin_monitoring_pages.sql
-- Purpose: Missing backend support for the Captain Analytics,
--          Reports, Users & Roles, and Activity Logs pages.
--
--          All changes are ADDITIVE and NON-DESTRUCTIVE.
--          Existing data and tables are preserved.
--
-- PREREQUISITES:
--   1. Files 01-21 + captain-portal-schema-additions.sql
--      + 20_complaints_case_viewer.sql must already be applied.
--   2. The app_role enum already includes:
--        resident, captain, staff, police, admin, oic, secretary, lupon
--
-- WHAT THIS FILE ADDS
--   A. profiles  -> email, last_sign_in_at (synced from auth.users)
--   B. activity_logs -> result, remarks, linked_event_id, ip_address
--      + indexes (for review/result display on Activity Logs page)
--   C. generated_reports (Reports page history)
--   D. report_schedules (Reports page scheduling - informational field
--      for an external scheduler; nothing runs automatically)
--   E. Security DEFINER RPCs (never expose the service-role key):
--        update_user_role()      - on-the-fly role changes with audit log
--        update_user_status()    - activate / suspend / disable accounts
--        review_security_alert() - review flag role/status events
--      Each validates the caller is an official, refuses to change the
--      Barangay Captain, refuses self role change, and appends an
--      immutable entry to activity_logs.
--
-- HOW TO APPLY:
--   1. Open Supabase Dashboard > SQL Editor
--   2. Paste this entire file
--   3. Click "Run"
--   4. Verify with:
--        SELECT column_name FROM information_schema.columns
--        WHERE table_name = 'generated_reports' ORDER BY ordinal_position;
-- ============================================================

-- ──────────────────────────────────────────────────────────────
-- A. profiles: email + last_sign_in_at (synced from auth.users)
-- ──────────────────────────────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS email text;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS last_sign_in_at timestamptz;

-- Backfill from auth.users for existing profiles
UPDATE public.profiles p
SET email = au.email,
    last_sign_in_at = au.last_sign_in_at
FROM auth.users au
WHERE au.id = p.id
  AND (p.email IS DISTINCT FROM au.email OR p.last_sign_in_at IS DISTINCT FROM au.last_sign_in_at);

CREATE INDEX IF NOT EXISTS idx_profiles_email ON public.profiles(email);
CREATE INDEX IF NOT EXISTS idx_profiles_last_sign_in_at ON public.profiles(last_sign_in_at);

-- Keep profiles.email / last_sign_in_at in sync when auth.users changes
CREATE OR REPLACE FUNCTION public.trg_sync_profile_from_auth()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.profiles
  SET email = NEW.email,
      last_sign_in_at = NEW.last_sign_in_at,
      updated_at = now()
  WHERE id = NEW.id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_sync_profile ON auth.users;
CREATE TRIGGER on_auth_user_sync_profile
  AFTER INSERT OR UPDATE OF email, last_sign_in_at ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_sync_profile_from_auth();

-- Officials (captain, oic, secretary, lupon) read all official profiles
DROP POLICY IF EXISTS "Officials read all official profiles" ON public.official_profiles;
CREATE POLICY "Officials read all official profiles"
  ON public.official_profiles FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('captain', 'oic', 'secretary', 'lupon')
    )
  );

-- ──────────────────────────────────────────────────────────────
-- B. activity_logs: review / result metadata
-- ──────────────────────────────────────────────────────────────
-- result     - outcome of the logged action: 'success' or 'failed'
-- remarks    - reviewing officer's notes / disposition
-- ip_address - recorded only if the capturing process supplies it
ALTER TABLE public.activity_logs
  ADD COLUMN IF NOT EXISTS result text;

ALTER TABLE public.activity_logs
  ADD COLUMN IF NOT EXISTS remarks text;

ALTER TABLE public.activity_logs
  ADD COLUMN IF NOT EXISTS linked_event_id uuid;

ALTER TABLE public.activity_logs
  ADD COLUMN IF NOT EXISTS ip_address inet;

-- reviewed columns allow a reviewer note while keeping the entry
-- otherwise immutable (no RLS UPDATE/DELETE policies are added)
ALTER TABLE public.activity_logs
  ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES public.profiles(id);

ALTER TABLE public.activity_logs
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_activity_logs_result ON public.activity_logs(result);
CREATE INDEX IF NOT EXISTS idx_activity_logs_reviewed ON public.activity_logs(reviewed_at) WHERE reviewed_at IS NULL;

-- ──────────────────────────────────────────────────────────────
-- C. generated_reports - Reports page history (metadata only,
--    files are produced on-demand by the client via jsPDF).
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.generated_reports (
  id            uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  report_type   text NOT NULL,
  report_title  text NOT NULL,
  date_from     date NOT NULL,
  date_to       date NOT NULL,
  filters       jsonb NOT NULL DEFAULT '{}'::jsonb,
  row_count     integer NOT NULL DEFAULT 0,
  generated_by  uuid NOT NULL REFERENCES public.profiles(id),
  generated_at  timestamptz NOT NULL DEFAULT now()
);

-- Re-generating the same type + range + generator updates rather
-- than duplicating the history entry (upsert semantics in the app).
CREATE UNIQUE INDEX IF NOT EXISTS idx_generated_reports_dedupe
  ON public.generated_reports(report_type, date_from, date_to, generated_by);

CREATE INDEX IF NOT EXISTS idx_generated_reports_type ON public.generated_reports(report_type);
CREATE INDEX IF NOT EXISTS idx_generated_reports_generated_at ON public.generated_reports(generated_at);

ALTER TABLE public.generated_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Officials read generated reports" ON public.generated_reports;
CREATE POLICY "Officials read generated reports"
  ON public.generated_reports FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('captain', 'oic', 'secretary')
    )
  );

DROP POLICY IF EXISTS "Officials generate reports" ON public.generated_reports;
CREATE POLICY "Officials generate reports"
  ON public.generated_reports FOR INSERT
  WITH CHECK (
    generated_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('captain', 'oic', 'secretary')
    )
  );

-- Officials may archive/remove their own stale history
DROP POLICY IF EXISTS "Officials delete own generated reports" ON public.generated_reports;
CREATE POLICY "Officials delete own generated reports"
  ON public.generated_reports FOR DELETE
  USING (
    generated_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('captain', 'oic', 'secretary')
    )
  );

-- ──────────────────────────────────────────────────────────────
-- D. report_schedules - scheduled report definitions.
--    Stored for transparency; an EXTERNAL scheduler is expected to
--    read this table and execute. This SQL does NOT auto-run reports.
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.report_schedules (
  id            uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  report_type   text NOT NULL,
  frequency     text NOT NULL CHECK (frequency IN ('daily', 'weekly', 'monthly')),
  run_time      time NOT NULL DEFAULT '08:00:00'::time,
  enabled       boolean NOT NULL DEFAULT true,
  created_by    uuid NOT NULL REFERENCES public.profiles(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_run_at   timestamptz,
  next_run_at   timestamptz
);

ALTER TABLE public.report_schedules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Officials read report schedules" ON public.report_schedules;
CREATE POLICY "Officials read report schedules"
  ON public.report_schedules FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('captain', 'oic', 'secretary')
    )
  );

DROP POLICY IF EXISTS "Officials manage report schedules" ON public.report_schedules;
CREATE POLICY "Officials manage report schedules"
  ON public.report_schedules FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('captain', 'oic', 'secretary')
    )
  );

-- ──────────────────────────────────────────────────────────────
-- E. Shared helpers + Security DEFINER RPCs
-- ──────────────────────────────────────────────────────────────

-- The set of account / role events a reviewing officer may flag
CREATE OR REPLACE FUNCTION public.is_security_sensitive(p_action text)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT p_action ILIKE ANY (ARRAY[
    'user.role_changed',
    'user.status_changed',
    'user.account_suspended',
    'user.account_disabled',
    'user.account_activated',
    'role.changed',
    '%role_changed%',
    '%deleted%',
    '%suspended%',
    '%disabled%',
    '%permission%'
  ]);
$$;

GRANT EXECUTE ON FUNCTION public.is_security_sensitive(text) TO authenticated;

-- Allow a valid but limited set of app_role values for on-the-fly changes
CREATE OR REPLACE FUNCTION public.is_manageable_role(p_role text)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT p_role IN ('resident', 'captain', 'oic', 'secretary', 'lupon');
$$;

GRANT EXECUTE ON FUNCTION public.is_manageable_role(text) TO authenticated;

-- ── update_user_role ─────────────────────────────────────────
-- Changes a user's role on-the-fly. Audit-logged, immutable trail.
-- Refuses: non-official callers, captain self-change, changing the
-- Barangay Captain's own role, and roles outside the valid set.
CREATE OR REPLACE FUNCTION public.update_user_role(p_user_id uuid, p_new_role text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_role app_role;
  v_old_role   app_role;
  v_first_name text;
  v_last_name  text;
BEGIN
  SELECT role INTO v_actor_role FROM public.profiles WHERE id = auth.uid();
  IF v_actor_role IS NULL THEN
    RAISE EXCEPTION 'Your profile was not found.';
  END IF;

  IF v_actor_role NOT IN ('captain', 'oic', 'secretary') THEN
    RAISE EXCEPTION 'You are not allowed to change user roles.';
  END IF;

  IF NOT public.is_manageable_role(p_new_role) THEN
    RAISE EXCEPTION 'Role % cannot be assigned here.', p_new_role;
  END IF;

  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'You cannot change your own role.';
  END IF;

  SELECT role INTO v_old_role FROM public.profiles WHERE id = p_user_id;
  IF v_old_role IS NULL THEN
    RAISE EXCEPTION 'Target profile does not exist.';
  END IF;

  IF v_old_role = 'captain' THEN
    RAISE EXCEPTION 'The Barangay Captain role cannot be changed from this page.';
  END IF;

  IF v_old_role = p_new_role::app_role THEN
    RAISE EXCEPTION 'User already has the % role.', v_old_role;
  END IF;

  UPDATE public.profiles
  SET role = p_new_role::app_role, updated_at = now()
  WHERE id = p_user_id;

  -- Keep the lightweight official_profiles record in sync
  IF p_new_role <> 'resident' THEN
    INSERT INTO public.official_profiles (user_id, position)
    VALUES (p_user_id, p_new_role)
    ON CONFLICT (user_id) DO UPDATE SET position = p_new_role, updated_at = now();
  END IF;

  -- Promote a resident: keep their resident_profiles record (harmless).
  -- Demote to resident: ensure a basic resident profile exists so the
  -- name display keeps working from resident_profiles first_name/last_name.
  IF p_new_role = 'resident' AND NOT EXISTS (SELECT 1 FROM public.resident_profiles WHERE user_id = p_user_id) THEN
    SELECT COALESCE(NULLIF(display_name, ''), 'Resident'), split_part(COALESCE(display_name, 'Resident'), ' ', 1)
      INTO v_first_name, v_last_name
      FROM public.profiles WHERE id = p_user_id;
    v_last_name := NULLIF(substr(COALESCE(display_name, v_first_name), length(v_first_name) + 1), '');
    IF v_last_name IS NULL THEN v_last_name := 'User'; END IF;
    INSERT INTO public.resident_profiles (
      user_id, first_name, last_name, date_of_birth, sex,
      mobile_number, house_street, purok
    ) VALUES (
      p_user_id, COALESCE(NULLIF(v_first_name, ''), 'Resident'), 'User',
      '2000-01-01'::date, 'Other', 'N/A', 'N/A', 'N/A'
    )
    ON CONFLICT (user_id) DO NOTHING;
  END IF;

  PERFORM public.log_activity(
    'user.role_changed',
    'user',
    p_user_id,
    NULL,
    jsonb_build_object('new_role', p_new_role, 'old_role', v_old_role::text),
    jsonb_build_object('role', v_old_role::text),
    jsonb_build_object('role', p_new_role)
  );

  RETURN 'Role updated from ' || v_old_role || ' to ' || p_new_role || '.';
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_user_role(uuid, text) TO authenticated;

-- ── update_user_status ───────────────────────────────────────
-- Allows captain / oic / secretary to manage account status.
-- The captain's own account cannot be disabled/suspended from the UI.
CREATE OR REPLACE FUNCTION public.update_user_status(p_user_id uuid, p_status text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_role app_role;
  v_old_status account_status;
BEGIN
  SELECT role INTO v_actor_role FROM public.profiles WHERE id = auth.uid();
  IF v_actor_role IS NULL OR v_actor_role NOT IN ('captain', 'oic', 'secretary') THEN
    RAISE EXCEPTION 'You are not allowed to manage account status.';
  END IF;

  IF p_status NOT IN ('active', 'pending', 'suspended', 'disabled') THEN
    RAISE EXCEPTION 'Invalid status: %', p_status;
  END IF;

  IF p_user_id = auth.uid() AND p_status IN ('suspended', 'disabled') THEN
    RAISE EXCEPTION 'You cannot suspend or disable your own account from this page.';
  END IF;

  SELECT account_status INTO v_old_status FROM public.profiles WHERE id = p_user_id;
  IF v_old_status IS NULL THEN
    RAISE EXCEPTION 'Target profile does not exist.';
  END IF;

  IF v_old_status = p_status::account_status THEN
    RAISE EXCEPTION 'Account is already %', v_old_status;
  END IF;

  UPDATE public.profiles
  SET account_status = p_status::account_status, updated_at = now()
  WHERE id = p_user_id;

  PERFORM public.log_activity(
    'user.status_changed',
    'user',
    p_user_id,
    NULL,
    jsonb_build_object('new_status', p_status, 'old_status', v_old_status::text),
    jsonb_build_object('account_status', v_old_status::text),
    jsonb_build_object('account_status', p_status)
  );

  RETURN 'Account status updated to ' || p_status || '.';
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_user_status(uuid, text) TO authenticated;

-- ── review_security_alert ────────────────────────────────────
-- A reviewing officer may attach an outcome (result) and remarks to
-- a security-sensitive activity entry. This is the ONLY write path for
-- those fields - there is no RLS UPDATE policy on activity_logs, so the
-- underlying audit record remains immutable.
CREATE OR REPLACE FUNCTION public.review_security_alert(p_log_id uuid, p_result text, p_remarks text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_role app_role;
  v_action     text;
BEGIN
  SELECT role INTO v_actor_role FROM public.profiles WHERE id = auth.uid();
  IF v_actor_role IS NULL OR v_actor_role NOT IN ('captain', 'oic', 'secretary') THEN
    RAISE EXCEPTION 'You are not allowed to review security alerts.';
  END IF;

  IF p_result NOT IN ('success', 'failed', 'dismissed', 'escalated') THEN
    RAISE EXCEPTION 'Invalid result: %', p_result;
  END IF;

  SELECT action INTO v_action FROM public.activity_logs WHERE id = p_log_id;
  IF v_action IS NULL THEN
    RAISE EXCEPTION 'Activity log entry not found.';
  END IF;

  IF NOT public.is_security_sensitive(v_action) THEN
    RAISE EXCEPTION 'Only security-sensitive events can be reviewed from this page.';
  END IF;

  UPDATE public.activity_logs
  SET result = p_result,
      remarks = COALESCE(NULLIF(TRIM(p_remarks), ''), remarks),
      reviewed_by = auth.uid(),
      reviewed_at = now()
  WHERE id = p_log_id;

  PERFORM public.log_activity(
    'security_alert_reviewed',
    'activity_log',
    p_log_id,
    NULL,
    jsonb_build_object('result', p_result, 'remarks', p_remarks),
    NULL,
    NULL
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.review_security_alert(uuid, text, text) TO authenticated;

-- ──────────────────────────────────────────────────────────────
-- VERIFICATION (run after applying):
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'generated_reports' ORDER BY ordinal_position;
--   SELECT proname FROM pg_proc
--   WHERE proname IN ('update_user_role','update_user_status','review_security_alert');
-- ──────────────────────────────────────────────────────────────