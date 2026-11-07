

CREATE TABLE IF NOT EXISTS profiles (
  id            uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role          app_role NOT NULL DEFAULT 'resident',
  display_name  text,
  avatar_path   text,
  account_status account_status NOT NULL DEFAULT 'pending',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_id ON profiles(id);


ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Residents read own profile"
  ON profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Residents update own allowed fields"
  ON profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);


