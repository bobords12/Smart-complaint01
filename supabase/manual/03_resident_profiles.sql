CREATE TABLE IF NOT EXISTS resident_profiles (
  id                     uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  user_id                uuid UNIQUE NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  first_name             text NOT NULL,
  middle_name            text DEFAULT '',
  last_name              text NOT NULL,
  suffix                 text DEFAULT '',
  date_of_birth          date NOT NULL,
  sex                    text NOT NULL CHECK (sex IN ('Male', 'Female', 'Other')),
  mobile_number          text NOT NULL,
  house_street           text NOT NULL,
  purok                  text NOT NULL,
  barangay               text NOT NULL DEFAULT 'Abuno',
  city                   text NOT NULL DEFAULT 'Iligan City',
  verification_status    text NOT NULL DEFAULT 'pending'
                         CHECK (verification_status IN ('pending', 'verified', 'rejected')),
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_resident_profiles_user_id ON resident_profiles(user_id);

ALTER TABLE resident_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Residents read own resident profile"
  ON resident_profiles FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Residents update own resident profile"
  ON resident_profiles FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

