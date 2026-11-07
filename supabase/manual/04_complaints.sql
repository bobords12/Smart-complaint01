CREATE TABLE IF NOT EXISTS complaints (
  id                    uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  resident_id           uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  reference_number      text UNIQUE NOT NULL,
  title                 text NOT NULL,
  description           text NOT NULL,
  incident_date         date,
  incident_time         time,
  incident_location     text,
  persons_involved      text,
  witnesses             text,

  -- Predicted (AI classification — recommendations only)
  predicted_category    case_category,
  predicted_case_type   case_category,
  predicted_urgency     urgency_level,
  prediction_confidence numeric(5,4),
  prediction_model      text DEFAULT 'tfidf-nb-v1',

  -- Confirmed (official barangay values)
  confirmed_category    case_category,
  confirmed_case_type   case_category,
  confirmed_urgency     urgency_level,

  -- Status tracking
  current_status        complaint_status NOT NULL DEFAULT 'Pending Review',
  current_stage         text NOT NULL DEFAULT 'Pending Review',

  -- Timestamps
  submitted_at          timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  resolved_at           timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_complaints_reference_number ON complaints(reference_number);
CREATE INDEX IF NOT EXISTS idx_complaints_resident_id ON complaints(resident_id);
CREATE INDEX IF NOT EXISTS idx_complaints_status ON complaints(current_status);

ALTER TABLE complaints ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Residents read own complaints"
  ON complaints FOR SELECT
  USING (auth.uid() = resident_id);

CREATE POLICY "Residents insert own complaints"
  ON complaints FOR INSERT
  WITH CHECK (auth.uid() = resident_id);


