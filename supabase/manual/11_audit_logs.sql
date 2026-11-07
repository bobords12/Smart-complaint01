-- ============================================================
-- 11_audit_logs.sql
-- Purpose: Append-only audit trail for privileged actions.
-- Safety:  no Resident access whatsoever; staff/captain only.
-- ============================================================

CREATE TABLE IF NOT EXISTS audit_logs (
  id            uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  actor_id      uuid REFERENCES profiles(id),
  actor_role    app_role,
  action        text NOT NULL,
  target_type   text,
  target_id     uuid,
  details       jsonb,
  ip_address    inet,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_id ON audit_logs(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- No policies = no access for authenticated users via RLS.
-- Audit logs are only accessible via SECURITY DEFINER functions
-- used by staff/captain/admin back-office operations.
