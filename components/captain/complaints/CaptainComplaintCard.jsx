"use client";

/**
 * Captain Portal -> Complaints: complaint card.
 *
 * CAPTAIN ONLY. This file exists as a separate component from
 * ./ComplaintCard.jsx on purpose. ComplaintCard.jsx is imported by the
 * OIC and Secretary portals as well, so editing it in place would
 * redesign pages outside the scope of this task. Nothing outside the
 * Captain route imports this file.
 *
 * WHAT IS ON THE CARD
 *   Only what the Captain needs to identify a case and decide where to
 *   click: who filed it, what it is about, what kind of case it is,
 *   where it sits, how urgent it is, and what happens next. Everything
 *   else — evidence, narrative, hearings, documents — is on the case
 *   file, and duplicating it here is what made the previous list hard
 *   to scan.
 */

import { memo, useCallback } from "react";
import { ArrowRight, FileQuestion, Siren } from "lucide-react";
import {
  resolveComplainantName,
  resolveReference,
  resolveConfirmedCategory,
  resolveConfirmedUrgency,
  resolvePredictedCategory,
  stageOf,
  STAGE_META,
} from "./complaintMeta";
import {
  situationOf,
  isUnidentifiedIncident,
  summonsStateFor,
  absenceSummaryFor,
  attendanceRowsFor,
  currentAndNextAction,
} from "@/lib/captainComplaintWorkflow";
import { WorkflowChip, barClass } from "./captainWorkflowUi";

const URGENCY_TONE = {
  Critical: "critical",
  High: "warning",
  Normal: "info",
};

function formatDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function CaptainComplaintCard({ complaint, workflow, onOpen }) {
  // `onOpen` is the same function instance for every card, so it is called
  // with this card's id rather than a fresh per-card closure. Combined with
  // the memo below and the memoised workflow context in the grid, a card
  // whose complaint and workflow data are unchanged no longer re-renders
  // when a sibling card does.
  const complaintId = complaint?.id;
  const open = useCallback(() => {
    onOpen?.(complaintId);
  }, [onOpen, complaintId]);
  const stage = stageOf(complaint, workflow?.kpTracker);
  const stageMeta = STAGE_META[stage] || STAGE_META.check;

  const situation = situationOf(complaint);
  const unidentified = isUnidentifiedIncident(complaint);

  const confirmedCategory = resolveConfirmedCategory(complaint);
  const confirmedUrgency = resolveConfirmedUrgency(complaint);
  const predictedCategory = resolvePredictedCategory(complaint);

  const attendanceRows = attendanceRowsFor(
    workflow?.hearings,
    workflow?.attendances,
    workflow?.minutes
  );
  const absence = absenceSummaryFor(workflow?.attendances);
  const summons = summonsStateFor({
    summons: workflow?.summons,
    serviceRecords: workflow?.serviceRecords,
    documents: workflow?.documents,
    hearings: workflow?.hearings,
  });

  const actions = currentAndNextAction(complaint, workflow);

  // The accent bar follows the situation, because that is the first
  // thing a Captain needs to separate when scanning a mixed list:
  // a case that can be mediated is not the same as a case that cannot.
  const accent = unidentified
    ? "critical"
    : absence.respondent.absent
      ? "warning"
      : complaint?.confirmed_category
        ? situation.tone
        : "warning";

  const categoryLabel = confirmedCategory
    ? confirmedCategory
    : predictedCategory
      ? `${predictedCategory} (AI suggestion)`
      : "Not yet classified";

  const urgencyLabel = confirmedUrgency || complaint?.predicted_urgency || null;
  const isKiosk = !complaint?.isDemo && typeof complaint?.filing_channel === "string" &&
    complaint.filing_channel.trim().toLowerCase() === "kiosk";

  return (
    <article
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          open();
        }
      }}
      aria-label={`View complaint ${resolveReference(complaint)} filed by ${resolveComplainantName(complaint)}`}
      className="group flex cursor-pointer flex-col overflow-hidden rounded-2xl border border-line bg-white shadow-soft transition-shadow hover:shadow-float focus-visible:outline-2 focus-visible:outline-secondary"
    >
      <span className={`h-1 shrink-0 ${barClass(accent)}`} aria-hidden="true" />

      <div className="flex flex-1 flex-col gap-3.5 p-5">
        {/* Identity: reference + urgency, the two things that sort first. */}
        <div className="flex items-start justify-between gap-3">
          <p className="min-w-0 font-mono text-[11px] font-semibold uppercase tracking-wide text-muted">
            {resolveReference(complaint)}
            {isKiosk ? (
              <span className="ml-2 inline-flex items-center rounded-full bg-info-soft px-2 py-0.5 font-sans text-[10px] font-semibold normal-case tracking-normal text-secondary">
                Kiosk
              </span>
            ) : null}
            {complaint.isDemo ? <span className="ml-2 font-sans normal-case">Sample Case · Demo only</span> : null}
          </p>
          {urgencyLabel ? (
            <WorkflowChip tone={URGENCY_TONE[urgencyLabel] || "neutral"}>
              {urgencyLabel === "Critical" ? (
                <Siren className="h-3 w-3" aria-hidden="true" />
              ) : null}
              {urgencyLabel}
            </WorkflowChip>
          ) : null}
        </div>

        <div className="min-w-0">
          <h2 className="line-clamp-2 font-heading text-base font-semibold leading-snug text-navy">
            {complaint.title || "Untitled complaint"}
          </h2>
          <p className="mt-1 truncate text-xs text-muted">
            {resolveComplainantName(complaint)}
          </p>
        </div>

        {/* Situation and stage: the two chips that decide the workflow. */}
        <div className="flex flex-wrap items-center gap-1.5">
          <WorkflowChip tone={situation.tone}>{situation.short}</WorkflowChip>
          <WorkflowChip tone={unidentified ? "critical" : "info"}>{complaint.isDemo ? complaint.current_status : stageMeta.short}</WorkflowChip>
          {/* Recorded absences, counted as written down facts. This used
              to read "3rd no-show" once a threshold was reached, which
              turned a recorded attendance entry into a legal
              conclusion on the list view. */}
          {absence.respondent.absent ? (
            <WorkflowChip tone="warning">
              {absence.respondent.absent} recorded absence
              {absence.respondent.absent === 1 ? "" : "s"}
            </WorkflowChip>
          ) : null}
        </div>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 border-y border-line py-3 text-xs">
          <div className="min-w-0">
            <dt className="font-medium uppercase tracking-wide text-muted">Filed</dt>
            <dd className="mt-0.5 truncate font-semibold text-mirage">
              {formatDate(complaint.submitted_at)}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="font-medium uppercase tracking-wide text-muted">Updated</dt>
            <dd className="mt-0.5 truncate font-semibold text-mirage">
              {formatDate(complaint.updated_at || complaint.submitted_at)}
            </dd>
          </div>
          <div className="col-span-2 min-w-0">
            <dt className="font-medium uppercase tracking-wide text-muted">Category</dt>
            <dd className="mt-0.5 flex items-center gap-1.5 truncate font-semibold text-mirage">
              {!confirmedCategory && predictedCategory ? (
                <FileQuestion className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden="true" />
              ) : null}
              {categoryLabel}
            </dd>
          </div>
        </dl>

        {/* One line of workflow state, taken from the same derivation
            the case file uses, so the two can never disagree. */}
        <p className="text-xs leading-relaxed text-muted">
          {complaint.isDemo ? "Read-only example of the barangay complaint process." : <>
            <span className="font-semibold uppercase tracking-wide text-navy">Next </span>
            {actions.next}
          </>}
        </p>

        <div className="mt-auto flex items-center justify-end pt-1">
          <span className="inline-flex items-center gap-1 text-sm font-semibold text-secondary">
            View Details
            <ArrowRight
              className="h-4 w-4 transition-transform group-hover:translate-x-0.5"
              aria-hidden="true"
            />
          </span>
        </div>
      </div>
    </article>
  );
}

export default memo(CaptainComplaintCard);
