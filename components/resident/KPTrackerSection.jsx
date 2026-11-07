"use client";

import { Clock, Info } from "lucide-react";
import StatusBadge from "@/components/shared/StatusBadge";
import {
  elapsedDays,
  remainingDays,
  clampProgress,
  isDueSoon,
  formatDateLong,
} from "@/lib/kpDateUtils";

/* ── KP Phase Badge ─────────────────────────────────────────────────── */

function KPPhaseBadge({ phase }) {
  const colors = {
    Assessment: "bg-warning-soft text-warning",
    Mediation: "bg-info-soft text-secondary",
    Conciliation: "bg-info-soft text-secondary",
    "Conciliation Extension": "bg-warning-soft text-warning",
    Completed: "bg-success-soft text-success",
    "Not Applicable": "bg-alt text-muted",
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-semibold ring-1 ring-inset ${colors[phase] ?? "bg-alt text-muted"}`}
    >
      {phase}
    </span>
  );
}

/* ── Shared sub-components ─────────────────────────────────────────── */

function TrackerCard({ children, remainingBadge }) {
  return (
    <div className="mt-6 rounded-2xl border border-line bg-white dark:bg-alt p-5 sm:p-6 shadow-[0_1px_2px_rgba(11,33,68,0.06)]">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[13px] font-semibold uppercase tracking-wide text-muted">
          Deadline
        </h2>
        {remainingBadge}
      </div>
      {children}
    </div>
  );
}

function PhaseTitle({ title }) {
  return <p className="mt-4 text-base font-semibold text-navy dark:text-secondary">{title}</p>;
}

function RemainingBadge({ days, variant = "default" }) {
  const colors = {
    default: "bg-success-soft text-success",
    warning: "bg-warning-soft text-warning",
    critical: "bg-critical-soft text-critical",
  };
  return (
    <div
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold ${colors[variant]}`}
    >
      <Clock className="h-3.5 w-3.5" aria-hidden="true" />
      {days > 0 ? `${days}d left` : "0d left"}
    </div>
  );
}

function ProgressBar({ pct, label }) {
  return (
    <div className="mt-4">
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-line">
        <div
          className="h-full rounded-full bg-secondary transition-all"
          style={{ width: `${pct}%` }}
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={label}
        />
      </div>
    </div>
  );
}

function PhaseHistory({ phases }) {
  if (!phases || phases.length === 0) return null;

  return (
    <div className="mt-5 border-t border-line/70 pt-4">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted">
        History
      </h3>
      <div className="mt-3 space-y-3">
        {phases.map((phase) => (
          <div
            key={phase.id}
            className="rounded-xl border border-line/50 bg-canvas px-4 py-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <KPPhaseBadge phase={phase.phase} />
                <StatusBadge label={phase.status} />
              </div>
              <span className="text-[12px] text-muted">
                {phase.durationDays} days
              </span>
            </div>
            <div className="mt-2 flex flex-wrap gap-4 text-[13px] text-mirage">
              <span>
                Start:{" "}
                <span className="font-medium">
                  {formatDateLong(phase.startDate)}
                </span>
              </span>
              <span>
                Deadline:{" "}
                <span className="font-medium">
                  {formatDateLong(phase.deadlineDate)}
                </span>
              </span>
              {phase.completedAt && (
                <span>
                  Completed:{" "}
                  <span className="font-medium">
                    {formatDateLong(phase.completedAt)}
                  </span>
                </span>
              )}
            </div>
            {phase.outcome && (
              <p className="mt-1.5 text-[13px] text-muted">{phase.outcome}</p>
            )}
            {phase.extensionDays && (
              <p className="mt-1 text-[12px] text-muted">
                Extension: {phase.extensionDays} days
                {phase.extensionReason && ` \u2014 ${phase.extensionReason}`}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function NotStartedMediation() {
  return (
    <TrackerCard>
      <div className="flex items-start gap-3 rounded-xl bg-canvas px-4 py-3">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-alt">
          <Clock className="h-4 w-4 text-muted" aria-hidden="true" />
        </div>
        <div>
          <p className="text-sm font-semibold text-navy dark:text-secondary">
            Awaiting Mediation
          </p>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            The 15-day mediation period has not started.
          </p>
        </div>
      </div>
    </TrackerCard>
  );
}

function NotStartedConciliation() {
  return (
    <TrackerCard>
      <div className="flex items-start gap-3 rounded-xl bg-canvas px-4 py-3">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-alt">
          <Clock className="h-4 w-4 text-muted" aria-hidden="true" />
        </div>
        <div>
          <p className="text-sm font-semibold text-navy dark:text-secondary">
            Awaiting Conciliation
          </p>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            Mediation ended. Conciliation begins when the Pangkat convenes.
          </p>
        </div>
      </div>
    </TrackerCard>
  );
}

/* ── Main KP Tracker View ──────────────────────────────────────────── */

function KPTrackerView({ tracker }) {
  const now = new Date().toISOString();
  const currentPhase = tracker.currentPhase;

  // ── Not Applicable ───────────────────────────────────────────────
  if (currentPhase === "Not Applicable") {
    return (
      <TrackerCard>
        <div className="flex items-start gap-3 rounded-xl bg-canvas px-4 py-3">
          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-alt">
            <Clock className="h-4 w-4 text-muted" aria-hidden="true" />
          </div>
          <div>
          <p className="text-sm font-semibold text-navy dark:text-secondary">Not Applicable</p>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            No mediation tracker for this complaint.
          </p>
          </div>
        </div>
      </TrackerCard>
    );
  }

  // ── Assessment (applicability under review) ──────────────────────
  if (currentPhase === "Assessment" && !tracker.applicable) {
    return (
      <TrackerCard>
        <div className="flex items-start gap-3 rounded-xl bg-canvas px-4 py-3">
          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-warning-soft">
            <Info className="h-4 w-4 text-warning" aria-hidden="true" />
          </div>
          <div>
            <p className="text-sm font-semibold text-navy dark:text-secondary">
              Applicability Under Review
            </p>
            <p className="mt-1 text-sm leading-relaxed text-muted">
              Staff has not yet confirmed KP applicability.
            </p>
          </div>
        </div>
      </TrackerCard>
    );
  }

  // ── Assessment (applicable, no phases yet) ───────────────────────
  if (currentPhase === "Assessment" && tracker.applicable) {
    return (
      <TrackerCard>
        <div className="flex items-start gap-3 rounded-xl bg-canvas px-4 py-3">
          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-info-soft">
            <Info className="h-4 w-4 text-secondary" aria-hidden="true" />
          </div>
          <div>
            <p className="text-sm font-semibold text-navy dark:text-secondary">
              Awaiting Mediation
            </p>
            <p className="mt-1 text-sm leading-relaxed text-muted">
              The 15-day mediation period has not started.
            </p>
          </div>
        </div>
        {tracker.applicabilityConfirmedAt && (
          <p className="mt-3 text-[12px] text-muted">
            KP applicability confirmed:{" "}
            <span className="font-medium text-mirage">
              {formatDateLong(tracker.applicabilityConfirmedAt)}
            </span>
          </p>
        )}
      </TrackerCard>
    );
  }

  // ── Active Mediation ─────────────────────────────────────────────
  if (currentPhase === "Mediation") {
    const mediationPhase = tracker.phases.find((p) => p.phase === "Mediation");
    if (!mediationPhase) return <NotStartedMediation />;

    const elapsed = elapsedDays(mediationPhase.startDate, now);
    const remaining = remainingDays(mediationPhase.deadlineDate, now);
    const pct = clampProgress(elapsed, mediationPhase.durationDays);
    const dueSoon = isDueSoon(mediationPhase.deadlineDate, now);

    let statusLabel = "Active";
    if (remaining <= 0) {
      statusLabel = "Period Elapsed";
    } else if (dueSoon) {
      statusLabel = "Due Soon";
    }

    return (
      <TrackerCard
        remainingBadge={
          remaining > 0 ? (
            <RemainingBadge
              days={remaining}
              variant={dueSoon ? "warning" : "default"}
            />
          ) : (
            <RemainingBadge days={0} variant="critical" />
          )
        }
      >
        <PhaseTitle title="Mediation" />
        <div className="mt-3 flex items-center gap-2">
          <KPPhaseBadge phase="Mediation" />
          <StatusBadge label={statusLabel} />
        </div>

        <p className="mt-4 text-2xl font-bold text-navy dark:text-secondary">
          Day {Math.min(elapsed, mediationPhase.durationDays)} of{" "}
          {mediationPhase.durationDays}
        </p>
        <p className="mt-0.5 text-sm text-muted">
          {remaining > 0
            ? `${remaining} days left`
            : "Period elapsed"}
        </p>

        <ProgressBar
          pct={pct}
          label={`Mediation progress: ${elapsed} of ${mediationPhase.durationDays} days`}
        />

        <div className="mt-3 flex flex-wrap gap-4 text-sm text-mirage">
          <p>
            Started{" "}
            <span className="font-semibold">
              {formatDateLong(mediationPhase.startDate)}
            </span>
          </p>
          <p>
            Deadline{" "}
            <span className="font-semibold">
              {formatDateLong(mediationPhase.deadlineDate)}
            </span>
          </p>
        </div>

        <div className="mt-3 flex items-start gap-2.5 rounded-xl bg-canvas px-4 py-3">
          <Info
            className="mt-0.5 h-4 w-4 shrink-0 text-secondary"
            aria-hidden="true"
          />
          <p className="text-[13px] leading-relaxed text-secondary">
            Counted from the phase&apos;s official start date.
          </p>
        </div>

        <PhaseHistory phases={tracker.phases} />
      </TrackerCard>
    );
  }

  // ── Awaiting Pangkat (completed mediation, no conciliation yet) ──
  if (currentPhase === "Completed") {
    const mediationPhase = tracker.phases.find((p) => p.phase === "Mediation");
    return (
      <TrackerCard>
        <div className="flex items-start gap-3 rounded-xl bg-canvas px-4 py-3">
          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-info-soft">
            <Info className="h-4 w-4 text-secondary" aria-hidden="true" />
          </div>
          <div>
            <p className="text-sm font-semibold text-navy dark:text-secondary">
            Awaiting Conciliation
          </p>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            Mediation ended. Conciliation begins when the Pangkat convenes.
          </p>
          </div>
        </div>
        {mediationPhase && (
          <div className="mt-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
              Result
            </p>
            <p className="mt-1 text-sm text-mirage">
              {mediationPhase.outcome ?? "No settlement"}
            </p>
            {mediationPhase.completedAt && (
              <p className="mt-0.5 text-[12px] text-muted">
                Completed: {formatDateLong(mediationPhase.completedAt)}
              </p>
            )}
          </div>
        )}
        <PhaseHistory phases={tracker.phases} />
      </TrackerCard>
    );
  }

  // ── Active Conciliation ──────────────────────────────────────────
  if (currentPhase === "Conciliation") {
    const concPhase = tracker.phases.find(
      (p) => p.phase === "Conciliation" && !p.extensionDays
    );
    if (!concPhase) return <NotStartedConciliation />;

    const elapsed = elapsedDays(concPhase.startDate, now);
    const remaining = remainingDays(concPhase.deadlineDate, now);
    const pct = clampProgress(elapsed, concPhase.durationDays);
    const dueSoon = isDueSoon(concPhase.deadlineDate, now);

    let statusLabel = "Active";
    if (remaining <= 0) {
      statusLabel = "Period Elapsed";
    } else if (dueSoon) {
      statusLabel = "Due Soon";
    }

    return (
      <TrackerCard
        remainingBadge={
          remaining > 0 ? (
            <RemainingBadge
              days={remaining}
              variant={dueSoon ? "warning" : "default"}
            />
          ) : (
            <RemainingBadge days={0} variant="critical" />
          )
        }
      >
        <PhaseTitle title="Conciliation" />
        <div className="mt-3 flex items-center gap-2">
          <KPPhaseBadge phase="Conciliation" />
          <StatusBadge label={statusLabel} />
        </div>

        <p className="mt-4 text-2xl font-bold text-navy dark:text-secondary">
          Day {Math.min(elapsed, concPhase.durationDays)} of{" "}
          {concPhase.durationDays}
        </p>
        <p className="mt-0.5 text-sm text-muted">
          {remaining > 0
            ? `${remaining} days left`
            : "Period elapsed"}
        </p>

        <ProgressBar
          pct={pct}
          label={`Conciliation progress: ${elapsed} of ${concPhase.durationDays} days`}
        />

        <div className="mt-3 flex flex-wrap gap-4 text-sm text-mirage">
          <p>
            Pangkat convened{" "}
            <span className="font-semibold">
              {formatDateLong(concPhase.startDate)}
            </span>
          </p>
          <p>
            Initial deadline{" "}
            <span className="font-semibold">
              {formatDateLong(concPhase.deadlineDate)}
            </span>
          </p>
        </div>

        <div className="mt-3 flex items-start gap-2.5 rounded-xl bg-canvas px-4 py-3">
          <Info
            className="mt-0.5 h-4 w-4 shrink-0 text-secondary"
            aria-hidden="true"
          />
          <p className="text-[13px] leading-relaxed text-secondary">
            Counted from the Pangkat&apos;s convening date.
          </p>
        </div>

        <PhaseHistory phases={tracker.phases} />
      </TrackerCard>
    );
  }

  // ── Extended Conciliation ────────────────────────────────────────
  if (currentPhase === "Conciliation Extension") {
    const extPhase = tracker.phases.find(
      (p) => p.phase === "Conciliation Extension"
    );
    const concPhase = tracker.phases.find(
      (p) => p.phase === "Conciliation" && !p.extensionDays
    );

    if (!extPhase) return <NotStartedConciliation />;

    const elapsed = elapsedDays(extPhase.startDate, now);
    const remaining = remainingDays(extPhase.deadlineDate, now);
    const pct = clampProgress(elapsed, extPhase.durationDays);

    let statusLabel = "Extended";
    if (remaining <= 0) {
      statusLabel = "Period Elapsed";
    }

    return (
      <TrackerCard remainingBadge={<StatusBadge label="Extended" />}>
        <PhaseTitle title="Conciliation" />
        <div className="mt-3 flex items-center gap-2">
          <KPPhaseBadge phase="Conciliation Extension" />
          <StatusBadge label={statusLabel} />
        </div>

        <div className="mt-4 rounded-xl bg-canvas px-4 py-3">
          <p className="text-sm font-medium text-navy dark:text-secondary">
            Initial: {concPhase?.durationDays ?? 15} days
          </p>
          <p className="mt-1 text-sm font-medium text-navy dark:text-secondary">
            Extension: {extPhase.extensionDays} days
          </p>
          <p className="mt-1 text-sm font-medium text-navy dark:text-secondary">
            New deadline:{" "}
            <span className="font-semibold">
              {formatDateLong(extPhase.deadlineDate)}
            </span>
          </p>
        </div>

        {extPhase.extensionReason && (
          <div className="mt-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
              Reason
            </p>
            <p className="mt-1 text-sm leading-relaxed text-mirage">
              {extPhase.extensionReason}
            </p>
          </div>
        )}

        {extPhase.approvedAt && (
          <p className="mt-2 text-[12px] text-muted">
            Approved: {formatDateLong(extPhase.approvedAt)}
            {extPhase.approvedBy && ` by ${extPhase.approvedBy}`}
          </p>
        )}

        <ProgressBar
          pct={pct}
          label={`Extension progress: ${elapsed} of ${extPhase.durationDays} days`}
        />

        <PhaseHistory phases={tracker.phases} />
      </TrackerCard>
    );
  }

  // ── Fallback ─────────────────────────────────────────────────────
  return (
    <TrackerCard>
      <div className="flex items-start gap-3 rounded-xl bg-canvas px-4 py-3">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-alt">
          <Clock className="h-4 w-4 text-muted" aria-hidden="true" />
        </div>
        <div>
          <p className="text-sm font-semibold text-navy dark:text-secondary">Not Applicable</p>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            No active deadline tracker for this complaint.
          </p>
        </div>
      </div>
    </TrackerCard>
  );
}

/* ── Legacy fallback for complaints without kpTracker ──────────────── */

function LegacyTrackerView({ deadlineTracker }) {
  if (
    !deadlineTracker ||
    !deadlineTracker.applicable ||
    deadlineTracker.status === "Not Applicable"
  ) {
    return (
      <TrackerCard>
        <div className="mt-4 flex items-start gap-3 rounded-xl bg-canvas px-4 py-3">
          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-alt">
            <Clock className="h-4 w-4 text-muted" aria-hidden="true" />
          </div>
          <div>
            <p className="text-sm font-semibold text-navy dark:text-secondary">Not Applicable</p>
            <p className="mt-1 text-sm leading-relaxed text-muted">
              No active mediation deadline tracker applies to this complaint
              record.
            </p>
          </div>
        </div>
      </TrackerCard>
    );
  }

  const total = deadlineTracker.totalDays ?? 15;
  const elapsed = deadlineTracker.elapsedDays ?? 0;
  const remaining = Math.max(0, total - elapsed);
  const pct = clampProgress(elapsed, total);

  return (
    <TrackerCard
      remainingBadge={
        <RemainingBadge
          days={remaining}
          variant={
            remaining <= 3 ? "critical" : remaining <= 7 ? "warning" : "default"
          }
        />
      }
    >
      <PhaseTitle title="Mediation Period" />
      <div className="mt-3 flex items-center gap-2">
        <KPPhaseBadge phase="Mediation" />
        <StatusBadge label={deadlineTracker.status} />
      </div>

      <p className="mt-4 text-2xl font-bold text-navy dark:text-secondary">
        Day {elapsed} of {total}
      </p>
      <p className="mt-0.5 text-sm text-muted">
        {remaining > 0 ? `${remaining} days left` : "Period elapsed"}
      </p>

      <ProgressBar
        pct={pct}
        label={`Mediation progress: ${elapsed} of ${total} days`}
      />

      <div className="mt-3 flex flex-wrap gap-4 text-sm text-mirage">
        <p>
          Started{" "}
          <span className="font-semibold">
            {formatDateLong(deadlineTracker.startDate)}
          </span>
        </p>
        <p>
          Ends{" "}
          <span className="font-semibold">
            {formatDateLong(deadlineTracker.endDate)}
          </span>
        </p>
      </div>
    </TrackerCard>
  );
}

/* ── Exported section component ────────────────────────────────────── */

export default function KPTrackerSection({ kpTracker, deadlineTracker }) {
  if (kpTracker) {
    return <KPTrackerView tracker={kpTracker} />;
  }
  return <LegacyTrackerView deadlineTracker={deadlineTracker} />;
}
