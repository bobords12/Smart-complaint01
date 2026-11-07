"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, FileText, Inbox, Loader2, Search } from "lucide-react";
import {
  formatDate,
  getMyAssignments,
  isLeadRole,
} from "@/repositories/luponRepository";
import { LUPON_ROUTES } from "@/lib/constants";

const FILTERS = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "leads", label: "I lead" },
  { key: "concluded", label: "Concluded" },
];

function ClockText({ assignment }) {
  if (!assignment.convenes_at) return "Not convened";
  if (assignment.tracker_status === "Concluded") return "Concluded";
  if (assignment.tracker_status === "Terminated") return "Terminated";
  if (!assignment.day_number) return "Not convened";
  return `Day ${assignment.day_number} of ${assignment.total_days}`;
}

export default function LuponCases() {
  const [assignments, setAssignments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setAssignments(await getMyAssignments());
    } catch (err) {
      setError(err.message);
      setAssignments([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await load();
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return assignments.filter((a) => {
      if (filter === "active" && (a.outcome_type || a.tracker_status !== "Active")) {
        return false;
      }
      if (filter === "leads" && !isLeadRole(a.my_role)) return false;
      if (filter === "concluded" && !a.outcome_type) return false;
      if (!term) return true;
      return (
        a.title?.toLowerCase().includes(term) ||
        a.reference_number?.toLowerCase().includes(term)
      );
    });
  }, [assignments, filter, search]);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header>
        <h1 className="font-heading text-2xl font-bold tracking-tight text-navy sm:text-3xl">
          My Cases
        </h1>
        <p className="mt-1.5 text-sm text-muted">
          Only the cases you are actively assigned to appear here.
        </p>
      </header>

      {/* Controls */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div
          role="tablist"
          aria-label="Filter cases"
          className="flex flex-wrap gap-1.5 rounded-xl bg-alt p-1"
        >
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              role="tab"
              aria-selected={filter === f.key}
              onClick={() => setFilter(f.key)}
              className={`min-h-[36px] rounded-lg px-3.5 text-[13px] font-semibold transition-colors ${
                filter === f.key
                  ? "bg-white text-navy shadow-sm"
                  : "text-muted hover:text-navy"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="relative sm:w-72">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
            aria-hidden="true"
          />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search reference or title"
            aria-label="Search cases"
            className="min-h-[40px] w-full rounded-xl border border-line bg-white pl-9 pr-3 text-[13px] text-navy placeholder:text-muted focus-visible:outline-2 focus-visible:outline-secondary"
          />
        </div>
      </div>

      {error ? (
        <p
          role="alert"
          className="rounded-xl border border-critical/30 bg-critical-soft p-4 text-sm text-critical"
        >
          {error}
        </p>
      ) : null}

      {loading ? (
        <div className="flex items-center justify-center gap-3 rounded-2xl border border-line bg-white py-16 text-muted">
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
          <span className="text-sm">Loading your cases…</span>
        </div>
      ) : visible.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-line bg-white px-6 py-16 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-alt text-muted">
            <Inbox className="h-6 w-6" aria-hidden="true" />
          </span>
          <h2 className="mt-4 font-heading text-base font-semibold text-navy">
            {assignments.length === 0
              ? "No cases assigned to you"
              : "Nothing matches those filters"}
          </h2>
          <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-muted">
            {assignments.length === 0
              ? "Once the Barangay Captain assigns you to a Pangkat, the case will show up here."
              : "Try a different filter or clear the search box."}
          </p>
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((a) => (
            <li key={a.complaint_id}>
              <Link
                href={LUPON_ROUTES.caseDetail(a.complaint_id)}
                className="group flex h-full flex-col rounded-2xl border border-line bg-white p-5 shadow-sm transition-colors hover:border-secondary/40 focus-visible:outline-2 focus-visible:outline-secondary"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[12px] font-semibold text-secondary">
                    {a.reference_number}
                  </span>
                  <span className="rounded-full bg-alt px-2.5 py-1 text-[11px] font-semibold capitalize text-muted">
                    {a.my_role}
                  </span>
                </div>
                <h2 className="mt-2 line-clamp-2 font-heading text-[15px] font-semibold leading-snug text-navy">
                  {a.title}
                </h2>
                <dl className="mt-3 space-y-1.5 text-[12px]">
                  <div className="flex justify-between gap-2">
                    <dt className="text-muted">Pangkat</dt>
                    <dd className="font-semibold text-navy">{ClockText({ assignment: a })}</dd>
                  </div>
                  {a.next_hearing_date ? (
                    <div className="flex justify-between gap-2">
                      <dt className="text-muted">Next hearing</dt>
                      <dd className="font-semibold text-navy">
                        {formatDate(a.next_hearing_date)}
                      </dd>
                    </div>
                  ) : null}
                  {a.deadline_on && !a.outcome_type ? (
                    <div className="flex justify-between gap-2">
                      <dt className="text-muted">Deadline</dt>
                      <dd className="font-semibold text-navy">
                        {formatDate(a.deadline_on)}
                      </dd>
                    </div>
                  ) : null}
                </dl>
                <div className="mt-auto flex items-center justify-between gap-2 pt-4">
                  {a.outcome_type ? (
                    <span className="rounded-full bg-success/10 px-2.5 py-1 text-[11px] font-semibold text-success">
                      {a.outcome_type}
                    </span>
                  ) : (
                    <span className="rounded-full bg-alt px-2.5 py-1 text-[11px] font-semibold text-muted">
                      {String(a.current_status ?? "").replace(/_/g, " ") || "In progress"}
                    </span>
                  )}
                  <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-secondary">
                    Open
                    <ArrowRight
                      className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5"
                      aria-hidden="true"
                    />
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {!loading && visible.length > 0 ? (
        <p className="flex items-center gap-2 text-[12px] text-muted">
          <FileText className="h-3.5 w-3.5" aria-hidden="true" />
          Showing {visible.length} of {assignments.length} assigned case
          {assignments.length === 1 ? "" : "s"}.
        </p>
      ) : null}
    </div>
  );
}
