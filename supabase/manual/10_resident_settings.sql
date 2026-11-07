-- ============================================================
-- 10_resident_settings.sql
-- Purpose: Safe per-resident preferences (theme, notifications,
--          accessibility). No secrets stored here.
-- Safety:  residents read and update only their own settings.
-- ============================================================

CREATE TABLE IF NOT EXISTS resident_settings (
  id              uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  user_id         uuid UNIQUE NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  theme           text NOT NULL DEFAULT 'light'
                  CHECK (theme IN ('light', 'system')),
  complaint_updates boolean NOT NULL DEFAULT true,
  hearing_reminders boolean NOT NULL DEFAULT true,
  sms_updates       boolean NOT NULL DEFAULT false,
  general_notices   boolean NOT NULL DEFAULT true,
  reduced_motion    boolean NOT NULL DEFAULT false,
  increased_text    boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_resident_settings_user_id ON resident_settings(user_id);

ALTER TABLE resident_settings ENABLE ROW LEVEL SECURITY;

-- Residents can read their own settings
CREATE POLICY "Residents read own settings"
  ON resident_settings FOR SELECT
  USING (auth.uid() = user_id);

-- Residents can update their own settings
CREATE POLICY "Residents update own settings"
  ON resident_settings FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Settings are created by the handle_new_user() trigger.
-- Residents must not INSERT or DELETE settings directly.
