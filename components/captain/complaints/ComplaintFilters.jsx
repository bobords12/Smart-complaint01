"use client";

import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import {
  CASE_TYPE_FILTERS,
  ROUTE_FILTERS,
  STAGE_FILTERS,
  URGENCY_OPTIONS,
} from "./complaintMeta";

const searchStyles =
  "w-full rounded-full border border-line bg-white px-4 py-2.5 pl-10 text-sm text-mirage outline-none transition-colors focus:border-secondary focus:ring-2 focus:ring-secondary/20";

/** One definition shared by every dropdown, so the row stays consistent. */
const selectStyles =
  "h-11 rounded-full border border-line bg-white px-4 text-sm font-medium text-mirage outline-none transition-colors focus:border-secondary focus:ring-2 focus:ring-secondary/20";

/**
 * The shared filter row. Every control writes one key of `value`, and the
 * page combines them with AND in filterComplaints().
 *
 * `showCaseType` opts a portal into the Civil / Administrative / Criminal
 * classification filter. It is off by default so the OIC and Secretary
 * pages, which render this same component, keep the row they have today.
 *
 * `showStage` hides the workflow-stage dropdown for portals that do not
 * filter by stage. It is on by default so the OIC and Secretary pages keep
 * their current filter row unchanged.
 */
export default function ComplaintFilters({
  value,
  onChange,
  disabled,
  showCaseType = false,
  showStage = true,
}) {
  const {
    q = "",
    stage = "all",
    urgency = "All",
    route = "all",
    caseType = "all",
  } = value;
  const [query, setQuery] = useState(q);
  const [lastQ, setLastQ] = useState(q);
  const timerRef = useRef(null);

  if (lastQ !== q) {
    setLastQ(q);
    setQuery(q);
  }

  useEffect(() => () => window.clearTimeout(timerRef.current), []);

  const handleQueryChange = (next) => {
    setQuery(next);
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      onChange({ ...value, q: next });
    }, 250);
  };

  const hasActiveFilters =
    q !== "" ||
    (showStage && stage !== "all") ||
    urgency !== "All" ||
    route !== "all" ||
    (showCaseType && caseType !== "all");

  return (
    <section aria-label="Complaint filters" className="flex flex-wrap items-center gap-3">
      <div className="relative min-w-[220px] flex-1">
        <Search
          className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
          aria-hidden="true"
        />
        <label className="sr-only" htmlFor="complaint-search">
          Search complaints
        </label>
        <input
          id="complaint-search"
          type="search"
          value={query}
          onChange={(event) => handleQueryChange(event.target.value)}
          disabled={disabled}
          placeholder="Search complaints (reference, title, complainant, respondent)"
          className={searchStyles}
          autoComplete="off"
        />
      </div>

      {showCaseType ? (
        <>
          <label className="sr-only" htmlFor="complaint-case-type-filter">
            Filter by case type
          </label>
          <select
            id="complaint-case-type-filter"
            value={caseType}
            onChange={(event) => onChange({ ...value, caseType: event.target.value })}
            disabled={disabled}
            className={selectStyles}
          >
            {CASE_TYPE_FILTERS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </>
      ) : null}

      <label className="sr-only" htmlFor="complaint-route-filter">
        Filter by status
      </label>
      <select
        id="complaint-route-filter"
        value={route}
        onChange={(event) => onChange({ ...value, route: event.target.value })}
        disabled={disabled}
        className={selectStyles}
      >
        {ROUTE_FILTERS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>

      {showStage ? (
        <>
          <label className="sr-only" htmlFor="complaint-stage-filter">
            Filter by stage
          </label>
          <select
            id="complaint-stage-filter"
            value={stage}
            onChange={(event) => onChange({ ...value, stage: event.target.value })}
            disabled={disabled}
            className={selectStyles}
          >
            {STAGE_FILTERS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </>
      ) : null}

      <label className="sr-only" htmlFor="complaint-urgency-filter">
        Filter by urgency
      </label>
      <select
        id="complaint-urgency-filter"
        value={urgency}
        onChange={(event) => onChange({ ...value, urgency: event.target.value })}
        disabled={disabled}
        className={selectStyles}
      >
        <option value="All">All Urgency Levels</option>
        {URGENCY_OPTIONS.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>

      {hasActiveFilters ? (
        <button
          type="button"
          onClick={() =>
            onChange({ ...value, q: "", stage: "all", urgency: "All", route: "all", caseType: "all" })
          }
          disabled={disabled}
          className="inline-flex h-11 items-center justify-center gap-1.5 rounded-full border border-line bg-white px-4 text-sm font-semibold text-mirage transition-colors hover:bg-alt disabled:opacity-60"
        >
          <X className="h-4 w-4" aria-hidden="true" />
          Reset
        </button>
      ) : null}
    </section>
  );
}
