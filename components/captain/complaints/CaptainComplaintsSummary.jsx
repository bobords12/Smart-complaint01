"use client";

/**
 * Captain Portal -> Complaints: compact triage summary.
 *
 * CAPTAIN ONLY, and deliberately a single line rather than a row of
 * stat tiles. The shared ./ComplaintStats.jsx renders four tiles; this
 * keeps the counts the Captain uses to triage a mixed list without
 * turning the top of the page into an analytics block.
 *
 * OVERALL, NOT FILTERED. The page passes the full complaint dataset here on
 * purpose: this is a workload overview, so it must stay put while the list
 * below is filtered. The filtered result count is the "X of Y" beside the
 * filters.
 *
 * Every number is derived from the rows — nothing on this bar is literal.
 */

import {
  countsFor,
  isClosedComplaint,
  isCritical,
  stageOf,
  STAGE_KEYS,
} from "./complaintMeta";
import { isUnidentifiedIncident, isTwoPartyDispute } from "@/lib/captainComplaintWorkflow";
import { barClass } from "./captainWorkflowUi";

function Stat({ label, value, tone = "neutral" }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-1.5 w-1.5 rounded-full ${barClass(tone)}`} aria-hidden="true" />
      <span className="text-xs font-semibold text-mirage">{value}</span>
      <span className="text-xs text-muted">{label}</span>
    </span>
  );
}

export default function CaptainComplaintsSummary({ complaints = [], kpTrackerMap = {} }) {
  if (!complaints.length) return null;

  const counts = countsFor(complaints, kpTrackerMap);

  let active = 0;
  let awaitingReview = 0;
  let twoParty = 0;
  let unidentified = 0;
  let critical = 0;

  for (const c of complaints) {
    const kpTracker = kpTrackerMap[c.id];
    if (!isClosedComplaint(c, kpTracker)) active += 1;
    if (stageOf(c, kpTracker) === STAGE_KEYS.CHECK) awaitingReview += 1;
    if (isTwoPartyDispute(c)) twoParty += 1;
    if (isUnidentifiedIncident(c)) unidentified += 1;
    if (isCritical(c)) critical += 1;
  }

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-2xl border border-line bg-white px-5 py-3 shadow-soft">
      <Stat label="Active" value={active} />
      <Stat
        label="Awaiting Review"
        value={awaitingReview}
        tone={awaitingReview ? "warning" : "neutral"}
      />
      <Stat
        label="Needs Categorization"
        value={counts.categorization}
        tone={counts.categorization ? "warning" : "neutral"}
      />
      <Stat label="Two-Party Cases" value={twoParty} tone="ok" />
      {/* What this counts is a complaint with no identified OTHER PARTY —
          a theft or damage report against an unknown suspect, which cannot
          go to mediation. The schema has no anonymous-complainant column:
          a full complainant name is required at submission on every filing
          path, so counting "no name on record" here would only ever be
          counting broken data. */}
      <Stat
        label="Unidentified Respondents"
        value={unidentified}
        tone={unidentified ? "critical" : "neutral"}
      />
      <Stat label="Critical" value={critical} tone={critical ? "critical" : "neutral"} />
    </div>
  );
}
