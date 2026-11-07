"use client";

import { useMemo } from "react";
import { TimerReset } from "lucide-react";
import { deadlineInfo, formatDateShort } from "./complaintMeta";
import { clampProgress } from "@/lib/kpDateUtils";
import { firstActualMeeting } from "@/lib/captainComplaintWorkflow";

/** Whole days from today until `date`. Negative once the date has passed. */
function daysBetween(date) {
  const target = new Date(`${date}T00:00:00`);
  if (Number.isNaN(target.getTime())) return 0;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target - today) / 86400000);
}

function addDays(date, days) {
  const base = new Date(`${date}T00:00:00`);
  if (Number.isNaN(base.getTime())) return null;
  base.setDate(base.getDate() + Number(days || 0));
  return `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, "0")}-${String(
    base.getDate()
  ).padStart(2, "0")}`;
}

const MILESTONES = [
  { day: 10, note: "Casework reminder" },
  { day: 13, note: "Final push reminder" },
  { day: 15, note: "Period deadline" },
];

export default function DeadlineTracker({ kpTracker, kpPhases, hearings = [], minutes = [] }) {
  const tracker = useMemo(
    () => (kpTracker ? { ...kpTracker, phases: kpPhases || [] } : null),
    [kpTracker, kpPhases]
  );
  const phase = tracker?.phases?.find((p) => p.start_date && !p.completed_at) || tracker?.phases?.[0];
  const isConciliation = (phase?.phase_type || "").toLowerCase().includes("concil");

  /*
   * The mediation period starts at the first meeting that was actually
   * recorded as conducted. A scheduled hearing, a service record, or a
   * date that has simply passed do not start it. The KP phase row still
   * carries a start date, and it is kept as a fallback for a case whose
   * meeting record has not been written yet - but where a recorded
   * meeting exists, that date is the start date, because the meeting is
   * the fact and the phase row is a copy of it.
   */
  const actual = isConciliation ? null : firstActualMeeting(minutes, hearings);
  const dl = useMemo(() => {
    const fromTracker = deadlineInfo(tracker);
    if (isConciliation || !actual || !fromTracker.hasDeadline) return fromTracker;
    // Keep the phase's total and label; correct only the start date.
    const startDate = actual.date;
    const deadlineDate = addDays(startDate, fromTracker.total);
    const elapsed = daysBetween(startDate);
    const remaining = daysBetween(deadlineDate);
    return {
      ...fromTracker,
      elapsed,
      remaining,
      progress: clampProgress(elapsed, fromTracker.total),
      startDate,
      deadlineDate,
      label: `${
        remaining > 0 ? `${remaining} day${remaining === 1 ? "" : "s"} remaining` : "Deadline reached"
      }`,
      derivedFromMeetingRecord: true,
    };
  }, [tracker, actual, isConciliation]);

  if (!tracker) {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex h-2 w-full overflow-hidden rounded-full bg-alt" />
        <p className="text-xs text-muted">
          No Katarungang Pambarangay tracker has been opened for this complaint yet.
        </p>
      </div>
    );
  }

  if (!dl.hasDeadline) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="inline-flex items-center gap-2 text-sm font-semibold text-mirage">
          <TimerReset className="h-4 w-4 text-muted" aria-hidden="true" />
          {tracker.kp_applicable
            ? "Tracker pending first meeting"
            : "KP applicability not yet confirmed"}
        </p>
        <p className="text-xs text-muted">
          The 15-day mediation period begins on the day the first mediation meeting is
          recorded as conducted. A scheduled hearing does not start it, and neither does summons
          delivery.
        </p>
      </div>
    );
  }

  const startEvent = isConciliation
    ? "first Pangkat session"
    : "first meeting of both parties";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-navy">
            Day {dl.elapsed} <span className="font-normal text-muted">of {dl.total}-day period</span>
          </p>
          <p className="mt-0.5 text-xs text-muted">
            {isConciliation ? "Pangkat conciliation" : "Captain mediation"} ·{" "}
            {formatDateShort(dl.startDate)} – {formatDateShort(dl.deadlineDate)}
          </p>
        </div>
        <span className="inline-flex items-center rounded-full bg-warning-soft px-3 py-1 text-xs font-semibold text-warning">
          {dl.label}
        </span>
      </div>
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-alt"
        role="presentation"
      >
        <span
          className={`block h-full rounded-full ${isConciliation ? "bg-[#714bd8]" : "bg-[#1b4c8c]"}`}
          style={{ width: `${dl.progress}%` }}
        />
      </div>
      <div className="flex justify-between text-[11px] font-medium text-muted">
        {MILESTONES.map((m) => (
          <span key={m.day} className="text-center">
            <span className="block font-semibold text-mirage">Day {m.day}</span>
            <span>{m.note}</span>
          </span>
        ))}
      </div>
      <p className="text-xs leading-relaxed text-muted">
        Start event: {startEvent} on {formatDateShort(dl.startDate)}. Reminders on Day 10,
        Day 13, and Day 15 are administrative notices, not legal conclusions.
      </p>
      {dl.derivedFromMeetingRecord ? (
        <p className="text-xs leading-relaxed text-muted">
          The start date above is taken from the first Meeting Record saved as conducted
          {actual?.date === dl.startDate ? ` (${formatDateShort(actual.date)})` : ""}, not from a
          scheduled hearing.
        </p>
      ) : null}
    </div>
  );
}