-- ══════════════════════════════════════════════════════════
-- Migration 34 — pnp_create_referral() could never succeed.
-- ══════════════════════════════════════════════════════════
--
-- SYMPTOM
--
--   Creating a referral from the Captain's portal always fails with a
--   400, whether the button is offered correctly or not:
--
--     ERROR: 42804: COALESCE types text and integer cannot be matched
--     QUERY: SELECT COALESCE(MAX(substring(referral_reference from
--            'PNP-REF-[0-9]{4}-([0-9]{6})$')), 0) + 1
--     CONTEXT: PL/pgSQL function pnp_referral_next_reference() line 13
--
--   pnp_create_referral() raises it at line 128, where it assigns
--   v_reference := pnp_referral_next_reference().
--
-- CAUSE
--
--   substring() returns text. COALESCE(text, integer) is a type error
--   PostgreSQL reports at plan time, not a value that happens to be
--   null — so the +1 fallback could never be chosen and the function
--   could never return. Every referral creation in this system has
--   failed, on every case, since the function was written.
--
--   It hid well: the error is raised inside a SECURITY DEFINER helper
--   two frames away from the button, and the UI reported a 400 with no
--   indication that the numbering scheme itself was unreachable.
--
-- FIX
--
--   Cast the captured group before aggregating, and match the whole
--   reference with ~ instead of LIKE so a malformed row can never
--   reach the cast. MAX() then runs over integers, COALESCE(integer,
--   integer) type-checks, and the advisory lock that guards against
--   two Captains drawing the same number is untouched.
--
-- HOW TO APPLY
--   After pnp-portal-03-referral-functions.sql. Safe to re-run.
-- ══════════════════════════════════════════════════════════


CREATE OR REPLACE FUNCTION public.pnp_referral_next_reference()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_year  int;
  v_seq   bigint;
  v_ref   text;
BEGIN
  v_year := EXTRACT(YEAR FROM now())::int;

  -- Transaction-scoped: released automatically at commit or
  -- rollback, so a failed creation cannot wedge the sequence.
  PERFORM pg_advisory_xact_lock(20260214, v_year);

  -- substring() yields text, so the cast has to happen before MAX():
  -- COALESCE(text, integer) is a plan-time type error, which is what
  -- made this function uncallable. Anchoring the match on the full
  -- shape rather than LIKE keeps a truncated or hand-edited reference
  -- out of the cast entirely.
  SELECT COALESCE(MAX(
           substring(referral_reference from 'PNP-REF-[0-9]{4}-([0-9]{6})$')::bigint
         ), 0) + 1
    INTO v_seq
    FROM public.complaint_referrals
   WHERE referral_reference ~ ('^PNP-REF-' || v_year::text || '-[0-9]{6}$');

  v_ref := 'PNP-REF-' || v_year::text || '-' || lpad(v_seq::text, 6, '0');
  RETURN v_ref;
END;
$$;

REVOKE ALL ON FUNCTION public.pnp_referral_next_reference() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pnp_referral_next_reference() TO authenticated;


-- ── Verification ────────────────────────────────────────────
-- The generator runs first, on its own, because it is the part that
-- failed before and it must be proven independently of the caller.

DO $$
DECLARE
  v_ref      text;
  v_existing integer;
  v_expected text;
BEGIN
  v_ref := public.pnp_referral_next_reference();

  IF v_ref !~ '^PNP-REF-[0-9]{4}-[0-9]{6}$' THEN
    RAISE EXCEPTION 'FAIL: generator returned % which is not PNP-REF-YYYY-NNNNNN', v_ref;
  END IF;
  RAISE NOTICE 'PASS 1: generator returned %', v_ref;

  -- The sequence must continue from what is already stored, not restart
  -- at 000001 and collide with a reference in use.
  SELECT count(*) INTO v_existing
    FROM public.complaint_referrals
   WHERE referral_reference ~ ('^PNP-REF-' || EXTRACT(YEAR FROM now())::text || '-[0-9]{6}$');

  IF v_existing > 0 THEN
    SELECT 'PNP-REF-' || EXTRACT(YEAR FROM now())::text || '-' ||
           lpad((MAX(substring(referral_reference from 'PNP-REF-[0-9]{4}-([0-9]{6})$')::bigint) + 1)::text, 6, '0')
      INTO v_expected
      FROM public.complaint_referrals
     WHERE referral_reference ~ ('^PNP-REF-' || EXTRACT(YEAR FROM now())::text || '-[0-9]{6}$');

    IF v_ref <> v_expected THEN
      RAISE EXCEPTION 'FAIL: expected next reference % but got %', v_expected, v_ref;
    END IF;
    RAISE NOTICE 'PASS 2: continues from existing rows to %', v_ref;
  ELSE
    RAISE NOTICE 'PASS 2: no prior referrals this year, sequence starts at %', v_ref;
  END IF;

  RAISE NOTICE 'ALL CHECKS PASSED';
END $$;

-- The caller is verified separately, under the Captain's own role and
-- with RLS applied, because running pnp_create_referral() from here
-- would execute as the migration engine and prove nothing about the
-- path the browser actually takes.
