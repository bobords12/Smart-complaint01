"use client";

import {
  stageOf,
  STAGE_META,
  resolveConfirmedCategory,
  resolveConfirmedUrgency,
  nextActionFor,
  deadlineInfo,
} from "./complaintMeta";

function Cell({ label, children }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 truncate text-sm font-semibold text-mirage">{children}</p>
    </div>
  );
}

export default function CaseSummary({ complaint, kpTracker, hearings }) {
  const stage = stageOf(complaint, kpTracker);
  const next = nextActionFor(complaint, { hearings, kpTracker });
  const dl = deadlineInfo(kpTracker);

  return (
    <section
      aria-label="Case summary"
      className="grid grid-cols-1 gap-4 rounded-2xl border border-line bg-white p-5 shadow-soft sm:grid-cols-2 lg:grid-cols-5"
    >
      <Cell label="Current Stage">{STAGE_META[stage].label}</Cell>
      <Cell label="Confirmed Type">
        {resolveConfirmedCategory(complaint) || "Not yet set"}
      </Cell>
      <Cell label="Confirmed Urgency">
        {resolveConfirmedUrgency(complaint) || "Not yet set"}
      </Cell>
      <Cell label="Next Action">{next.value}</Cell>
      <Cell label="Active Deadline">{dl.hasDeadline ? dl.label : "Not yet set"}</Cell>
    </section>
  );
}