"use client";

/**
 * Captain Portal -> Complaints: the list page.
 *
 * CAPTAIN ONLY. ./OfficialComplaints.jsx is imported by the OIC and
 * Secretary portals, so this is a separate page component rather than an
 * edit to it. It reuses the existing design system pieces —
 * ComplaintsHeader, ComplaintFilters, EmptyState, the shared filter and
 * export helpers — without modifying them, and replaces only the card
 * grid and the stats strip.
 *
 * The Captain route (/captain/complaints) is pointed at this component;
 * /oic/complaints and /secretary/complaints keep using
 * OfficialComplaints.jsx unchanged.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import toast from "react-hot-toast";
import { RotateCw, AlertTriangle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { buildCsv, downloadCsv } from "@/lib/csvExport";
import {
  filterComplaints,
  resolveComplainantName,
  resolveReference,
  stageOf,
  STAGE_META,
  resolveConfirmedCategory,
  resolveConfirmedUrgency,
} from "./complaintMeta";
import ComplaintsHeader from "./ComplaintsHeader";
import ComplaintFilters from "./ComplaintFilters";
import CaptainComplaintsGrid from "./CaptainComplaintsGrid";
import CaptainComplaintsSummary from "./CaptainComplaintsSummary";
import { useOfficialRoutes } from "@/components/official/OfficialPortalProvider";
import { useAuth } from "@/context/AuthContext";
import { demoComplaints, demoComplaintsEnabledFor } from "@/lib/demoComplaints";
import {
  fetchCaptainComplaintsContext,
  situationOf,
  summonsStateFor,
} from "@/lib/captainComplaintWorkflow";

function readFilters(searchParams) {
  return {
    q: searchParams.get("q") || "",
    urgency: searchParams.get("urgency") || "All",
    route: searchParams.get("route") || "all",
    caseType: searchParams.get("caseType") || "all",
  };
}

function filtersEqual(a, b) {
  return (
    a.q === b.q &&
    a.urgency === b.urgency &&
    a.route === b.route &&
    a.caseType === b.caseType
  );
}

function pushUrl(router, basePath, filters) {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.urgency && filters.urgency !== "All") params.set("urgency", filters.urgency);
  if (filters.route && filters.route !== "all") params.set("route", filters.route);
  if (filters.caseType && filters.caseType !== "all") params.set("caseType", filters.caseType);
  const query = params.toString();
  router.replace(`${basePath}${query ? `?${query}` : ""}`, { scroll: false });
}

export default function CaptainComplaintsPage() {
  const router = useRouter();
  const { user } = useAuth();
  const showDemo = demoComplaintsEnabledFor(user);
  const searchParams = useSearchParams();
  const routes = useOfficialRoutes();
  const supabaseRef = useRef(null);
  if (supabaseRef.current == null) supabaseRef.current = createClient();

  const [filters, setFilters] = useState(() => readFilters(searchParams));
  const [urlFilters, setUrlFilters] = useState(() => readFilters(searchParams));
  const [source, setSource] = useState({
    complaints: [],
    hearingsByComplaint: {},
    kpTrackerMap: {},
    blotterMap: {},
    incidentDetailMap: {},
    assistanceMap: {},
    summonsMap: {},
    serviceMap: {},
    documentsMap: {},
    attendanceMap: {},
    workflowUnavailable: false,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const nextFilters = readFilters(searchParams);
  if (!filtersEqual(urlFilters, nextFilters)) {
    setUrlFilters(nextFilters);
    setFilters((prev) => (filtersEqual(prev, nextFilters) ? prev : nextFilters));
  }

  const applyResult = useCallback((result) => {
    setSource(result);
    setError(result.error || null);
  }, []);

  const load = useCallback(async () => {
    const result = await fetchCaptainComplaintsContext(supabaseRef.current);
    applyResult(result);
    setLoading(false);
  }, [applyResult]);

  useEffect(() => {
    load();
    const supabase = supabaseRef.current;
    const channel = supabase
      .channel("captain-complaints-list")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "complaints" },
        () => load()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [load]);

  const handleFilterChange = useCallback(
    (next) => {
      setFilters(next);
      pushUrl(router, routes.complaints, next);
    },
    [router, routes.complaints]
  );

  const filtered = useMemo(
    () => filterComplaints(
      showDemo ? [...source.complaints, ...demoComplaints] : source.complaints,
      filters, source.kpTrackerMap
    ),
    [source.complaints, filters, source.kpTrackerMap, showDemo]
  );

  const handleExport = useCallback(() => {
    const headers = [
      "Reference No.",
      "Title",
      "Complainant",
      "Situation",
      "Stage",
      "Category",
      "Urgency",
      "Notice of Hearing",
      "Filed",
    ];
    const rows = filtered.filter((c) => !c.isDemo).map((c) => {
      const hearings = source.hearingsByComplaint[c.id] || [];
      const summons = summonsStateFor({
        summons: source.summonsMap[c.id] || [],
        serviceRecords: source.serviceMap[c.id] || [],
        documents: source.documentsMap[c.id] || [],
        hearings,
      });
      return [
        resolveReference(c),
        c.title || "",
        resolveComplainantName(c),
        situationOf(c).label,
        STAGE_META[stageOf(c, source.kpTrackerMap[c.id])].label,
        resolveConfirmedCategory(c) || c.predicted_category || "",
        resolveConfirmedUrgency(c) || c.predicted_urgency || "",
        summons.label,
        c.submitted_at ? new Date(c.submitted_at).toLocaleString() : "",
      ];
    });
    downloadCsv(
      `complaints-export-${new Date().toISOString().slice(0, 10)}.csv`,
      buildCsv(headers, rows)
    );
    toast.success(`Exported ${rows.length} complaint record(s).`);
  }, [filtered, source]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    const result = await fetchCaptainComplaintsContext(supabaseRef.current);
    applyResult(result);
    setRefreshing(false);
    toast.success("Complaint list refreshed.");
  }, [applyResult]);

  const workflowWarning = !loading && !error && source.workflowUnavailable;

  return (
    <div className="mx-auto max-w-7xl px-4 pb-14 pt-6 sm:px-6 lg:px-8">
      <div className="space-y-6">
        <ComplaintsHeader onExport={handleExport} busy={refreshing} />

        {/* The summary is the Captain's overall workload, so it always reads
            the full dataset rather than the filtered slice: filtering the
            list must not make the overview move. The filtered count lives
            beside the filters as "X of Y". */}
        <CaptainComplaintsSummary
          complaints={source.complaints}
          kpTrackerMap={source.kpTrackerMap}
        />

        {workflowWarning ? (
          <p className="rounded-2xl border border-[#b45309]/25 bg-warning-soft px-4 py-3 text-xs leading-relaxed text-warning">
            <span className="font-semibold">Summons and attendance tracking are unavailable.</span>{" "}
            The tables that record summons, service and hearing attendance have not been applied to
            this database yet, so those parts of the workflow cannot be shown. Apply the case-viewer
            and Lupon migrations to restore them.
          </p>
        ) : null}

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <ComplaintFilters
            value={filters}
            onChange={handleFilterChange}
            disabled={loading}
            showCaseType
            showStage={false}
          />
          <p className="text-xs font-medium text-muted" aria-live="polite">
            {loading
              ? "Loading complaints…"
              : `${filtered.length} of ${source.complaints.length + (showDemo ? demoComplaints.length : 0)}`}
          </p>
        </div>

        {error ? (
          <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-critical/25 bg-critical-soft px-6 py-12 text-center">
            <AlertTriangle className="h-8 w-8 text-critical" aria-hidden="true" />
            <div>
              <p className="text-sm font-semibold text-navy">Could not load complaints.</p>
              <p className="mt-1 text-xs text-muted">{error}</p>
            </div>
            <button
              type="button"
              onClick={load}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-jordy px-5 text-sm font-semibold text-white shadow-button transition-colors hover:bg-secondary"
            >
              <RotateCw className="h-4 w-4" aria-hidden="true" />
              Try again
            </button>
          </div>
        ) : (
          <CaptainComplaintsGrid
            complaints={filtered}
            source={source}
            loading={loading}
            emptyMessage={
              filters.q ||
              filters.caseType !== "all" ||
              filters.urgency !== "All" ||
              filters.route !== "all"
                ? "No complaints match the selected search or filters."
                : "No complaints have been submitted yet."
            }
            onOpen={(id) => router.push(`${routes.complaints}/${id}`)}
          />
        )}

        <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
          <p className="text-xs text-muted">
             {showDemo ? "Demo cases are read-only and excluded from summaries and exports." : "Official records only — actions create audit entries."}
          </p>
          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing}
            className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-full border border-line bg-white px-4 text-xs font-semibold text-mirage transition-colors hover:bg-alt disabled:opacity-60"
          >
            <RotateCw
              className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`}
              aria-hidden="true"
            />
            Refresh
          </button>
        </div>
      </div>
    </div>
  );
}
