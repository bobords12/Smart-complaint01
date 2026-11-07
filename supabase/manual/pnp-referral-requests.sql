-- ============================================================
-- pnp-referral-requests.sql
-- Purpose: Resident-initiated PNP referral requests.
-- Safety:  residents create requests for own complaints only;
--          review/approval is protected from client edits.
--
-- HOW TO APPLY:
--   1. Open Supabase Dashboard > SQL Editor
--   2. Paste this entire file
--   3. Click "Run"
--   4. Verify: SELECT * FROM pnp_referral_requests;
-- ============================================================

-- ── Enum ───────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'referral_request_status') THEN
    CREATE TYPE referral_request_status AS ENUM (
      'pending_review',
      'more_information_required',
      'approved',
      'declined',
      'officially_referred',
      'completed',
      'cancelled'
    );
  END IF;
END
$$;

-- ── Table ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pnp_referral_requests (
  id                       uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  complaint_id             uuid NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
  resident_user_id         uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  reason                   text NOT NULL,
  has_immediate_safety_concern boolean NOT NULL DEFAULT false,
  status                   referral_request_status NOT NULL DEFAULT 'pending_review',
  decision_note            text,
  reviewed_by              uuid REFERENCES profiles(id),
  reviewed_at              timestamptz,
  requested_at             timestamptz NOT NULL DEFAULT now(),
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

-- ── Indexes ────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_pnp_referral_complaint_id ON pnp_referral_requests(complaint_id);
CREATE INDEX IF NOT EXISTS idx_pnp_referral_resident_id ON pnp_referral_requests(resident_user_id);

-- Unique constraint: only one active (non-terminal) request per complaint
-- Terminal statuses: declined, completed, cancelled
CREATE UNIQUE INDEX IF NOT EXISTS idx_pnp_referral_active_per_complaint
  ON pnp_referral_requests(complaint_id)
  WHERE status IN ('pending_review', 'more_information_required', 'approved', 'officially_referred');

-- ── RLS ────────────────────────────────────────────────────
ALTER TABLE pnp_referral_requests ENABLE ROW LEVEL SECURITY;

-- Residents can read their own referral requests
CREATE POLICY "Residents read own referral requests"
  ON pnp_referral_requests FOR SELECT
  USING (auth.uid() = resident_user_id);

-- Residents can create referral requests for their own complaints
CREATE POLICY "Residents insert own referral requests"
  ON pnp_referral_requests FOR INSERT
  WITH CHECK (
    auth.uid() = resident_user_id
    AND EXISTS (
      SELECT 1 FROM complaints
      WHERE complaints.id = pnp_referral_requests.complaint_id
        AND complaints.resident_id = auth.uid()
    )
  );

-- Residents can cancel their own pending requests
CREATE POLICY "Residents cancel own pending referral requests"
  ON pnp_referral_requests FOR UPDATE
  USING (auth.uid() = resident_user_id)
  WITH CHECK (
    auth.uid() = resident_user_id
    AND status = 'cancelled'
  );

-- Staff, captain can read and manage all referral requests
CREATE POLICY "Staff read all referral requests"
  ON pnp_referral_requests FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('captain', 'staff', 'admin')
    )
  );

CREATE POLICY "Staff update all referral requests"
  ON pnp_referral_requests FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('captain', 'staff', 'admin')
    )
  );

-- ── Auto-update updated_at ─────────────────────────────────
CREATE OR REPLACE FUNCTION update_pnp_referral_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_pnp_referral_updated_at ON pnp_referral_requests;
CREATE TRIGGER trg_pnp_referral_updated_at
  BEFORE UPDATE ON pnp_referral_requests
  FOR EACH ROW
  EXECUTE FUNCTION update_pnp_referral_updated_at();

-- ── Notifications on status change ─────────────────────────
-- When a referral request is reviewed, notify the resident
CREATE OR REPLACE FUNCTION notify_resident_on_referral_update()
RETURNS TRIGGER AS $$
DECLARE
  v_resident_id uuid;
  v_complaint_ref text;
  v_message text;
BEGIN
  -- Only notify on status changes (not on initial insert)
  IF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    v_resident_id := NEW.resident_user_id;

    SELECT reference_number INTO v_complaint_ref
    FROM complaints WHERE id = NEW.complaint_id;

    v_message := CASE NEW.status
      WHEN 'more_information_required' THEN
        'Your PNP referral request for ' || v_complaint_ref || ' needs more information.'
      WHEN 'approved' THEN
        'Your PNP referral request for ' || v_complaint_ref || ' has been approved.'
      WHEN 'declined' THEN
        'Your PNP referral request for ' || v_complaint_ref || ' has been declined.'
      WHEN 'officially_referred' THEN
        'Your complaint ' || v_complaint_ref || ' has been officially referred to the PNP.'
      ELSE NULL
    END;

    IF v_message IS NOT NULL THEN
      INSERT INTO notifications (user_id, type, title, message, related_complaint_id)
      VALUES (
        v_resident_id,
        'complaint',
        'PNP Referral Update',
        v_message,
        NEW.complaint_id
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_notify_resident_referral_update ON pnp_referral_requests;
CREATE TRIGGER trg_notify_resident_referral_update
  AFTER UPDATE ON pnp_referral_requests
  FOR EACH ROW
  EXECUTE FUNCTION notify_resident_on_referral_update();
