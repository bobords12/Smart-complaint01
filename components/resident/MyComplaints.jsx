"use client";

import { useMemo, useState, useCallback, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import toast from "react-hot-toast";
import {
  AlertTriangle,
  ArrowLeft,
  ChevronDown,
  Eye,
  FileText,
  FilterX,
  Search,
  SearchX,
  Plus,
  SlidersHorizontal,
  SortAsc,
  SortDesc,
} from "lucide-react";
import StatusBadge from "@/components/shared/StatusBadge";
import EmptyState from "@/components/shared/EmptyState";
import { RESIDENT_ROUTES, residentComplaintStatus } from "@/lib/constants";
import useResidentComplaints from "@/hooks/useResidentComplaints";
import { useAuth } from "@/context/AuthContext";
import { demoComplaints, demoComplaintsEnabledFor } from "@/lib/demoComplaints";
import { formatResidentDateShort } from "@/lib/residentDates";
import {
  buildResidentTimeline,
  residentCategory,
  residentUrgency,
} from "@/lib/residentCase";

const STATUS_TABS = [
  { key: "all", label: "All" },
  { key: "pending-review", label: "Pending Review" },
  { key: "in-progress", label: "In Progress" },
  { key: "awaiting-meeting", label: "Awaiting Meeting" },
  { key: "resolved", label: "Resolved" },
  { key: "closed", label: "Closed" },
];

const CATEGORY_OPTIONS = ["All", "Civil", "Criminal", "Administrative"];
const URGENCY_OPTIONS = ["All", "Critical", "High", "Normal"];

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/* â”€â”€ Skeleton card â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

function SkeletonCard() {
  return (
    <article
      aria-hidden="true"
      className="flex h-full flex-col rounded-2xl border border-line bg-white dark:bg-alt p-5"
    >
      <div className="animate-pulse space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="h-4 w-36 rounded bg-line" />
          <div className="h-5 w-20 rounded-full bg-line" />
        </div>
        <div className="h-3 w-28 rounded bg-line/60" />
        <div className="h-3 w-24 rounded bg-line/60" />
        <div className="mt-4 grid grid-cols-2 gap-3">
          <div>
            <div className="h-2.5 w-16 rounded bg-line/60" />
            <div className="mt-1.5 h-5 w-20 rounded-full bg-line" />
          </div>
          <div>
            <div className="h-2.5 w-12 rounded bg-line/60" />
            <div className="mt-1.5 h-5 w-16 rounded-full bg-line" />
          </div>
        </div>
        <div className="mt-4 border-t border-line/70 pt-4">
          <div className="h-2.5 w-24 rounded bg-line/60" />
          <div className="mt-1.5 h-3 w-full rounded bg-line/60" />
          <div className="mt-1 h-3 w-20 rounded bg-line/60" />
        </div>
        <div className="mt-4 h-10 w-full rounded-xl bg-line" />
      </div>
    </article>
  );
}

/* â”€â”€ Complaint card â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

function ComplaintCard({ complaint, timeline }) {
  const detailHref = `${RESIDENT_ROUTES.complaints}/${complaint.id}`;
  const status = residentComplaintStatus(complaint.current_status);
  const category = residentCategory(complaint);
  const urgency = residentUrgency(complaint);
  const submitted = formatResidentDateShort(complaint.submitted_at);
  const latest = timeline?.[0] ?? null;

  return (
    <article className="flex h-full flex-col rounded-2xl border border-line bg-white dark:bg-alt p-5 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md focus-within:ring-2 focus-within:ring-secondary">
      {/* Header */}
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="font-heading text-base font-semibold leading-snug tracking-tight text-navy dark:text-secondary">
            {complaint.title}
          </h3>
          <p className="mt-1 text-[13px] font-medium text-secondary">
            {complaint.reference_number || complaint.id}
          </p>
          {complaint.isDemo ? <span className="text-[11px] font-semibold text-muted">Sample Case · Demo only</span> : null}
          {submitted ? (
            <p className="mt-0.5 text-[12px] text-muted">Submitted {submitted}</p>
          ) : null}
        </div>
        <StatusBadge label={status} />
      </header>

      {/* Category + Urgency */}
      <div className="mt-5 grid grid-cols-2 gap-4">
        <div>
          <p className="text-[10.5px] font-bold uppercase tracking-wide text-muted">
            Category
          </p>
          <div className="mt-1">
            <StatusBadge label={category} />
          </div>
        </div>
        <div>
          <p className="text-[10.5px] font-bold uppercase tracking-wide text-muted">
            Urgency
          </p>
          <div className="mt-1">
            <StatusBadge label={urgency} />
          </div>
        </div>
      </div>

      {/* Latest resident-visible update */}
      <section className="mt-5 flex-1 border-t border-line pt-4">
        <p className="text-[10.5px] font-bold uppercase tracking-wide text-muted">
          Latest Update
        </p>
        {latest ? (
          <>
            <p className="mt-1.5 text-[13px] leading-relaxed text-mirage">
              {latest.label}
            </p>
            {latest.at ? (
              <p className="mt-1 text-[12px] text-muted">
                {formatResidentDateShort(latest.at)}
              </p>
            ) : null}
          </>
        ) : (
          <p className="mt-1.5 text-[13px] text-muted">
            No update recorded yet.
          </p>
        )}
      </section>

      {/* View Details */}
      <div className="mt-auto pt-5">
        <Link
          href={detailHref}
          aria-label={`View details for complaint ${complaint.reference_number || complaint.id}`}
          className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-[10px] border border-line bg-canvas text-sm font-semibold text-navy dark:text-secondary transition-colors duration-150 hover:border-secondary hover:bg-[#EBF2FF] focus-visible:outline-2 focus-visible:outline-secondary"
        >
          <Eye className="h-4 w-4" aria-hidden="true" />
          View
        </Link>
      </div>
    </article>
  );
}

/* â”€â”€ Main component â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

export default function MyComplaints() {
  const router = useRouter();
  const { user } = useAuth();
  const showDemo = demoComplaintsEnabledFor(user);
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const {
    complaints,
    counts,
    loading,
    error,
    refresh,
    caseStatusesByComplaint,
    hearingsByComplaint,
    documentsByComplaint,
  } = useResidentComplaints();
  const visibleComplaints = useMemo(
    () => showDemo ? [...complaints, ...demoComplaints] : complaints,
    [complaints, showDemo]
  );

  const [searchQuery, setSearchQuery] = useState(searchParams.get("q") ?? "");
  const [statusFilter, setStatusFilter] = useState(
    searchParams.get("status") ?? "all"
  );
  const [categoryFilter, setCategoryFilter] = useState(
    searchParams.get("category") ?? "All"
  );
  const [urgencyFilter, setUrgencyFilter] = useState(
    searchParams.get("priority") ?? "All"
  );
  const [sortOrder, setSortOrder] = useState(
    searchParams.get("sort") ?? "newest"
  );

  /**
   * The card's "Latest Update" is resolved from the same canonical rows
   * the shared portal source already fetched, so this page costs no extra
   * query and can never disagree with the dashboard about what happened.
   */
  const timelines = useMemo(() => {
    const map = new Map();
    for (const complaint of visibleComplaints) {
      if (complaint.isDemo) {
        map.set(complaint.id, [...complaint.timeline].reverse());
        continue;
      }
      map.set(
        complaint.id,
        buildResidentTimeline(complaint, {
          caseStatuses: caseStatusesByComplaint[complaint.id] ?? [],
          hearings: hearingsByComplaint[complaint.id] ?? [],
          documents: documentsByComplaint[complaint.id] ?? [],
        })
      );
    }
    return map;
  }, [visibleComplaints, caseStatusesByComplaint, hearingsByComplaint, documentsByComplaint]);

  const updateParam = useCallback(
    (key, value) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value && value !== "all" && value !== "All" && value !== "newest") {
        params.set(key, value);
      } else {
        params.delete(key);
      }
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [router, pathname, searchParams]
  );

  const handleSearchChange = useCallback(
    (e) => {
      const value = e.target.value;
      setSearchQuery(value);
      updateParam("q", value);
    },
    [updateParam]
  );

  const handleStatusTab = useCallback(
    (key) => {
      setStatusFilter(key);
      updateParam("status", key);
    },
    [updateParam]
  );

  const handleCategoryChange = useCallback(
    (e) => {
      const val = e.target.value;
      setCategoryFilter(val);
      updateParam("category", val);
    },
    [updateParam]
  );

  const handleUrgencyChange = useCallback(
    (e) => {
      const val = e.target.value;
      setUrgencyFilter(val);
      updateParam("priority", val);
    },
    [updateParam]
  );

  const handleSortToggle = useCallback(() => {
    const next = sortOrder === "newest" ? "oldest" : "newest";
    setSortOrder(next);
    updateParam("sort", next);
  }, [sortOrder, updateParam]);

  const clearFilters = useCallback(() => {
    setSearchQuery("");
    setStatusFilter("all");
    setCategoryFilter("All");
    setUrgencyFilter("All");
    setSortOrder("newest");
    router.replace(pathname, { scroll: false });
    toast.success("Filters cleared.");
  }, [router, pathname]);

  const filtered = useMemo(() => {
    let result = visibleComplaints;

    if (statusFilter !== "all") {
      result = result.filter(
        (c) => slugify(residentComplaintStatus(c.current_status)) === statusFilter
      );
    }

    if (categoryFilter !== "All") {
      result = result.filter((c) => residentCategory(c) === categoryFilter);
    }

    if (urgencyFilter !== "All") {
      result = result.filter((c) => residentUrgency(c) === urgencyFilter);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter(
        (c) =>
          (c.title || "").toLowerCase().includes(q) ||
          (c.reference_number || "").toLowerCase().includes(q)
      );
    }

    result = [...result].sort((a, b) => {
      const dateA = new Date(a.submitted_at).getTime();
      const dateB = new Date(b.submitted_at).getTime();
      return sortOrder === "newest" ? dateB - dateA : dateA - dateB;
    });

    return result;
  }, [
    visibleComplaints,
    statusFilter,
    categoryFilter,
    urgencyFilter,
    searchQuery,
    sortOrder,
  ]);

  const hasActiveFilters =
    searchQuery.trim() !== "" ||
    statusFilter !== "all" ||
    categoryFilter !== "All" ||
    urgencyFilter !== "All" ||
    sortOrder !== "newest";

  const countPills = [
    { label: "All", value: counts.total },
    { label: "Pending Review", value: counts.pendingReview },
    { label: "In Progress", value: counts.inProgress },
    { label: "Awaiting Meeting", value: counts.awaitingMeeting },
    { label: "Resolved", value: counts.resolved },
    { label: "Critical", value: counts.critical },
  ];

  return (
    <section
      aria-labelledby="my-complaints-title"
      className="mx-auto max-w-[1100px]"
    >
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1
            id="my-complaints-title"
            className="font-heading text-2xl font-semibold tracking-tight text-navy dark:text-secondary sm:text-3xl"
          >
            My Complaints
          </h1>
          <p className="mt-1 text-sm text-muted">
            Track your submitted complaints.
          </p>
        </div>
        <Link
          href={RESIDENT_ROUTES.newComplaint}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-full bg-navy px-5 text-sm font-semibold text-white transition-colors hover:bg-secondary"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          New Complaint
        </Link>
      </header>

      {showDemo ? (
        <p className="mt-4 text-xs text-muted">Sample cases appear in the list; summary counts include official complaints only.</p>
      ) : null}
      <div
        className="mt-5 flex flex-wrap gap-2"
        role="list"
        aria-label="Complaint summary counts"
      >
        {countPills.map((pill) => (
          <span
            key={pill.label}
            role="listitem"
            className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white dark:bg-alt px-3 py-1.5 text-[12.5px] font-medium text-muted"
          >
            <span className="font-semibold text-navy dark:text-secondary">{pill.value}</span>
            {pill.label}
          </span>
        ))}
      </div>

      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative max-w-sm flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
            aria-hidden="true"
          />
          <input
            type="search"
            placeholder="Search by title or reference number..."
            value={searchQuery}
            onChange={handleSearchChange}
            className="min-h-[40px] w-full rounded-full border border-line bg-white dark:bg-alt pl-9 pr-4 text-[13px] text-mirage placeholder:text-muted/60 transition-colors focus:border-secondary focus:outline-none focus:ring-1 focus:ring-secondary"
            aria-label="Search complaints"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <select
              value={categoryFilter}
              onChange={handleCategoryChange}
              className="min-h-[36px] appearance-none rounded-full border border-line bg-white dark:bg-alt pl-3 pr-8 text-[13px] font-medium text-muted transition-colors hover:border-secondary/50 focus:border-secondary focus:outline-none focus:ring-1 focus:ring-secondary"
              aria-label="Filter by category"
            >
              {CATEGORY_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>
                  {opt === "All" ? "Category: All" : opt}
                </option>
              ))}
            </select>
            <ChevronDown
              className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted"
              aria-hidden="true"
            />
          </div>
          <div className="relative">
            <select
              value={urgencyFilter}
              onChange={handleUrgencyChange}
              className="min-h-[36px] appearance-none rounded-full border border-line bg-white dark:bg-alt pl-3 pr-8 text-[13px] font-medium text-muted transition-colors hover:border-secondary/50 focus:border-secondary focus:outline-none focus:ring-1 focus:ring-secondary"
              aria-label="Filter by urgency"
            >
              {URGENCY_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>
                  {opt === "All" ? "Urgency: All" : opt}
                </option>
              ))}
            </select>
            <ChevronDown
              className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted"
              aria-hidden="true"
            />
          </div>
          <button
            type="button"
            onClick={handleSortToggle}
            className="inline-flex min-h-[36px] items-center gap-1.5 rounded-full border border-line bg-white dark:bg-alt px-3 text-[13px] font-medium text-muted transition-colors hover:border-secondary/50 hover:text-secondary"
            aria-label={`Sort: ${sortOrder === "newest" ? "Newest first" : "Oldest first"}. Click to toggle.`}
          >
            {sortOrder === "newest" ? (
              <SortDesc className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <SortAsc className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            {sortOrder === "newest" ? "Newest" : "Oldest"}
          </button>
          {hasActiveFilters ? (
            <button
              type="button"
              onClick={clearFilters}
              className="inline-flex min-h-[36px] items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold text-critical transition-colors hover:bg-critical-soft"
            >
              <FilterX className="h-4 w-4" aria-hidden="true" />
              Clear
            </button>
          ) : null}
        </div>
      </div>

      <div
        role="tablist"
        aria-label="Filter complaints by status"
        className="mt-4 flex flex-wrap items-center gap-2"
      >
        {(showDemo ? [
          ...STATUS_TABS,
          { key: "under-mediation", label: "Under Mediation" },
          { key: "for-lupon-pangkat-formation", label: "For Lupon/Pangkat Formation" },
          { key: "cfa-issued", label: "CFA Issued" },
        ] : STATUS_TABS).map((tab) => {
          const active = statusFilter === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => handleStatusTab(tab.key)}
              className={`min-h-[34px] rounded-full border px-3.5 text-[12.5px] font-semibold transition-colors ${
                active
                  ? "border-navy bg-navy text-white"
                  : "border-line bg-white dark:bg-alt text-muted hover:border-secondary/50 hover:text-secondary"
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <p
        className="mt-4 text-[13px] font-medium text-muted"
        aria-live="polite"
        aria-atomic="true"
      >
        {loading
          ? "Loading complaints..."
          : `${filtered.length} ${filtered.length === 1 ? "complaint" : "complaints"} found`}
      </p>

      {/* â”€â”€ Loading skeletons â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      {loading ? (
        <div
          aria-busy="true"
          aria-label="Loading complaints"
          className="mt-3 grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3"
        >
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : error ? (
        /* â”€â”€ Error state â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
        <div className="mt-3 rounded-2xl border border-line bg-white dark:bg-alt">
          <EmptyState
            title="We couldn't load complaints"
            message={error}
            icon={AlertTriangle}
          >
            <button
              type="button"
              onClick={refresh}
              className="inline-flex min-h-[40px] items-center gap-2 rounded-full bg-navy px-5 text-[13px] font-semibold text-white transition-colors hover:bg-secondary"
            >
              Retry
            </button>
          </EmptyState>
        </div>
      ) : filtered.length > 0 ? (
        /* â”€â”€ Complaint card grid â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
        <div
          className="mt-3 grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3"
          role="list"
          aria-label="Complaints"
        >
          {filtered.map((complaint) => (
            <ComplaintCard
              key={complaint.id}
              complaint={complaint}
              timeline={timelines.get(complaint.id)}
            />
          ))}
        </div>
      ) : hasActiveFilters ? (
        /* â”€â”€ No filter results â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
        <div className="mt-3 rounded-2xl border border-line bg-white dark:bg-alt">
          <EmptyState
            title="No results"
            message="Try adjusting your filters."
            icon={SearchX}
          >
            <button
              type="button"
              onClick={clearFilters}
              className="inline-flex min-h-[40px] items-center gap-2 rounded-full bg-navy px-5 text-[13px] font-semibold text-white transition-colors hover:bg-secondary"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Clear Filters
            </button>
          </EmptyState>
        </div>
      ) : (
        /* â”€â”€ No complaints yet â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
        <div className="mt-3 rounded-2xl border border-line bg-white dark:bg-alt">
          <EmptyState
            title="No complaints yet"
            message="File a complaint to get started."
            icon={FileText}
          >
            <Link
              href={RESIDENT_ROUTES.newComplaint}
              className="inline-flex min-h-[40px] items-center gap-2 rounded-full bg-navy px-5 text-[13px] font-semibold text-white transition-colors hover:bg-secondary"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              File Your First Complaint
            </Link>
          </EmptyState>
        </div>
      )}
    </section>
  );
}
