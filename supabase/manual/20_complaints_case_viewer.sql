-- ============================================================
-- 20_complaints_case_viewer.sql
-- Purpose: Add the tables the Captain complaints case viewer
--          requires which are not yet present in the schema:
--            * internal_notes            (footer "Add Internal Note")
--            * hearing_attendances       (hearing sessions attendance/minutes)
--            * summons_service_records   (proof-of-service records)
--            * document_lifecycle_events (prepared/authorized/signed/
--                                         served/received/finalized/archived)
--          All additive. Includes RLS and audit triggers.
--
-- PREREQUISITES:
--   1. All prior SQL files (01-19) must be applied.
--   2. captain-portal-schema-additions.sql must be applied
--      (defines activity_logs, official_documents, log_activity()).
--
-- HOW TO APPLY:
--   1. Open Supabase Dashboard > SQL Editor
--   2. Paste this entire file
--   3. Click "Run"
--   4. Verify with:
--        SELECT tablename FROM pg_tables
--        WHERE schemaname = 'public'
--          AND tablename IN ('internal_notes','hearing_attendances',
--                            'summons_service_records','document_lifecycle_events');
-- ============================================================

-- ── 1. Internal notes ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS internal_notes (
  id                  uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  complaint_id        uuid NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
  note                text NOT NULL,
  note_type           text NOT NULL DEFAULT 'general'
                      CHECK (note_type IN ('general', 'external_coordination', 'risk_flag', 'critical_advisory')),
  is_resident_visible boolean NOT NULL DEFAULT false,
  author_id           uuid REFERENCES profiles(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_internal_notes_complaint_id ON internal_notes(complaint_id);
CREATE INDEX IF NOT EXISTS idx_internal_notes_author_id ON internal_notes(author_id);

ALTER TABLE internal_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Officials read internal notes"
  ON internal_notes FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('captain', 'oic', 'secretary')
    )
  );

CREATE POLICY "Officials insert internal notes"
  ON internal_notes FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('captain', 'oic', 'secretary')
    )
  );

CREATE POLICY "Officials update internal notes"
  ON internal_notes FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('captain', 'oic', 'secretary')
    )
  );

CREATE POLICY "Residents read visible internal notes"
  ON internal_notes FOR SELECT
  USING (
    is_resident_visible = true
    AND EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role = 'resident'
    )
  );

-- ── 2. Hearing attendance / minutes ─────────────────────────
CREATE TABLE IF NOT EXISTS hearing_attendances (
  id            uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  complaint_id  uuid NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
  hearing_id    uuid NOT NULL REFERENCES hearings(id) ON DELETE CASCADE,
  attendee_label text NOT NULL,
  party_role    text NOT NULL DEFAULT 'party'
                CHECK (party_role IN ('complainant', 'respondent', 'witness',
                                      'lupon_member', 'barangay_official', 'other')),
  attended      boolean NOT NULL DEFAULT true,
  minutes       text,
  recorded_by   uuid REFERENCES profiles(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hearing_attend_complaint_id ON hearing_attendances(complaint_id);
CREATE INDEX IF NOT EXISTS idx_hearing_attend_hearing_id ON hearing_attendances(hearing_id);

ALTER TABLE hearing_attendances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Officials read hearing attendance"
  ON hearing_attendances FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('captain', 'oic', 'secretary')
    )
  );

CREATE POLICY "Officials manage hearing attendance"
  ON hearing_attendances FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('captain', 'oic', 'secretary')
    )
  );

-- ── 3. Summons service records ──────────────────────────────
CREATE TABLE IF NOT EXISTS summons_service_records (
  id                uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  complaint_id      uuid NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
  summons_id        uuid REFERENCES summons(id) ON DELETE CASCADE,
  party_role        text NOT NULL CHECK (party_role IN ('complainant', 'respondent')),
  party_label       text,
  mode_of_service   text,
  served_on         date,
  served_to         text,
  proof_document_id uuid REFERENCES official_documents(id) ON DELETE SET NULL,
  served_by         uuid REFERENCES profiles(id),
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_summons_service_complaint_id ON summons_service_records(complaint_id);
CREATE INDEX IF NOT EXISTS idx_summons_service_summons_id ON summons_service_records(summons_id);

ALTER TABLE summons_service_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Officials read summons service records"
  ON summons_service_records FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('captain', 'oic', 'secretary')
    )
  );

CREATE POLICY "Officials manage summons service records"
  ON summons_service_records FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('captain', 'oic', 'secretary')
    )
  );

-- ── 4. Document lifecycle events ────────────────────────────
CREATE TABLE IF NOT EXISTS document_lifecycle_events (
  id            uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  document_id   uuid NOT NULL REFERENCES official_documents(id) ON DELETE CASCADE,
  complaint_id  uuid NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
  event_type    text NOT NULL
                CHECK (event_type IN ('prepared', 'authorized', 'signed', 'served',
                                      'received', 'finalized', 'archived',
                                      'superseded', 'released', 'uploaded', 'rejected')),
  event_date    timestamptz NOT NULL DEFAULT now(),
  actor_id      uuid REFERENCES profiles(id),
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_doc_lifecycle_document_id ON document_lifecycle_events(document_id);
CREATE INDEX IF NOT EXISTS idx_doc_lifecycle_complaint_id ON document_lifecycle_events(complaint_id);

ALTER TABLE document_lifecycle_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Officials read document lifecycle events"
  ON document_lifecycle_events FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('captain', 'oic', 'secretary')
    )
  );

CREATE POLICY "Officials manage document lifecycle events"
  ON document_lifecycle_events FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('captain', 'oic', 'secretary')
    )
  );

-- ── 5. Audit triggers ───────────────────────────────────────
-- Every official write on the tables above creates an audit
-- entry targeting the complaint, via the existing log_activity().

CREATE OR REPLACE FUNCTION public.trg_audit_internal_note()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.log_activity(
    'internal_note_added',
    'complaint',
    NEW.complaint_id,
    NULL,
    jsonb_build_object(
      'note_type', NEW.note_type,
      'is_resident_visible', NEW.is_resident_visible
    ),
    NULL,
    NULL
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_internal_note ON internal_notes;
CREATE TRIGGER trg_audit_internal_note
AFTER INSERT ON internal_notes
FOR EACH ROW EXECUTE FUNCTION public.trg_audit_internal_note();

CREATE OR REPLACE FUNCTION public.trg_audit_hearing_attendance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.log_activity(
    'hearing_attendance_recorded',
    'complaint',
    NEW.complaint_id,
    NULL,
    jsonb_build_object(
      'attendee', NEW.attendee_label,
      'attended', NEW.attended,
      'party_role', NEW.party_role
    ),
    NULL,
    NULL
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_hearing_attendance ON hearing_attendances;
CREATE TRIGGER trg_audit_hearing_attendance
AFTER INSERT ON hearing_attendances
FOR EACH ROW EXECUTE FUNCTION public.trg_audit_hearing_attendance();

CREATE OR REPLACE FUNCTION public.trg_audit_summons_service()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.log_activity(
    'summons_service_recorded',
    'complaint',
    NEW.complaint_id,
    NULL,
    jsonb_build_object(
      'party_role', NEW.party_role,
      'mode', NEW.mode_of_service,
      'served_on', NEW.served_on
    ),
    NULL,
    NULL
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_summons_service ON summons_service_records;
CREATE TRIGGER trg_audit_summons_service
AFTER INSERT ON summons_service_records
FOR EACH ROW EXECUTE FUNCTION public.trg_audit_summons_service();

CREATE OR REPLACE FUNCTION public.trg_audit_document_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.log_activity(
    'document_' || NEW.event_type,
    'complaint',
    NEW.complaint_id,
    NULL,
    jsonb_build_object(
      'document_id', NEW.document_id,
      'event_type', NEW.event_type,
      'notes', NEW.notes
    ),
    NULL,
    NULL
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_document_lifecycle ON document_lifecycle_events;
CREATE TRIGGER trg_audit_document_lifecycle
AFTER INSERT ON document_lifecycle_events
FOR EACH ROW EXECUTE FUNCTION public.trg_audit_document_lifecycle();

-- ── 6. Complete complaints audit read (immutable, newest-first) ──
-- Officials already have SELECT on activity_logs via
-- captain-portal-schema-additions.sql. Index targets already exist:
--   idx_activity_logs_action, idx_activity_logs_target.