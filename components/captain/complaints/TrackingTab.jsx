"use client";

import { CalendarClock, StickyNote } from "lucide-react";
import Panel from "./Panel";
import DeadlineTracker from "./DeadlineTracker";
import CaseTimeline from "./CaseTimeline";
import {
  stageOf,
  STAGE_META,
  formatDateShort,
  formatTime,
  formatDateTime,
} from "./complaintMeta";

const NEXT_STAGE_LABELS = {
  check: "Captain mediation",
  mediation: "Pangkat formation",
  conciliation: "Settlement document",
  closed: "Archival",
};

export default function TrackingTab({ complaint, kpTracker, kpPhases, caseStatuses, reviews, hearings, internalNotes }) {
  const stage = stageOf(complaint, kpTracker);
  const completedHearings = (hearings || []).filter((h) => h.status === "Completed");
  const upcoming = (hearings || [])
    .filter((h) => ["Upcoming", "Scheduled", "Confirmed"].includes(h.status))
    .sort((a, b) => new Date(`${a.hearing_date}T${a.hearing_time || "00:00"}`) - new Date(`${b.hearing_date}T${b.hearing_time || "00:00"}`))[0];

  const { hasDeadline, label: deadlineLabel } =
    kpTracker && kpPhases
      ? deadlineOf(kpTracker, kpPhases)
      : { hasDeadline: false, label: "Not started" };

  return (
    <div className="space-y-4">
      <p className="rounded-xl border border-gold-soft bg-paledgold px-4 py-3 text-xs leading-relaxed text-mirage">
        <strong className="font-semibold text-warning">Correct legal basis:</strong> The 15-day
        mediation period begins from the parties’ first meeting before the Punong Barangay—not
        from the summons delivery date. The Pangkat period begins when the Pangkat convenes.
      </p>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel
          title="Active Deadline"
          tag={hasDeadline ? deadlineLabel : "Not started"}
          tagClass={
            hasDeadline && deadlineLabel?.includes("remaining")
              ? "bg-warning-soft text-warning"
              : "bg-alt text-muted"
          }
          className="lg:col-span-2"
        >
          <DeadlineTracker kpTracker={kpTracker} kpPhases={kpPhases} />
        </Panel>

        <Panel title="Stage Summary">
          <div className="space-y-4">
            <SummaryRow label="Current Phase">{STAGE_META[stage].label}</SummaryRow>
            <SummaryRow label="Meetings Held">{completedHearings.length}</SummaryRow>
            <SummaryRow label="Next Meeting">
              {upcoming
                ? `${formatDateShort(upcoming.hearing_date)} · ${formatTime(upcoming.hearing_time)}`
                : "—"}
            </SummaryRow>
            <SummaryRow label="Potential Next Stage">{NEXT_STAGE_LABELS[stage]}</SummaryRow>
          </div>
        </Panel>
      </div>

      <Panel title="Complete Case Progress">
        <CaseTimeline
          caseStatuses={caseStatuses}
          reviews={reviews}
          kpPhases={kpPhases}
          hearings={hearings}
          kpTracker={kpTracker}
        />
      </Panel>

      <Panel title="Internal Notes" tag="Officials only">
        {internalNotes.length === 0 ? (
          <p className="text-sm text-muted">
            No internal notes yet. Use “Add Internal Note” to record one.
          </p>
        ) : (
          <ul className="space-y-3">
            {internalNotes.map((note) => (
              <li key={note.id} className="rounded-xl border border-line bg-canvas px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-secondary">
                    <StickyNote className="h-3 w-3" aria-hidden="true" />
                    {note.is_resident_visible ? "Notice to parties" : "Internal note"}
                  </p>
                  <time className="text-[11px] text-muted">{formatDateTime(note.created_at)}</time>
                </div>
                <p className="mt-1.5 whitespace-pre-line text-sm leading-relaxed text-mirage">{note.note}</p>
                <p className="mt-1 text-[11px] text-muted">
                  {note.is_resident_visible ? "Visible to resident" : "Internal only"} ·{" "}
                  {note.author_id ? "By official" : "By system"}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function deadlineOf(kpTracker, kpPhases) {
  const phases = (kpPhases || []).filter((p) => p.start_date && !p.completed_at);
  if (phases.length === 0) return { hasDeadline: false, label: "Not started" };
  const phase = phases[phases.length - 1];
  return {
    hasDeadline: true,
    label: `${phase.deadline_date ? daysLabel(phase.deadline_date) : "Active"}`,
  };
}

function daysLabel(deadlineIso) {
  const diff = Math.ceil((new Date(deadlineIso) - new Date()) / 86400000);
  if (diff <= 0) return "Deadline reached";
  return `${diff} day${diff === 1 ? "" : "s"} remaining`;
}

function SummaryRow({ label, children }) {
  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-0.5 text-sm font-semibold text-mirage">{children || "—"}</p>
    </div>
  );
}