-- ============================================================
-- 09_case_inquiries.sql
-- Purpose: Resident-initiated inquiries about their complaints.
-- Safety:  residents create inquiries for own complaints only;
--          official responses are protected from client edits.
-- ============================================================

CREATE TABLE IF NOT EXISTS case_inquiries (
  id            uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  complaint_id  uuid NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
  resident_id   uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  subject       text NOT NULL,
  message       text NOT NULL,
  response      text,
  responded_by  uuid REFERENCES profiles(id),
  status        inquiry_status NOT NULL DEFAULT 'Open',
  responded_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_case_inquiries_complaint_id ON case_inquiries(complaint_id);
CREATE INDEX IF NOT EXISTS idx_case_inquiries_resident_id ON case_inquiries(resident_id);

ALTER TABLE case_inquiries ENABLE ROW LEVEL SECURITY;

-- Residents can read their own inquiries
CREATE POLICY "Residents read own inquiries"
  ON case_inquiries FOR SELECT
  USING (auth.uid() = resident_id);

-- Residents can create inquiries for their own complaints
CREATE POLICY "Residents insert own inquiries"
  ON case_inquiries FOR INSERT
  WITH CHECK (
    auth.uid() = resident_id
    AND EXISTS (
      SELECT 1 FROM complaints
      WHERE complaints.id = case_inquiries.complaint_id
        AND complaints.resident_id = auth.uid()
    )
  );

-- Residents must not update inquiries (official responses are staff-only)
