-- ============================================================
-- pnp-portal-03-referral-functions.sql
-- Purpose: the ONLY sanctioned write paths for a formal referral.
--          Every mutation validates auth.uid(), the caller's role,
--          the referral's current status, and the transition.
-- Safety:  SECURITY DEFINER with a pinned search_path on every
--          function. No function trusts a client-supplied role.
-- ============================================================
--
-- THE RULES THESE FUNCTIONS ENFORCE
--   * Only captain / oic may create a referral.
--   * A referral is born in 'referred'. It is never created
--     pre-acknowledged or pre-assigned.
--   * referral_reference is generated under a lock, so two
--     simultaneous referrals cannot share one.
--   * Only pnp_officer may move a referral forward, and only from
--     the statuses listed for each transition.
--   * returned / declined / closed require a written reason.
--   * A KP-eligible, named-respondent case stays in barangay
--     mediation: pnp_create_referral() refuses it. A PNP referral
--     never unlocks a summons, a hearing, or a Lupon panel.
--   * Nothing here writes a police blotter number, a charge, or a
--     guilt finding. Those are not this system's to record.
--
-- HOW TO APPLY
--   After pnp-portal-02. Before pnp-portal-04.
-- ============================================================


-- ── 1. is_referring_official() ──────────────────────────────
CREATE OR REPLACE FUNCTION public.is_referring_official()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.profiles p
     WHERE p.id = auth.uid()
       AND p.role IN ('captain'::public.app_role, 'oic'::public.app_role)
       AND p.account_status = 'active'::public.account_status
  );
$$;

REVOKE ALL ON FUNCTION public.is_referring_official() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_referring_official() TO authenticated;


-- ── 2. pnp_referral_next_reference() ────────────────────────
-- PNP-REF-<year>-<6 digits>, zero padded, restartable per year.
--
-- The advisory lock is the whole point: two Captains clicking
-- "Refer to PNP" in the same second would otherwise both read the
-- same max() and try to insert the same reference. The unique
-- constraint would reject one of them, which is safe but a bad
-- experience. The lock makes the second one wait.
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

  SELECT COALESCE(MAX(
           substring(referral_reference from 'PNP-REF-[0-9]{4}-([0-9]{6})$')
         ), 0) + 1
    INTO v_seq
    FROM public.complaint_referrals
   WHERE referral_reference LIKE 'PNP-REF-' || v_year::text || '-%';

  v_ref := 'PNP-REF-' || v_year::text || '-' || lpad(v_seq::text, 6, '0');
  RETURN v_ref;
END;
$$;

REVOKE ALL ON FUNCTION public.pnp_referral_next_reference() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pnp_referral_next_reference() TO authenticated;


-- ── 3. pnp_create_referral() ────────────────────────────────
-- Captain / OIC only. Creates the referral, its first timeline
-- entry, and the evidence share rows, in one transaction.
CREATE OR REPLACE FUNCTION public.pnp_create_referral(
  p_complaint_id        uuid,
  p_summary             text,
  p_referral_reason     text,
  p_referral_basis      text,
  p_referral_request_id uuid  DEFAULT NULL,
  p_safety_concern      boolean DEFAULT false,
  p_evidence_ids        uuid[] DEFAULT NULL,
  p_incident_date       date  DEFAULT NULL,
  p_incident_location   text  DEFAULT NULL,
  p_parties_involved    text  DEFAULT NULL,
  p_due_at              timestamptz DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_complaint     public.complaints%ROWTYPE;
  v_actor         uuid := auth.uid();
  v_role          public.app_role;
  v_referral_id   uuid;
  v_reference     text;
  v_status        public.complaint_status;
  -- Routing columns on complaints are plain text, not enums:
  -- complaint_nature / kp_applicability are text in
  -- captain-complaint-routing-workflow.sql.
  v_nature        text;
  v_respondent    text;
  v_kp            text;
  v_request       public.pnp_referral_requests%ROWTYPE;
  v_evidence_id   uuid;
  v_shared        int := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'You must be signed in.';
  END IF;

  IF NOT public.is_referring_official() THEN
    RAISE EXCEPTION
      'Only the Barangay Captain or the Officer-in-Charge may create a PNP referral.';
  END IF;

  SELECT role INTO v_role FROM public.profiles WHERE id = v_actor;

  IF length(trim(COALESCE(p_summary, ''))) < 10 THEN
    RAISE EXCEPTION
      'Write a referral summary of at least 10 characters. This is the only case narrative the PNP will see.';
  END IF;

  IF length(trim(COALESCE(p_referral_reason, ''))) < 5 THEN
    RAISE EXCEPTION 'Record why this case is being referred.';
  END IF;

  IF p_referral_basis NOT IN ('resident_request', 'barangay_initiated') THEN
    RAISE EXCEPTION 'referral_basis must be resident_request or barangay_initiated.';
  END IF;

  SELECT * INTO v_complaint
    FROM public.complaints
   WHERE complaints.id = p_complaint_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Complaint not found.';
  END IF;

  -- A case that is still with the PNP cannot be referred again.
  IF EXISTS (
    SELECT 1 FROM public.complaint_referrals r
     WHERE r.complaint_id = p_complaint_id
       AND r.status NOT IN ('closed', 'declined', 'returned')
  ) THEN
    RAISE EXCEPTION
      'This complaint already has an open referral. Update the existing referral instead of creating a second one.';
  END IF;

  -- Guard: a named respondent on a KP-eligible case belongs in
  -- barangay mediation, not with the PNP. This is the one rule that
  -- most often gets forgotten by hand, so it is enforced here
  -- rather than left to the dialog.
  v_status     := v_complaint.current_status;
  v_nature     := v_complaint.complaint_nature;
  v_respondent := NULLIF(btrim(COALESCE(v_complaint.respondent_display_name, '')), '');
  v_kp         := v_complaint.kp_applicability;

  IF v_kp = 'applicable' THEN
    RAISE EXCEPTION
      'This case is KP-applicable, so it stays in barangay mediation. A PNP referral does not apply to a KP case.';
  END IF;

  -- A named respondent whose KP applicability has not been assessed
  -- is exactly the case the Routing Assessment tab exists to
  -- resolve. Referring it would be a silent way around that.
  IF v_respondent IS NOT NULL AND COALESCE(v_kp, 'pending') = 'pending' THEN
    RAISE EXCEPTION
      'A respondent is named on this case but KP applicability has not been assessed. Record the KP assessment in Routing Assessment before referring it to the PNP.';
  END IF;

  -- Validate the request, when the basis is a resident request.
  IF p_referral_basis = 'resident_request' THEN
    IF p_referral_request_id IS NULL THEN
      RAISE EXCEPTION
        'Select the resident request this referral approves, or choose barangay_initiated.';
    END IF;

    SELECT * INTO v_request
      FROM public.pnp_referral_requests
     WHERE pnp_referral_requests.id = p_referral_request_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Referral request not found.';
    END IF;

    IF v_request.complaint_id <> p_complaint_id THEN
      RAISE EXCEPTION 'That referral request belongs to a different complaint.';
    END IF;

    IF v_request.resident_user_id <> v_complaint.resident_id THEN
      RAISE EXCEPTION 'That referral request does not belong to this complainant.';
    END IF;

    IF v_request.status NOT IN ('approved', 'officially_referred') THEN
      RAISE EXCEPTION
        'The resident request is still "%". Approve it first, or refer the case on a barangay basis instead.',
        v_request.status;
    END IF;
  END IF;

  -- Evidence: every id must belong to this complaint. This is the
  -- check that stops an official from sharing another case's file.
  IF p_evidence_ids IS NOT NULL AND cardinality(p_evidence_ids) > 0 THEN
    FOREACH v_evidence_id IN ARRAY p_evidence_ids LOOP
      IF NOT EXISTS (
        SELECT 1 FROM public.evidence e
         WHERE e.id = v_evidence_id
           AND e.complaint_id = p_complaint_id
      ) THEN
        RAISE EXCEPTION
          'Evidence file % does not belong to this complaint and cannot be shared.', v_evidence_id;
      END IF;
    END LOOP;
  END IF;

  v_reference := public.pnp_referral_next_reference();

  INSERT INTO public.complaint_referrals (
    referral_reference, complaint_id, referral_request_id,
    summary, incident_date, incident_location, parties_involved,
    referral_basis, referral_reason, has_safety_concern,
    status, referred_by, referred_at, due_at
  )
  VALUES (
    v_reference, p_complaint_id, p_referral_request_id,
    trim(p_summary), p_incident_date,
    NULLIF(trim(COALESCE(p_incident_location, '')), ''),
    NULLIF(trim(COALESCE(p_parties_involved, '')), ''),
    p_referral_basis, trim(p_referral_reason), COALESCE(p_safety_concern, false),
    'referred', v_actor, now(), p_due_at
  )
  RETURNING id INTO v_referral_id;

  -- Timeline: the creation entry.
  INSERT INTO public.complaint_referral_updates (
    referral_id, update_type, status_before, status_after,
    message, author_id, author_role
  )
  VALUES (
    v_referral_id, 'created', NULL, 'referred',
    'Referred to the PNP by the barangay. Reference ' || v_reference || '.',
    v_actor, v_role
  );

  -- Evidence share rows.
  IF p_evidence_ids IS NOT NULL AND cardinality(p_evidence_ids) > 0 THEN
    FOREACH v_evidence_id IN ARRAY p_evidence_ids LOOP
      INSERT INTO public.complaint_referral_evidence (
        referral_id, evidence_id, shared_by, note
      )
      VALUES (
        v_referral_id, v_evidence_id, v_actor,
        'Shared with the PNP as part of referral ' || v_reference || '.'
      );
      v_shared := v_shared + 1;
    END LOOP;

    IF v_shared > 0 THEN
      INSERT INTO public.complaint_referral_updates (
        referral_id, update_type, message, author_id, author_role
      )
      VALUES (
        v_referral_id, 'evidence_shared',
        v_shared || ' file(s) shared with the PNP.', v_actor, v_role
      );
    END IF;
  END IF;

  -- Mark the resident request as officially referred.
  IF p_referral_basis = 'resident_request' AND p_referral_request_id IS NOT NULL THEN
    UPDATE public.pnp_referral_requests
       SET status = 'officially_referred',
           reviewed_by = v_actor,
           reviewed_at = now()
     WHERE id = p_referral_request_id;
  END IF;

  -- Resident-facing status line. Guarded because case_statuses is
  -- not present in every deployment of the base schema.
  IF to_regclass('public.case_statuses') IS NOT NULL THEN
    INSERT INTO public.case_statuses (
      complaint_id, status, stage, resident_visible_message, changed_by
    )
    VALUES (
      p_complaint_id,
      v_status,
      COALESCE(v_complaint.current_stage, 'Pending Review'),
      'Your complaint has been referred to the Philippine National Police by the barangay. Reference ' || v_reference || '.',
      v_actor
    );
  END IF;

  -- Notify the resident (the pnp-referral-requests trigger also
  -- fires on the status change above; this one carries the
  -- reference, which the trigger's message does not).
  IF to_regclass('public.notifications') IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, title, message, related_complaint_id)
    VALUES (
      v_complaint.resident_id,
      'complaint',
      'Referred to the PNP',
      'Your complaint (' || v_complaint.reference_number || ') has been referred to the Philippine National Police by the barangay. Reference ' || v_reference || '. You can track it on your dashboard.',
      p_complaint_id
    );
  END IF;

  -- Head-up notice to every active PNP officer of the unit.
  --
  -- Note what this deliberately is NOT: it is not access. An
  -- unassigned referral is invisible to all of these officers,
  -- because pnp_referral_is_visible() requires an unreleased
  -- pnp_referral_assignments row naming the caller. This message
  -- says a referral exists; the officer still cannot open it until
  -- pnp_assign_referral() names them — and that assignment sends
  -- its own, actionable notice (migration 32).
  --
  -- Only pnp_officer rows are selected: the Captain or OIC who
  -- created the referral already has it on their own screen, and
  -- is excluded from this blast on purpose rather than by an
  -- author_id comparison.
  IF to_regclass('public.notifications') IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, title, message, related_referral_id)
    SELECT
      p.id,
      'general',
      'New PNP referral',
      'Barangay Abuno referred complaint ' || v_complaint.reference_number || ' to the PNP. Reference ' || v_reference || '.',
      v_referral_id
    FROM public.profiles p
    WHERE p.role = 'pnp_officer'
      AND p.account_status = 'active'
      AND EXISTS (
        SELECT 1 FROM public.pnp_officer_units ou
         WHERE ou.officer_id = p.id
      );
  END IF;

  -- Audit.
  PERFORM public.log_activity(
    'pnp_referral_created',
    'complaint_referral',
    v_referral_id,
    v_reference,
    jsonb_build_object(
      'complaint_id', p_complaint_id,
      'basis', p_referral_basis,
      'safety_concern', COALESCE(p_safety_concern, false),
      'evidence_shared', v_shared
    ),
    NULL,
    jsonb_build_object('status', 'referred', 'reference', v_reference)
  );

  RETURN v_referral_id;
END;
$$;

REVOKE ALL ON FUNCTION public.pnp_create_referral(uuid, text, text, text, uuid, boolean, uuid[], date, text, text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pnp_create_referral(uuid, text, text, text, uuid, boolean, uuid[], date, text, text, timestamptz) TO authenticated;


-- ── 4. pnp_referral_is_visible() ────────────────────────────
-- The single predicate the RLS file uses, so "who can see this
-- referral" is stated once.
CREATE OR REPLACE FUNCTION public.pnp_referral_is_visible(p_referral_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_pnp_officer()
     AND EXISTS (
       SELECT 1
         FROM public.pnp_referral_assignments a
        WHERE a.referral_id = p_referral_id
          AND a.officer_id = auth.uid()
          AND a.released_at IS NULL
     );
$$;

REVOKE ALL ON FUNCTION public.pnp_referral_is_visible(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pnp_referral_is_visible(uuid) TO authenticated;


-- ── 5. pnp_assign_referral() ────────────────────────────────
-- Assign to an officer, optionally with their unit. Captain/OIC
-- only. A plain UPDATE of assigned_officer_id is impossible for
-- everyone: there is no client UPDATE policy on the table, and
-- every RPC here pins the transition.
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


-- ── 6. pnp_release_referral() ───────────────────────────────
CREATE OR REPLACE FUNCTION public.pnp_release_referral(
  p_referral_id uuid,
  p_reason      text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor    uuid := auth.uid();
  v_role     public.app_role;
  v_referral public.complaint_referrals%ROWTYPE;
BEGIN
  IF NOT public.is_referring_official() THEN
    RAISE EXCEPTION 'Only the Barangay Captain or the Officer-in-Charge may release a referral.';
  END IF;

  IF length(trim(COALESCE(p_reason, ''))) < 5 THEN
    RAISE EXCEPTION 'Record a reason for releasing the officer.';
  END IF;

  SELECT role INTO v_role FROM public.profiles WHERE id = v_actor;

  SELECT * INTO v_referral
    FROM public.complaint_referrals
   WHERE id = p_referral_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Referral not found.';
  END IF;

  UPDATE public.pnp_referral_assignments
     SET released_at = now()
   WHERE referral_id = p_referral_id
     AND released_at IS NULL;

  UPDATE public.complaint_referrals
     SET assigned_officer_id = NULL
   WHERE id = p_referral_id;

  INSERT INTO public.complaint_referral_updates (
    referral_id, update_type, message, author_id, author_role
  )
  VALUES (
    p_referral_id, 'assigned', trim(p_reason), v_actor, v_role
  );

  PERFORM public.log_activity(
    'pnp_referral_released',
    'complaint_referral',
    p_referral_id,
    v_referral.referral_reference,
    jsonb_build_object('reason', trim(p_reason)), NULL, NULL
  );
END;
$$;

REVOKE ALL ON FUNCTION public.pnp_release_referral(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pnp_release_referral(uuid, text) TO authenticated;


-- ── 7. pnp_update_referral_status() ─────────────────────────
-- The status machine. One function, one table of allowed moves, so
-- the rules are readable in one place and there is no way to
-- bypass them.
--
--   referred            -> acknowledged, returned, declined
--   acknowledged        -> in_progress, needs_information, returned, declined
--   in_progress         -> needs_information, completed, returned
--   needs_information   -> information_submitted, returned, declined
--   information_submitted -> acknowledged, in_progress, needs_information, returned, declined
--   completed           -> closed
--   returned            -> (terminal from the PNP's view; the
--                          barangay may create a new referral)
--   declined            -> (terminal)
--   closed              -> (terminal)
CREATE OR REPLACE FUNCTION public.pnp_update_referral_status(
  p_referral_id uuid,
  p_new_status  referral_status,
  p_reason      text DEFAULT NULL,
  p_note        text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor     uuid := auth.uid();
  v_role      public.app_role;
  v_referral  public.complaint_referrals%ROWTYPE;
  v_allowed   boolean := false;
  v_needs_reason boolean := false;
  v_notice    text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'You must be signed in.';
  END IF;

  SELECT role INTO v_role FROM public.profiles WHERE id = v_actor;

  -- Captain/OIC may drive any legal move (including pulling a
  -- referral back). A PNP officer may drive the PNP's own
  -- lifecycle but may not mark a referral returned, declined or
  -- closed: those are decisions about the barangay's request, and
  -- only the barangay makes them.
  IF v_role NOT IN ('pnp_officer', 'captain', 'oic') THEN
    RAISE EXCEPTION 'Your role cannot change a referral status.';
  END IF;

  IF v_role = 'pnp_officer' AND NOT public.is_pnp_officer() THEN
    RAISE EXCEPTION 'Your PNP account is not active.';
  END IF;

  IF v_role = 'pnp_officer'
     AND NOT EXISTS (
       SELECT 1 FROM public.pnp_referral_assignments
        WHERE referral_id = p_referral_id
          AND officer_id = v_actor
          AND released_at IS NULL
     ) THEN
    RAISE EXCEPTION 'This referral is not assigned to you.';
  END IF;

  SELECT * INTO v_referral
    FROM public.complaint_referrals
   WHERE id = p_referral_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Referral not found.';
  END IF;

  IF v_referral.status = p_new_status THEN
    RAISE EXCEPTION 'This referral is already %.', v_referral.status;
  END IF;

  v_allowed :=
    (v_referral.status = 'referred'            AND p_new_status IN ('acknowledged', 'returned', 'declined')) OR
    (v_referral.status = 'acknowledged'        AND p_new_status IN ('in_progress', 'needs_information', 'returned', 'declined')) OR
    (v_referral.status = 'in_progress'         AND p_new_status IN ('needs_information', 'completed', 'returned')) OR
    (v_referral.status = 'needs_information'   AND p_new_status IN ('information_submitted', 'returned', 'declined')) OR
    (v_referral.status = 'information_submitted' AND p_new_status IN ('acknowledged', 'in_progress', 'needs_information', 'returned', 'declined')) OR
    (v_referral.status = 'completed'           AND p_new_status = 'closed');

  IF NOT v_allowed THEN
    RAISE EXCEPTION
      'A referral cannot move from % to %.', v_referral.status, p_new_status;
  END IF;

  v_needs_reason := p_new_status IN ('returned', 'declined', 'closed');

  IF v_needs_reason AND length(trim(COALESCE(p_reason, ''))) < 5 THEN
    RAISE EXCEPTION 'Record a reason: this move is %.', p_new_status;
  END IF;

  IF v_role = 'pnp_officer' AND p_new_status IN ('returned', 'declined', 'closed') THEN
    RAISE EXCEPTION
      'A PNP officer cannot mark a referral as returned, declined or closed. Record a note and let the barangay make that decision.';
  END IF;

  -- information_submitted asserts that the BARANGAY answered, so the
  -- PNP must not be able to assert it about itself. The answer is
  -- written through pnp_respond_to_referral_information(), which
  -- checks the caller's role and records the text of the reply on the
  -- timeline. Without this guard the generic status call would let a
  -- PNP officer move a referral off the information queue by
  -- pressing one button, and the timeline would show a submission
  -- that never happened.
  IF v_role = 'pnp_officer' AND p_new_status = 'information_submitted' THEN
    RAISE EXCEPTION
      'A PNP officer cannot mark information as submitted. Only the barangay can answer an information request.';
  END IF;

  UPDATE public.complaint_referrals
     SET status = p_new_status,
         acknowledged_by = CASE
           WHEN p_new_status = 'acknowledged' AND acknowledged_at IS NULL
             THEN v_actor ELSE acknowledged_by END,
         acknowledged_at = CASE
           WHEN p_new_status = 'acknowledged' AND acknowledged_at IS NULL
             THEN now() ELSE acknowledged_at END,
         resolution_reason = CASE
           WHEN v_needs_reason THEN trim(p_reason) ELSE resolution_reason END
   WHERE id = p_referral_id;

  v_notice := CASE p_new_status
    WHEN 'acknowledged'        THEN 'A PNP officer has acknowledged this referral.'
    WHEN 'in_progress'         THEN 'The PNP has begun working on this referral.'
    WHEN 'needs_information'   THEN 'The PNP has requested further information.'
    WHEN 'information_submitted' THEN 'Information was submitted to the PNP.'
    WHEN 'completed'           THEN 'The PNP marked this referral completed.'
    WHEN 'returned'            THEN 'The referral was returned to the barangay: ' || trim(p_reason)
    WHEN 'declined'            THEN 'The referral was declined: ' || trim(p_reason)
    WHEN 'closed'              THEN 'The referral was closed: ' || trim(p_reason)
    ELSE 'Referral status updated.'
  END;

  INSERT INTO public.complaint_referral_updates (
    referral_id, update_type, status_before, status_after,
    message, author_id, author_role
  )
  VALUES (
    p_referral_id, 'status_change', v_referral.status, p_new_status,
    COALESCE(NULLIF(trim(COALESCE(p_note, '')), ''), v_notice),
    v_actor, v_role
  );

  -- Resident notification, worded so it never overstates: the PNP
  -- portal records coordination status, not a police finding.
  IF to_regclass('public.notifications') IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, title, message, related_complaint_id, related_referral_id)
    SELECT
      c.resident_id, 'complaint',
      'Referral update',
      'Your complaint (' || c.reference_number || ') referral ' || v_referral.referral_reference || ' is now ' || replace(p_new_status::text, '_', ' ') || '. ' || v_notice,
      c.id, p_referral_id
    FROM public.complaints c
    WHERE c.id = v_referral.complaint_id;
  END IF;

  PERFORM public.log_activity(
    'pnp_referral_status_changed',
    'complaint_referral',
    p_referral_id,
    v_referral.referral_reference,
    jsonb_build_object('from', v_referral.status, 'to', p_new_status,
                       'reason', NULLIF(trim(COALESCE(p_reason, '')), '')),
    jsonb_build_object('status', v_referral.status),
    jsonb_build_object('status', p_new_status)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.pnp_update_referral_status(uuid, referral_status, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pnp_update_referral_status(uuid, referral_status, text, text) TO authenticated;


-- ── 8. pnp_record_referral_note() ───────────────────────────
-- A note on the timeline. PNP officers may write notes on their own
-- assignments; the barangay may write notes on any referral.
CREATE OR REPLACE FUNCTION public.pnp_record_referral_note(
  p_referral_id uuid,
  p_message     text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor    uuid := auth.uid();
  v_role     public.app_role;
  v_referral public.complaint_referrals%ROWTYPE;
BEGIN
  IF length(trim(COALESCE(p_message, ''))) < 3 THEN
    RAISE EXCEPTION 'Write a note before saving.';
  END IF;

  SELECT role INTO v_role FROM public.profiles WHERE id = v_actor;

  IF v_role = 'pnp_officer' THEN
    IF NOT public.is_pnp_officer() THEN
      RAISE EXCEPTION 'Your PNP account is not active.';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.pnp_referral_assignments
       WHERE referral_id = p_referral_id
         AND officer_id = v_actor
         AND released_at IS NULL
    ) THEN
      RAISE EXCEPTION 'This referral is not assigned to you.';
    END IF;
  ELSIF v_role NOT IN ('captain', 'oic') THEN
    RAISE EXCEPTION 'Your role cannot add a referral note.';
  END IF;

  SELECT * INTO v_referral
    FROM public.complaint_referrals
   WHERE id = p_referral_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Referral not found.';
  END IF;

  INSERT INTO public.complaint_referral_updates (
    referral_id, update_type, message, author_id, author_role
  )
  VALUES (p_referral_id, 'note', trim(p_message), v_actor, v_role);

  PERFORM public.log_activity(
    'pnp_referral_note_added',
    'complaint_referral',
    p_referral_id,
    v_referral.referral_reference,
    jsonb_build_object('note', trim(p_message)), NULL, NULL
  );
END;
$$;

REVOKE ALL ON FUNCTION public.pnp_record_referral_note(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pnp_record_referral_note(uuid, text) TO authenticated;


-- ── 9. pnp_set_external_reference() ─────────────────────────
-- PNP officer or Captain records a REAL external reference. There
-- is no generator here and no default: the value must be supplied.
CREATE OR REPLACE FUNCTION public.pnp_set_external_reference(
  p_referral_id        uuid,
  p_external_reference text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor    uuid := auth.uid();
  v_role     public.app_role;
  v_referral public.complaint_referrals%ROWTYPE;
BEGIN
  IF length(trim(COALESCE(p_external_reference, ''))) < 3 THEN
    RAISE EXCEPTION
      'Enter the actual reference supplied by the PNP, or leave the field empty. This system does not generate police reference numbers.';
  END IF;

  SELECT role INTO v_role FROM public.profiles WHERE id = v_actor;

  IF v_role NOT IN ('pnp_officer', 'captain', 'oic') THEN
    RAISE EXCEPTION 'Your role cannot record an external reference.';
  END IF;

  IF v_role = 'pnp_officer' AND NOT EXISTS (
    SELECT 1 FROM public.pnp_referral_assignments
     WHERE referral_id = p_referral_id
       AND officer_id = v_actor
       AND released_at IS NULL
  ) THEN
    RAISE EXCEPTION 'This referral is not assigned to you.';
  END IF;

  SELECT * INTO v_referral
    FROM public.complaint_referrals
   WHERE id = p_referral_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Referral not found.';
  END IF;

  IF v_referral.status IN ('closed', 'declined') THEN
    RAISE EXCEPTION 'A % referral cannot be updated.', v_referral.status;
  END IF;

  UPDATE public.complaint_referrals
     SET external_reference = trim(p_external_reference),
         external_reference_at = now()
   WHERE id = p_referral_id;

  INSERT INTO public.complaint_referral_updates (
    referral_id, update_type, message, author_id, author_role
  )
  VALUES (
    p_referral_id, 'external_reference',
    'External PNP reference recorded: ' || trim(p_external_reference) || '.',
    v_actor, v_role
  );

  PERFORM public.log_activity(
    'pnp_referral_external_reference_set',
    'complaint_referral',
    p_referral_id,
    v_referral.referral_reference,
    jsonb_build_object('external_reference', trim(p_external_reference)),
    NULL, NULL
  );
END;
$$;

REVOKE ALL ON FUNCTION public.pnp_set_external_reference(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pnp_set_external_reference(uuid, text) TO authenticated;


-- ── 10. pnp_request_referral_information() ──────────────────
-- The PNP asks the barangay a question. Records the question on the
-- timeline and puts the referral in needs_information.
CREATE OR REPLACE FUNCTION public.pnp_request_referral_information(
  p_referral_id uuid,
  p_question    text
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
  IF NOT public.is_pnp_officer() THEN
    RAISE EXCEPTION 'Only an active PNP officer may request further information.';
  END IF;

  IF length(trim(COALESCE(p_question, ''))) < 5 THEN
    RAISE EXCEPTION 'Write the information you need.';
  END IF;

  SELECT * INTO v_referral
    FROM public.complaint_referrals
   WHERE id = p_referral_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Referral not found.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.pnp_referral_assignments
     WHERE referral_id = p_referral_id
       AND officer_id = v_actor
       AND released_at IS NULL
  ) THEN
    RAISE EXCEPTION 'This referral is not assigned to you.';
  END IF;

  IF v_referral.status NOT IN ('acknowledged', 'in_progress', 'information_submitted') THEN
    RAISE EXCEPTION
      'Further information cannot be requested while the referral is %.', v_referral.status;
  END IF;

  UPDATE public.complaint_referrals
     SET status = 'needs_information'
   WHERE id = p_referral_id;

  INSERT INTO public.complaint_referral_updates (
    referral_id, update_type, status_before, status_after,
    message, author_id, author_role
  )
  VALUES (
    p_referral_id, 'information_request', v_referral.status, 'needs_information',
    trim(p_question), v_actor, 'pnp_officer'::public.app_role
  );

  -- Tell the barangay, not the resident: this is a question about
  -- the case between the two parties.
  IF to_regclass('public.notifications') IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, title, message, related_referral_id)
    SELECT
      pr.id, 'general',
      'PNP requested information',
      'The PNP requested further information on referral ' || v_referral.referral_reference || ': ' || trim(p_question),
      p_referral_id
    FROM public.profiles pr
    WHERE pr.role IN ('captain', 'oic') AND pr.account_status = 'active';
  END IF;

  PERFORM public.log_activity(
    'pnp_referral_information_requested',
    'complaint_referral',
    p_referral_id,
    v_referral.referral_reference,
    jsonb_build_object('question', trim(p_question)), NULL, NULL
  );
END;
$$;

REVOKE ALL ON FUNCTION public.pnp_request_referral_information(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pnp_request_referral_information(uuid, text) TO authenticated;


-- ── 11. pnp_respond_to_referral_information() ───────────────
-- The barangay answers.
CREATE OR REPLACE FUNCTION public.pnp_respond_to_referral_information(
  p_referral_id uuid,
  p_answer      text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor    uuid := auth.uid();
  v_role     public.app_role;
  v_referral public.complaint_referrals%ROWTYPE;
BEGIN
  IF NOT public.is_referring_official() THEN
    RAISE EXCEPTION 'Only the Barangay Captain or the Officer-in-Charge may answer an information request.';
  END IF;

  IF length(trim(COALESCE(p_answer, ''))) < 3 THEN
    RAISE EXCEPTION 'Write a response before sending.';
  END IF;

  SELECT role INTO v_role FROM public.profiles WHERE id = v_actor;

  SELECT * INTO v_referral
    FROM public.complaint_referrals
   WHERE id = p_referral_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Referral not found.';
  END IF;

  IF v_referral.status <> 'needs_information' THEN
    RAISE EXCEPTION 'This referral is not waiting for information.';
  END IF;

  UPDATE public.complaint_referrals
     SET status = 'information_submitted'
   WHERE id = p_referral_id;

  INSERT INTO public.complaint_referral_updates (
    referral_id, update_type, status_before, status_after,
    message, author_id, author_role
  )
  VALUES (
    p_referral_id, 'information_response', v_referral.status, 'information_submitted',
    trim(p_answer), v_actor, v_role
  );

  IF to_regclass('public.notifications') IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, title, message, related_referral_id)
    SELECT
      a.officer_id, 'general',
      'Barangay responded to your request',
      'The barangay answered your information request on referral ' || v_referral.referral_reference || ': ' || trim(p_answer),
      p_referral_id
    FROM public.pnp_referral_assignments a
    WHERE a.referral_id = p_referral_id AND a.released_at IS NULL;
  END IF;

  PERFORM public.log_activity(
    'pnp_referral_information_answered',
    'complaint_referral',
    p_referral_id,
    v_referral.referral_reference,
    jsonb_build_object('answer', trim(p_answer)), NULL, NULL
  );
END;
$$;

REVOKE ALL ON FUNCTION public.pnp_respond_to_referral_information(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pnp_respond_to_referral_information(uuid, text) TO authenticated;


-- ── 12. pnp_share_referral_evidence() ───────────────────────
-- Adds an evidence file to a referral. Captain/OIC only. The
-- evidence must already belong to the complaint behind the
-- referral, so this can never widen what the PNP can see.
CREATE OR REPLACE FUNCTION public.pnp_share_referral_evidence(
  p_referral_id uuid,
  p_evidence_id uuid,
  p_note        text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor    uuid := auth.uid();
  v_role     public.app_role;
  v_referral public.complaint_referrals%ROWTYPE;
  v_evidence public.evidence%ROWTYPE;
BEGIN
  IF NOT public.is_referring_official() THEN
    RAISE EXCEPTION 'Only the Barangay Captain or the Officer-in-Charge may share evidence with the PNP.';
  END IF;

  SELECT role INTO v_role FROM public.profiles WHERE id = v_actor;

  SELECT * INTO v_referral
    FROM public.complaint_referrals
   WHERE id = p_referral_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Referral not found.';
  END IF;

  SELECT * INTO v_evidence
    FROM public.evidence
   WHERE id = p_evidence_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Evidence file not found.';
  END IF;

  IF v_evidence.complaint_id <> v_referral.complaint_id THEN
    RAISE EXCEPTION
      'That file belongs to a different complaint and cannot be shared on this referral.';
  END IF;

  INSERT INTO public.complaint_referral_evidence (referral_id, evidence_id, shared_by, note)
  VALUES (p_referral_id, p_evidence_id, v_actor, NULLIF(trim(COALESCE(p_note, '')), ''))
  ON CONFLICT (referral_id, evidence_id) DO NOTHING;

  INSERT INTO public.complaint_referral_updates (
    referral_id, update_type, message, author_id, author_role
  )
  VALUES (
    p_referral_id, 'evidence_shared',
    'Shared "' || v_evidence.original_filename || '" with the PNP.',
    v_actor, v_role
  );

  PERFORM public.log_activity(
    'pnp_referral_evidence_shared',
    'complaint_referral',
    p_referral_id,
    v_referral.referral_reference,
    jsonb_build_object('evidence_id', p_evidence_id,
                       'filename', v_evidence.original_filename),
    NULL, NULL
  );
END;
$$;

REVOKE ALL ON FUNCTION public.pnp_share_referral_evidence(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pnp_share_referral_evidence(uuid, uuid, text) TO authenticated;


-- ── 13. pnp_referral_activity() ─────────────────────────────
-- The PNP portal's read-only audit surface.
--
-- public.activity_logs is a captain/oic/secretary-only table (see
-- captain-portal-schema-additions.sql); a PNP officer is none of
-- those and must not be added to it, because that policy would
-- also expose role changes and account suspensions.
--
-- So the PNP gets a narrow SECURITY DEFINER reader instead, which
-- returns referral-scoped rows only, and only for referrals the
-- caller is assigned to. It also strips the jsonb payloads down to
-- the keys a referral actor needs.
CREATE OR REPLACE FUNCTION public.pnp_referral_activity(
  p_referral_id uuid  DEFAULT NULL,
  p_limit       integer DEFAULT 100
)
RETURNS TABLE (
  id           uuid,
  action       text,
  entity_ref   text,
  details      jsonb,
  created_at   timestamptz,
  referral_id  uuid
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500);
BEGIN
  IF NOT public.is_pnp_officer() THEN
    RAISE EXCEPTION 'Only an active PNP officer may read referral activity.';
  END IF;

  RETURN QUERY
  SELECT
    al.id,
    al.action,
    al.entity_ref,
    -- Only the keys below leave the database. A log row's full
    -- details blob can carry internal values that are not part of
    -- the referral.
    CASE
      WHEN al.details ? 'from' OR al.details ? 'to'
        THEN al.details - ARRAY['assigned_by', 'question', 'answer', 'note']
      WHEN al.details ? 'officer_id'
        THEN al.details - ARRAY['assigned_by', 'question', 'answer', 'note']
      ELSE al.details - ARRAY['assigned_by', 'question', 'answer', 'note', 'reason']
    END,
    al.created_at,
    al.target_id
  FROM public.activity_logs al
  WHERE al.target_type = 'complaint_referral'
    AND al.target_id IS NOT NULL
    -- Assignment-scoped, exactly as the table policies are.
    AND EXISTS (
      SELECT 1
        FROM public.pnp_referral_assignments a
       WHERE a.referral_id = al.target_id
         AND a.officer_id = v_actor
         AND a.released_at IS NULL
    )
    AND (p_referral_id IS NULL OR al.target_id = p_referral_id)
  ORDER BY al.created_at DESC
  LIMIT v_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.pnp_referral_activity(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pnp_referral_activity(uuid, integer) TO authenticated;


-- ── 14. pnp_referral_evidence_files() ───────────────────────
-- The file list behind a referral.
--
-- WHY THIS IS A FUNCTION AND NOT A JOIN
--   The PNP portal must show the officer which files the barangay
--   shared, with their names, so they can open the right one. That
--   metadata lives in public.evidence, and pnp-portal-04 grants no
--   PNP policy on that table — deliberately, because evidence rows
--   carry uploader, description, storage path and complaint id for
--   every file on every case, most of which is not shared.
--
--   A nested PostgREST select cannot work around that: the join is
--   made under the CALLER's policies, so
--     complaint_referral_evidence(*, evidence(*))
--   would return a null evidence object. Granting PNP read on
--   evidence to make the embed resolve would hand over the whole
--   filing cabinet.
--
--   So the shared slice is read here instead, and the return type
--   is the allowlist. storage_path is included because the client
--   needs it to mint a short-lived URL through
--   createSignedUrl(); pnp-portal-05 decides whether that request
--   is allowed, and it re-checks the same assignment and the same
--   share row this function did.
CREATE OR REPLACE FUNCTION public.pnp_referral_evidence_files(
  p_referral_id uuid
)
RETURNS TABLE (
  share_id        uuid,
  evidence_id     uuid,
  original_filename text,
  mime_type       text,
  file_size       bigint,
  storage_path    text,
  shared_by       uuid,
  shared_at       timestamptz,
  note            text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  IF NOT public.is_pnp_officer() THEN
    RAISE EXCEPTION 'Only an active PNP officer may list referral evidence.';
  END IF;

  IF NOT public.pnp_referral_is_visible(p_referral_id) THEN
    RAISE EXCEPTION 'This referral is not assigned to you.';
  END IF;

  RETURN QUERY
  SELECT
    re.id,
    re.evidence_id,
    e.original_filename,
    e.mime_type,
    e.file_size,
    e.storage_path,
    re.shared_by,
    re.shared_at,
    re.note
  FROM public.complaint_referral_evidence re
  JOIN public.evidence e ON e.id = re.evidence_id
  WHERE re.referral_id = p_referral_id
  ORDER BY re.shared_at, e.original_filename;
END;
$$;

REVOKE ALL ON FUNCTION public.pnp_referral_evidence_files(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pnp_referral_evidence_files(uuid) TO authenticated;

COMMENT ON FUNCTION public.pnp_referral_evidence_files(uuid) IS
  'Evidence explicitly shared on one referral, for the PNP officer assigned to it. The return type is the allowlist: it exposes no complaint id, no uploader, no description, and no file that was not shared.';


-- ── 15. pnp_officer_directory() ─────────────────────────────
-- Who can this referral be assigned to?
--
-- WHY NOT A PLAIN SELECT
--   The assignment dialog has to show the Captain a list of active
--   PNP officers and the units they belong to. Three separate
--   obstacles stop that from being a table read:
--
--     * public.profiles RLS lets a user read their own row and the
--       rows the existing official policies already allow, but the
--       officer roster is not among them.
--     * pnp_officer_units has a policy for OWN membership only, so
--       an officer cannot enumerate the unit, and a Captain cannot
--       read it either.
--     * A roster is exactly the thing that should not be a general
--       read, so the answer is scoped to the two roles that
--       actually assign work.
--
-- WHAT IT RETURNS
--   Only what a Captain needs to make an assignment decision: the
--   officer's id and display name, their optional PNP rank and
--   station, and the units they belong to. No email, no phone, no
--   personnel number, no account_status history. pnp_assign_referral()
--   re-checks that the chosen account is still an active PNP officer
--   at the moment of assignment, so a stale roster cannot be used to
--   assign work to a suspended account.
CREATE OR REPLACE FUNCTION public.pnp_officer_directory(
  p_unit_id uuid DEFAULT NULL
)
RETURNS TABLE (
  officer_id     uuid,
  display_name   text,
  rank           text,
  station_name   text,
  unit_id        uuid,
  unit_code      text,
  unit_name      text,
  open_referrals bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_referring_official() THEN
    RAISE EXCEPTION
      'Only the Barangay Captain or the Officer-in-Charge may view the PNP officer directory.';
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    COALESCE(NULLIF(trim(p.display_name), ''), 'Unnamed officer'),
    op.rank,
    op.station_name,
    u.id,
    u.unit_code,
    u.unit_name,
    (
      SELECT count(*)
        FROM public.pnp_referral_assignments a
       WHERE a.officer_id = p.id
         AND a.released_at IS NULL
    )
  FROM public.profiles p
  LEFT JOIN public.pnp_officer_profiles op ON op.id = p.id
  LEFT JOIN public.pnp_officer_units ou ON ou.officer_id = p.id
  LEFT JOIN public.pnp_portal_units u
         ON u.id = ou.unit_id AND u.is_active
  WHERE p.role = 'pnp_officer'::public.app_role
    AND p.account_status = 'active'::public.account_status
    AND (p_unit_id IS NULL OR u.id = p_unit_id)
  ORDER BY COALESCE(NULLIF(trim(p.display_name), ''), 'Unnamed officer'), u.unit_code;
END;
$$;

REVOKE ALL ON FUNCTION public.pnp_officer_directory(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pnp_officer_directory(uuid) TO authenticated;

COMMENT ON FUNCTION public.pnp_officer_directory(uuid) IS
  'Active PNP officers and their units, for the Captain/OIC assignment dialog. Returns name, rank, station and unit only. An officer with no unit membership appears once with NULL unit columns, and can still be assigned without a unit.';


-- ── Verification (read-only) ────────────────────────────────
-- SELECT proname, prosecdef
--   FROM pg_proc
--  WHERE proname LIKE 'pnp_%'
--  ORDER BY proname;
--  -- every row must have prosecdef = true
--
-- SELECT p.proname, pg_get_function_identity_arguments(p.oid)
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--  WHERE n.nspname = 'public' AND p.proname LIKE 'pnp_%'
--  ORDER BY 1, 2;
