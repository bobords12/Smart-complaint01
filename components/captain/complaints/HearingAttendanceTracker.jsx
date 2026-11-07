"use client";

/**
 * Captain Portal -> Complaints: hearings, attendance and meeting records.
 *
 * SCOPE NOTE
 *   This reads the hearings that already exist on the case and records
 *   what happened at them. It does not create the first hearing; that
 *   happens on the Hearings & Notice page when the mediation is
 *   scheduled, which is also what prepares the Notice of Hearing.
 *
 * WHAT IS ACTUALLY RECORDED
 *   Three separate facts, deliberately not merged:
 *     1. attendance      - who was in the room, per party, per hearing
 *     2. the meeting     - whether it was conducted at all
 *     3. the outcome     - what was decided, if the meeting happened
 *
 *   A hearing only reads as Held when a saved meeting record says the
 *   meeting was conducted. Recording attendance never does that, which
 *   is what stopped a hearing that had not happened yet from being
 *   reported as already over.
 *
 * NO THRESHOLD LOGIC
 *   The panel used to count respondent absences and, at three, state
 *   that the BAR process may be initiated. Nothing here counts toward a
 *   legal threshold any more. A recorded absence is reported as a
 *   recorded absence, and what follows from it is an official action
 *   taken through the ordinary workflow, never a conclusion the system
 *   draws for itself.
 *
 * WHY attendance_status IS WRITTEN
 *   The trigger hearing_attendance_sync_attended() overwrites the legacy
 *   `attended` boolean from `attendance_status` on every write, so the
 *   boolean is a derived mirror rather than a record of a decision. All
 *   reads and writes here go through `attendance_status`, and an
 *   unrecognised or absent value is stored as 'Not recorded' instead of
 *   being promoted to an appearance.
 */

import { useState } from "react";
import toast from "react-hot-toast";
import { CalendarCheck, CalendarClock, CalendarX, FileSignature, FileText, TriangleAlert, UserCheck, UserX } from "lucide-react";
import {
  ATTENDANCE_STATUS_OPTIONS,
  absenceSummaryFor,
  attendanceRowsFor,
  recordHearingAttendance,
  respondentDisplay,
} from "@/lib/captainComplaintWorkflow";
import {
  generateAmicableSettlementFromForm,
  generateAmicableSettlementIfStale,
} from "@/lib/resolution/amicableSettlementForm";
import { WorkflowPanel, WorkflowChip, WorkflowField, WorkflowNote } from "./captainWorkflowUi";
import AttendanceModal from "./AttendanceModal";
import MeetingRecordModal from "./MeetingRecordModal";
import HearingLifecycleModal from "./HearingLifecycleModal";

/** Inline pick, limited to statuses that carry no extra requirement. */
const QUICK_STATUS_OPTIONS = ATTENDANCE_STATUS_OPTIONS.filter(
  (option) => option.value !== "Excused"
);

function formatDateTime(date, time) {
  if (!date) return "Date to be confirmed";
  const d = new Date(`${date}T${time || "00:00"}`);
  if (Number.isNaN(d.getTime())) return String(date);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function AttendanceCell({ state, party, onPick, busy, options }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted">{party}</p>
      {state ? (
        <WorkflowChip tone={state.absent ? "critical" : state.attended ? "ok" : "neutral"}>
          {state.label}
        </WorkflowChip>
      ) : (
        <p className="text-sm font-semibold text-muted">Not recorded</p>
      )}
      {!state && options.length ? (
        <select
          aria-label={`Record ${party.toLowerCase()} attendance`}
          value=""
          disabled={busy}
          onChange={(event) => onPick(event.target.value)}
          className="mt-1.5 h-9 w-full rounded-lg border border-line bg-white px-2 text-xs font-semibold text-mirage transition-colors hover:bg-alt disabled:opacity-60"
        >
          <option value="" disabled>
            Record…
          </option>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : null}
      {state?.excuseReason ? (
        <p className="mt-1 text-[11px] text-muted">Reason: {state.excuseReason}</p>
      ) : null}
    </div>
  );
}

/**
 * Whether the Amicable Settlement can be printed from this hearing's row.
 *
 * Conducted + Outcome is the whole gate. It is deliberately NOT the meeting
 * record's "Final" status: hearing_minutes only reaches Final through the
 * Lupon portal, and only the Pangkat Secretary can set it, so that gate left
 * this unreachable for every meeting a Captain records. The record stays a
 * Draft here, which is why keepPrintedSettlementCurrent() reprints whenever
 * the terms or the date change rather than trusting one frozen copy.
 */
function settlementEligibleFor(row, meetingOverride) {
  // The meeting passed in can be the values just saved rather than the row's
  // own copy: right after a save the parent's props still hold what the record
  // said BEFORE the edit, so judging by them would skip the very first save
  // that turns a case into a Settled one.
  const meeting = meetingOverride ?? row?.meeting;
  return Boolean(
    row?.hearing?.hearing_date &&
      meeting &&
      meeting.conducted === "Yes" &&
      meeting.outcome === "Settled" &&
      String(meeting.agreements || "").trim(),
  );
}

/** How many Amicable Settlements this case already holds on file. */
function settlementCountFor(documents) {
  return (documents || []).filter((doc) => doc?.document_type === "settlement").length;
}

export default function HearingAttendanceTracker({
  supabase,
  user,
  complaint,
  hearings = [],
  attendances = [],
  minutes = [],
  documents = [],
  respondent,
  onChanged,
}) {
  const [busy, setBusy] = useState(null);
  const [genBusy, setGenBusy] = useState(null);
  const [attendanceFor, setAttendanceFor] = useState(null);
  const [meetingFor, setMeetingFor] = useState(null);
  const [lifecycle, setLifecycle] = useState(null);

  const rows = attendanceRowsFor(hearings, attendances, minutes);
  const absence = absenceSummaryFor(attendances);
  const respondentInfo = respondentDisplay(complaint);
  const settlementCount = settlementCountFor(documents);

  /**
   * Print the barangay's Amicable Settlement form for one Settled meeting
   * record. It only prepares and stores the document — recording the
   * settlement itself stays a deliberate act on the Resolution & Outcomes tab.
   */
  const generateSettlement = async (row) => {
    setGenBusy(row.hearingId);
    const result = await generateAmicableSettlementFromForm(supabase, {
      complaint,
      user,
      hearing: row.hearing,
      meeting: row.meeting,
      documents,
    });
    setGenBusy(null);
    if (!result.success) {
      toast.error(
        result.templateUnavailable
          ? `${result.error} Upload the printed form to the templates bucket at masters/amicable-settlement/Amicable_settlement.docx.`
          : result.error
      );
      return;
    }
    toast.success(
      settlementCount
        ? "A new version of the Amicable Settlement was filed under Case Documents."
        : "Amicable Settlement generated. It is filed under Case Documents."
    );
    onChanged?.();
  };

  /**
   * After a meeting record is saved, keep any printed settlement in step.
   *
   * This is the "generate it automatically when the case is settled" path.
   * It writes nothing on its own: generateAmicableSettlementIfStale() only
   * produces a document when the meeting is Conducted + Settled AND the copy
   * on file is missing or now says something different. Re-saving a record
   * whose terms and date have not moved is a no-op, so no versions pile up
   * and the complainant is not re-notified for nothing.
   *
   * Failures are reported but never block the save — the meeting record is
   * already stored, and the manual button above remains the way to retry.
   */
  const handleMeetingSaved = async (saved) => {
    onChanged?.();

    const row = rows.find((r) => r.hearingId === saved?.hearingId);
    if (!row) return;

    // The refreshed row may not have arrived through props yet, so the
    // values just saved are used to build the record the paper comes from.
    const meeting = {
      ...row.meeting,
      conducted: saved.conducted,
      outcome: saved.outcome,
      agreements: saved.agreements,
    };

    if (!settlementEligibleFor(row, meeting)) return;

    const outcome = await generateAmicableSettlementIfStale(supabase, {
      complaint,
      user,
      hearing: row.hearing,
      meeting,
    });

    if (outcome.generated) {
      toast.success(
        "This meeting was recorded as Settled, so the Amicable Settlement was generated and filed under Case Documents."
      );
      onChanged?.();
    } else if (outcome.reason === "lookup_failed") {
      toast.error(
        "The meeting record was saved, but the Amicable Settlement could not be checked against the copy on file. Use Generate Amicable Settlement to retry."
      );
    }
  };

  const record = async (row, partyRole, attendeeLabel, attendanceStatus) => {
    setBusy(`${row.hearingId}:${partyRole}`);
    const result = await recordHearingAttendance(supabase, {
      complaintId: complaint.id,
      hearingId: row.hearingId,
      partyRole,
      attendeeLabel,
      attendanceStatus,
    });
    setBusy(null);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    toast.success(
      `Attendance recorded as ${attendanceStatus}. The hearing status is unchanged.`
    );
    onChanged?.();
  };

  if (!hearings.length) {
    return (
      <WorkflowPanel title="Hearings, Attendance & Meeting Records">
        <WorkflowNote tone="neutral">
          No hearing has been scheduled on this complaint yet. A hearing is created on the
          Hearings &amp; Notice page once the mediation is scheduled.
        </WorkflowNote>
      </WorkflowPanel>
    );
  }

  const upcoming = rows.find((r) => r.lifecycle?.scheduled);
  const heldCount = rows.filter((r) => r.held).length;

  const activeRow = attendanceFor || meetingFor || null;
  const activeAttendances = activeRow
    ? attendances.filter((a) => a.hearing_id === activeRow.hearingId)
    : [];

  return (
    <WorkflowPanel
      title="Hearings, Attendance & Meeting Records"
      description="Every hearing on this case, who attended, and the meeting record saved against it."
      action={
        <WorkflowChip tone={heldCount ? "ok" : "neutral"}>
          {heldCount} of {rows.length} held
        </WorkflowChip>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <WorkflowField label="Hearings On Record">{rows.length}</WorkflowField>
          <WorkflowField label="Meetings Held">{heldCount}</WorkflowField>
          <WorkflowField label="Next Hearing">
            {upcoming ? formatDateTime(upcoming.date, upcoming.time) : "None scheduled"}
          </WorkflowField>
        </div>

        <WorkflowNote tone="neutral">{absence.headline}</WorkflowNote>

        <ul className="flex flex-col gap-3">
          {rows.map((row) => {
            const canChange = !row.lifecycle?.cancelled && !row.lifecycle?.rescheduled;
            return (
              <li
                key={row.hearingId}
                className="rounded-xl border border-line bg-canvas px-4 py-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-navy">
                      {row.sequence === 1 ? "1st" : row.sequence === 2 ? "2nd" : `${row.sequence}th`}{" "}
                      hearing
                    </p>
                    <p className="text-xs text-muted">{formatDateTime(row.date, row.time)}</p>
                  </div>
                  <WorkflowChip
                    tone={
                      row.lifecycle?.heldWithoutRecord
                        ? "warning"
                        : row.lifecycle?.held
                          ? "ok"
                          : row.lifecycle?.scheduled
                            ? "info"
                            : "neutral"
                    }
                  >
                    {row.lifecycle?.label || row.status || "Scheduled"}
                  </WorkflowChip>
                </div>

                {row.lifecycle?.heldWithoutRecord ? (
                  <p className="mt-2 inline-flex items-start gap-1.5 text-[11px] font-semibold text-warning">
                    <TriangleAlert className="mt-px h-3 w-3 shrink-0" aria-hidden="true" />
                    {row.lifecycle.detail}
                  </p>
                ) : null}

                {row.lifecycle?.cancelled && row.hearing?.cancel_reason ? (
                  <p className="mt-2 text-[11px] text-muted">
                    Reason for cancellation: {row.hearing.cancel_reason}
                  </p>
                ) : null}

                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <AttendanceCell
                    party="Complainant"
                    state={row.complainant}
                    options={canChange ? QUICK_STATUS_OPTIONS : []}
                    busy={busy === `${row.hearingId}:complainant`}
                    onPick={(value) =>
                      record(
                        row,
                        "complainant",
                        resolveComplainantLabel(complaint) || "Complainant",
                        value
                      )
                    }
                  />
                  <AttendanceCell
                    party="Respondent"
                    state={row.respondent}
                    options={canChange && respondentInfo.identified ? QUICK_STATUS_OPTIONS : []}
                    busy={busy === `${row.hearingId}:respondent`}
                    onPick={(value) =>
                      record(row, "respondent", respondentInfo.name || "Respondent", value)
                    }
                  />
                </div>

                {row.respondent?.absent ? (
                  <p className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-semibold text-critical">
                    <UserX className="h-3 w-3" aria-hidden="true" />
                    Respondent recorded as absent at this hearing.
                  </p>
                ) : null}
                {row.complainant?.attended ? (
                  <p className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-semibold text-success">
                    <UserCheck className="h-3 w-3" aria-hidden="true" />
                    Complainant recorded as present.
                  </p>
                ) : null}

                {row.meetingRecorded ? (
                  <div className="mt-3 rounded-xl border border-line bg-white px-3 py-2 text-[11px] text-muted">
                    <p className="font-semibold text-navy">
                      Meeting Conducted: {row.meeting?.conducted || "Not recorded"}
                    </p>
                    {row.meeting?.outcome ? (
                      <p>Outcome: {row.meeting.outcome}</p>
                    ) : null}
                    {row.meeting?.outcome_explanation ? (
                      <p>Explanation: {row.meeting.outcome_explanation}</p>
                    ) : null}
                    {row.meeting?.agreements ? (
                      <p className="mt-1">Agreements: {row.meeting.agreements}</p>
                    ) : null}
                    {row.meeting?.next_step ? <p>Next step: {row.meeting.next_step}</p> : null}
                    {row.meeting?.narrative ? (
                      <p className="mt-1 whitespace-pre-line">{row.meeting.narrative}</p>
                    ) : null}
                    <p className="mt-1 text-[10px] uppercase tracking-wide text-muted">
                      Record status: {row.meeting?.status || "Draft"}
                    </p>
                  </div>
                ) : null}

                {canChange ? (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setAttendanceFor(row)}
                      className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-xs font-semibold text-secondary transition-colors hover:bg-info-soft"
                    >
                      <FileText className="h-3 w-3" aria-hidden="true" />
                      {row.recorded ? "Edit attendance" : "Record attendance"}
                    </button>

                    <button
                      type="button"
                      onClick={() => setMeetingFor(row)}
                      className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-xs font-semibold text-secondary transition-colors hover:bg-info-soft"
                    >
                      <FileText className="h-3 w-3" aria-hidden="true" />
                      {row.meetingRecorded ? "Edit meeting record" : "Record meeting"}
                    </button>

                    {row.lifecycle?.scheduled ? (
                      <>
                        <button
                          type="button"
                          onClick={() => setLifecycle({ mode: "reschedule", row })}
                          className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-xs font-semibold text-muted transition-colors hover:bg-info-soft"
                        >
                          <CalendarClock className="h-3 w-3" aria-hidden="true" />
                          Reschedule
                        </button>
                        <button
                          type="button"
                          onClick={() => setLifecycle({ mode: "cancel", row })}
                          className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-xs font-semibold text-critical transition-colors hover:bg-critical-soft"
                        >
                          <CalendarX className="h-3 w-3" aria-hidden="true" />
                          Cancel
                        </button>
                      </>
                    ) : null}
                  </div>
                ) : null}

                {settlementEligibleFor(row) ? (
                  <div className="mt-3 rounded-xl border border-line bg-white px-3 py-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                      Amicable Settlement
                    </p>
                    <p className="mt-1 text-[11px] text-muted">
                      This meeting was recorded as Settled, so the barangay&apos;s Amicable
                      Settlement form is generated and filed under Case Documents
                      automatically — filled with this case&apos;s parties, case number, the
                      terms recorded above and this hearing&apos;s date. Both parties sign the
                      printed copy.
                      {settlementCount
                        ? ` ${settlementCount === 1 ? "One version is" : `${settlementCount} versions are`} already on file.`
                        : ""}
                    </p>
                    <button
                      type="button"
                      disabled={genBusy === row.hearingId}
                      onClick={() => generateSettlement(row)}
                      className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-xs font-semibold text-secondary transition-colors hover:bg-info-soft disabled:opacity-60"
                    >
                      <FileSignature className="h-3 w-3" aria-hidden="true" />
                      {genBusy === row.hearingId
                        ? "Generating…"
                        : settlementCount
                          ? "Generate another copy"
                          : "Generate Amicable Settlement"}
                    </button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>

        {!respondentInfo.identified ? (
          <WorkflowNote tone="warning" icon={CalendarCheck}>
            No respondent is identified on this complaint, so respondent attendance cannot be
            recorded. This case follows the incident pathway rather than a mediation hearing.
          </WorkflowNote>
        ) : null}

        <WorkflowNote tone="neutral">
          An excused party is recorded in the attendance dialog, where the reason has to be written
          down. The inline picks above only offer statuses that need no further explanation.
        </WorkflowNote>
      </div>

      <AttendanceModal
        key={`attendance-${attendanceFor?.hearingId || "none"}`}
        open={Boolean(attendanceFor)}
        onClose={() => setAttendanceFor(null)}
        supabase={supabase}
        complaint={complaint}
        hearing={attendanceFor?.hearing}
        attendances={activeRow ? activeAttendances : []}
        onSaved={onChanged}
      />

      <MeetingRecordModal
        key={`meeting-${meetingFor?.hearingId || "none"}`}
        open={Boolean(meetingFor)}
        onClose={() => setMeetingFor(null)}
        supabase={supabase}
        complaint={complaint}
        hearing={meetingFor?.hearing}
        attendances={activeRow ? activeAttendances : []}
        meeting={meetingFor?.meeting || null}
        onSaved={handleMeetingSaved}
      />

      <HearingLifecycleModal
        key={`lifecycle-${lifecycle?.row?.hearingId || "none"}-${lifecycle?.mode || "none"}`}
        open={Boolean(lifecycle)}
        mode={lifecycle?.mode || "reschedule"}
        onClose={() => setLifecycle(null)}
        supabase={supabase}
        complaint={complaint}
        hearing={lifecycle?.row?.hearing}
        onSaved={onChanged}
      />
    </WorkflowPanel>
  );
}

function resolveComplainantLabel(complaint) {
  const profile = complaint?.profiles;
  if (profile?.display_name) return profile.display_name;
  const rp = profile?.resident_profiles?.[0];
  if (rp) return [rp.first_name, rp.middle_name, rp.last_name].filter(Boolean).join(" ");
  return "Complainant";
}