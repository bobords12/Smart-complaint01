-- ══════════════════════════════════════════════════════════
-- Migration 32 — PNP referral: case reference snapshot, and
--                tell the officer who is actually assigned.
-- ══════════════════════════════════════════════════════════
--
-- Two gaps, both in the same seam.
--
-- 1. THE OFFICER WHO RECEIVES THE CASE IS NEVER TOLD.
--
--    pnp_create_referral() notifies every active officer in the unit
--    ("New PNP referral"), but an unassigned referral is invisible to
--    all of them: pnp_referral_is_visible() requires an unreleased
--    pnp_referral_assignments row naming the caller. So the blast
--    goes out to the officers who cannot open it, while the one
--    officer who CAN open it — the one the referral was assigned to —
--    receives nothing. pnp_assign_referral() wrote a timeline entry
--    and an audit row, and neither of those is delivered to anybody.
--
--    Fix: the assignment now notifies the officer it is made to.
--
-- 2. THE REFERRAL CANNOT BE CITED.
--
--    The PNP portal deliberately holds no policy on public.complaints
--    (pnp-portal-04-referral-rls.sql §6, with a DO block that warns if
--    one ever appears), because a referral carries its own snapshot
--    columns so the underlying case file never leaves the barangay.
--    But the snapshot was missing the one field a police report is
--    actually keyed on: the barangay case number. An officer holding a
--    referral could say "PNP-2026-0014" but never "AB-2026-0027".
--
--    Fix: snapshot complaints.reference_number onto the referral,
--    exactly the way summary / incident_date / incident_location /
--    parties_involved are already snapshotted. No policy on
--    public.complaints is added, and §6's sanity check still passes.
--
-- Both are additive and reversible on their own.
-- ══════════════════════════════════════════════════════════


-- ── 1. complaint_reference snapshot column ──────────────────
-- Nullable, so the column lands before anything is written to it.

ALTER TABLE public.complaint_referrals
  ADD COLUMN IF NOT EXISTS complaint_reference text;

COMMENT ON COLUMN public.complaint_referrals.complaint_reference IS
  'Snapshot of complaints.reference_number (the barangay case number) '
  'taken when the referral is created. Stored on the referral rather '
  'than read from complaints so the PNP portal needs no SELECT policy '
  'on public.complaints — see pnp-portal-04-referral-rls.sql §6.';


-- ── 2. The snapshot trigger ─────────────────────────────────
-- Taken on INSERT by trigger rather than by adding one more column
-- to pnp_create_referral()'s INSERT list, because a trigger covers
-- every path that can ever create a referral, not just the one that
-- exists today, and it cannot drift out of step with the function.
--
-- SECURITY DEFINER so the snapshot still lands if the inserting role
-- somehow lacks SELECT on public.complaints.

CREATE OR REPLACE FUNCTION public.pnp_referral_snapshot_case_reference()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.complaint_reference IS NULL AND NEW.complaint_id IS NOT NULL THEN
    SELECT c.reference_number
      INTO NEW.complaint_reference
      FROM public.complaints c
     WHERE c.id = NEW.complaint_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pnp_referral_case_reference ON public.complaint_referrals;
CREATE TRIGGER trg_pnp_referral_case_reference
  BEFORE INSERT ON public.complaint_referrals
  FOR EACH ROW
  EXECUTE FUNCTION public.pnp_referral_snapshot_case_reference();


-- ── 3. Backfill the referrals already on file ───────────────
-- Only fills blanks, so it is safe to re-run.

UPDATE public.complaint_referrals r
   SET complaint_reference = c.reference_number
  FROM public.complaints c
 WHERE c.id = r.complaint_id
   AND r.complaint_reference IS NULL
   AND c.reference_number IS NOT NULL;


-- ── 4. pnp_assign_referral(): notify the officer ────────────
-- Identical to pnp-portal-03 §5 apart from the notification block
-- at the end, which is the whole point of this migration.

CREATE OR REPLACE FUNCTION public.pnp_assign_referral(
  p_referral_id   uuid,
  p_officer_id    uuid,
  p_unit_id       uuid DEFAULT NULL,
  p_message       text  DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor    uuid := auth.uid();
  v_referral public.complaint_referrals%ROWTYPE;
BEGIN
  IF NOT public.is_referring_official() THEN
    RAISE EXCEPTION 'Only the Barangay Captain or the Officer-in-Charge may assign a referral.';
  END IF;

  SELECT * INTO v_referral
    FROM public.complaint_referrals
   WHERE id = p_referral_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Referral not found.';
  END IF;

  IF v_referral.status IN ('closed', 'declined', 'returned') THEN
    RAISE EXCEPTION 'A referral that is % cannot be assigned.', v_referral.status;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
     WHERE id = p_officer_id AND role = 'pnp_officer' AND account_status = 'active'
  ) THEN
    RAISE EXCEPTION 'The selected account is not an active PNP officer.';
  END IF;

  IF p_unit_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.profiles pr
     JOIN public.pnp_officer_units ou ON ou.officer_id = pr.id
     WHERE pr.id = p_officer_id
       AND ou.unit_id = p_unit_id
  ) THEN
    RAISE EXCEPTION 'That officer does not belong to the selected unit.';
  END IF;

  INSERT INTO public.pnp_referral_assignments (referral_id, officer_id, assigned_by)
  VALUES (p_referral_id, p_officer_id, v_actor)
  ON CONFLICT (referral_id, officer_id)
  DO UPDATE SET released_at = NULL, assigned_at = now(), assigned_by = v_actor;

  UPDATE public.complaint_referrals
     SET assigned_officer_id = p_officer_id,
         assigned_unit_id = COALESCE(p_unit_id, assigned_unit_id),
         assigned_at = now()
   WHERE id = p_referral_id;

  INSERT INTO public.complaint_referral_updates (
    referral_id, update_type, message, author_id, author_role
  )
  SELECT
    p_referral_id, 'assigned',
    COALESCE(NULLIF(trim(p_message), ''), 'Assigned to a PNP officer.'),
    v_actor, pr.role
  FROM public.profiles pr WHERE pr.id = v_actor;

  -- Tell the officer the referral is now theirs.
  --
  -- This is the notification that makes the portal connected: until
  -- it fires, an officer can only discover an assignment by polling
  -- the queue. Guarded with to_regclass the same way pnp_create_referral
  -- guards the rest of its inserts, so a deployment without the table
  -- still assigns cleanly.
  IF to_regclass('public.notifications') IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, title, message, related_referral_id)
    VALUES (
      p_officer_id,
      'general',
      'PNP referral assigned to you',
      'Referral ' || v_referral.referral_reference
        || COALESCE(' for barangay case ' || v_referral.complaint_reference, '')
        || ' has been assigned to you by ' ||
          -- profiles.display_name is the only name the official
          -- tables carry (first_name/last_name live on
          -- resident_profiles, and profiles has no email column),
          -- so this is deliberately a single-column lookup.
          COALESCE(
            (SELECT NULLIF(trim(pr.display_name), '')
               FROM public.profiles pr
              WHERE pr.id = v_actor),
            'the barangay'
          )
        || COALESCE(' ' || NULLIF(trim(p_message), ''), '')
        || ' Open the referral to acknowledge it.',
      p_referral_id
    );
  END IF;

  PERFORM public.log_activity(
    'pnp_referral_assigned',
    'complaint_referral',
    p_referral_id,
    v_referral.referral_reference,
    jsonb_build_object('officer_id', p_officer_id, 'unit_id', p_unit_id),
    NULL, NULL
  );
END;
$$;

REVOKE ALL ON FUNCTION public.pnp_assign_referral(uuid, uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pnp_assign_referral(uuid, uuid, uuid, text) TO authenticated;


-- ── 5. Verification ─────────────────────────────────────────
-- Returns one row per check; a `fail` needs looking at.

WITH checks AS (
  SELECT 'complaint_reference column exists' AS check_name,
         (SELECT count(*) FROM information_schema.columns
           WHERE table_schema = 'public'
             AND table_name = 'complaint_referrals'
             AND column_name = 'complaint_reference') = 1 AS ok
  UNION ALL
  SELECT 'every referral carries a case reference',
         (SELECT count(*) FROM public.complaint_referrals
           WHERE complaint_reference IS NULL) = 0
  UNION ALL
  SELECT 'snapshot trigger installed',
         (SELECT count(*) FROM pg_trigger
           WHERE tgname = 'trg_pnp_referral_case_reference'
             AND NOT tgisinternal) = 1
  UNION ALL
  SELECT 'pnp_referral_is_visible still restricts to the assignee',
         (SELECT count(*) FROM pg_policies
           WHERE schemaname = 'public'
             AND tablename = 'complaint_referrals'
             AND qual LIKE '%pnp_referral_is_visible%') > 0
  UNION ALL
  -- pnp-portal-04 §6 must still hold: nothing on the case file
  -- may mention pnp_officer after this migration.
  SELECT 'no policy on complaints/blotter grants pnp_officer',
         NOT EXISTS (
           SELECT 1 FROM pg_policies
            WHERE schemaname = 'public'
              AND tablename IN ('complaints', 'blotter_records',
                                'internal_notes', 'hearing_attendances',
                                'complaint_routing_history')
              AND (qual LIKE '%pnp_officer%' OR with_check LIKE '%pnp_officer%')
         )
)
SELECT check_name,
       CASE WHEN ok THEN 'pass' ELSE 'FAIL' END AS result
FROM checks;
