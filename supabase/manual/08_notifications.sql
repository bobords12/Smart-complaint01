CREATE TABLE IF NOT EXISTS notifications (
  id              uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  user_id         uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type            text NOT NULL DEFAULT 'general'
                  CHECK (type IN ('complaint', 'hearing', 'general')),
  title           text NOT NULL,
  message         text NOT NULL,
  related_complaint_id uuid REFERENCES complaints(id) ON DELETE SET NULL,
  related_hearing_id   uuid REFERENCES hearings(id) ON DELETE SET NULL,
  read_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id) WHERE read_at IS NULL;

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Residents read own notifications"
  ON notifications FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Residents mark own notifications as read"
  ON notifications FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

