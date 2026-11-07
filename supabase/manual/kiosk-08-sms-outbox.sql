-- ============================================================
-- kiosk-08-sms-outbox.sql
-- Purpose: The durable outbox that makes the kiosk confirmation
--          SMS happen exactly once, and only for a complaint that
--          was really filed.
--
-- WHY AN OUTBOX AND NOT A DIRECT SEND:
--   The complaint and the SMS must not be able to disagree. If the
--   server called PhilSMS first and the database write failed
--   afterwards, the citizen would receive a reference number that
--   does not exist. If the database write succeeded and the send
--   failed, the citizen would wait for a message that never comes.
--
--   So the filing writes ONE row into an outbox table in the same
--   transaction as the complaint. The outbox row is the promise. A
--   separate worker delivers the promise, at its own pace, and
--   records what happened to it. Nothing is ever sent for a
--   complaint that was not filed, and nothing is lost because a
--   network call failed.
--
-- WHY THIS IS THE ONLY WRITE PATH:
--   The trigger below is what enqueues a job. A second, idempotent
--   function exists purely to REPAIR the outbox (for instance if
--   the trigger was missing when a complaint was filed) and it
--   resolves to the same single row thanks to the unique key on
--   (complaint_id, notification_type).
--
-- WHO CAN READ THE OUTBOX:
--   Nobody except the service role. The table holds phone numbers
--   and message bodies, so it is revoked from anon and
--   authenticated and RLS is enabled with no policies at all.
--
-- PREREQUISITES:
--   kiosk-01-schema-support.sql   (filing_channel, kiosk columns)
--   kiosk-02-secure-idempotent-submission.sql
--                                  (kiosk_normalize_mobile)
--
-- NOT APPLIED YET. Review before running.
-- ============================================================

-- ──────────────────────────────────────────────────────────────
-- A. The outbox table
--
-- One row per (complaint, notification type). The unique key is
-- the whole duplicate-prevention story at the database level: a
-- double-clicked Submit, a retried request and a replayed offline
-- queue entry all resolve to the SAME row.
--
-- status values:
--   pending    waiting to be picked up
--   sending    claimed by a worker right now
--   retry      the provider refused in a way worth retrying
--   sent       the provider accepted the message
--   failed     the provider refused it, or it will not be retried
--   uncertain  the outcome of the send is UNKNOWN. Never resent.
--   skipped    there was nothing to send to
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.kiosk_sms_outbox (
  id                  uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  complaint_id        uuid NOT NULL REFERENCES public.complaints(id) ON DELETE CASCADE,
  notification_type   text NOT NULL DEFAULT 'complaint_submitted',
  recipient           text NOT NULL,
  recipient_format    text NOT NULL DEFAULT '63',
  reference_number    text,
  status              text NOT NULL DEFAULT 'pending',
  attempts            integer NOT NULL DEFAULT 0,
  next_attempt_at     timestamptz NOT NULL DEFAULT now(),
  locked_at           timestamptz,
  provider_message_id text,
  provider_status     text,
  message             text,
  last_error_code     text,
  last_error_message  text,
  sent_at             timestamptz,
  delivered_at        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT kiosk_sms_outbox_unique_job
    UNIQUE (complaint_id, notification_type),

  CONSTRAINT kiosk_sms_outbox_status_check
    CHECK (status IN ('pending', 'sending', 'retry', 'sent', 'failed', 'uncertain', 'skipped')),

  CONSTRAINT kiosk_sms_outbox_recipient_format_check
    CHECK (recipient_format IN ('63', '+63')),

  CONSTRAINT kiosk_sms_outbox_attempts_check
    CHECK (attempts >= 0)
);

COMMENT ON TABLE public.kiosk_sms_outbox IS
  'Durable outbox for kiosk confirmation SMS. One row per (complaint_id, notification_type).';
COMMENT ON COLUMN public.kiosk_sms_outbox.status IS
  '''uncertain'' means the outcome of a send is unknown; such a row is never sent again.';

-- The worker polls on (status, next_attempt_at).
CREATE INDEX IF NOT EXISTS idx_kiosk_sms_outbox_pending
  ON public.kiosk_sms_outbox (status, next_attempt_at);

CREATE INDEX IF NOT EXISTS idx_kiosk_sms_outbox_stale
  ON public.kiosk_sms_outbox (locked_at)
  WHERE status = 'sending';

-- ──────────────────────────────────────────────────────────────
-- B. The enqueue trigger
--
-- Fires after every complaint insert. It enqueues ONLY kiosk
-- filings: every other portal keeps its own notification flow and
-- must not start receiving SMS because of this change.
--
-- It runs as SECURITY DEFINER so it can write the outbox row
-- regardless of the caller's RLS context, and so that the kiosk
-- still needs no direct table privilege.
--
-- A filing without a usable mobile number enqueues nothing at all.
-- There is no number to send to, and a job that can never succeed
-- would only sit in the queue forever.
--
-- The confirmation SMS is a courtesy on top of a filing that has
-- already succeeded. If anything goes wrong while the job is being
-- written -- the normalizer is missing, the outbox rejects the row,
-- a future schema change breaks the insert -- the citizen's
-- complaint must still commit. The whole SMS-specific block is
-- therefore guarded, and the handler only warns. It logs the
-- complaint id, the SQLSTATE and the constraint name: identifiers an
-- operator needs to repair the job, never the mobile number, the
-- reference number or any complaint content.
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.kiosk_enqueue_confirmation_sms_on_complaint()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mobile text;
  v_sqlstate text;
  v_constraint text;
BEGIN
  IF NEW.filing_channel IS DISTINCT FROM 'kiosk' THEN
    RETURN NEW;
  END IF;

  BEGIN
    v_mobile := public.kiosk_normalize_mobile(NEW.complainant_snapshot->>'mobile_number');

    -- kiosk_normalize_mobile() returns the digits it could make sense
    -- of, and NULL only for an empty value. The shape check is what
    -- rejects a number that is not a Philippine mobile number.
    IF v_mobile IS NULL OR v_mobile !~ '^09[0-9]{9}$' THEN
      RETURN NEW;
    END IF;

    INSERT INTO public.kiosk_sms_outbox (
      complaint_id,
      notification_type,
      recipient,
      recipient_format,
      reference_number,
      status,
      next_attempt_at
    )
    VALUES (
      NEW.id,
      'complaint_submitted',
      v_mobile,
      '63',
      NEW.reference_number,
      'pending',
      now()
    )
    ON CONFLICT (complaint_id, notification_type) DO NOTHING;

    RETURN NEW;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS
      v_sqlstate = RETURNED_SQLSTATE,
      v_constraint = CONSTRAINT_NAME;

    RAISE WARNING
      'kiosk sms enqueue skipped for complaint % (sqlstate %, constraint %)',
      NEW.id,
      v_sqlstate,
      coalesce(v_constraint, 'none');

    RETURN NEW;
  END;
END;
$$;

DROP TRIGGER IF EXISTS trg_kiosk_enqueue_confirmation_sms ON public.complaints;

CREATE TRIGGER trg_kiosk_enqueue_confirmation_sms
AFTER INSERT ON public.complaints
FOR EACH ROW
EXECUTE FUNCTION public.kiosk_enqueue_confirmation_sms_on_complaint();

-- ──────────────────────────────────────────────────────────────
-- C. The repair function
--
-- The Next.js server calls this right after a complaint is
-- committed. It is idempotent: if the trigger already created the
-- row, this finds the same row and changes nothing.
--
-- It returns a small JSON object so the caller can tell the kiosk
-- that a message is on its way WITHOUT ever telling the citizen
-- that a message was delivered:
--
--   queued = true   a job exists and is still going to be attempted
--   queued = false  and a reason:
--                     complaint_not_found
--                     not_a_kiosk_filing
--                     no_mobile_number
--                     already_sent
--                     delivery_unknown
--                     already_failed
--
-- 'delivery_unknown' is the 'uncertain' state: a previous send may
-- or may not have reached the phone. The honest answer is silence,
-- not a promise.
--
-- Only the service role may call it. The kiosk itself never does:
-- the kiosk's own write path already produced the outbox row.
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.kiosk_enqueue_confirmation_sms(
  p_complaint_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_complaint public.complaints%ROWTYPE;
  v_mobile text;
  v_job public.kiosk_sms_outbox%ROWTYPE;
BEGIN
  SELECT * INTO v_complaint
  FROM public.complaints
  WHERE id = p_complaint_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'queued', false, 'status', NULL, 'reason', 'complaint_not_found');
  END IF;

  IF v_complaint.filing_channel IS DISTINCT FROM 'kiosk' THEN
    RETURN jsonb_build_object(
      'queued', false, 'status', NULL, 'reason', 'not_a_kiosk_filing');
  END IF;

  v_mobile := public.kiosk_normalize_mobile(v_complaint.complainant_snapshot->>'mobile_number');

  IF v_mobile IS NULL OR v_mobile !~ '^09[0-9]{9}$' THEN
    RETURN jsonb_build_object(
      'queued', false, 'status', NULL, 'reason', 'no_mobile_number');
  END IF;

  INSERT INTO public.kiosk_sms_outbox (
    complaint_id,
    notification_type,
    recipient,
    recipient_format,
    reference_number,
    status,
    next_attempt_at
  )
  VALUES (
    v_complaint.id,
    'complaint_submitted',
    v_mobile,
    '63',
    v_complaint.reference_number,
    'pending',
    now()
  )
  ON CONFLICT (complaint_id, notification_type) DO NOTHING;

  SELECT * INTO v_job
  FROM public.kiosk_sms_outbox
  WHERE complaint_id = p_complaint_id
    AND notification_type = 'complaint_submitted';

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'queued', false, 'status', NULL, 'reason', 'enqueue_failed');
  END IF;

  RETURN jsonb_build_object(
    'queued',
      v_job.status IN ('pending', 'sending', 'retry'),
    'id', v_job.id,
    'status', v_job.status,
    'reference_number', v_job.reference_number,
    'reason',
      CASE v_job.status
        WHEN 'sent'      THEN 'already_sent'
        WHEN 'uncertain' THEN 'delivery_unknown'
        WHEN 'failed'    THEN 'already_failed'
        WHEN 'skipped'   THEN 'already_skipped'
        ELSE NULL
      END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.kiosk_enqueue_confirmation_sms(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kiosk_enqueue_confirmation_sms(uuid) TO service_role;

-- ──────────────────────────────────────────────────────────────
-- D. Locking down the table
--
-- The outbox holds phone numbers and the exact text that was sent.
-- anon and authenticated get nothing; the service role bypasses
-- RLS by design and is the only role that reads or writes it.
-- ──────────────────────────────────────────────────────────────
ALTER TABLE public.kiosk_sms_outbox ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.kiosk_sms_outbox FROM anon, authenticated;
GRANT ALL ON TABLE public.kiosk_sms_outbox TO service_role;

-- The trigger function is only ever called by the trigger itself.
REVOKE ALL ON FUNCTION public.kiosk_enqueue_confirmation_sms_on_complaint() FROM PUBLIC, anon, authenticated;

-- ──────────────────────────────────────────────────────────────
-- E. Verification
--
-- Run these after applying. They answer the questions that matter:
-- does the table exist, is it locked down, does the trigger exist,
-- and does a filing produce exactly ONE job.
-- ──────────────────────────────────────────────────────────────
--
-- 1. The table and its constraints.
--
-- SELECT conname, pg_get_constraintdef(oid)
--   FROM pg_constraint
--  WHERE conrelid = 'public.kiosk_sms_outbox'::regclass
--  ORDER BY conname;
-- Expect: kiosk_sms_outbox_unique_job, kiosk_sms_outbox_status_check,
--         kiosk_sms_outbox_recipient_format_check,
--         kiosk_sms_outbox_attempts_check.
--
-- 2. The trigger.
--
-- SELECT tgname, pg_get_triggerdef(oid)
--   FROM pg_trigger
--  WHERE tgrelid = 'public.complaints'::regclass
--    AND NOT tgisinternal;
-- Expect: trg_kiosk_enqueue_confirmation_sms.
--
-- 3. The privileges. The second and third queries must be FALSE.
--
-- SELECT has_table_privilege('anon', 'public.kiosk_sms_outbox', 'SELECT');
-- SELECT has_table_privilege('authenticated', 'public.kiosk_sms_outbox', 'SELECT');
--
-- 4. The function privileges. The first must be FALSE, the second TRUE.
--
-- SELECT has_function_privilege(
--   'anon', 'public.kiosk_enqueue_confirmation_sms(uuid)', 'EXECUTE');
-- SELECT has_function_privilege(
--   'service_role', 'public.kiosk_enqueue_confirmation_sms(uuid)', 'EXECUTE');
--
-- 5. A real filing produces exactly one job, and calling the repair
--    function again does not create a second one.
--
-- BEGIN;
-- SELECT id, reference_number, filing_channel
--   FROM public.complaints
--  WHERE filing_channel = 'kiosk'
--  ORDER BY submitted_at DESC
--  LIMIT 1;
--
-- SELECT count(*) FROM public.kiosk_sms_outbox
--  WHERE complaint_id = '<that id>';
-- Expect: 1
--
-- SELECT public.kiosk_enqueue_confirmation_sms('<that id>');
-- Expect: queued = true, status = 'pending' (or 'sent' if it already went).
--
-- SELECT count(*) FROM public.kiosk_sms_outbox
--  WHERE complaint_id = '<that id>';
-- Expect: still 1
-- ROLLBACK;
--
-- 6. Every kiosk complaint has exactly one job, and no other
--    complaint has any.
--
-- SELECT c.filing_channel,
--        count(DISTINCT c.id)                                        AS complaints,
--        count(o.id)                                                  AS jobs
--   FROM public.complaints c
--   LEFT JOIN public.kiosk_sms_outbox o
--          ON o.complaint_id = c.id
--          AND o.notification_type = 'complaint_submitted'
--  WHERE c.filing_channel = 'kiosk'
--  GROUP BY c.filing_channel;
--
-- 7. The job ledger, for the thesis appendix.
--
-- SELECT status,
--        count(*),
--        min(created_at) AS oldest,
--        max(updated_at) AS newest
--   FROM public.kiosk_sms_outbox
--  WHERE notification_type = 'complaint_submitted'
--  GROUP BY status
--  ORDER BY status;
