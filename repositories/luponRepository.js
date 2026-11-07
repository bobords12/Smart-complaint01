/**
 * Lupon Member Portal data layer.
 *
 * SECURITY MODEL — read this before adding a query.
 *
 * There is no "which cases am I allowed to see" logic in this
 * file, and there must never be any. Every query below is
 * unscoped on purpose: it asks the database for the caller's own
 * rows and relies on RLS to decide what comes back. That is the
 * whole point of the model, because a filter written in
 * JavaScript is a filter the client controls and can be removed
 * from the request.
 *
 *   * A member who guesses another case's UUID gets zero rows.
 *   * A member who is replaced, removed, suspended or disabled
 *     gets zero rows, because every policy goes through
 *     lupon_is_assigned_to(), which requires an ACTIVE panel row
 *     and an ACTIVE account.
 *   * Nothing here can widen access. If a query looks like it
 *     needs a WHERE clause for safety, that is a signal the query
 *     is wrong, not that the clause is missing.
 *
 * Writes go through the SECURITY DEFINER RPCs, which are the only
 * paths that enforce the business rules (authorship, lifecycle
 * transitions, the 15-day extension cap).
 */

import { createClient } from "@/lib/supabase/client";

/* ── Assignments ─────────────────────────────────────────── */

/**
 * The caller's own assignments, joined with the Pangkat clock,
 * the next hearing, the current minutes status and the outcome.
 * One round trip powers the dashboard, the case list and the
 * "my cases" filter.
 */
export async function getMyAssignments() {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("lupon_my_assignments");

  if (error) {
    if (isMissingRpc(error)) return [];
    throw new Error(error.message);
  }
  return data ?? [];
}

/**
 * Look up the caller's role on one case. Returns null when the
 * case does not exist OR the caller is not assigned to it, which
 * are indistinguishable by design: a member must not be able to
 * tell "no such case" from "not yours".
 */
export async function getMyRoleInCase(complaintId) {
  const rows = await getMyAssignments();
  return rows.find((row) => row.complaint_id === complaintId) ?? null;
}

function isMissingRpc(error) {
  const code = error?.code ?? "";
  const message = String(error?.message ?? "").toLowerCase();
  return (
    code === "42883" ||
    code === "PGRST202" ||
    message.includes("does not exist") ||
    message.includes("could not find the function")
  );
}

/* ── Case detail ─────────────────────────────────────────── */

/**
 * Everything the case page needs. Each of these is a separate
 * RLS-filtered read; an unassigned complaint simply yields [].
 */
export async function getCaseBundle(complaintId) {
  const supabase = createClient();

  const [
    complaint,
    hearings,
    attendance,
    minutes,
    outcome,
    extensions,
    panel,
    documents,
  ] = await Promise.all([
    supabase
      .from("complaints")
      // `category` is not a column on complaints — the official ones are
      // confirmed_category / confirmed_case_type, which is what a Lupon
      // member should read anyway: predicted_* is the AI suggestion and
      // is documented as a recommendation, not a finding. Selecting a
      // name that never existed made getCaseBundle throw and the whole
      // case page fail with "column complaints.category does not exist".
      .select(
        "id, reference_number, barangay_case_number, title, description, confirmed_category, confirmed_case_type, current_status, submitted_at, resolved_at"
      )
      .eq("id", complaintId)
      .maybeSingle(),
    supabase
      .from("hearings")
      .select("id, complaint_id, hearing_date, hearing_time, hearing_type, venue, status, is_online, online_link")
      .eq("complaint_id", complaintId)
      .order("hearing_date", { ascending: true }),
    supabase
      .from("hearing_attendances")
      .select("id, hearing_id, attendee_label, party_role, attendance_status, attended, excuse_reason")
      .eq("complaint_id", complaintId)
      .order("attendee_label", { ascending: true }),
    supabase
      .from("hearing_minutes")
      .select("id, complaint_id, hearing_id, status, narrative, agreements, next_step, returned_reason, returned_at, return_count, author_id, created_at, updated_at")
      .eq("complaint_id", complaintId)
      .order("created_at", { ascending: false }),
    supabase
      .from("case_outcomes")
      .select("id, complaint_id, outcome_type, summary, terms, absence_recorded, recorded_at")
      .eq("complaint_id", complaintId)
      .maybeSingle(),
    supabase
      .from("pangkat_extensions")
      .select("id, complaint_id, requested_days, reason, status, decision_note, requested_by, requested_at, decided_at")
      .eq("complaint_id", complaintId)
      .order("requested_at", { ascending: false }),
    supabase
      .from("lupon_panels")
      // selected_by is the choosing party (complainant / respondent /
      // jointly). It is the one fact about the panel that the parties
      // themselves care about — which side each member spoke for — and
      // it has been on the row since the Pangkat migration.
      .select("id, complaint_id, member_id, role, selected_by, status, assigned_at")
      .eq("complaint_id", complaintId),
    supabase
      .from("official_documents")
      .select("id, complaint_id, document_type, title, filename, storage_path, mime_type, file_size, status, uploaded_by, created_at")
      .eq("complaint_id", complaintId)
      .order("created_at", { ascending: false }),
  ]);

  // The complaint read is the one that decides whether this case
  // is visible at all. If RLS returned nothing, the other seven
  // reads are all empty too, but returning null here lets the page
  // say "not assigned" instead of rendering an empty case.
  if (complaint.error) throw new Error(complaint.error.message);
  if (!complaint.data) return null;

  /**
   * The other seven reads are non-fatal, but they must not be silent.
   *
   * Dropping their errors made a failed read indistinguishable from a
   * section that is genuinely empty: a member saw "No hearing has been
   * set on this case yet" when the query had in fact failed, and the
   * Documents section quietly did not render at all. Each failure is
   * now reported so the page can say the section could not be loaded
   * rather than inventing an empty one.
   */
  const readErrors = [
    ["Hearings", hearings.error],
    ["Attendance", attendance.error],
    ["Minutes", minutes.error],
    ["Outcome", outcome.error],
    ["Extensions", extensions.error],
    ["Panel members", panel.error],
    ["Documents", documents.error],
  ]
    .filter(([, err]) => Boolean(err))
    .map(([label, err]) => `${label} could not be loaded.`);

  return {
    complaint: complaint.data,
    hearings: hearings.data ?? [],
    attendance: attendance.data ?? [],
    minutes: minutes.data ?? [],
    outcome: outcome.data ?? null,
    extensions: extensions.data ?? [],
    panel: panel.data ?? [],
    documents: documents.data ?? [],
    readErrors,
  };
}

/**
 * A short-lived signed URL for one case document.
 *
 * The bucket is private and the storage policy authorises a lupon
 * member only for documents of cases they are actively assigned to, so
 * the URL cannot be handed to anyone else or kept: it expires with the
 * same 120-second window the rest of the portal uses for evidence.
 *
 * @returns {Promise<string|null>} the URL, or null when nothing was asked for.
 */
export async function createDocumentSignedUrl(storagePath, expiresIn = 120) {
  if (!storagePath) return null;
  const supabase = createClient();
  const { data, error } = await supabase.storage
    .from("documents")
    .createSignedUrl(storagePath, expiresIn);
  if (error) throw new Error(error.message);
  return data?.signedUrl || null;
}

/* ── Schedule ────────────────────────────────────────────── */

/** Upcoming hearings across every assigned case. */
export async function getMyHearings() {
  const supabase = createClient();
  const today = new Date().toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from("hearings")
    .select("id, complaint_id, hearing_date, hearing_time, hearing_type, venue, status, is_online, online_link, complaints(reference_number, title)")
    .gte("hearing_date", today)
    .order("hearing_date", { ascending: true })
    .order("hearing_time", { ascending: true });

  if (error) throw new Error(error.message);
  return data ?? [];
}

/** Past hearings, for the "already held" tab. */
export async function getMyPastHearings() {
  const supabase = createClient();
  const today = new Date().toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from("hearings")
    .select("id, complaint_id, hearing_date, hearing_time, hearing_type, venue, status, complaints(reference_number, title)")
    .lt("hearing_date", today)
    .order("hearing_date", { ascending: false })
    .limit(50);

  if (error) throw new Error(error.message);
  return data ?? [];
}

/* ── Minutes ─────────────────────────────────────────────── */

/** Every minutes record on every assigned case. */
export async function getMyMinutes() {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("hearing_minutes")
    .select("id, complaint_id, hearing_id, status, narrative, returned_reason, return_count, updated_at, hearings(hearing_date, hearing_time), complaints(reference_number, title)")
    .order("updated_at", { ascending: false });

  if (error) throw new Error(error.message);
  return data ?? [];
}

/* ── Pangkat clock ───────────────────────────────────────── */

/**
 * Day X of Y for one case. pangkat_day_progress() is revoked from
 * the client, so it is not callable directly; the same numbers
 * arrive on lupon_my_assignments(). This helper exists so the UI
 * has one place to read the fields from.
 */
export function readClock(assignment) {
  if (!assignment || !assignment.convenes_at) return null;
  return {
    dayNumber: assignment.day_number ?? null,
    totalDays: assignment.total_days ?? null,
    daysLeft: assignment.days_left ?? null,
    deadlineOn: assignment.deadline_on ?? null,
    status: assignment.tracker_status ?? null,
    label: formatClockLabel(assignment),
  };
}

export function formatClockLabel(assignment) {
  if (!assignment || !assignment.convenes_at) return "Not yet convened";
  if (assignment.tracker_status === "Concluded") return "Concluded";
  if (assignment.tracker_status === "Terminated") return "Terminated";
  if (!assignment.day_number || !assignment.total_days) return "Not yet convened";
  return `Day ${assignment.day_number} of ${assignment.total_days}`;
}

/* ── Writes (RPC only) ───────────────────────────────────── */

/** Start the 15-day clock. Lead role only. */
export async function convenePangkat(complaintId) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("lupon_convene_pangkat", {
    p_complaint_id: complaintId,
  });
  if (error) throw new Error(error.message);
  return data;
}

/** Ask for more time. Any assigned member may request. */
export async function requestExtension(complaintId, days, reason) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("lupon_request_extension", {
    p_complaint_id: complaintId,
    p_days: days,
    p_reason: reason,
  });
  if (error) throw new Error(error.message);
  return data;
}

/** Record or correct one attendee's presence. */
export async function recordAttendance({
  hearingId,
  attendeeLabel,
  partyRole,
  status,
  excuseReason = null,
}) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("lupon_record_attendance", {
    p_hearing_id: hearingId,
    p_attendee_label: attendeeLabel,
    p_party_role: partyRole,
    p_status: status,
    p_excuse_reason: excuseReason,
  });
  if (error) throw new Error(error.message);
  return data;
}

/** Create or update a minutes draft. Lead role only. */
export async function saveMinutesDraft({
  hearingId,
  narrative,
  agreements = null,
  nextStep = null,
  hearingDate = null,
}) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("lupon_save_minutes_draft", {
    p_hearing_id: hearingId,
    p_narrative: narrative,
    p_agreements: agreements,
    p_next_step: nextStep,
    p_hearing_date: hearingDate,
  });
  if (error) throw new Error(error.message);
  return data;
}

/**
 * Move a record along its lifecycle.
 *
 * Lifecycle (enforced by the RPC, not by this file):
 *
 *   Draft ──submit──▶ Submitted for Review
 *   Submitted for Review ──return──▶ Returned for Correction
 *   Returned for Correction ──(save draft reopens)──▶ Draft
 *   Submitted for Review ──attest──▶ Attested
 *   Attested ──finalize──▶ Final        (immutable, trigger-locked)
 *
 * Who may do what:
 *   submit  — Chairperson or Secretary
 *   return  — an active official only, note required
 *   attest  — Chairperson or Secretary
 *   finalize— the SECRETARY only
 *
 * `return` is exposed here for completeness but the portal has no
 * button for it: it is the Captain/OIC/Secretary review screen that
 * sends minutes back.
 */
export async function minutesAction(minutesId, action, note = null) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("lupon_minutes_action", {
    p_minutes_id: minutesId,
    p_action: action,
    p_note: note,
  });
  if (error) throw new Error(error.message);
  return data;
}

/** Record the conciliation result. Lead role only. */
export async function recordOutcome({
  complaintId,
  outcomeType,
  summary,
  terms = null,
  absenceRecorded = false,
}) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("lupon_record_outcome", {
    p_complaint_id: complaintId,
    p_outcome_type: outcomeType,
    p_summary: summary,
    p_terms: terms,
    p_absence_recorded: absenceRecorded,
  });
  if (error) throw new Error(error.message);
  return data;
}

/* ── Display helpers ─────────────────────────────────────── */

export const ATTENDANCE_STATUSES = [
  "Present",
  "Absent",
  "Late",
  "Excused",
  "Not Recorded",
];

export const OUTCOME_TYPES = [
  "Amicably Settled",
  "Failed to Settle",
  "Withdrawn",
  "Referred to Court",
  "Referred to Another Office",
  "No Appearance",
];

export const LEAD_ROLES = ["chairperson", "secretary"];

export function isLeadRole(role) {
  return LEAD_ROLES.includes(String(role ?? "").toLowerCase());
}

export function isFinalizedStatus(status) {
  return String(status ?? "").toLowerCase() === "final";
}

/** The minutes record a member is currently allowed to act on. */
export function activeMinutesRecord(minutesList) {
  if (!Array.isArray(minutesList) || minutesList.length === 0) return null;
  return minutesList.find((m) => !isFinalizedStatus(m.status)) ?? null;
}

export function latestFinalMinutes(minutesList) {
  if (!Array.isArray(minutesList) || minutesList.length === 0) return null;
  return minutesList.find((m) => isFinalizedStatus(m.status)) ?? null;
}

export function formatDate(value) {
  if (!value) return "—";
  const d = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-PH", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function formatTime(value) {
  if (value === null || value === undefined) return "—";
  const str = String(value);
  if (str === "" || str === "—") return "—";
  const [h, m] = str.split(":");
  const hour = Number(h);
  const minute = Number(m);
  if (Number.isNaN(hour)) return "—";
  const period = hour >= 12 ? "PM" : "AM";
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${display}:${Number.isNaN(minute) ? "00" : String(minute).padStart(2, "0")} ${period}`;
}

export function formatDateTime(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return `${formatDate(value)} · ${d.toLocaleTimeString("en-PH", {
    hour: "numeric",
    minute: "2-digit",
  })}`;
}
