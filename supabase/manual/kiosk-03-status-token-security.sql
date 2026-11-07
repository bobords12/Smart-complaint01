-- ============================================================
-- kiosk-03-status-token-security.sql
-- Purpose: Resident-safe status lookup (QR token + tracking
--          number) and the QR evidence-upload session lifecycle.
--
-- PRIVACY RULES ENFORCED HERE:
--   * Only a SHA-256 HASH of a status token is ever stored, and
--     the raw token is never written to the database or a log.
--   * The public status payload contains no staff notes, no
--     internal routing reasons, no classification confidence,
--     no audit metadata and no other resident's data. It is
--     assembled from an explicit allow-list below, so a column
--     added to complaints later cannot leak by accident.
--   * A failed tracking-number lookup and a wrong mobile number
--     return the SAME generic error and cost the same rate-limit
--     budget, so the endpoint is not an existence oracle.
--
-- PREREQUISITES: kiosk-01, kiosk-02
-- ============================================================

-- ──────────────────────────────────────────────────────────────
-- A. Opaque token generator
--
--    Built from uuid_generate_v4(), which the project already
--    uses everywhere. No pgcrypto dependency, and 244 bits of
--    entropy for the long-lived status token.
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.kiosk_new_token(p_groups integer DEFAULT 1)
RETURNS text
LANGUAGE sql
VOLATILE
AS $$
  SELECT string_agg(
           replace(extensions.uuid_generate_v4()::text, '-', ''),
           ''
         )
    FROM generate_series(1, greatest(coalesce(p_groups, 1), 1));
$$;

-- ──────────────────────────────────────────────────────────────
-- B. Resident-safe status payload
--
--    SECURITY DEFINER because it reads tables (case_statuses,
--    kp_trackers, kp_phases, hearings) that anon cannot select.
--    It is NOT granted to anon; only the two lookup functions
--    below may call it, and they add their own authorisation.
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.kiosk_status_payload(p_complaint_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c             record;
  v_last_msg    text;
  v_last_at     timestamptz;
  v_timeline    jsonb;
  -- Typed scalars, NOT `record`, for the three lookups below.
  --
  -- A plpgsql `record` variable that is never the target of an executed
  -- SELECT INTO raises `record "v_mediation" is not assigned yet` on the
  -- first field reference, which is SQLSTATE 55000. The mediation
  -- lookup sat inside `IF v_kp.kp_applicable AND ...`, so for every
  -- complaint that is not a KP case -- which is every complaint at the
  -- moment it is filed -- the SELECT never ran and the build of the
  -- payload at the bottom of this function aborted the whole lookup.
  -- The status screen therefore failed with 503 for every new filing.
  --
  -- Scalars default to NULL, so an absent row and an unassigned variable
  -- are the same thing and cannot be confused.
  v_kp_applicable      boolean;
  v_kp_confirmed_at    timestamptz;
  v_mediation_phase    public.kp_phase_type;
  v_mediation_deadline timestamptz;
  v_mediation_status   public.kp_phase_status;
  v_hearing_date       date;
  v_hearing_time       time;
  v_hearing_venue      text;
  v_hearing_status     public.hearing_status;
  v_hearing_title      text;
BEGIN
  SELECT reference_number,
         current_status,
         current_stage,
         submitted_at,
         updated_at,
         confirmed_category,
         confirmed_urgency,
         other_party_status,
         incident_ongoing,
         immediate_safety_concern,
         classification_status
    INTO c
    FROM public.complaints
   WHERE id = p_complaint_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- Most recent resident-facing wording only. changed_by is a
  -- staff user id and is never exposed.
  SELECT resident_visible_message, created_at
    INTO v_last_msg, v_last_at
    FROM public.case_statuses
   WHERE complaint_id = p_complaint_id
   ORDER BY created_at DESC, id DESC
   LIMIT 1;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'status',   cs.status,
           'stage',    coalesce(cs.stage, cs.status::text),
           'message',  cs.resident_visible_message,
           'at',       cs.created_at
         ) ORDER BY cs.created_at ASC, cs.id ASC), '[]'::jsonb)
    INTO v_timeline
    FROM public.case_statuses cs
   WHERE cs.complaint_id = p_complaint_id;

  SELECT kp_applicable, applicability_confirmed_at
    INTO v_kp_applicable, v_kp_confirmed_at
    FROM public.kp_trackers
   WHERE complaint_id = p_complaint_id;

  IF v_kp_applicable
     AND v_kp_confirmed_at IS NOT NULL THEN
    SELECT kp.phase_type, kp.deadline_date, kp.status
      INTO v_mediation_phase, v_mediation_deadline, v_mediation_status
      FROM public.kp_phases kp
      JOIN public.kp_trackers t ON t.id = kp.tracker_id
     WHERE t.complaint_id = p_complaint_id
       AND kp.phase_type IN ('Mediation', 'Conciliation')
       AND kp.start_date IS NOT NULL
     ORDER BY kp.start_date DESC
     LIMIT 1;
  END IF;

  SELECT hearing_date, hearing_time, venue, status, title
    INTO v_hearing_date, v_hearing_time, v_hearing_venue,
         v_hearing_status, v_hearing_title
    FROM public.hearings
   WHERE complaint_id = p_complaint_id
     AND status = 'Upcoming'
   ORDER BY hearing_date ASC, hearing_time ASC NULLS LAST
   LIMIT 1;

  RETURN jsonb_build_object(
    'reference_number',   c.reference_number,
    'current_status',     c.current_status,
    'current_stage',      c.current_stage,
    'submitted_at',       c.submitted_at,
    'last_updated_at',    greatest(coalesce(c.updated_at, c.submitted_at), coalesce(v_last_at, c.submitted_at)),
    'last_message',       v_last_msg,
    -- Official values only. These stay null while unconfirmed, so
    -- an unconfirmed AI suggestion can never be presented to the
    -- resident as fact.
    'confirmed_category', c.confirmed_category,
    'confirmed_urgency',  c.confirmed_urgency,
    'classification_status', c.classification_status,
    'other_party_status', c.other_party_status,
    'incident_ongoing',   c.incident_ongoing,
    'immediate_safety_concern', c.immediate_safety_concern,
    'timeline',           v_timeline,
    'is_kp_case',         coalesce(v_kp_applicable, false)
                           AND v_kp_confirmed_at IS NOT NULL,
    'mediation',          CASE WHEN v_mediation_phase IS NULL THEN NULL ELSE jsonb_build_object(
                              'phase',     v_mediation_phase,
                              'deadline',  v_mediation_deadline,
                              'status',    v_mediation_status
                            ) END,
    'next_hearing',       CASE WHEN v_hearing_date IS NULL THEN NULL ELSE jsonb_build_object(
                              'date',   v_hearing_date,
                              'time',   v_hearing_time,
                              'venue',  v_hearing_venue,
                              'status', v_hearing_status,
                              'title',  v_hearing_title
                            ) END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.kiosk_status_payload(uuid) FROM PUBLIC, anon, authenticated;

-- ──────────────────────────────────────────────────────────────
-- C. Lookup by QR status token
--
--    An unknown token returns {"state":"pending_sync"} rather
--    than an error. That single shape covers both a genuinely
--    unsynchronised offline receipt and a token that does not
--    exist, so the endpoint reveals nothing about which
--    complaints exist. The client performs a purely local format
--    check first and shows "invalid link" for malformed input.
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.kiosk_status_by_token(
  p_token       text,
  p_fingerprint text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id      uuid;
  v_payload jsonb;
BEGIN
  IF NOT public.kiosk_check_rate_limit(
       'status_token:' || p_fingerprint, 90, 3600
     ) THEN
    RAISE EXCEPTION 'Too many requests. Please wait before trying again.';
  END IF;

  IF p_token IS NULL OR length(p_token) < 32 OR length(p_token) > 128 THEN
    RETURN jsonb_build_object('state', 'pending_sync');
  END IF;

  SELECT id INTO v_id
    FROM public.complaints
   WHERE kiosk_status_token_hash =
           public.kiosk_sha256(reference_number || ':' || p_token)
     AND kiosk_status_token_revoked_at IS NULL
     AND kiosk_status_token_expires_at > now()
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'pending_sync');
  END IF;

  v_payload := public.kiosk_status_payload(v_id);
  IF v_payload IS NULL THEN
    RETURN jsonb_build_object('state', 'pending_sync');
  END IF;

  RETURN v_payload || jsonb_build_object('state', 'found');
END;
$$;

REVOKE ALL ON FUNCTION public.kiosk_status_by_token(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kiosk_status_by_token(text, text) TO anon, authenticated;

-- ──────────────────────────────────────────────────────────────
-- D. Manual lookup by tracking number + registered mobile
--
--    The mobile number is compared in SQL. It is never returned,
--    and a mismatch is indistinguishable from an unknown tracking
--    number.
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.kiosk_status_lookup(
  p_reference   text,
  p_mobile      text,
  p_fingerprint text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id      uuid;
  v_mobile  text;
  v_payload jsonb;
BEGIN
  IF NOT public.kiosk_check_rate_limit(
       'status_lookup:' || p_fingerprint, 10, 900
     ) THEN
    RAISE EXCEPTION 'Too many attempts. Please try again later.';
  END IF;

  v_mobile := public.kiosk_normalize_mobile(p_mobile);

  IF p_reference IS NULL
     OR length(trim(p_reference)) < 4
     OR v_mobile IS NULL THEN
    RAISE EXCEPTION 'We could not verify those details.';
  END IF;

  SELECT id INTO v_id
    FROM public.complaints
   WHERE upper(reference_number) = upper(trim(p_reference))
     AND kiosk_client_submission_id IS NOT NULL
     AND complainant_snapshot->>'mobile_number' = v_mobile
   LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'We could not verify those details.';
  END IF;

  v_payload := public.kiosk_status_payload(v_id);
  IF v_payload IS NULL THEN
    RAISE EXCEPTION 'We could not verify those details.';
  END IF;

  RETURN v_payload || jsonb_build_object('state', 'found');
END;
$$;

REVOKE ALL ON FUNCTION public.kiosk_status_lookup(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kiosk_status_lookup(text, text, text) TO anon, authenticated;

-- ──────────────────────────────────────────────────────────────
-- E. QR evidence upload session
--
--    Two identifiers with different jobs:
--      draft_reference - random, not secret, appears in the
--                        storage path and is what the storage
--                        RLS policy validates.
--      token           - the only value placed in the QR code.
--                        Only public.kiosk_sha256(token) is
--                        stored.
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.kiosk_create_upload_session(
  p_fingerprint text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_draft text;
  v_token text;
  v_hash  text;
BEGIN
  IF NOT public.kiosk_check_rate_limit(
       'upload_session:' || p_fingerprint, 20, 3600
     ) THEN
    RAISE EXCEPTION 'Too many upload sessions. Please try again later.';
  END IF;

  v_draft := public.kiosk_new_token(1);
  v_token := public.kiosk_new_token(1);
  v_hash  := public.kiosk_sha256(v_token);

  INSERT INTO public.kiosk_upload_sessions (
    draft_reference, token_hash, expires_at
  ) VALUES (
    v_draft, v_hash, now() + interval '10 minutes'
  );

  RETURN jsonb_build_object(
    'draft_reference', v_draft,
    'token',          v_token,
    'expires_at',     now() + interval '10 minutes'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.kiosk_create_upload_session(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kiosk_create_upload_session(text) TO anon, authenticated;

-- Helper: resolve a session from its secret token.
CREATE OR REPLACE FUNCTION public.kiosk_resolve_upload_session(p_token text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_token IS NULL OR length(p_token) < 16 OR length(p_token) > 128 THEN
    RETURN NULL;
  END IF;

  SELECT id INTO v_id
    FROM public.kiosk_upload_sessions
   WHERE token_hash = public.kiosk_sha256(p_token)
     AND revoked_at IS NULL
     AND consumed_at IS NULL
     AND expires_at > now()
   LIMIT 1;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.kiosk_resolve_upload_session(text) FROM PUBLIC, anon, authenticated;

-- Polled by the kiosk to learn what a phone has delivered.
CREATE OR REPLACE FUNCTION public.kiosk_upload_session_status(
  p_token       text,
  p_fingerprint text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session uuid;
  v_row     record;
  v_files   jsonb;
BEGIN
  IF NOT public.kiosk_check_rate_limit(
       'upload_poll:' || p_fingerprint, 240, 3600
     ) THEN
    RAISE EXCEPTION 'Too many requests. Please wait before trying again.';
  END IF;

  v_session := public.kiosk_resolve_upload_session(p_token);

  IF v_session IS NULL THEN
    RETURN jsonb_build_object('state', 'expired');
  END IF;

  SELECT draft_reference, expires_at
    INTO v_row
    FROM public.kiosk_upload_sessions
   WHERE id = v_session;

  -- "uploaded" is decided by whether the storage object actually
  -- exists, NOT by received_at. received_at is stamped when the
  -- phone registers its intent to upload, which happens before the
  -- bytes move; trusting it would let the review screen offer a file
  -- whose upload failed or was abandoned halfway.
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id',         f.id,
           'name',       f.original_filename,
           'mime_type',  f.mime_type,
           'size',       f.file_size,
           'registered_at', f.received_at,
           'uploaded',   (o.id IS NOT NULL),
           'attached',   f.attached_at IS NOT NULL
         ) ORDER BY f.received_at ASC), '[]'::jsonb)
    INTO v_files
    FROM public.kiosk_upload_session_files f
    LEFT JOIN storage.objects o
           ON o.bucket_id = 'evidence'
          AND o.name = f.storage_path
   WHERE f.session_id = v_session;

  RETURN jsonb_build_object(
    'state', 'active',
    'draft_reference', v_row.draft_reference,
    'expires_at', v_row.expires_at,
    'files', v_files
  );
END;
$$;

REVOKE ALL ON FUNCTION public.kiosk_upload_session_status(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kiosk_upload_session_status(text, text) TO anon, authenticated;

-- ──────────────────────────────────────────────────────────────
-- F. Register a file the phone has already stored
--
--    The route handler performs the actual storage upload and
--    then records the manifest row here. The storage path is
--    DERIVED SERVER-SIDE from the session's draft_reference, so
--    the client cannot point the manifest at an arbitrary object.
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.kiosk_register_uploaded_file(
  p_token           text,
  p_original_filename text,
  p_mime_type       text,
  p_file_size       bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session  uuid;
  v_draft    text;
  v_ext      text;
  v_safe     text;
  v_path     text;
  v_file_id  uuid;
  v_count    integer;
BEGIN
  -- The rate-limit bucket is keyed by a HASH of the token, never by
  -- the token itself. kiosk_rate_limits is a persistent table, so
  -- using the raw capability as the primary key would store the
  -- secret in plaintext and defeat the point of hashing it
  -- everywhere else.
  IF NOT public.kiosk_check_rate_limit(
       'upload_register:' || public.kiosk_sha256(coalesce(p_token, '')), 30, 3600
     ) THEN
    RAISE EXCEPTION 'Too many uploads for this session.';
  END IF;

  v_session := public.kiosk_resolve_upload_session(p_token);
  IF v_session IS NULL THEN
    RAISE EXCEPTION 'This upload link is no longer valid.';
  END IF;

  IF p_mime_type NOT IN ('image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'application/pdf') THEN
    RAISE EXCEPTION 'Unsupported file type.';
  END IF;

  IF p_file_size IS NULL OR p_file_size <= 0 OR p_file_size > 10485760 THEN
    RAISE EXCEPTION 'File must be 10 MB or smaller.';
  END IF;

  SELECT count(*) INTO v_count
    FROM public.kiosk_upload_session_files
   WHERE session_id = v_session;
  IF v_count >= 5 THEN
    RAISE EXCEPTION 'A maximum of 5 files can be uploaded.';
  END IF;

  SELECT draft_reference INTO v_draft
    FROM public.kiosk_upload_sessions
   WHERE id = v_session;

  -- Extension is taken from the allow-listed MIME type, never
  -- from the client-supplied name.
  v_ext := CASE p_mime_type
    WHEN 'image/jpeg' THEN 'jpg'
    WHEN 'image/jpg'  THEN 'jpg'
    WHEN 'image/png'  THEN 'png'
    WHEN 'image/webp' THEN 'webp'
    ELSE 'pdf'
  END;

  v_safe := public.kiosk_clean_text(p_original_filename, 120);
  IF v_safe IS NULL OR v_safe = '' THEN
    v_safe := 'evidence.' || v_ext;
  END IF;

  v_path := 'kiosk/' || v_draft || '/' || public.kiosk_new_token(1) || '.' || v_ext;

  INSERT INTO public.kiosk_upload_session_files (
    session_id, storage_path, original_filename, mime_type, file_size
  ) VALUES (
    v_session, v_path, v_safe, p_mime_type, p_file_size
  )
  RETURNING id INTO v_file_id;

  RETURN jsonb_build_object(
    'id', v_file_id,
    'storage_path', v_path,
    'name', v_safe,
    'mime_type', p_mime_type,
    'size', p_file_size
  );
END;
$$;

REVOKE ALL ON FUNCTION public.kiosk_register_uploaded_file(text, text, text, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kiosk_register_uploaded_file(text, text, text, bigint)
  TO anon, authenticated;

-- Revoke early when the resident cancels or navigates away.
CREATE OR REPLACE FUNCTION public.kiosk_revoke_upload_session(
  p_token       text,
  p_fingerprint text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  v_id := public.kiosk_resolve_upload_session(p_token);
  IF v_id IS NULL THEN
    RETURN false;
  END IF;

  UPDATE public.kiosk_upload_sessions
     SET revoked_at = now()
   WHERE id = v_id;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.kiosk_revoke_upload_session(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kiosk_revoke_upload_session(text, text) TO anon, authenticated;

-- ──────────────────────────────────────────────────────────────
-- G. Reap expired sessions
--
--    Abandoned QR sessions and their orphaned storage objects are
--    removed by a manual call (or a Supabase scheduled function).
--    Only rows that are expired AND never attached to a complaint
--    are touched.
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.kiosk_cleanup_expired_uploads()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_paths text[];
  v_count integer;
BEGIN
  SELECT coalesce(array_agg(f.storage_path), ARRAY[]::text[])
    INTO v_paths
    FROM public.kiosk_upload_session_files f
    JOIN public.kiosk_upload_sessions s ON s.id = f.session_id
   WHERE s.expires_at < now()
     AND s.consumed_at IS NULL
     AND f.attached_at IS NULL;

  DELETE FROM public.kiosk_upload_session_files f
   USING public.kiosk_upload_sessions s
   WHERE s.id = f.session_id
     AND s.expires_at < now()
     AND s.consumed_at IS NULL
     AND f.attached_at IS NULL;

  DELETE FROM public.kiosk_upload_sessions
   WHERE expires_at < now()
     AND consumed_at IS NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- Storage objects are removed by the Dashboard / Storage API
  -- because storage.objects is not writable from plpgsql here.
  -- The returned paths are what an operator must delete, or what
  -- a service-role scheduled function should delete.
  RETURN jsonb_build_object(
    'sessions_removed', v_count,
    'orphaned_storage_paths', to_jsonb(v_paths)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.kiosk_cleanup_expired_uploads() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kiosk_cleanup_expired_uploads() TO service_role;

-- ──────────────────────────────────────────────────────────────
-- H. Verification
-- ──────────────────────────────────────────────────────────────
-- SELECT p.proname
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--  WHERE n.nspname = 'public' AND p.proname LIKE 'kiosk_%'
--  ORDER BY 1;
-- Expect 12 functions.
--
-- SELECT has_function_privilege('anon', 'public.kiosk_status_payload(uuid)', 'EXECUTE');
-- Must be false.
