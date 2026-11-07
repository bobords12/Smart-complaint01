CREATE TABLE IF NOT EXISTS complaint_classification_logs (
  id                uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  complaint_id      uuid NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
  predicted_category  case_category,
  predicted_case_type case_category,
  predicted_urgency   urgency_level,
  confidence        numeric(5,4),
  model_version     text DEFAULT 'tfidf-nb-v1',
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_classification_complaint_id ON complaint_classification_logs(complaint_id);

ALTER TABLE complaint_classification_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Residents read classification logs for own complaints"
  ON complaint_classification_logs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM complaints
      WHERE complaints.id = complaint_classification_logs.complaint_id
        AND complaints.resident_id = auth.uid()
    )
  );

CREATE TABLE IF NOT EXISTS complaint_reviews (
  id                uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  complaint_id      uuid UNIQUE NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
  reviewed_by       uuid REFERENCES profiles(id),
  confirmed_category case_category,
  confirmed_case_type case_category,
  confirmed_urgency  urgency_level,
  review_notes      text,
  reviewed_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE complaint_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Residents read review for own complaints"
  ON complaint_reviews FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM complaints
      WHERE complaints.id = complaint_reviews.complaint_id
        AND complaints.resident_id = auth.uid()
    )
  );

CREATE TABLE IF NOT EXISTS case_statuses (
  id                       uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  complaint_id             uuid NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
  status                   complaint_status NOT NULL,
  stage                    text,
  resident_visible_message text,
  changed_by               uuid REFERENCES profiles(id),
  created_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_case_statuses_complaint_id ON case_statuses(complaint_id);

ALTER TABLE case_statuses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Residents read own complaint statuses"
  ON case_statuses FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM complaints
      WHERE complaints.id = case_statuses.complaint_id
        AND complaints.resident_id = auth.uid()
    )
  );

CREATE TABLE IF NOT EXISTS kp_trackers (
  id                          uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  complaint_id                uuid UNIQUE NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
  kp_applicable               boolean NOT NULL DEFAULT false,
  current_phase               kp_phase_type NOT NULL DEFAULT 'Not Applicable',
  applicability_confirmed_by  uuid REFERENCES profiles(id),
  applicability_confirmed_at  timestamptz,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE kp_trackers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Residents read KP tracker for own complaints"
  ON kp_trackers FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM complaints
      WHERE complaints.id = kp_trackers.complaint_id
        AND complaints.resident_id = auth.uid()
    )
  );

CREATE TABLE IF NOT EXISTS kp_phases (
  id               uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  tracker_id       uuid NOT NULL REFERENCES kp_trackers(id) ON DELETE CASCADE,
  phase_type       kp_phase_type NOT NULL,
  start_date       timestamptz,
  deadline_date    timestamptz,
  duration_days    integer NOT NULL DEFAULT 15,
  status           kp_phase_status NOT NULL DEFAULT 'Not Started',
  outcome          text,
  extension_days   integer DEFAULT 0,
  extension_reason text,
  approved_by      uuid REFERENCES profiles(id),
  approved_at      timestamptz,
  completed_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kp_phases_tracker_id ON kp_phases(tracker_id);

ALTER TABLE kp_phases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Residents read KP phases for own complaints"
  ON kp_phases FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM kp_trackers
      JOIN complaints ON complaints.id = kp_trackers.complaint_id
      WHERE kp_trackers.id = kp_phases.tracker_id
        AND complaints.resident_id = auth.uid()
    )
  );
