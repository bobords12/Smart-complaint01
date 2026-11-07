-- ============================================================
-- kiosk-07-tracking-documents.sql
-- Purpose: Extend the resident-safe tracking payload with the
--          Barangay Case Number, the official-received timestamp
--          and a list of documents the barangay has shared with
--          the resident, and add the token-verified document
--          access RPC the kiosk route signs URLs with.
--
-- PRIVACY RULES PRESERVED:
--   * kiosk_status_payload() still assembles an explicit
--     allow-list. Three NEW keys are added and nothing else:
--       barangay_case_number, official_received_at, documents.
--   * The documents array carries DISPLAY METADATA ONLY. It never
--     contains storage_path, filename, uploaded_by or
--     content_snapshot. A document is downloadable only through
--     public.kiosk_document_access(), which re-checks the token,
--     the complaint ownership, the visibility and an allow-list of
--     document types before returning a private storage path.
--   * A Respondent Summons is NEVER exposed. 'summons' is not in
--     the document type allow-list in either function.
--
-- PREREQUISITES: kiosk-01 .. kiosk-06, and
--                reklamo-form-document-workflow.sql (for
--                complaints.barangay_case_number /
--                official_received_at and official_documents.version,
--                document_status, generated_at).
--
-- HOW TO APPLY: paste the whole file into the Supabase SQL Editor
--               and Run. It is idempotent (CREATE OR REPLACE only).
-- ============================================================


-- ──────────────────────────────────────────────────────────────
-- A. Resident-safe tracking payload (extended)
--
--    This is the kiosk-04 body VERBATIM plus three additions:
--      1. barangay_case_number / official_received_at are read off
--         the complaint row,
--      2. v_documents is built from an allow-listed, resident-visible
--         subset of official_documents,
--      3. those three keys are added to the returned JSON object.
--    No existing key changes shape, so older clients keep working.
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
  v_documents   jsonb;

  -- Typed scalars, not `record` (see kiosk-04): a `record` that is
  -- never the target of an executed SELECT INTO raises 55000 on the
  -- first field read.
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
         classification_status,
         barangay_case_number,
         official_received_at
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

  -- Documents the barangay has deliberately shared with residents.
  -- Display metadata only: no storage_path, no filename, no author.
  -- 'summons' is deliberately absent.
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id',              d.id,
           'document_type',   d.document_type,
           'title',           d.title,
           'version',         d.version,
           'document_status', d.document_status,
           'mime_type',       d.mime_type,
           'file_size',       d.file_size,
           'shared_at',       coalesce(d.generated_at, d.created_at)
         ) ORDER BY d.created_at ASC, d.id ASC), '[]'::jsonb)
    INTO v_documents
    FROM public.official_documents d
   WHERE d.complaint_id = p_complaint_id
     AND d.status = 'active'
     AND d.visibility IN ('resident_visible', 'public')
     AND d.document_type IN ('reklamo_form', 'signed_reklamo_form', 'hearing_notice');

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
    -- The Barangay Case Number is assigned ONCE, only on official
    -- receipt. It stays null until then.
    'barangay_case_number', c.barangay_case_number,
    'official_received_at', c.official_received_at,
    'timeline',           v_timeline,
    'documents',          v_documents,
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
-- B. Token-verified document access
--
--    Given the SAME opaque status token that opens the tracking
--    page, the id of a document listed in that payload, and a
--    device fingerprint, this returns the PRIVATE storage path of
--    that document - and only when every one of these holds:
--
--      * the token hashes to a live, non-revoked, non-expired
--        complaint token,
--      * the document belongs to THAT complaint,
--      * the document is active and resident-visible,
--      * the document type is in the resident allow-list.
--
--    It is granted to service_role ONLY. The browser never calls
--    it: the kiosk route handler calls it with the service-role
--    key and returns a short-lived signed URL, so a storage path
--    never reaches the client.
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.kiosk_document_access(
  p_token       text,
  p_document_id uuid,
  p_fingerprint text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id       uuid;
  v_path     text;
  v_filename text;
  v_mime     text;
BEGIN
  IF NOT public.kiosk_check_rate_limit(
       'doc_access:' || coalesce(p_fingerprint, ''), 60, 3600
     ) THEN
    RAISE EXCEPTION 'Too many requests. Please wait before trying again.';
  END IF;

  IF p_token IS NULL
     OR length(p_token) < 32
     OR length(p_token) > 128
     OR p_document_id IS NULL THEN
    RETURN jsonb_build_object('state', 'not_found');
  END IF;

  SELECT id INTO v_id
    FROM public.complaints
   WHERE kiosk_status_token_hash =
           public.kiosk_sha256(reference_number || ':' || p_token)
     AND kiosk_status_token_revoked_at IS NULL
     AND kiosk_status_token_expires_at > now()
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'not_found');
  END IF;

  SELECT storage_path, filename, mime_type
    INTO v_path, v_filename, v_mime
    FROM public.official_documents
   WHERE id = p_document_id
     AND complaint_id = v_id
     AND status = 'active'
     AND visibility IN ('resident_visible', 'public')
     AND document_type IN ('reklamo_form', 'signed_reklamo_form', 'hearing_notice')
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'not_found');
  END IF;

  RETURN jsonb_build_object(
    'state',        'ok',
    'storage_path', v_path,
    'filename',     v_filename,
    'mime_type',    v_mime
  );
END;
$$;

REVOKE ALL ON FUNCTION public.kiosk_document_access(text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kiosk_document_access(text, uuid, text) TO service_role;


-- ──────────────────────────────────────────────────────────────
-- C. Verification
-- ──────────────────────────────────────────────────────────────
-- SELECT has_function_privilege('anon', 'public.kiosk_document_access(text,uuid,text)', 'EXECUTE');
-- Expect false.
--
-- SELECT public.kiosk_status_payload(c.id) -> 'barangay_case_number' AS case_no,
--        jsonb_array_length(public.kiosk_status_payload(c.id) -> 'documents') AS docs
--   FROM public.complaints c
--  WHERE c.submission_channel = 'kiosk'
--  ORDER BY c.submitted_at DESC
--  LIMIT 5;
