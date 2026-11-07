-- ============================================================
-- kiosk-01-schema-support.sql
-- Purpose: Non-destructive schema support for the Barangay Abuno
--          Public Complaint Kiosk.
--
-- pgcrypto: the kiosk must store only SHA-256 HASHES of the QR
--   status token and the QR upload token, never the tokens
--   themselves. Postgres has no built-in SHA-256, so pgcrypto is
--   enabled here. It is additive (IF NOT EXISTS) and is placed in
--   the same "extensions" schema the project already uses for
--   uuid-ossp and pg_trgm. If the hosted project already has
--   pgcrypto in another schema, public.kiosk_sha256() below finds
--   it there instead.
--
-- WHAT THIS ADDS (all additive):
--   1. 'kiosk' added to complaints.filing_channel and
--      complaints.source. Existing values are preserved.
--   2. Kiosk columns on complaints (idempotency key, status
--      token hash, other-party status, consent timestamps,
--      classification status, offline-sync bookkeeping).
--   3. kiosk_upload_sessions + kiosk_upload_session_files for
--      the QR evidence-upload flow.
--   4. kiosk_rate_limits for submission / lookup throttling.
--   5. evidence.uploaded_by relaxed from NOT NULL to nullable so
--      a complaint can carry evidence filed by an anonymous
--      walk-in who has no profiles row. The existing
--      "auth.uid() = uploaded_by" policies are unaffected
--      because auth.uid() is NULL for anon.
--
-- NO new complaint / evidence / profile / notification / audit
-- table is created. Everything reuses the existing schema.
--
-- PREREQUISITES:
--   01_extensions_and_enums.sql ... 23_staff_assisted_complaint_filing.sql
--   and captain-portal-schema-additions.sql must already be applied.
--
-- HOW TO APPLY:
--   Supabase Dashboard > SQL Editor > New query > paste > Run.
--   Safe to run more than once.
--
-- EXECUTION ORDER IN THIS KIOSK SERIES:
--   kiosk-01 -> kiosk-02 -> kiosk-03 -> kiosk-04 -> kiosk-05 -> kiosk-06
-- ============================================================

-- ──────────────────────────────────────────────────────────────
-- A0. Hashing support
-- ──────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- Schema-tolerant SHA-256. Supabase normally exposes pgcrypto in
-- "extensions", but a project that installed it elsewhere must
-- keep working, so both locations are probed at call time.
CREATE OR REPLACE FUNCTION public.kiosk_sha256(p_text text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_bytes bytea := convert_to(coalesce(p_text, ''), 'UTF8');
BEGIN
  IF to_regprocedure('extensions.digest(bytea,text)') IS NOT NULL THEN
    RETURN encode(extensions.digest(v_bytes, 'sha256'), 'hex');
  END IF;

  IF to_regprocedure('public.digest(bytea,text)') IS NOT NULL THEN
    RETURN encode(public.digest(v_bytes, 'sha256'), 'hex');
  END IF;

  RAISE EXCEPTION
    'pgcrypto is required. Run: CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;';
END;
$$;

-- ──────────────────────────────────────────────────────────────
-- A. Widen the filing_channel and source domains to include kiosk
--    Both are plain CHECK constraints, not enum types, so
--    extending them cannot invalidate stored values. Every
--    pre-existing value ('online', 'staff_assisted',
--    'barangay_hall', 'resident_portal', 'manual') is kept.
-- ──────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'complaints_filing_channel_check'
      AND conrelid = 'public.complaints'::regclass
  ) THEN
    ALTER TABLE public.complaints DROP CONSTRAINT complaints_filing_channel_check;
  END IF;

  ALTER TABLE public.complaints
    ADD CONSTRAINT complaints_filing_channel_check
    CHECK (filing_channel IN ('online', 'staff_assisted', 'barangay_hall', 'kiosk'));
END
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'complaints_source_check'
      AND conrelid = 'public.complaints'::regclass
  ) THEN
    ALTER TABLE public.complaints DROP CONSTRAINT complaints_source_check;
  END IF;

  ALTER TABLE public.complaints
    ADD CONSTRAINT complaints_source_check
    CHECK (source IN ('resident_portal', 'staff_assisted', 'manual', 'kiosk'));
END
$$;

-- ──────────────────────────────────────────────────────────────
-- B. Kiosk columns on complaints
--
--    Design notes:
--    * kiosk_client_submission_id is the client-generated UUID
--      used as the idempotency key. The unique index in section
--      C is what makes a double-tap or an offline retry safe:
--      a second insert with the same key collides instead of
--      creating a second complaint.
--    * kiosk_status_token_hash stores ONLY a SHA-256 hash. The
--      raw token is returned to the kiosk exactly once and is
--      never stored anywhere in the database.
--    * classification_* holds the TF-IDF + SVM suggestion only.
--      confirmed_category / confirmed_urgency (existing columns)
--      remain the official values and stay NULL until an
--      authorised official confirms them.
-- ──────────────────────────────────────────────────────────────
ALTER TABLE public.complaints
  ADD COLUMN IF NOT EXISTS kiosk_client_submission_id  uuid,
  ADD COLUMN IF NOT EXISTS kiosk_fingerprint           text,
  ADD COLUMN IF NOT EXISTS kiosk_status_token_hash     text,
  ADD COLUMN IF NOT EXISTS kiosk_status_token_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS kiosk_status_token_revoked_at timestamptz,
  ADD COLUMN IF NOT EXISTS kiosk_draft_reference       text,
  ADD COLUMN IF NOT EXISTS other_party_status          text
    DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS incident_ongoing            boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS immediate_safety_concern    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS kiosk_submitted_offline     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS kiosk_sync_status           text
    DEFAULT 'synced',
  ADD COLUMN IF NOT EXISTS kiosk_queued_at             timestamptz,
  ADD COLUMN IF NOT EXISTS kiosk_synced_at             timestamptz,
  ADD COLUMN IF NOT EXISTS privacy_consent_at          timestamptz,
  ADD COLUMN IF NOT EXISTS accuracy_confirmation_at    timestamptz,
  ADD COLUMN IF NOT EXISTS classification_status       text
    DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS classification_model        text,
  ADD COLUMN IF NOT EXISTS classification_at           timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'complaints_other_party_status_check'
      AND conrelid = 'public.complaints'::regclass
  ) THEN
    ALTER TABLE public.complaints
      ADD CONSTRAINT complaints_other_party_status_check
      CHECK (other_party_status IN ('known', 'unknown', 'not_applicable'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'complaints_kiosk_sync_status_check'
      AND conrelid = 'public.complaints'::regclass
  ) THEN
    ALTER TABLE public.complaints
      ADD CONSTRAINT complaints_kiosk_sync_status_check
      CHECK (kiosk_sync_status IN
        ('pending_sync', 'syncing', 'synced', 'sync_failed', 'needs_attention'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'complaints_classification_status_check'
      AND conrelid = 'public.complaints'::regclass
  ) THEN
    ALTER TABLE public.complaints
      ADD CONSTRAINT complaints_classification_status_check
      CHECK (classification_status IN
        ('pending', 'suggested', 'confirmed', 'unavailable'));
  END IF;
END
$$;

-- Idempotency key. Partial so that pre-kiosk rows (NULL) are
-- never in conflict with each other.
CREATE UNIQUE INDEX IF NOT EXISTS idx_complaints_kiosk_client_submission_id
  ON public.complaints (kiosk_client_submission_id)
  WHERE kiosk_client_submission_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_complaints_kiosk_status_token_hash
  ON public.complaints (kiosk_status_token_hash)
  WHERE kiosk_status_token_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_complaints_filing_submitted
  ON public.complaints (filing_channel, submitted_at DESC);

-- ──────────────────────────────────────────────────────────────
-- C. Kiosk evidence support on the EXISTING evidence table
--
--    evidence.uploaded_by is currently NOT NULL REFERENCES
--    profiles(id). A public kiosk complainant has no profiles
--    row, so the column is relaxed to nullable.
--
--    This does not weaken the existing resident policies:
--    "Residents insert own complaint evidence" requires
--    auth.uid() = uploaded_by, which can never be NULL for an
--    authenticated resident, and stays false for anon.
--
--    kiosk_evidence marks the row as kiosk-origin so officials
--    can tell walk-in kiosk evidence apart from staff-encoded
--    evidence, and kiosk_upload_session_id links it back to the
--    QR session that delivered the bytes.
-- ──────────────────────────────────────────────────────────────
ALTER TABLE public.evidence
  ADD COLUMN IF NOT EXISTS kiosk_evidence          boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS kiosk_upload_session_id uuid;

ALTER TABLE public.evidence
  ALTER COLUMN uploaded_by DROP NOT NULL;

-- ──────────────────────────────────────────────────────────────
-- D. QR evidence upload sessions
--
--    The kiosk asks for a session BEFORE the complaint exists,
--    because the resident may scan the QR and upload from a
--    phone while the kiosk is still on the wizard.
--
--    Two identifiers, deliberately different:
--      * draft_reference  - random, NOT secret. It appears in
--                            the storage path
--                            kiosk/{draft_reference}/{file}.
--                            The storage INSERT policy validates
--                            it against this table.
--      * token_hash       - SHA-256 of the secret token that is
--                            the only thing placed in the QR
--                            code. The raw token is never stored.
--
--    A session expires (default 10 minutes) and is revoked on
--    submission, cancellation, or explicit user action.
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.kiosk_upload_sessions (
  id               uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  draft_reference  text NOT NULL UNIQUE,
  token_hash       text NOT NULL,
  expires_at       timestamptz NOT NULL,
  revoked_at       timestamptz,
  consumed_at      timestamptz,
  complaint_id     uuid REFERENCES public.complaints(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kiosk_upload_sessions_token_hash
  ON public.kiosk_upload_sessions (token_hash);
CREATE INDEX IF NOT EXISTS idx_kiosk_upload_sessions_expiry
  ON public.kiosk_upload_sessions (expires_at);

-- Files received through a QR session. The storage object is the
-- real file; this table is only the manifest the kiosk polls to
-- learn that a phone delivered something.
CREATE TABLE IF NOT EXISTS public.kiosk_upload_session_files (
  id                uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  session_id        uuid NOT NULL
                      REFERENCES public.kiosk_upload_sessions(id) ON DELETE CASCADE,
  storage_path      text NOT NULL,
  original_filename text NOT NULL,
  mime_type         text NOT NULL,
  file_size         bigint NOT NULL,
  received_at       timestamptz NOT NULL DEFAULT now(),
  attached_at       timestamptz
);

CREATE INDEX IF NOT EXISTS idx_kiosk_upload_session_files_session
  ON public.kiosk_upload_session_files (session_id);

ALTER TABLE public.evidence
  DROP CONSTRAINT IF EXISTS evidence_kiosk_upload_session_id_fkey;
ALTER TABLE public.evidence
  ADD CONSTRAINT evidence_kiosk_upload_session_id_fkey
  FOREIGN KEY (kiosk_upload_session_id)
  REFERENCES public.kiosk_upload_sessions(id) ON DELETE SET NULL;

-- ──────────────────────────────────────────────────────────────
-- E. Rate limiting
--
--    key is a hash produced by the Next.js route handler from the
--    request IP and user agent. It is NOT a security boundary on
--    its own (a caller can rotate its user agent) — it stops
--    casual hammering of a public endpoint. See
--    KIOSK_SETUP_GUIDE.md for the recommended edge/WAF limit.
--
--    The table is never readable by anon or authenticated; only
--    the kiosk_check_rate_limit() helper touches it.
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.kiosk_rate_limits (
  key           text PRIMARY KEY,
  count         integer NOT NULL DEFAULT 0,
  window_start  timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.kiosk_rate_limits ENABLE ROW LEVEL SECURITY;
-- Deliberately no policies. No role can read or write this table
-- directly; only SECURITY DEFINER functions may.

-- ──────────────────────────────────────────────────────────────
-- F. RLS on the new tables
--
--    kiosk_upload_sessions and its file manifest are reached only
--    through SECURITY DEFINER functions that check the secret
--    token. No anon or authenticated SELECT policy exists, so a
--    leaked draft_reference is still not enough to read a
--    session.
-- ──────────────────────────────────────────────────────────────
ALTER TABLE public.kiosk_upload_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kiosk_upload_session_files ENABLE ROW LEVEL SECURITY;

-- ──────────────────────────────────────────────────────────────
-- G. Verification (run after applying; expect 18 columns)
-- ──────────────────────────────────────────────────────────────
-- SELECT column_name FROM information_schema.columns
-- WHERE table_name = 'complaints'
--   AND column_name IN (
--     'kiosk_client_submission_id','kiosk_fingerprint',
--     'kiosk_status_token_hash','kiosk_status_token_expires_at',
--     'kiosk_status_token_revoked_at','kiosk_draft_reference',
--     'other_party_status','incident_ongoing',
--     'immediate_safety_concern','kiosk_submitted_offline',
--     'kiosk_sync_status','kiosk_queued_at','kiosk_synced_at',
--     'privacy_consent_at','accuracy_confirmation_at',
--     'classification_status','classification_model',
--     'classification_at'
--   )
-- ORDER BY column_name;
