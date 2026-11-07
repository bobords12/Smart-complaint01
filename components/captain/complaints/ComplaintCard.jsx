"use client";

import { ChevronRight } from "lucide-react";
import {
  stageOf,
  STAGE_META,
  resolveComplainantName,
  resolveConfirmedCategory,
  resolveConfirmedUrgency,
  resolvePredictedCategory,
  nextActionFor,
  deadlineInfo,
  progressPercent,
} from "./complaintMeta";
import {
  PARTY_FACING_ROUTES,
  complaintNatureMeta,
  routingCta,
  routingGate,
  routingNextAction,
  routingStatusMeta,
} from "@/lib/captainComplaintRouting";

const ROUTING_KINDS = [
  "routing",
  "completeness",
  "incident",
  "blotter",
  "assistance",
  "decision",
];

export default function ComplaintCard({
  complaint,
  kpTracker,
  hearings,
  blotterRecord = null,
  incidentRecorded = false,
  assistanceRecorded = false,
  onOpen,
}) {
  const stage = stageOf(complaint, kpTracker);
  const meta = STAGE_META[stage];
  const gate = routingGate(complaint);

  const confirmedCat = resolveConfirmedCategory(complaint);
  const confirmedUrgency = resolveConfirmedUrgency(complaint);
  const hasConfirmed = Boolean(confirmedCat && confirmedUrgency);

  const predicted = resolvePredictedCategory(complaint);
  const aiUrgency = complaint?.predicted_urgency;

  const assessLabel = hasConfirmed ? "Confirmed Assessment" : "AI Suggestion";
  const assessValue = hasConfirmed
    ? `${confirmedCat} · ${confirmedUrgency}`
    : predicate(complaint, predicted, aiUrgency);

  const routeMeta = routingStatusMeta(complaint?.routing_status);
  const natureMeta = complaintNatureMeta(complaint?.complaint_nature);
  const isKpRoute = PARTY_FACING_ROUTES.includes(complaint?.routing_status);

  // For a KP case the right-hand cell keeps the 15-day answer; for any
  // other route a mediation deadline is meaningless, so the cell states
  // the route instead.
  const metaRightLabel = hasConfirmed && isKpRoute ? "Deadline" : "Case route";
  const metaRightValue = hasConfirmed && isKpRoute
    ? deadlineInfo(kpTracker).hasDeadline
      ? `${deadlineInfo(kpTracker).detail} of ${deadlineInfo(kpTracker).total}`
      : "Tracker pending first meeting"
    : routeMeta.short === "Unassessed"
      ? "Awaiting route"
      : routeMeta.short;

  const cta = routingCta(complaint, {
    hasBlotter: Boolean(blotterRecord),
    hasIncidentDetails: incidentRecorded,
    hasAssistance: assistanceRecorded,
    isReceived: Boolean(complaint?.official_received_at),
  });

  let next;
  if (!gate.open && partyless(complaint)) {
    // A case with no one to summon still has an honest next step, and
    // complaint.nature/route tell us which one the card can name.
    next = { label: "Next required action", value: cta.label };
  } else if (!gate.open) {
    next =
      routingNextAction(complaint) || { label: "Next action", value: "Routing Assessment" };
  } else if (ROUTING_KINDS.includes(cta.kind)) {
    next = { label: "Next required action", value: cta.label };
  } else {
    next = nextActionFor(complaint, { hearings, kpTracker });
  }

  const progress = progressPercent(complaint);

  return (
    <article
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
      aria-label={`Open case: ${complaint.title || "Untitled complaint"}`}
      className="group flex cursor-pointer flex-col overflow-hidden rounded-2xl border border-line bg-white shadow-soft transition-shadow hover:shadow-float focus-visible:outline-2 focus-visible:outline-secondary"
    >
      <span className={`h-1 shrink-0 ${meta.bar}`} aria-hidden="true" />
      <div className="flex flex-1 flex-col gap-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate font-heading text-base font-semibold text-navy">
              {complaint.title || "Untitled complaint"}
            </h2>
            <p className="mt-0.5 truncate text-xs text-muted">
              {complaint.reference_number || "No reference"} ·{" "}
              {resolveComplainantName(complaint)}
            </p>
          </div>
          <span
            className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold ${meta.badge}`}
          >
            {meta.short}
          </span>
        </div>

        {!gate.open && !partyless(complaint) ? (
          <p className="rounded-xl bg-warning-soft px-4 py-2.5 text-xs font-semibold leading-relaxed text-warning">
            Routing assessment needed — summons and mediation are unavailable until a respondent is
            identified and KP applicability is confirmed.
          </p>
        ) : null}

        {!gate.open && partyless(complaint) ? (
          <p className="rounded-xl bg-alt px-4 py-2.5 text-xs font-medium leading-relaxed text-muted">
            No party can be summoned on this case. The barangay records the incident rather than
            holding a hearing —{" "}
            <span className="font-semibold text-mirage">{cta.label.toLowerCase()}.</span>
          </p>
        ) : null}

        <div className="grid grid-cols-2 gap-3 border-b border-line pb-4">
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted">
              {assessLabel}
            </p>
            <p className="mt-0.5 truncate text-sm font-semibold text-mirage">
              {assessValue}
            </p>
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted">
              {metaRightLabel}
            </p>
            <p className="mt-0.5 truncate text-sm font-semibold text-mirage">
              {metaRightValue}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <CardTag tone="neutral">{routeMeta.short}</CardTag>
          {natureMeta ? <CardTag tone="info">{natureMeta.short}</CardTag> : null}
          {blotterRecord ? (
            <CardTag tone="ok">Blotter {blotterRecord.blotter_number}</CardTag>
          ) : null}
        </div>

        <div>
          <div className="flex items-center justify-between text-[11px] font-medium text-muted">
            <span className="uppercase tracking-wide">Workflow</span>
            <span>{progress}%</span>
          </div>
          <div
            className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-alt"
            role="presentation"
          >
            <span
              className={`block h-full rounded-full ${meta.bar}`}
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        <div className="mt-auto flex items-end justify-between gap-3">
          <span className="min-w-0">
            <span className="block text-[11px] uppercase tracking-wide text-muted">
              {next.label}
            </span>
            <span className="block truncate text-sm font-semibold text-mirage">
              {next.value}
            </span>
          </span>
          <span className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-secondary">
            Open case
            <ChevronRight
              className="h-4 w-4 transition-transform group-hover:translate-x-0.5"
              aria-hidden="true"
            />
          </span>
        </div>
      </div>
    </article>
  );
}

function CardTag({ tone, children }) {
  const tones = {
    neutral: "border-line bg-alt text-muted",
    info: "border-[#1b4c8c]/20 bg-info-soft text-secondary",
    ok: "border-[#17774e]/25 bg-success-soft text-success",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold ${tones[tone] || tones.neutral}`}
    >
      {children}
    </span>
  );
}

/** True when the case walks the no-one-to-summon pathway. */
function partyless(complaint) {
  return (
    complaint?.complaint_nature === "reported_incident" ||
    REFERRAL_LIKE(complaint) ||
    ["unknown", "insufficient_information", "not_applicable"].includes(
      complaint?.respondent_status
    )
  );
}

function REFERRAL_LIKE(complaint) {
  return ["police_reporting_assistance", "external_agency_assistance", "incident_documentation"].includes(
    complaint?.routing_status
  );
}

function predicate(complaint, predicted, aiUrgency) {
  const parts = [
    predicted || (complaint?.predicted_case_type ? complaint.predicted_case_type : "Undefined"),
  ];
  if (aiUrgency) parts.push(aiUrgency);
  else if (!predicted) parts.push("Pending");
  return parts.join(" · ");
}