-- ============================================================
-- 90_repair_missing_profiles.sql
-- Purpose: Fix accounts that have auth.users rows but are
--          missing profiles / resident_profiles rows.
--          Also creates the heal_missing_profile() RPC for
--          application-level auto-healing.
-- Safety:  Idempotent — safe to run multiple times.
-- ============================================================

-- 1. Create the heal function (RPC) for application auto-healing
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
  -- Only heal if the user exists in auth.users and has no profile
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'User % does not exist in auth.users', p_user_id;
  END IF;

  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id) THEN
    RETURN; -- Already has a profile, nothing to heal
  END IF;

  SELECT raw_user_meta_data INTO v_meta
  FROM auth.users WHERE id = p_user_id;

  v_first  := NULLIF(TRIM(COALESCE(v_meta ->> 'first_name', '')), '');
  v_middle := COALESCE(v_meta ->> 'middle_name', '');
  v_last   := NULLIF(TRIM(COALESCE(v_meta ->> 'last_name', '')), '');
  v_suffix := COALESCE(v_meta ->> 'suffix', '');

  -- date_of_birth may be missing; fall back to a safe default
  BEGIN
    v_dob := NULLIF(v_meta ->> 'date_of_birth', '')::date;
  EXCEPTION WHEN others THEN
    v_dob := '2000-01-01'::date;
  END;

  v_sex    := COALESCE(NULLIF(v_meta ->> 'sex', ''), 'Other');
  v_mobile := COALESCE(v_meta ->> 'mobile_number', 'N/A');
  v_house  := COALESCE(v_meta ->> 'house_street', 'N/A');
  v_purok  := COALESCE(v_meta ->> 'purok', 'N/A');

  -- Ensure NOT NULL constraints are satisfied
  IF v_first IS NULL THEN v_first := 'Resident'; END IF;
  IF v_last IS NULL THEN v_last := 'User'; END IF;
  IF v_dob IS NULL THEN v_dob := '2000-01-01'::date; END IF;

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

-- 2. Ensure the trigger function exists (re-create with hardened logic)
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

-- 2. Ensure the trigger is attached
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- 3. Repair existing users missing profiles
-- Uses per-row exception handling so one bad row doesn't abort all repairs
DO $$
DECLARE
  r RECORD;
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
  v_count      int := 0;
BEGIN
  FOR r IN
    SELECT u.id, u.raw_user_meta_data
    FROM auth.users u
    LEFT JOIN public.profiles p ON p.id = u.id
    WHERE p.id IS NULL
  LOOP
    BEGIN
      v_first_name := NULLIF(TRIM(COALESCE(r.raw_user_meta_data ->> 'first_name', '')), '');
      v_middle_name := COALESCE(r.raw_user_meta_data ->> 'middle_name', '');
      v_last_name := NULLIF(TRIM(COALESCE(r.raw_user_meta_data ->> 'last_name', '')), '');
      v_suffix := COALESCE(r.raw_user_meta_data ->> 'suffix', '');

      BEGIN
        v_dob := NULLIF(r.raw_user_meta_data ->> 'date_of_birth', '')::date;
      EXCEPTION WHEN others THEN
        v_dob := '2000-01-01'::date;
      END;

      v_sex    := COALESCE(NULLIF(r.raw_user_meta_data ->> 'sex', ''), 'Other');
      v_mobile := COALESCE(r.raw_user_meta_data ->> 'mobile_number', 'N/A');
      v_house  := COALESCE(r.raw_user_meta_data ->> 'house_street', 'N/A');
      v_purok  := COALESCE(r.raw_user_meta_data ->> 'purok', 'N/A');

      IF v_first_name IS NULL THEN v_first_name := 'Resident'; END IF;
      IF v_last_name IS NULL THEN v_last_name := 'User'; END IF;
      IF v_dob IS NULL THEN v_dob := '2000-01-01'::date; END IF;

      v_display := TRIM(v_first_name || ' ' || v_last_name);

      INSERT INTO public.profiles (id, role, display_name, account_status)
      VALUES (r.id, 'resident', v_display, 'active')
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO public.resident_profiles (
        user_id, first_name, middle_name, last_name, suffix,
        date_of_birth, sex, mobile_number, house_street, purok
      ) VALUES (
        r.id, v_first_name, v_middle_name, v_last_name, v_suffix,
        v_dob, v_sex, v_mobile, v_house, v_purok
      )
      ON CONFLICT (user_id) DO NOTHING;

      INSERT INTO public.resident_settings (user_id)
      VALUES (r.id)
      ON CONFLICT (user_id) DO NOTHING;

      v_count := v_count + 1;
      RAISE NOTICE 'Repaired profile for user % (%)', r.id, v_count;
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'Failed to repair user %: %', r.id, SQLERRM;
    END;
  END LOOP;
  RAISE NOTICE 'Total users repaired: %', v_count;
END
$$;

-- 4. Verify repair
SELECT
  u.id,
  u.email,
  p.id IS NOT NULL AS has_profile,
  rp.user_id IS NOT NULL AS has_resident_profile
FROM auth.users u
LEFT JOIN public.profiles p ON p.id = u.id
LEFT JOIN public.resident_profiles rp ON rp.user_id = u.id
ORDER BY u.created_at DESC;
