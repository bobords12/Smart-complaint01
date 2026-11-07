"use client";

import { CheckCircle2, CircleDashed, Clock } from "lucide-react";
import { formatDateTime } from "./complaintMeta";



export default function CaseTimeline({ caseStatuses = [], reviews = [], kpPhases = [], hearings = [], kpTracker }) {
  const events = [];

  const receivedEvent =
    caseStatuses.find(
      (cs) => cs.status === "Received" || cs.status === "For Official Categorization"
    ) || null;

  if (receivedEvent || kpTracker?.applicability_confirmed_at) {
    events.push({
      id: "applied",
      when: kpTracker?.applicability_confirmed_at || receivedEvent?.created_at,
      title: "Information and KP applicability reviewed",
      detail: "Accepted for barangay processing.",
    });
  }

  const latestReview = reviews[0];
  if (latestReview?.reviewed_at) {
    events.push({
      id: `categorization-${latestReview.id}`,
      when: latestReview.reviewed_at,
      title: "Official categorization confirmed",
      detail:
        [latestReview.confirmed_category, latestReview.confirmed_urgency].filter(Boolean).join(" · ") ||
        "Recorded as requiring further review.",
    });
  }

  for (const phase of kpPhases) {
    if (!phase.start_date) continue;
    const isConcil = (phase.phase_type || "").toLowerCase().includes("concil");
    events.push({
      id: `phase-${phase.id}`,
      when: phase.start_date,
      title: isConcil ? "Pangkat conciliation session started" : "Captain mediation meeting started",
      detail: `15-day deadline tracking began.`,
      status: phase.status,
    });
  }

  for (const h of hearings) {
    const when = h.hearing_date ? new Date(`${h.hearing_date}T${h.hearing_time || "00:00"}`) : null;
    if (!when) continue;
    const isFuture = when > new Date();
    events.push({
      id: `hearing-${h.id}`,
      when: when.toISOString(),
      title: `${h.title || "Hearing"}${isFuture ? " (scheduled)" : ""}`,
      detail: `${h.hearing_date ? formatDateTime(`${h.hearing_date}T${h.hearing_time || "00:00"}`) : ""} · ${h.venue || ""}`.trim().replace(/^·\s*/, ""),
      future: isFuture,
      status: h.status,
    });
  }

  const statusesByWhen = caseStatuses
    .filter((cs) => cs.created_at)
    .map((cs) => ({
      id: `status-${cs.id}`,
      when: cs.created_at,
      title: cs.stage || cs.status,
      detail: cs.resident_visible_message || "",
    }));
  events.push(...statusesByWhen);

  events.sort((a, b) => new Date(a.when) - new Date(b.when));

  const now = new Date();
  const terminal = events.find(
    (e) => e.status === "Settled" || e.status === "Completed Without Settlement"
  );

  if (terminal) {
    events.push({
      id: "outcome",
      when: terminal.when,
      title: terminal.status === "Settled" ? "Settlement recorded" : "Completed without settlement",
      detail: "Disposition recorded in the case record.",
    });
  }

  if (events.length === 0) {
    return (
      <p className="text-sm text-muted">No case progress has been recorded yet.</p>
    );
  }

  return (
    <ol className="relative space-y-0">
      {events.map((event, index) => {
        const done = !event.future && event.when && new Date(event.when) <= now;
        const isLast = index === events.length - 1;
        return (
          <li key={event.id || index} className="relative flex gap-4 pb-6 last:pb-0">
            {!isLast ? (
              <span
                aria-hidden="true"
                className={`absolute left-[10px] top-6 h-full w-px ${done ? "bg-secondary/40" : "bg-line"}`}
              />
            ) : null}
            <span className="relative z-10 flex h-5 w-5 shrink-0 items-center justify-center">
              {done ? (
                <CheckCircle2 className="h-5 w-5 text-success" aria-hidden="true" />
              ) : event.future ? (
                <Clock className="h-5 w-5 text-muted" aria-hidden="true" />
              ) : (
                <CircleDashed className="h-5 w-5 text-muted" aria-hidden="true" />
              )}
            </span>
            <div className="min-w-0 pt-0.5">
              <p className={`text-sm font-semibold ${done ? "text-navy" : event.future ? "text-muted" : "text-mirage"}`}>
                {event.title}
              </p>
              {event.detail ? (
                <p className="mt-0.5 text-xs leading-relaxed text-muted">{event.detail}</p>
              ) : null}
              {event.when ? (
                <p className={`mt-0.5 text-[11px] font-medium ${done ? "text-success" : "text-muted"}`}>
                  {formatDateTime(event.when)}
                </p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}