-- ============================================================
-- FIX: Circular RLS policy on profiles causing 500 errors
-- ============================================================
-- PROBLEM: The "Officials read all profiles" policy on the
-- profiles table queries profiles FROM profiles — infinite
-- recursion that makes PostgreSQL return HTTP 500.
--
-- This also breaks ALL other policies that reference profiles
-- (activity_logs, resident_profiles, notifications, etc.)
-- because reading profiles itself fails.
--
-- FIX: Create a SECURITY DEFINER helper function that reads
-- the role (bypasses RLS), then use it in the policy.
-- ============================================================

-- Step 1: Create helper function
CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS app_role
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid()
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_role() TO authenticated;

-- Step 2: Drop the broken self-referencing policy
DROP POLICY IF EXISTS "Officials read all profiles" ON profiles;

-- Step 3: Create fixed policy using the helper function
CREATE POLICY "Officials read all profiles"
  ON profiles FOR SELECT
  USING (
    auth.uid() = id  -- everyone reads own profile
    OR
    public.get_my_role() IN ('captain', 'oic', 'secretary', 'staff', 'admin')
  );

-- Step 4: Verify — should show 3 policies on profiles
-- "Residents read own profile"
-- "Residents update own allowed fields"
-- "Officials read all profiles"  <-- this one should now use get_my_role()
SELECT policyname, cmd, qual
FROM pg_policies
WHERE tablename = 'profiles'
ORDER BY policyname;
