-- ============================================================
-- kiosk-02-secure-idempotent-submission.sql
-- Purpose: The single trusted write path for public kiosk
--          complaints.
--
-- WHY A SECURITY DEFINER FUNCTION GRANTED TO anon:
--   The kiosk is public and must never hold a service-role key,
--   and RLS must not be weakened with an "anyone can insert"
--   policy. Instead every write is funnelled through this
--   function, which runs as the table owner, re-validates and
--   re-sanitises everything, and exposes a narrow surface:
--   no SELECT, no UPDATE, no DELETE, no arbitrary table access.
--
-- IDEMPOTENCY:
--   p_client_submission_id is a client-generated UUID created
--   before the first attempt and reused on every retry. A unique
--   index backs it, and the function catches unique_violation, so
--   a double-tap, a flaky connection, or an offline replay can
--   only ever produce ONE complaint.
--
-- TRACKING NUMBER:
--   Reuses public.generate_reference_number() ('AB-2026-0001'),
--   the same transactional sequence the rest of the system uses.
--   This is the resident-facing tracking reference stored in
--   complaints.reference_number. It is NOT a Barangay Case
--   Number (that is complaints.barangay_case_number, written
--   much later by receive_complaint_official()).
--
-- STATUS TOKEN:
--   The client generates the secret token before submitting (so
--   the same token also works for an offline receipt that is
--   later synchronised). Only its SHA-256 hash is stored.
--
-- PREREQUISITES: kiosk-01-schema-support.sql
-- ============================================================

-- ──────────────────────────────────────────────────────────────
-- A. Rate limit helper
--
--    Fixed-window counter keyed by a hash the route handler
--    derives from IP + user agent. Returns true when the caller
--    is still within budget.
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.kiosk_check_rate_limit(
  p_key            text,
  p_limit          integer,
  p_window_seconds integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count       integer;
  v_window_start timestamptz;
  v_now         timestamptz := now();
BEGIN
  IF p_key IS NULL OR length(p_key) < 16 OR length(p_key) > 200 THEN
    -- A caller that did not produce a well-formed fingerprint
    -- gets the strictest budget rather than a free pass.
    RETURN false;
  END IF;

  INSERT INTO public.kiosk_rate_limits AS r (key, count, window_start, updated_at)
  VALUES (p_key, 1, v_now, v_now)
  ON CONFLICT (key) DO UPDATE
    SET count = CASE
                  WHEN r.window_start < v_now - make_interval(secs => p_window_seconds)
                    THEN 1
                  ELSE r.count + 1
                END,
        window_start = CASE
                         WHEN r.window_start < v_now - make_interval(secs => p_window_seconds)
                           THEN v_now
                         ELSE r.window_start
                       END,
        updated_at = v_now
  RETURNING r.count, r.window_start INTO v_count, v_window_start;

  RETURN v_count <= p_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.kiosk_check_rate_limit(text, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kiosk_check_rate_limit(text, integer, integer)
  TO anon, authenticated;

-- ──────────────────────────────────────────────────────────────
-- B. Text sanitiser
--
--    Strips control characters (including NUL and zero-width
--    joiners used to break keyword search) and trims. The
--    resident's wording is never rewritten.
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.kiosk_clean_text(p_value text, p_max_len integer)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_value IS NULL THEN NULL
    ELSE left(
      trim(
        regexp_replace(
          regexp_replace(coalesce(p_value, ''), '[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]', '', 'g'),
          '[\u200B-\u200D\uFEFF]', '', 'g'
        )
      ),
      p_max_len
    )
  END;
$$;

-- ──────────────────────────────────────────────────────────────
-- C. Philippine mobile normaliser
--
--    Accepts 09XXXXXXXXX, +639XXXXXXXXX, 63XXXXXXXXX and
--    anything with spaces, dashes, dots or parentheses, and
--    stores a single canonical 09XXXXXXXXX form.
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.kiosk_normalize_mobile(p_value text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_digits text;
BEGIN
  IF p_value IS NULL OR trim(p_value) = '' THEN
    RETURN NULL;
  END IF;

  v_digits := regexp_replace(p_value, '[^0-9]', '', 'g');

  IF v_digits LIKE '63%' AND length(v_digits) = 12 THEN
    v_digits := '0' || substr(v_digits, 3);
  END IF;

  IF v_digits ~ '^9[0-9]{9}$' THEN
    v_digits := '0' || v_digits;
  END IF;

  RETURN v_digits;
END;
$$;

-- ──────────────────────────────────────────────────────────────
-- D. The trusted submission function
-- ──────────────────────────────────────────────────────────────
-- Every parameter is required, with no DEFAULT clause.
--
-- Postgres rejects a signature in which a defaulted parameter is followed
-- by a non-defaulted one (42P13), and this signature originally mixed the
-- two. Defaults bought nothing here: lib/kiosk/serverApi.js passes all 28
-- arguments by name on every call, so removing them changes no behaviour
-- and makes the function creatable at all.
CREATE OR REPLACE FUNCTION public.kiosk_submit_complaint(
  p_client_submission_id      uuid,
  p_fingerprint               text,
  p_status_token              text,
  p_draft_reference           text,
  p_complainant_snapshot      jsonb,
  p_other_party_status        text,
  p_respondent_name           text,
  p_respondent_address        text,
  p_respondent_purok          text,
  p_respondent_contact        text,
  p_respondent_relationship   text,
  p_incident_date             date,
  p_incident_time             time,
  p_incident_location         text,
  p_incident_purok            text,
  p_incident_ongoing          boolean,
  p_immediate_safety_concern  boolean,
  p_narrative                 text,
  p_evidence_file_ids         jsonb,
  p_privacy_consent_at        timestamptz,
  p_accuracy_confirmation_at  timestamptz,
  p_predicted_category        text,
  p_predicted_case_type       text,
  p_predicted_urgency         text,
  p_prediction_confidence     numeric,
  p_prediction_model          text,
  p_submitted_offline         boolean,
  p_queued_at                 timestamptz
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id            uuid;
  v_ref           text;
  v_token_hash    text;
  v_existing      record;
  v_snapshot      jsonb;
  v_full_name     text;
  v_mobile        text;
  v_address       text;
  v_narrative     text;
  v_location      text;
  v_purok         text;
  v_op_status     text;
  v_submitted_at  timestamptz := now();
  v_file_ids      uuid[] := ARRAY[]::uuid[];
  v_file_row      record;
  v_linked        integer := 0;
  v_session_id    uuid;
  v_category      case_category;
  v_case_type     case_category;
  v_urgency       urgency_level;
  v_confidence    numeric(5,4);
  v_class_status  text;
BEGIN
  -- 1. Rate limit before any work is done.
  IF NOT public.kiosk_check_rate_limit(
       'submit:' || p_fingerprint, 12, 3600
     ) THEN
    RAISE EXCEPTION 'Too many submissions. Please try again later.'
      USING ERRCODE = 'P0001';
  END IF;

  -- 2. Idempotency: an existing row for this key is returned
  --    untouched. The raw status token is NOT echoed back; the
  --    client already holds it because it generated the token.
  IF p_client_submission_id IS NOT NULL THEN
    SELECT id, reference_number, submitted_at, current_status
      INTO v_existing
      FROM public.complaints
     WHERE kiosk_client_submission_id = p_client_submission_id;

    IF FOUND THEN
      RETURN json_build_object(
        'id', v_existing.id,
        'reference_number', v_existing.reference_number,
        'submitted_at', v_existing.submitted_at,
        'status', v_existing.current_status,
        'already_submitted', true
      );
    END IF;
  END IF;

  -- 3. Required values.
  IF p_client_submission_id IS NULL THEN
    RAISE EXCEPTION 'Missing submission reference.';
  END IF;

  IF p_status_token IS NULL
     OR length(p_status_token) < 32
     OR length(p_status_token) > 128 THEN
    RAISE EXCEPTION 'Invalid status token.';
  END IF;

  IF p_privacy_consent_at IS NULL THEN
    RAISE EXCEPTION 'Privacy acknowledgement is required.';
  END IF;

  IF p_accuracy_confirmation_at IS NULL THEN
    RAISE EXCEPTION 'Accuracy confirmation is required.';
  END IF;

  IF p_complainant_snapshot IS NULL
     OR p_complainant_snapshot = '{}'::jsonb THEN
    RAISE EXCEPTION 'Complainant details are required.';
  END IF;

  -- 4. Sanitise the complainant snapshot. Only known keys are
  --    copied, so the client cannot smuggle extra fields into
  --    storage.
  v_snapshot := jsonb_build_object(
    'first_name',  public.kiosk_clean_text(p_complainant_snapshot->>'first_name', 80),
    'middle_name', public.kiosk_clean_text(p_complainant_snapshot->>'middle_name', 80),
    'last_name',   public.kiosk_clean_text(p_complainant_snapshot->>'last_name', 80),
    'suffix',      public.kiosk_clean_text(p_complainant_snapshot->>'suffix', 20),
    'mobile_number', public.kiosk_normalize_mobile(
                      p_complainant_snapshot->>'mobile_number'),
    'house_street', public.kiosk_clean_text(p_complainant_snapshot->>'house_street', 200),
    'purok',        public.kiosk_clean_text(p_complainant_snapshot->>'purok', 80),
    'barangay',     'Abuno',
    'city',         'Iligan City',
    'filing_mode',  public.kiosk_clean_text(p_complainant_snapshot->>'filing_mode', 40)
  );

  v_full_name := btrim(
    coalesce(v_snapshot->>'first_name', '') || ' ' ||
    coalesce(v_snapshot->>'middle_name', '') || ' ' ||
    coalesce(v_snapshot->>'last_name', '') || ' ' ||
    coalesce(v_snapshot->>'suffix', '')
  );

  IF length(v_full_name) < 2 THEN
    RAISE EXCEPTION 'Enter your full name.';
  END IF;

  v_mobile := v_snapshot->>'mobile_number';
  IF v_mobile IS NULL OR v_mobile !~ '^09[0-9]{9}$' THEN
    RAISE EXCEPTION 'Enter a valid Philippine mobile number.';
  END IF;

  v_address := btrim(
    coalesce(v_snapshot->>'house_street', '') || ', ' ||
    coalesce(v_snapshot->>'purok', '') || ', Abuno, Iligan City'
  );
  IF length(coalesce(v_snapshot->>'house_street', '')) < 2
     OR length(coalesce(v_snapshot->>'purok', '')) < 1 THEN
    RAISE EXCEPTION 'Enter your complete address.';
  END IF;

  -- 5. Incident details.
  v_narrative := public.kiosk_clean_text(p_narrative, 5000);
  IF v_narrative IS NULL OR length(v_narrative) < 20 THEN
    RAISE EXCEPTION 'Describe what happened.';
  END IF;

  v_location := public.kiosk_clean_text(p_incident_location, 250);
  IF v_location IS NULL OR length(v_location) < 2 THEN
    RAISE EXCEPTION 'Enter the incident location.';
  END IF;

  v_purok := public.kiosk_clean_text(p_incident_purok, 80);

  IF p_incident_date IS NULL THEN
    RAISE EXCEPTION 'Enter the incident date.';
  END IF;
  IF p_incident_date > current_date THEN
    RAISE EXCEPTION 'The incident date cannot be in the future.';
  END IF;
  IF p_incident_time IS NULL THEN
    RAISE EXCEPTION 'Enter the incident time.';
  END IF;

  -- 6. Other party. An unknown or absent other party must never
  --    create a fabricated respondent.
  v_op_status := coalesce(
    public.kiosk_clean_text(p_other_party_status, 32), 'unknown'
  );
  IF v_op_status NOT IN ('known', 'unknown', 'not_applicable') THEN
    RAISE EXCEPTION 'Select the other-party status.';
  END IF;

  IF v_op_status = 'known' THEN
    IF public.kiosk_clean_text(p_respondent_name, 160) IS NULL THEN
      RAISE EXCEPTION 'Enter the other party''s name.';
    END IF;
  END IF;

  -- 7. Classification is advisory only. An unusable value falls
  --    back to pending rather than failing the submission.
  v_class_status := 'pending';
  BEGIN
    IF p_predicted_case_type IN ('Criminal', 'Civil', 'Administrative') THEN
      v_case_type := p_predicted_case_type::case_category;
    END IF;
    IF p_predicted_category IN ('Criminal', 'Civil', 'Administrative') THEN
      v_category := p_predicted_category::case_category;
    END IF;
    IF p_predicted_urgency IN ('Critical', 'High', 'Normal') THEN
      v_urgency := p_predicted_urgency::urgency_level;
    END IF;
    IF v_case_type IS NOT NULL AND v_urgency IS NOT NULL THEN
      v_confidence := least(greatest(coalesce(p_prediction_confidence, 0), 0), 1);
      v_class_status := 'suggested';
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_class_status := 'unavailable';
    v_category := NULL;
    v_case_type := NULL;
    v_urgency := NULL;
    v_confidence := NULL;
  END;

  -- 8. Reference number from the existing transactional sequence.
  v_ref := public.generate_reference_number();
  v_token_hash := public.kiosk_sha256(v_ref || ':' || p_status_token);

  -- 9. Insert. A concurrent duplicate is caught below.
  BEGIN
    INSERT INTO public.complaints (
      resident_id,
      reference_number,
      title,
      description,
      incident_date,
      incident_time,
      incident_location,
      incident_purok,
      persons_involved,
      other_party_status,
      incident_ongoing,
      immediate_safety_concern,
      predicted_category,
      predicted_case_type,
      predicted_urgency,
      prediction_confidence,
      prediction_model,
      classification_status,
      classification_at,
      current_status,
      current_stage,
      filing_channel,
      source,
      complainant_snapshot,
      respondent_name,
      respondent_address,
      respondent_contact,
      encoded_at,
      kiosk_client_submission_id,
      kiosk_fingerprint,
      kiosk_status_token_hash,
      kiosk_status_token_expires_at,
      kiosk_draft_reference,
      kiosk_submitted_offline,
      kiosk_sync_status,
      kiosk_queued_at,
      kiosk_synced_at,
      privacy_consent_at,
      accuracy_confirmation_at,
      submitted_at
    ) VALUES (
      NULL,
      v_ref,
      -- complaints.title is NOT NULL. It is derived server-side
      -- from the resident's own words; nothing is invented.
      left(v_narrative, 90),
      v_narrative,
      p_incident_date,
      p_incident_time,
      v_location,
      v_purok,
      CASE WHEN v_op_status = 'known'
           THEN public.kiosk_clean_text(p_respondent_name, 160)
           ELSE NULL END,
      v_op_status,
      coalesce(p_incident_ongoing, false),
      coalesce(p_immediate_safety_concern, false),
      v_category,
      v_case_type,
      v_urgency,
      v_confidence,
      public.kiosk_clean_text(p_prediction_model, 60),
      v_class_status,
      CASE WHEN v_class_status = 'suggested' THEN v_submitted_at ELSE NULL END,
      -- A kiosk submission is RECEIVED, never approved. It enters
      -- the normal staff review queue at 'Pending Review'.
      'Pending Review',
      'Pending Review',
      'kiosk',
      'kiosk',
      v_snapshot,
      CASE WHEN v_op_status = 'known'
           THEN public.kiosk_clean_text(p_respondent_name, 160)
           ELSE NULL END,
      CASE WHEN v_op_status = 'known'
           THEN public.kiosk_clean_text(
                  p_respondent_address || coalesce(', ' || p_respondent_purok, ''), 250)
           ELSE NULL END,
      CASE WHEN v_op_status = 'known'
           THEN public.kiosk_clean_text(p_respondent_contact, 60)
           ELSE NULL END,
      v_submitted_at,
      p_client_submission_id,
      left(coalesce(p_fingerprint, ''), 200),
      v_token_hash,
      -- The status QR stops working after 180 days, which is well
      -- past the point a resident would still be checking.
      v_submitted_at + interval '180 days',
      public.kiosk_clean_text(p_draft_reference, 64),
      coalesce(p_submitted_offline, false),
      'synced',
      p_queued_at,
      v_submitted_at,
      p_privacy_consent_at,
      p_accuracy_confirmation_at,
      v_submitted_at
    )
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    -- Lost a race with a concurrent retry. Return the winner.
    SELECT id, reference_number, submitted_at, current_status
      INTO v_existing
      FROM public.complaints
     WHERE kiosk_client_submission_id = p_client_submission_id;

    IF FOUND THEN
      RETURN json_build_object(
        'id', v_existing.id,
        'reference_number', v_existing.reference_number,
        'submitted_at', v_existing.submitted_at,
        'status', v_existing.current_status,
        'already_submitted', true
      );
    END IF;
    RAISE;
  END;

  -- 10. Link evidence that actually arrived through a live QR
  --     session. Session-file rows are the only accepted proof;
  --     the client cannot name an arbitrary storage path.
  IF p_evidence_file_ids IS NOT NULL
     AND jsonb_typeof(p_evidence_file_ids) = 'array'
     AND jsonb_array_length(p_evidence_file_ids) > 0 THEN

    SELECT id INTO v_session_id
      FROM public.kiosk_upload_sessions
     WHERE draft_reference = p_draft_reference
       AND revoked_at IS NULL
       AND consumed_at IS NULL
       AND expires_at > now()
     LIMIT 1;

    IF v_session_id IS NOT NULL THEN
      SELECT array_agg(value::uuid)
        INTO v_file_ids
        FROM (
          SELECT value
            FROM jsonb_array_elements_text(p_evidence_file_ids) AS value
        ) AS wanted;

      FOR v_file_row IN
        SELECT f.id, f.storage_path, f.original_filename,
               f.mime_type, f.file_size
          FROM public.kiosk_upload_session_files f
         WHERE f.session_id = v_session_id
           AND f.id = ANY(v_file_ids)
           AND f.attached_at IS NULL
         LIMIT 5
      LOOP
        INSERT INTO public.evidence (
          complaint_id,
          uploaded_by,
          storage_path,
          original_filename,
          mime_type,
          file_size,
          evidence_type,
          description,
          kiosk_evidence,
          kiosk_upload_session_id
        ) VALUES (
          v_id,
          NULL,
          v_file_row.storage_path,
          v_file_row.original_filename,
          v_file_row.mime_type,
          v_file_row.file_size,
          CASE WHEN v_file_row.mime_type LIKE 'image/%' THEN 'photo' ELSE 'document' END,
          'Uploaded by the complainant through the public kiosk.',
          true,
          v_session_id
        )
        ON CONFLICT DO NOTHING;

        UPDATE public.kiosk_upload_session_files
           SET attached_at = now()
         WHERE id = v_file_row.id;

        v_linked := v_linked + 1;
      END LOOP;

      IF v_linked > 0 THEN
        UPDATE public.kiosk_upload_sessions
           SET consumed_at = now(), complaint_id = v_id
         WHERE id = v_session_id;
      END IF;
    END IF;
  END IF;

  -- 11. Initial status history. resident_visible_message is the
  --     only wording the resident ever sees from this record.
  INSERT INTO public.case_statuses (
    complaint_id, status, stage, resident_visible_message, changed_by
  ) VALUES (
    v_id,
    'Pending Review',
    'Complaint Filed',
    'Your complaint was received at the Barangay Abuno Hall and is waiting for review by a barangay official.',
    NULL
  );

  -- 12. Notify the officials who already receive complaints.
  INSERT INTO public.notifications (
    user_id, type, title, message,
    related_complaint_id, related_hearing_id
  )
  SELECT p.id,
         'complaint',
         'New kiosk complaint to review',
         'A complaint was filed at the public kiosk and is waiting for review.',
         v_id,
         NULL
    FROM public.profiles p
   WHERE p.role IN ('captain', 'oic', 'secretary')
     AND p.account_status = 'active';

  -- 13. Audit trail. actor_id stays NULL: the complainant is not
  --     an account. The fingerprint is a hash, not an address.
  PERFORM public.log_activity(
    'kiosk_complaint_submitted',
    'complaint',
    v_id,
    v_ref,
    jsonb_build_object(
      'filing_channel', 'kiosk',
      'other_party_status', v_op_status,
      'evidence_linked', v_linked,
      'classification_status', v_class_status,
      'submitted_offline', coalesce(p_submitted_offline, false),
      'idempotency_key', p_client_submission_id
    )
  );

  INSERT INTO public.audit_logs (
    actor_id, actor_role, action, target_type, target_id, details
  ) VALUES (
    NULL, NULL, 'kiosk_complaint_submitted', 'complaint', v_id,
    jsonb_build_object(
      'reference_number', v_ref,
      'filing_channel', 'kiosk',
      'evidence_linked', v_linked,
      'classification_status', v_class_status,
      'fingerprint', left(coalesce(p_fingerprint, ''), 200),
      'idempotency_key', p_client_submission_id
    )
  );

  -- 14. Safe result. No internal identifiers, no staff notes.
  RETURN json_build_object(
    'id', v_id,
    'reference_number', v_ref,
    'submitted_at', v_submitted_at,
    'status', 'Pending Review',
    'evidence_count', v_linked,
    'classification_status', v_class_status,
    'already_submitted', false
  );
END;
$$;

-- Only anon (the public kiosk) and authenticated (the kiosk
-- service worker replaying a queued submission) may call this.
-- No direct table write is granted to either.
REVOKE ALL ON FUNCTION public.kiosk_submit_complaint(
  uuid, text, text, text, jsonb, text, text, text, text, text, text,
  date, time, text, text, boolean, boolean, text, jsonb, timestamptz,
  timestamptz, text, text, text, numeric, text, boolean, timestamptz
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.kiosk_submit_complaint(
  uuid, text, text, text, jsonb, text, text, text, text, text, text,
  date, time, text, text, boolean, boolean, text, jsonb, timestamptz,
  timestamptz, text, text, text, numeric, text, boolean, timestamptz
) TO anon, authenticated;

-- ──────────────────────────────────────────────────────────────
-- E. Verification
-- ──────────────────────────────────────────��───────────────────
-- SELECT p.proname, pg_catalog.pg_get_function_identity_arguments(p.oid)
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--  WHERE n.nspname = 'public' AND p.proname = 'kiosk_submit_complaint';
--
-- SELECT has_function_privilege(
--   'anon', 'public.kiosk_submit_complaint(uuid,text,text,text,jsonb,text,text,text,text,text,text,date,time,text,text,boolean,boolean,text,jsonb,timestamptz,timestamptz,text,text,text,numeric,text,boolean,timestamptz)', 'EXECUTE');
-- Both should return a row; the second must be true.
