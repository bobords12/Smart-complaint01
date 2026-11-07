"use client";

import { useMemo, useCallback } from "react";
import { PieChart, RefreshCw } from "lucide-react";
import useResidentComplaints from "@/hooks/useResidentComplaints";

const INDICATORS = [
  {
    key: "total",
    label: "Total Complaints",
    ariaLabel: "Total complaints",
    color: "#1b4c8c",
  },
  {
    key: "inProgress",
    label: "In Progress",
    ariaLabel: "In-progress complaints",
    color: "#d97706",
  },
  {
    key: "critical",
    label: "Critical",
    ariaLabel: "Critical active complaints",
    color: "#b5493b",
  },
  {
    key: "resolved",
    label: "Resolved",
    ariaLabel: "Resolved complaints",
    color: "#17774e",
  },
];

/* ── SVG Donut Ring ──────────────────────────────────────────────────── */

function DonutRing({ value, total, color, size = 80, stroke = 8 }) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const safeTotal = total || 1;
  const fraction = Math.min(Math.max(value / safeTotal, 0), 1);
  const offset = circumference - fraction * circumference;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="shrink-0"
      aria-hidden="true"
    >
      {/* Empty track */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        className="text-alt"
        strokeWidth={stroke}
      />
      {/* Progress arc */}
      {fraction > 0 && (
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          style={{
            transform: "rotate(-90deg)",
            transformOrigin: "50% 50%",
            transition: "stroke-dashoffset 0.6s ease-out",
          }}
        />
      )}
    </svg>
  );
}

/* ── Single Indicator ────────────────────────────────────────────────── */

function Indicator({ config, count, total }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;

  return (
    <div
      className="flex flex-col items-center gap-2"
      role="listitem"
      aria-label={`${config.ariaLabel}: ${count}`}
    >
      <div className="relative flex items-center justify-center">
        <DonutRing
          value={count}
          total={total}
          color={config.color}
        />
        <span className="absolute font-heading text-xl font-bold text-navy dark:text-secondary">
          {count}
        </span>
      </div>
      <span className="text-center text-[12px] font-semibold leading-tight text-muted">
        {config.label}
      </span>
      {total > 0 && (
        <span className="text-[11px] font-semibold text-muted/70">
          {pct}%
        </span>
      )}
    </div>
  );
}

/* ── Loading Skeleton ────────────────────────────────────────────────── */

function LoadingSkeleton() {
  return (
    <div className="mt-6 grid grid-cols-2 gap-6 sm:grid-cols-4" role="list" aria-busy="true" aria-label="Loading status overview">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="flex flex-col items-center gap-2" role="listitem">
          <div className="relative">
            <div className="h-[80px] w-[80px] animate-pulse rounded-full bg-alt" />
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="h-5 w-6 animate-pulse rounded bg-alt" />
            </div>
          </div>
          <div className="h-3 w-16 animate-pulse rounded bg-alt" />
        </div>
      ))}
    </div>
  );
}

/* ── Component ───────────────────────────────────────────────────────── */

export default function ComplaintStatusOverview() {
  const { counts, loading, error, refresh } = useResidentComplaints();

  const total = counts.total ?? 0;

  const indicatorData = useMemo(
    () => [
      { config: INDICATORS[0], count: total },
      { config: INDICATORS[1], count: counts.inProgress ?? 0 },
      { config: INDICATORS[2], count: counts.critical ?? 0 },
      { config: INDICATORS[3], count: counts.resolved ?? 0 },
    ],
    [counts, total]
  );

  const handleRetry = useCallback(() => {
    refresh();
  }, [refresh]);

  return (
    <section
      aria-labelledby="complaint-status-overview"
      className="flex flex-col rounded-2xl border border-line bg-white p-5 shadow-[0_1px_2px_rgba(11,33,68,0.06)] dark:bg-alt dark:shadow-[0_1px_2px_rgba(0,0,0,0.3)]"
    >
      <header className="flex items-center justify-between gap-3">
        <h2
          id="complaint-status-overview"
          className="flex items-center gap-2 font-heading text-base font-semibold tracking-tight text-navy dark:text-secondary"
        >
          <PieChart className="h-5 w-5 text-gold" aria-hidden="true" />
          Status Overview
        </h2>
      </header>

      {loading ? (
        <LoadingSkeleton />
      ) : error ? (
        <div className="mt-6 flex flex-col items-center justify-center rounded-xl border border-dashed border-critical/30 bg-critical-soft/30 px-4 py-8 text-center">
          <p className="text-sm font-semibold text-critical">
            Status overview could not be loaded.
          </p>
          <button
            type="button"
            onClick={handleRetry}
            className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-line bg-white px-4 py-2 text-[12px] font-semibold text-mirage transition-colors hover:border-secondary hover:text-secondary"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            Retry
          </button>
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-2 gap-5 sm:grid-cols-4" role="list">
          {indicatorData.map(({ config, count }) => (
            <Indicator
              key={config.key}
              config={config}
              count={count}
              total={total}
            />
          ))}
        </div>
      )}
    </section>
  );
}
