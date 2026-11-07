"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import toast from "react-hot-toast";
import { RotateCw, AlertTriangle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { fetchComplaintsContext } from "@/lib/complaintQueries";
import { buildCsv, downloadCsv } from "@/lib/csvExport";
import {
  countsFor,
  filterComplaints,
  legacyStatusToStage,
  resolveComplainantName,
  resolveRespondent,
  resolveReference,
  stageOf,
  STAGE_META,
  resolveConfirmedCategory,
  resolveConfirmedUrgency,
  resolvePredictedCategory,
} from "@/components/captain/complaints/complaintMeta";
import ComplaintsHeader from "@/components/captain/complaints/ComplaintsHeader";
import ComplaintStats from "@/components/captain/complaints/ComplaintStats";
import ComplaintFilters from "@/components/captain/complaints/ComplaintFilters";
import ComplaintGrid from "@/components/captain/complaints/ComplaintGrid";
import { useOfficialRoutes } from "@/components/official/OfficialPortalProvider";

function readFilters(searchParams) {
  const legacy = searchParams.get("status") || "";
  const stageParam = searchParams.get("stage") || "";
  return {
    q: searchParams.get("q") || "",
    stage: stageParam || (legacy ? legacyStatusToStage(legacy) : "all"),
    urgency: searchParams.get("urgency") || "All",
    route: searchParams.get("route") || "all",
  };
}

function filtersEqual(a, b) {
  return (
    a.q === b.q && a.stage === b.stage && a.urgency === b.urgency && a.route === b.route
  );
}

function pushUrl(router, basePath, filters) {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.stage && filters.stage !== "all") params.set("stage", filters.stage);
  if (filters.urgency && filters.urgency !== "All") params.set("urgency", filters.urgency);
  if (filters.route && filters.route !== "all") params.set("route", filters.route);
  const query = params.toString();
  router.replace(`${basePath}${query ? `?${query}` : ""}`, { scroll: false });
}

export default function CaptainComplaintsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const routes = useOfficialRoutes();
  const supabaseRef = useRef(null);
  if (supabaseRef.current == null) supabaseRef.current = createClient();

  const [filters, setFilters] = useState(() => readFilters(searchParams));
  const [urlFilters, setUrlFilters] = useState(() => readFilters(searchParams));
  const [allComplaints, setAllComplaints] = useState([]);
  const [hearingsByComplaint, setHearingsByComplaint] = useState({});
  const [kpTrackerMap, setKpTrackerMap] = useState({});
  const [blotterMap, setBlotterMap] = useState({});
  const [incidentDetailMap, setIncidentDetailMap] = useState({});
  const [assistanceMap, setAssistanceMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const nextFilters = readFilters(searchParams);
  if (!filtersEqual(urlFilters, nextFilters)) {
    setUrlFilters(nextFilters);
    setFilters((prev) => (filtersEqual(prev, nextFilters) ? prev : nextFilters));
  }

  const load = useCallback(async () => {
    const supabase = supabaseRef.current;
    const result = await fetchComplaintsContext(supabase);
    setAllComplaints(result.complaints);
    setHearingsByComplaint(result.hearingsByComplaint);
    setKpTrackerMap(result.kpTrackerMap);
    setBlotterMap(result.blotterMap || {});
    setIncidentDetailMap(result.incidentDetailMap || {});
    setAssistanceMap(result.assistanceMap || {});
    setError(result.error || null);
    setLoading(false);
  }, []);

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

  const counts = useMemo(
    () => countsFor(allComplaints, kpTrackerMap),
    [allComplaints, kpTrackerMap]
  );

  const filtered = useMemo(
    () => filterComplaints(allComplaints, filters, kpTrackerMap),
    [allComplaints, filters, kpTrackerMap]
  );

  const handleExport = useCallback(() => {
    const headers = [
      "Reference No.",
      "Title",
      "Complainant",
      "Respondent",
      "Stage",
      "Status",
      "Category",
      "Urgency",
      "Submitted At",
    ];
    const rows = filtered.map((c) => [
      resolveReference(c),
      c.title || "",
      resolveComplainantName(c),
      resolveRespondent(c),
      STAGE_META[stageOf(c, kpTrackerMap[c.id])].label,
      c.current_status || "",
      resolveConfirmedCategory(c) || resolvePredictedCategory(c) || "",
      resolveConfirmedUrgency(c) || "",
      c.submitted_at ? new Date(c.submitted_at).toLocaleString() : "",
    ]);
    downloadCsv(
      `complaints-export-${new Date().toISOString().slice(0, 10)}.csv`,
      buildCsv(headers, rows)
    );
    toast.success(`Exported ${rows.length} active complaint record(s).`);
  }, [filtered, kpTrackerMap]);

  const handleRefresh = useCallback(async () => {
    const supabase = supabaseRef.current;
    setRefreshing(true);
    const {
      complaints,
      hearingsByComplaint: hearings,
      kpTrackerMap: trackers,
      blotterMap,
      incidentDetailMap,
      assistanceMap,
      error: fetchError,
    } = await fetchComplaintsContext(supabase);
    setAllComplaints(complaints);
    setHearingsByComplaint(hearings);
    setKpTrackerMap(trackers);
    setBlotterMap(blotterMap || {});
    setIncidentDetailMap(incidentDetailMap || {});
    setAssistanceMap(assistanceMap || {});
    setError(fetchError || null);
    setRefreshing(false);
    toast.success("Complaint list refreshed.");
  }, []);

  return (
    <div className="mx-auto max-w-7xl px-4 pb-14 pt-6 sm:px-6 lg:px-8">
      <div className="space-y-6">
        <ComplaintsHeader
          onExport={handleExport}
          busy={refreshing}
        />

        <ComplaintStats counts={counts} loading={loading || refreshing} />

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <ComplaintFilters
            value={filters}
            onChange={handleFilterChange}
            disabled={loading}
          />
          <p className="text-xs font-medium text-muted" aria-live="polite">
            {loading ? "Loading complaints…" : `${filtered.length} of ${allComplaints.length}`}
          </p>
        </div>

        {error ? (
          <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-critical/25 bg-critical-soft px-6 py-12 text-center">
            <AlertTriangle className="h-8 w-8 text-critical" aria-hidden="true" />
            <div>
              <p className="text-sm font-semibold text-navy">
                Could not load complaints.
              </p>
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
          <ComplaintGrid
            complaints={filtered}
            hearingsByComplaint={hearingsByComplaint}
            kpTrackerMap={kpTrackerMap}
            blotterMap={blotterMap}
            incidentDetailMap={incidentDetailMap}
            assistanceMap={assistanceMap}
            loading={loading}
            emptyMessage={
              filters.q ||
              filters.stage !== "all" ||
              filters.urgency !== "All" ||
              filters.route !== "all"
                ? "No complaints match the current search or filters."
                : "No complaints have been submitted yet."
            }
            onOpen={(id) => router.push(`${routes.complaints}/${id}`)}
          />
        )}

        <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
          <p className="text-xs text-muted">
            Official records only — actions create audit entries.
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