CREATE TABLE IF NOT EXISTS hearings (
  id            uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  complaint_id  uuid NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
  hearing_type  text NOT NULL DEFAULT 'Mediation',
  title         text NOT NULL,
  hearing_date  date NOT NULL,
  hearing_time  time,
  venue         text NOT NULL DEFAULT 'Barangay Abuno Hall',
  status        hearing_status NOT NULL DEFAULT 'Upcoming',
  instructions  text,
  created_by    uuid REFERENCES profiles(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hearings_complaint_id ON hearings(complaint_id);
CREATE INDEX IF NOT EXISTS idx_hearings_date ON hearings(hearing_date);

ALTER TABLE hearings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Residents read hearings for own complaints"
  ON hearings FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM complaints
      WHERE complaints.id = hearings.complaint_id
        AND complaints.resident_id = auth.uid()
    )
  );

CREATE TABLE IF NOT EXISTS summons (
  id            uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  complaint_id  uuid NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
  hearing_id    uuid REFERENCES hearings(id) ON DELETE SET NULL,
  storage_path  text NOT NULL,
  issued_at     timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE summons ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Residents read summons for own complaints"
  ON summons FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM complaints
      WHERE complaints.id = summons.complaint_id
        AND complaints.resident_id = auth.uid()
    )
  );
