-- ============================================================
-- official-rbac-oic-secretary.sql
-- Purpose: Harden multi-layer RBAC for the shared official
--          portal (Captain / OIC / Secretary) without adding
--          a second portal stack.
--
--   1. Force resident role on signup/heal (no metadata trust).
--   2. Restrict setup_official_account / update_user_role /
--      update_user_status to the Captain (or SQL/service role).
--   3. Prevent users from changing their own role or status.
--   4. Restrict complaint categorization writes to Captain/OIC.
--   5. Restrict complaint review inserts to Captain/OIC.
--   6. Restrict lupon panel management and classification-log
--      inserts to Captain/OIC (Secretary remains read-only).
--   7. Provision OIC/Secretary profiles by email lookup against
--      auth.users (edit the emails in SECTION 4 before running).
--
-- PREREQUISITES:
--   - All prior SQL files (01-23, 90, 99) applied.
--   - captain-portal-schema-additions.sql applied
--     (adds oic / secretary / lupon to app_role).
--   - OIC and Secretary Auth users already created manually in
--     Supabase Dashboard → Authentication → Users.
--     Do NOT put passwords in this file or in the repo.
--
-- HOW TO APPLY:
--   1. Open Supabase Dashboard → SQL Editor.
--   2. Edit SECTION 4 emails to match the Auth users you created.
--   3. Paste this entire file and click "Run".
--   4. Verify with the queries in SECTION 5.
-- ============================================================

-- ── 0. Enum values (idempotent, standalone) ────────────────
-- If captain-portal-schema-additions.sql already ran, these
-- are no-ops. Each DO block is safe to re-run.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumtypid = 'app_role'::regtype AND enumlabel = 'oic'
  ) THEN
    ALTER TYPE app_role ADD VALUE 'oic';
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumtypid = 'app_role'::regtype AND enumlabel = 'secretary'
  ) THEN
    ALTER TYPE app_role ADD VALUE 'secretary';
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumtypid = 'app_role'::regtype AND enumlabel = 'lupon'
  ) THEN
    ALTER TYPE app_role ADD VALUE 'lupon';
  END IF;
END
$$;

-- ── 1. handle_new_user — never trust metadata role ────────
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
BEGIN
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

  v_display := TRIM(v_first_name || ' ' || v_last_name);

  -- Official roles are ONLY granted via setup_official_account
  -- (Captain) or manual SQL — never from client metadata.
  INSERT INTO public.profiles (id, role, display_name, account_status)
  VALUES (NEW.id, 'resident', v_display, 'active')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.resident_profiles (
    user_id, first_name, middle_name, last_name, suffix,
    date_of_birth, sex, mobile_number, house_street, purok
  ) VALUES (
    NEW.id, v_first_name, v_middle_name, v_last_name, v_suffix,
    v_dob, v_sex, v_mobile, v_house, v_purok
  )
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO public.resident_settings (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- ── 2. heal_missing_profile — force resident, auth only ───
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
BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'User % does not exist in auth.users', p_user_id;
  END IF;

  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id) THEN
    RETURN;
  END IF;

  SELECT raw_user_meta_data INTO v_meta
  FROM auth.users WHERE id = p_user_id;

  v_first  := COALESCE(v_meta ->> 'first_name', 'Resident');
  v_middle := COALESCE(v_meta ->> 'middle_name', '');
  v_last   := COALESCE(v_meta ->> 'last_name', 'User');
  v_suffix := COALESCE(v_meta ->> 'suffix', '');
  BEGIN
    v_dob := NULLIF(v_meta ->> 'date_of_birth', '')::date;
  EXCEPTION WHEN others THEN
    v_dob := '2000-01-01'::date;
  END;
  v_sex    := COALESCE(NULLIF(v_meta ->> 'sex', ''), 'Other');
  v_mobile := COALESCE(v_meta ->> 'mobile_number', 'N/A');
  v_house  := COALESCE(v_meta ->> 'house_street', 'N/A');
  v_purok  := COALESCE(v_meta ->> 'purok', 'N/A');
  v_display := TRIM(v_first || ' ' || v_last);

  -- Never promote from metadata — heal always creates a resident.
  INSERT INTO public.profiles (id, role, display_name, account_status)
  VALUES (p_user_id, 'resident', v_display, 'active')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.resident_profiles (
    user_id, first_name, middle_name, last_name, suffix,
    date_of_birth, sex, mobile_number, house_street, purok
  ) VALUES (
    p_user_id, v_first, v_middle, v_last, v_suffix,
    COALESCE(v_dob, '2000-01-01'::date), v_sex, v_mobile, v_house, v_purok
  )
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO public.resident_settings (user_id)
  VALUES (p_user_id)
  ON CONFLICT (user_id) DO NOTHING;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.heal_missing_profile(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.heal_missing_profile(uuid) TO authenticated;

-- ── 3. Privileged RPCs — Captain (or service role) only ───
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
  v_actor_role app_role;
BEGIN
  IF p_role NOT IN ('captain', 'oic', 'secretary', 'lupon') THEN
    RAISE EXCEPTION 'Invalid role: %. Must be captain, oic, secretary, or lupon', p_role;
  END IF;

  v_role := p_role::app_role;

  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'User % does not exist in auth.users', p_user_id;
  END IF;

  -- Service role / SQL editor (no JWT) or the Captain may call this.
  IF auth.uid() IS NOT NULL THEN
    SELECT role INTO v_actor_role FROM public.profiles WHERE id = auth.uid();
    IF v_actor_role IS DISTINCT FROM 'captain' THEN
      RAISE EXCEPTION 'Only the Barangay Captain can set up official accounts.';
    END IF;
    IF p_user_id = auth.uid() AND v_role <> 'captain' THEN
      RAISE EXCEPTION 'You cannot change your own role.';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = p_user_id AND role = 'captain'
    ) AND v_role <> 'captain' THEN
      RAISE EXCEPTION 'The Barangay Captain account cannot be reassigned here.';
    END IF;
  END IF;

  INSERT INTO public.profiles (id, role, display_name, account_status)
  VALUES (p_user_id, v_role, p_display_name, 'active')
  ON CONFLICT (id) DO UPDATE
    SET role = EXCLUDED.role,
        display_name = EXCLUDED.display_name,
        account_status = 'active',
        updated_at = now();

  INSERT INTO public.official_profiles (user_id, position)
  VALUES (p_user_id, p_role)
  ON CONFLICT (user_id) DO UPDATE SET position = p_role, updated_at = now();

  IF v_role = 'resident' THEN
    NULL; -- unreachable; kept for clarity
  END IF;

  RETURN 'Official account setup complete: ' || p_display_name || ' (' || p_role || ')';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.setup_official_account(uuid, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.setup_official_account(uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.setup_official_account(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.setup_official_account(uuid, text, text) TO service_role;

-- ── 4. update_user_role — Captain (or service role) only ──
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
  IF auth.uid() IS NOT NULL THEN
    SELECT role INTO v_actor_role FROM public.profiles WHERE id = auth.uid();
    IF v_actor_role IS DISTINCT FROM 'captain' THEN
      RAISE EXCEPTION 'You are not allowed to change user roles.';
    END IF;
    IF p_user_id = auth.uid() THEN
      RAISE EXCEPTION 'You cannot change your own role.';
    END IF;
  END IF;

  IF NOT public.is_manageable_role(p_new_role) THEN
    RAISE EXCEPTION 'Role % cannot be assigned here.', p_new_role;
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

  IF p_new_role <> 'resident' THEN
    INSERT INTO public.official_profiles (user_id, position)
    VALUES (p_user_id, p_new_role)
    ON CONFLICT (user_id) DO UPDATE SET position = p_new_role, updated_at = now();
  END IF;

  IF p_new_role = 'resident' AND NOT EXISTS (
    SELECT 1 FROM public.resident_profiles WHERE user_id = p_user_id
  ) THEN
    SELECT COALESCE(NULLIF(display_name, ''), 'Resident'),
           split_part(COALESCE(display_name, 'Resident'), ' ', 1)
      INTO v_last_name, v_first_name
      FROM public.profiles WHERE id = p_user_id;
    v_last_name := NULLIF(substr(COALESCE(display_name, v_first_name), length(v_first_name) + 1), '');
    IF v_last_name IS NULL THEN v_last_name := 'User'; END IF;
    INSERT INTO public.resident_profiles (
      user_id, first_name, last_name, date_of_birth, sex,
      mobile_number, house_street, purok
    ) VALUES (
      p_user_id, COALESCE(NULLIF(v_first_name, ''), 'Resident'), v_last_name,
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

REVOKE EXECUTE ON FUNCTION public.update_user_role(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_user_role(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_user_role(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_user_role(uuid, text) TO service_role;

-- ── 5. update_user_status — Captain (or service role) only ─
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
  IF auth.uid() IS NOT NULL THEN
    SELECT role INTO v_actor_role FROM public.profiles WHERE id = auth.uid();
    IF v_actor_role IS DISTINCT FROM 'captain' THEN
      RAISE EXCEPTION 'You are not allowed to manage account status.';
    END IF;
    IF p_user_id = auth.uid() AND p_status IN ('suspended', 'disabled') THEN
      RAISE EXCEPTION 'You cannot suspend or disable your own account from this page.';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = p_user_id AND role = 'captain'
    ) AND p_status IN ('suspended', 'disabled') THEN
      RAISE EXCEPTION 'The Barangay Captain account cannot be suspended or disabled here.';
    END IF;
  END IF;

  IF p_status NOT IN ('active', 'pending', 'suspended', 'disabled') THEN
    RAISE EXCEPTION 'Invalid status: %', p_status;
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

REVOKE EXECUTE ON FUNCTION public.update_user_status(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_user_status(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_user_status(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_user_status(uuid, text) TO service_role;

-- ── 6. Profiles: block self role/status elevation ─────────
CREATE OR REPLACE FUNCTION public.profiles_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_role app_role;
BEGIN
  -- Service role / SQL editor / signup triggers (no JWT): allow.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- Users may edit their own profile but never role/status.
  IF NEW.id = auth.uid() THEN
    IF TG_OP = 'UPDATE'
      AND (
        NEW.role IS DISTINCT FROM OLD.role
        OR NEW.account_status IS DISTINCT FROM OLD.account_status
      )
    THEN
      RAISE EXCEPTION 'You cannot change your own role or account status.';
    END IF;
    IF TG_OP = 'INSERT' AND NEW.role <> 'resident' THEN
      RAISE EXCEPTION 'You cannot assign yourself an official role.';
    END IF;
    RETURN NEW;
  END IF;

  -- Changing someone else's role/status: Captain only.
  IF TG_OP = 'UPDATE' AND (
    NEW.role IS DISTINCT FROM OLD.role
    OR NEW.account_status IS DISTINCT FROM OLD.account_status
  ) THEN
    SELECT role INTO v_actor_role FROM public.profiles WHERE id = auth.uid();
    IF v_actor_role IS DISTINCT FROM 'captain' THEN
      RAISE EXCEPTION 'Only the Barangay Captain can change roles or account status.';
    END IF;
  END IF;

  IF TG_OP = 'INSERT' AND NEW.role <> 'resident' THEN
    SELECT role INTO v_actor_role FROM public.profiles WHERE id = auth.uid();
    IF v_actor_role IS DISTINCT FROM 'captain' THEN
      RAISE EXCEPTION 'Only the Barangay Captain can create official accounts.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_guard_on_change ON public.profiles;
CREATE TRIGGER profiles_guard_on_change
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.profiles_guard();

-- ── 7. Complaint categorization — Captain / OIC only ──────
CREATE OR REPLACE FUNCTION public.complaints_categorization_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_role app_role;
  v_changed boolean;
BEGIN
  v_changed := (
    NEW.confirmed_category IS DISTINCT FROM OLD.confirmed_category
    OR NEW.confirmed_case_type IS DISTINCT FROM OLD.confirmed_case_type
    OR NEW.confirmed_urgency IS DISTINCT FROM OLD.confirmed_urgency
    OR NEW.predicted_category IS DISTINCT FROM OLD.predicted_category
    OR NEW.predicted_case_type IS DISTINCT FROM OLD.predicted_case_type
    OR NEW.predicted_urgency IS DISTINCT FROM OLD.predicted_urgency
    OR NEW.prediction_confidence IS DISTINCT FROM OLD.prediction_confidence
  );

  IF NOT v_changed THEN
    RETURN NEW;
  END IF;

  -- Service role / SQL scripts: allow.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT role INTO v_actor_role FROM public.profiles WHERE id = auth.uid();
  IF v_actor_role IN ('captain', 'oic') THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'You do not have permission to change complaint categorization.';
END;
$$;

DROP TRIGGER IF EXISTS complaints_categorization_guard ON public.complaints;
CREATE TRIGGER complaints_categorization_guard
  BEFORE UPDATE ON public.complaints
  FOR EACH ROW
  EXECUTE FUNCTION public.complaints_categorization_guard();

-- ── 8. Complaint reviews insert — Captain / OIC only ──────
CREATE OR REPLACE FUNCTION public.complaint_reviews_insert_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_role app_role;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT role INTO v_actor_role FROM public.profiles WHERE id = auth.uid();
  IF v_actor_role IN ('captain', 'oic') THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'You do not have permission to confirm complaint categorization.';
END;
$$;

DROP TRIGGER IF EXISTS complaint_reviews_insert_guard ON public.complaint_reviews;
CREATE TRIGGER complaint_reviews_insert_guard
  BEFORE INSERT ON public.complaint_reviews
  FOR EACH ROW
  EXECUTE FUNCTION public.complaint_reviews_insert_guard();

-- ── 9. RLS tighten: lupon manage → Captain / OIC ─────────
DROP POLICY IF EXISTS "Officials manage lupon panels" ON public.lupon_panels;
CREATE POLICY "Officials manage lupon panels"
  ON public.lupon_panels FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('captain', 'oic')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('captain', 'oic')
    )
  );

-- ── 10. RLS tighten: classification log insert → Cap/OIC ──
DROP POLICY IF EXISTS "Officials insert classification logs" ON public.complaint_classification_logs;
CREATE POLICY "Officials insert classification logs"
  ON public.complaint_classification_logs FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('captain', 'oic')
    )
  );

-- ── 11. RLS tighten: complaint review insert → Cap/OIC ────
DROP POLICY IF EXISTS "Officials insert reviews" ON public.complaint_reviews;
CREATE POLICY "Officials insert reviews"
  ON public.complaint_reviews FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('captain', 'oic')
    )
  );

-- ── 12. Provision OIC / Secretary by email ────────────────
-- EDIT the emails below to match the users you created in
-- Supabase Dashboard → Authentication → Users.
-- Leave a value as '' to skip that row.
-- Passwords must never appear in this file or in the repo.

DO $$
DECLARE
  v_oic_email     text := '';  -- e.g. 'oic@barangayabuno.ph'
  v_oic_name      text := '';  -- e.g. 'Juan Dela Cruz'
  v_secretary_email text := ''; -- e.g. 'secretary@barangayabuno.ph'
  v_secretary_name  text := '';
  v_uid           uuid;
  v_exists        boolean;
BEGIN
  IF v_oic_email <> '' THEN
    SELECT id INTO v_uid FROM auth.users
    WHERE lower(email) = lower(v_oic_email)
    LIMIT 1;

    IF v_uid IS NULL THEN
      RAISE NOTICE 'No auth.users row found for OIC email % — skipped.', v_oic_email;
    ELSE
      SELECT EXISTS (
        SELECT 1 FROM public.profiles WHERE id = v_uid AND role = 'captain'
      ) INTO v_exists;
      IF v_exists THEN
        RAISE NOTICE 'User % is the Captain — not demoting.', v_oic_email;
      ELSE
        INSERT INTO public.profiles (id, role, display_name, account_status)
        VALUES (v_uid, 'oic', NULLIF(v_oic_name, ''), 'active')
        ON CONFLICT (id) DO UPDATE
          SET role = 'oic',
              display_name = COALESCE(NULLIF(v_oic_name, ''), public.profiles.display_name),
              account_status = 'active',
              updated_at = now();

        INSERT INTO public.official_profiles (user_id, position)
        VALUES (v_uid, 'oic')
        ON CONFLICT (user_id) DO UPDATE SET position = 'oic', updated_at = now();

        RAISE NOTICE 'OIC profile ready for % (%).', v_oic_email, v_uid;
      END IF;
    END IF;
  END IF;

  IF v_secretary_email <> '' THEN
    SELECT id INTO v_uid FROM auth.users
    WHERE lower(email) = lower(v_secretary_email)
    LIMIT 1;

    IF v_uid IS NULL THEN
      RAISE NOTICE 'No auth.users row found for Secretary email % — skipped.', v_secretary_email;
    ELSE
      SELECT EXISTS (
        SELECT 1 FROM public.profiles WHERE id = v_uid AND role = 'captain'
      ) INTO v_exists;
      IF v_exists THEN
        RAISE NOTICE 'User % is the Captain — not demoting.', v_secretary_email;
      ELSE
        INSERT INTO public.profiles (id, role, display_name, account_status)
        VALUES (v_uid, 'secretary', NULLIF(v_secretary_name, ''), 'active')
        ON CONFLICT (id) DO UPDATE
          SET role = 'secretary',
              display_name = COALESCE(NULLIF(v_secretary_name, ''), public.profiles.display_name),
              account_status = 'active',
              updated_at = now();

        INSERT INTO public.official_profiles (user_id, position)
        VALUES (v_uid, 'secretary')
        ON CONFLICT (user_id) DO UPDATE SET position = 'secretary', updated_at = now();

        RAISE NOTICE 'Secretary profile ready for % (%).', v_secretary_email, v_uid;
      END IF;
    END IF;
  END IF;
END;
$$;

-- ── 13. Verification queries ──────────────────────────────
-- Run these after the script (they are read-only).

-- SELECT unnest(enum_range(NULL::app_role));
--
-- SELECT p.email, pr.role, pr.account_status, pr.display_name
-- FROM auth.users p
-- JOIN public.profiles pr ON pr.id = p.id
-- WHERE pr.role IN ('captain', 'oic', 'secretary')
-- ORDER BY pr.role;
--
-- SELECT proname, prosrc LIKE '%v_actor_role%' AS has_actor_check
-- FROM pg_proc
-- WHERE proname IN (
--   'setup_official_account',
--   'update_user_role',
--   'update_user_status'
-- );
--
-- SELECT tgname FROM pg_trigger
-- WHERE tgrelid = 'public.profiles'::regclass
--   AND NOT tgisinternal;
--
-- SELECT tgname FROM pg_trigger
-- WHERE tgrelid = 'public.complaints'::regclass
--   AND NOT tgisinternal;
--
-- SELECT polname, polcmd, pg_get_expr(polqual, polrelid) AS using_expr
-- FROM pg_policies
-- WHERE tablename IN (
--   'lupon_panels',
--   'complaint_classification_logs',
--   'complaint_reviews'
-- )
-- ORDER BY tablename, polname;
