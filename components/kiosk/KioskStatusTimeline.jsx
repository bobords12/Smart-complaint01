"use client";

import { Check } from "lucide-react";

import { classifyStage, formatDateTime } from "@/lib/kiosk/format";

/**
 * The status timeline.
 *
 * Which stages appear is a legal question the kiosk must NOT answer, so
 * nothing here decides it from the narrative. The database does: it sets
 * `is_kp_case` only once a human confirmed the case is KP-eligible, and
 * `other_party_status` records what the complainant actually reported.
 * A summons or mediation stage is shown only when BOTH hold, because the
 * design says:
 *
 *   Complaint Filed -> Reviewed and Approved -> Summons Issued
 *                   -> In Mediation -> Settlement or Escalation
 *
 * Every other case gets the administrative chain instead:
 *
 *   Complaint Filed -> Under Review -> Routing Confirmed
 *                   -> Blotter Linked or Referred -> Completed or Closed
 *
 * A resident therefore never sees "Summons Issued" for a case with an
 * unknown respondent, for a service or administrative concern, or for a
 * complaint that was not accepted for mediation.
 *
 * Progress is the FURTHEST point reached, computed from the whole status
 * history plus the current stage, not from the current stage alone. A
 * case that reached mediation and is now awaiting a hearing has a
 * current_stage of "Awaiting Meeting", which matches no stage keyword;
 * reading only the current value would walk the timeline backwards and
 * tell the citizen they were still under review.
 */
const KP_STAGES = [
  { key: "filed", labelKey: "timeline.stage.filed" },
  { key: "reviewed", labelKey: "timeline.stage.reviewed" },
  { key: "summons", labelKey: "timeline.stage.summons" },
  { key: "mediation", labelKey: "timeline.stage.mediation" },
  { key: "settlement", labelKey: "timeline.stage.settlement" },
];

const ADMIN_STAGES = [
  { key: "filed", labelKey: "timeline.stage.filed" },
  { key: "underReview", labelKey: "timeline.stage.underReview" },
  { key: "routing", labelKey: "timeline.stage.routing" },
  { key: "linked", labelKey: "timeline.stage.linked" },
  { key: "closed", labelKey: "timeline.stage.closed" },
];

/**
 * Picks the stage list and how far along the case actually is.
 *
 * @returns {{ stages: Array, currentIndex: number, reachedAt: Array }}
 *   `reachedAt` runs parallel to `stages` and holds the timestamp the
 *   database recorded for that stage, or null if the case has not been
 *   there yet.
 */
export function resolveTimeline(payload) {
  const stages =
    payload?.is_kp_case === true && payload?.other_party_status === "known"
      ? KP_STAGES
      : ADMIN_STAGES;

  const history = Array.isArray(payload?.timeline) ? payload.timeline : [];
  const reachedAt = new Array(stages.length).fill(null);
  let furthest = 0;

  const observe = (stage, status, at) => {
    const key = classifyStage(stage, status);
    if (key === null) return;
    const index = stages.findIndex((item) => item.key === key);
    if (index === -1) return;
    // First match wins: later rows for the same stage are status notes
    // about that step, not the moment it was reached.
    if (reachedAt[index] === null && at) reachedAt[index] = at;
    if (index > furthest) furthest = index;
  };

  for (const entry of history) {
    observe(entry.stage, entry.status, entry.at);
  }

  // Current state last, so a case whose current value is further along
  // than anything recorded in the history still advances.
  observe(payload?.current_stage, payload?.current_status, payload?.last_updated_at);

  // Every complaint starts at "filed", even before any history row
  // exists, so the first stage is always reached.
  if (reachedAt[0] === null) reachedAt[0] = payload?.submitted_at || null;

  return { stages, currentIndex: furthest, reachedAt };
}

export default function KioskStatusTimeline({ payload, t, language }) {
  const { stages, currentIndex, reachedAt } = resolveTimeline(payload);

  return (
    <section className="kiosk-card kiosk-card-pad" aria-label={t("a11y.timelineProgress")}>
      <ol>
        {stages.map((stage, index) => {
          const done = index < currentIndex;
          const current = index === currentIndex;
          const when = reachedAt[index];
          const last = index === stages.length - 1;

          return (
            <li key={stage.key} className="relative flex gap-3.5 pb-5 last:pb-0">
              {/* Connector, drawn on every item but the last and
                  coloured for the stage it leaves behind. */}
              {last ? null : (
                <span
                  aria-hidden="true"
                  className={`absolute top-[26px] bottom-0 left-[11px] w-0.5 rounded ${
                    done ? "bg-success" : "bg-line"
                  }`}
                />
              )}

              <StageMarker done={done} current={current} />

              <div className="min-w-0 flex-1 pt-px">
                <p
                  className={`text-[14.5px] leading-snug font-semibold ${
                    done ? "text-success" : current ? "text-navy" : "text-muted"
                  }`}
                  aria-current={current ? "step" : undefined}
                >
                  {t(stage.labelKey)}
                </p>

                {/* Each stage states its own state in words, so the
                    distinction never rests on colour alone. */}
                <p className="mt-0.5 text-[12px] font-medium text-muted">
                  {done
                    ? t("timeline.reached")
                    : current
                      ? t("timeline.currentStage")
                      : t("timeline.notReached")}
                </p>

                {when ? (
                  <p className="mt-0.5 text-[12px] text-muted">
                    {formatDateTime(when, language)}
                  </p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/**
 * Green completed, navy current, muted future.
 *
 * Three different glyphs, not three colours: a check, a filled ring, and
 * a hollow ring. A resident who cannot tell navy from muted still reads
 * the right progress from the shape alone.
 */
function StageMarker({ done, current }) {
  if (done) {
    return (
      <span
        aria-hidden="true"
        className="relative z-[1] flex h-[23px] w-[23px] shrink-0 items-center justify-center rounded-full bg-success text-white"
      >
        <Check className="h-3.5 w-3.5" strokeWidth={3} />
      </span>
    );
  }

  if (current) {
    return (
      <span
        aria-hidden="true"
        className="relative z-[1] flex h-[23px] w-[23px] shrink-0 items-center justify-center rounded-full border-[3px] border-navy bg-white"
      >
        <span className="h-[7px] w-[7px] rounded-full bg-navy" />
      </span>
    );
  }

  return (
    <span
      aria-hidden="true"
      className="relative z-[1] h-[23px] w-[23px] shrink-0 rounded-full border-2 border-line bg-white"
    />
  );
}
