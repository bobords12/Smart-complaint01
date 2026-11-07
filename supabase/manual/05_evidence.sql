CREATE TABLE IF NOT EXISTS evidence (
  id                uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  complaint_id      uuid NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
  uploaded_by       uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  storage_path      text NOT NULL,
  original_filename text NOT NULL,
  mime_type         text NOT NULL,
  file_size         bigint NOT NULL,
  evidence_type     text NOT NULL DEFAULT 'document'
                    CHECK (evidence_type IN ('photo', 'document', 'audio', 'video')),
  description       text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_evidence_complaint_id ON evidence(complaint_id);

ALTER TABLE evidence ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Residents read own complaint evidence"
  ON evidence FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM complaints
      WHERE complaints.id = evidence.complaint_id
        AND complaints.resident_id = auth.uid()
    )
  );

CREATE POLICY "Residents insert own complaint evidence"
  ON evidence FOR INSERT
  WITH CHECK (
    auth.uid() = uploaded_by
    AND EXISTS (
      SELECT 1 FROM complaints
      WHERE complaints.id = evidence.complaint_id
        AND complaints.resident_id = auth.uid()
    )
  );

CREATE POLICY "Residents delete own complaint evidence"
  ON evidence FOR DELETE
  USING (
    auth.uid() = uploaded_by
    AND EXISTS (
      SELECT 1 FROM complaints
      WHERE complaints.id = evidence.complaint_id
        AND complaints.resident_id = auth.uid()
        AND complaints.current_status IN ('Pending Review', 'Received')
    )
  );
