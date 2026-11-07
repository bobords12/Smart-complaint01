-- ============================================================
-- 13_indexes.sql
-- Purpose: Additional performance indexes for common query
--          patterns used by the Resident Portal.
-- Safety:  all CREATE INDEX IF NOT EXISTS — no destructive ops.
-- ============================================================

-- Complaints: sort by submitted date
CREATE INDEX IF NOT EXISTS idx_complaints_submitted_at ON complaints(submitted_at DESC);

-- Complaints: filter by status for dashboard counts
CREATE INDEX IF NOT EXISTS idx_complaints_status_submitted ON complaints(current_status, submitted_at DESC);

-- Notifications: user unread count
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC);

-- Hearings: upcoming hearings for resident
CREATE INDEX IF NOT EXISTS idx_hearings_date_status ON hearings(hearing_date, status);

-- Case statuses: chronological lookup per complaint
CREATE INDEX IF NOT EXISTS idx_case_statuses_created_at ON case_statuses(complaint_id, created_at DESC);

-- KP phases: lookup by tracker
CREATE INDEX IF NOT EXISTS idx_kp_phases_tracker ON kp_phases(tracker_id, created_at);

-- Audit logs: time-range queries
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action, created_at DESC);
