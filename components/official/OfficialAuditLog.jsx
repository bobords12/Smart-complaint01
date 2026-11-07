"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { getErrorMessage, logSupabaseError } from "@/lib/supabaseError";
import { selectWithOptionalColumns } from "@/lib/supabaseQuery";
import { useAuth } from "@/context/AuthContext";
import EmptyState from "@/components/shared/EmptyState";
import ResidentModal from "@/components/shared/ResidentModal";
import LoadingButton from "@/components/shared/LoadingButton";
import {
  ScrollText,
  Search,
  Filter,
  RefreshCw,
  AlertTriangle,
  Loader2,
  ChevronDown,
  ChevronUp,
  ShieldAlert,
  CheckCircle2,
  XCircle,
  Clock,
  Download,
} from "lucide-react";
import toast from "react-hot-toast";

const SENSITIVE_PATTERNS = [
  "user.role_changed",
  "user.status_changed",
  "user.account_suspended",
  "user.account_disabled",
  "role.changed",
  "deleted",
];

const ACTION_FILTERS = [
  { value: "all", label: "All Actions" },
  { value: "complaint", label: "Complaints" },
  { value: "blotter", label: "Blotter" },
  { value: "hearing", label: "Hearings" },
  { value: "user", label: "Users" },
  { value: "auth", label: "Auth" },
  { value: "report", label: "Reports" },
  { value: "security_alert_reviewed", label: "Reviews" },
];

const RESULT_FILTERS = [
  { value: "all", label: "All Results" },
  { value: "success", label: "Success" },
  { value: "failed", label: "Failed" },
];

function formatDate(dateStr) {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
}

function formatDateTime(dateStr) {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function isSensitiveAction(action) {
  if (!action) return false;
  const lower = action.toLowerCase();
  return SENSITIVE_PATTERNS.some((p) => lower.includes(p.toLowerCase()));
}

function actionMatchesFilter(action, filter) {
  if (filter === "all") return true;
  if (filter === "security_alert_reviewed") return action === filter;
  return action.toLowerCase().startsWith(filter.toLowerCase());
}

function severityOf(log) {
  if (log.action === "security_alert_reviewed") return { label: "Review", cls: "bg-secondary text-white" };
  if (isSensitiveAction(log.action)) {
    if (log.result === "failed") return { label: "Critical", cls: "bg-critical text-white" };
    return { label: "High", cls: "bg-warning-soft text-warning" };
  }
  if (log.result === "failed") return { label: "Failed", cls: "bg-critical-soft text-critical" };
  return { label: "Normal", cls: "bg-alt text-muted" };
}

function tryParseJson(value) {
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export default function CaptainActivityLogsPage() {
  const { user } = useAuth();
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [actionFilter, setActionFilter] = useState("all");
  const [actorFilter, setActorFilter] = useState("");
  const [targetTypeFilter, setTargetTypeFilter] = useState("all");
  const [resultFilter, setResultFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [limit, setLimit] = useState(50);
  const [expandedId, setExpandedId] = useState(null);

  const [reviewTarget, setReviewTarget] = useState(null);
  const [reviewResult, setReviewResult] = useState("dismissed");
  const [reviewRemarks, setReviewRemarks] = useState("");
  const [reviewBusy, setReviewBusy] = useState(false);

  const fetchLogs = useCallback(async () => {
    const supabase = createClient();
    const data = await selectWithOptionalColumns(
      supabase,
      "activity_logs",
      [
        "id",
        "action",
        "actor_id",
        "target_type",
        "target_id",
        "entity_ref",
        "details",
        "created_at",
        // activity_logs has two foreign keys to profiles: actor_id (who
        // performed the action) and reviewed_by (who reviewed it). A bare
        // embed is rejected as ambiguous, and the actor is what this log
        // displays, so the relationship is pinned to actor_id explicitly.
        "profiles!actor_id(display_name, role)",
      ],
      ["ip_address", "result", "remarks", "reviewed_by", "reviewed_at"],
      { orderField: "created_at", limit: 1000 }
    );
    setLogs(data);
  }, []);

  const loadAll = useCallback(async () => {
    setError(null);
    try {
      await fetchLogs();
    } catch (err) {
      logSupabaseError("Activity logs load", err);
      setError(getErrorMessage(err, "Failed to load activity logs."));
    }
  }, [fetchLogs]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      await loadAll();
      if (!cancelled) setLoading(false);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [loadAll]);

  const targetTypes = useMemo(() => {
    const set = new Set();
    logs.forEach((l) => l.target_type && set.add(l.target_type));
    return ["all", ...Array.from(set).sort()];
  }, [logs]);

  const actionCounts = useMemo(() => {
    const counts = {};
    logs.forEach((l) => {
      counts[l.action] = (counts[l.action] || 0) + 1;
    });
    return counts;
  }, [logs]);

  const topActions = useMemo(() => {
    return Object.entries(actionCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);
  }, [actionCounts]);

  // Counted once per data change. The chip row used to run
  // logs.filter(...) for every filter chip on every render, which was
  // ACTION_FILTERS.length x logs.length predicate calls per keystroke.
  const actionFilterCounts = useMemo(() => {
    const counts = {};
    for (const f of ACTION_FILTERS) {
      if (f.value === "all") {
        counts[f.value] = logs.length;
        continue;
      }
      let n = 0;
      for (const l of logs) {
        if (actionMatchesFilter(l.action, f.value)) n += 1;
      }
      counts[f.value] = n;
    }
    return counts;
  }, [logs]);

  const filteredLogs = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const actorNeedle = actorFilter.trim().toLowerCase();
    const fromTime = dateFrom ? new Date(dateFrom).getTime() : null;
    const toTime = dateTo ? new Date(`${dateTo}T23:59:59.999`).getTime() : null;

    return logs.filter((l) => {
      if (!actionMatchesFilter(l.action, actionFilter)) return false;
      if (targetTypeFilter !== "all" && l.target_type !== targetTypeFilter) return false;
      if (resultFilter !== "all" && l.result !== resultFilter) return false;
      if (actorNeedle && !(l.profiles?.display_name || "").toLowerCase().includes(actorNeedle)) return false;
      if (fromTime !== null || toTime !== null) {
        const t = new Date(l.created_at).getTime();
        if (fromTime !== null && t < fromTime) return false;
        if (toTime !== null && t > toTime) return false;
      }
      if (q) {
        const haystack = [
          l.action,
          l.entity_ref,
          l.target_type,
          l.target_id,
          l.profiles?.display_name,
          l.remarks,
          typeof l.details === "string" ? l.details : JSON.stringify(l.details || ""),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [
    logs,
    actionFilter,
    targetTypeFilter,
    resultFilter,
    actorFilter,
    dateFrom,
    dateTo,
    searchQuery,
  ]);

  const sensitiveUnreviewedCount = useMemo(() => {
    return logs.filter((l) => isSensitiveAction(l.action) && !l.reviewed_at).length;
  }, [logs]);

  const resetFilters = useCallback(() => {
    setSearchQuery("");
    setActionFilter("all");
    setActorFilter("");
    setTargetTypeFilter("all");
    setResultFilter("all");
    setDateFrom("");
    setDateTo("");
    setLimit(50);
  }, []);

  const handleReview = useCallback(async () => {
    if (!reviewTarget) return;
    const supabase = createClient();
    setReviewBusy(true);
    const toastId = toast.loading("Recording review…");
    try {
      const { error: err } = await supabase.rpc("review_security_alert", {
        p_log_id: reviewTarget.id,
        p_result: reviewResult,
        p_remarks: reviewRemarks,
      });
      if (err) throw err;
      toast.success("Security alert reviewed.");
      setReviewTarget(null);
      setReviewRemarks("");
      await fetchLogs();
    } catch (err) {
      console.error("Review error:", err);
      toast.error(err.message || "Could not record review.");
    } finally {
      toast.dismiss(toastId);
      setReviewBusy(false);
    }
  }, [reviewTarget, reviewResult, reviewRemarks, fetchLogs]);

  const handleExportCsv = useCallback(() => {
    try {
      const header = ["Timestamp", "Action", "Actor", "Target Type", "Target ID", "Entity", "Result", "Remarks", "Reviewed", "IP"];
      const rows = filteredLogs.map((l) => [
        formatDateTime(l.created_at),
        l.action,
        l.profiles?.display_name || "System",
        l.target_type || "",
        l.target_id || "",
        l.entity_ref || "",
        l.result || "",
        l.remarks || "",
        l.reviewed_at ? "Yes" : "No",
        l.ip_address || "",
      ]);
      const csv = [header, ...rows]
        .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
        .join("\n");
      const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `scbms_activity_logs_${Date.now()}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success("CSV downloaded.");
    } catch (err) {
      console.error("CSV export error:", err);
      toast.error("Could not export CSV.");
    }
  }, [filteredLogs]);

  const visibleLogs = useMemo(() => filteredLogs.slice(0, limit), [filteredLogs, limit]);

  if (loading) {
    return (
      <div className="mx-auto max-w-[1280px] space-y-6">
        <div className="flex items-center gap-3">
          <ScrollText className="h-6 w-6 text-secondary" aria-hidden="true" />
          <div>
            <h1 className="font-heading text-2xl font-semibold tracking-tight text-navy">Activity Logs</h1>
            <p className="text-[13px] text-muted">Immutable audit trail of all recorded actions.</p>
          </div>
        </div>
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-2xl border border-line bg-white p-4">
              <div className="mb-2 h-3 w-48 animate-pulse rounded bg-alt" />
              <div className="h-3 w-64 animate-pulse rounded bg-alt" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-[1280px] space-y-6">
        <div className="flex items-center gap-3">
          <ScrollText className="h-6 w-6 text-secondary" aria-hidden="true" />
          <h1 className="font-heading text-2xl font-semibold tracking-tight text-navy">Activity Logs</h1>
        </div>
        <EmptyState title="Could not load activity logs" message={error} icon={AlertTriangle}>
          <button
            type="button"
            onClick={loadAll}
            className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full bg-navy px-6 text-sm font-semibold text-white transition-colors hover:bg-secondary"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Retry
          </button>
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1280px] space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <ScrollText className="h-6 w-6 text-secondary" aria-hidden="true" />
          <div>
            <h1 className="font-heading text-2xl font-semibold tracking-tight text-navy">Activity Logs</h1>
            <p className="text-[13px] text-muted">
              {logs.length} entr{logs.length !== 1 ? "ies" : "y"} · read-only audit trail
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={handleExportCsv}
          disabled={filteredLogs.length === 0}
          className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full border border-line px-5 text-sm font-semibold text-navy transition-colors hover:bg-alt disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Download className="h-4 w-4" aria-hidden="true" />
          Export CSV
        </button>
      </div>

      <div className="flex items-start gap-3 rounded-2xl border border-info/20 bg-info-soft/40 p-4">
        <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-secondary" aria-hidden="true" />
        <p className="text-[13px] leading-relaxed text-navy">
          Entries here are immutable: no update or delete is permitted on activity_logs. Security-sensitive events (role changes, account
          suspensions, deletions) stay flagged until reviewed; each review writes a separate, auditable log entry.
          {sensitiveUnreviewedCount > 0 && (
            <span className="ml-1 font-semibold text-warning">
              {sensitiveUnreviewedCount} sensitive event{sensitiveUnreviewedCount !== 1 ? "s" : ""} awaiting review.
            </span>
          )}
        </p>
      </div>

      <section className="rounded-2xl border border-line bg-white p-5 shadow-[0_1px_2px_rgba(11,33,68,0.06)] sm:p-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="sm:col-span-2 lg:col-span-2">
            <label htmlFor="log-search" className="mb-1.5 block text-[13px] font-semibold text-mirage">Search</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" />
              <input
                id="log-search"
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search action, entity, actor, remarks…"
                className="w-full rounded-xl border border-line bg-white py-2.5 pl-10 pr-3 text-[13px] text-navy placeholder:text-muted focus:border-secondary focus:outline-none focus:ring-2 focus:ring-secondary/20"
              />
            </div>
          </div>
          <div>
            <label htmlFor="actor-filter" className="mb-1.5 block text-[13px] font-semibold text-mirage">Actor</label>
            <input
              id="actor-filter"
              type="text"
              value={actorFilter}
              onChange={(e) => setActorFilter(e.target.value)}
              placeholder="Actor name…"
              className="w-full rounded-xl border border-line bg-white px-3 py-2.5 text-[13px] text-navy placeholder:text-muted focus:border-secondary focus:outline-none focus:ring-2 focus:ring-secondary/20"
            />
          </div>
          <div>
            <label htmlFor="target-filter" className="mb-1.5 block text-[13px] font-semibold text-mirage">Target type</label>
            <select
              id="target-filter"
              value={targetTypeFilter}
              onChange={(e) => setTargetTypeFilter(e.target.value)}
              className="w-full appearance-none rounded-xl border border-line bg-white px-3 py-2.5 text-[13px] text-navy focus:border-secondary focus:outline-none focus:ring-2 focus:ring-secondary/20"
            >
              {targetTypes.map((t) => (
                <option key={t} value={t}>{t === "all" ? "All Targets" : t}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="result-filter" className="mb-1.5 block text-[13px] font-semibold text-mirage">Result</label>
            <select
              id="result-filter"
              value={resultFilter}
              onChange={(e) => setResultFilter(e.target.value)}
              className="w-full appearance-none rounded-xl border border-line bg-white px-3 py-2.5 text-[13px] text-navy focus:border-secondary focus:outline-none focus:ring-2 focus:ring-secondary/20"
            >
              {RESULT_FILTERS.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="date-from" className="mb-1.5 block text-[13px] font-semibold text-mirage">From</label>
            <input
              id="date-from"
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-full rounded-xl border border-line bg-white px-3 py-2.5 text-[13px] text-navy focus:border-secondary focus:outline-none focus:ring-2 focus:ring-secondary/20"
            />
          </div>
          <div>
            <label htmlFor="date-to" className="mb-1.5 block text-[13px] font-semibold text-mirage">To</label>
            <input
              id="date-to"
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-full rounded-xl border border-line bg-white px-3 py-2.5 text-[13px] text-navy focus:border-secondary focus:outline-none focus:ring-2 focus:ring-secondary/20"
            />
          </div>
          <div className="flex items-end gap-2">
            <button
              type="button"
              onClick={resetFilters}
              className="inline-flex min-h-[42px] flex-1 items-center justify-center gap-2 rounded-xl border border-line px-4 text-[13px] font-semibold text-mirage transition-colors hover:bg-alt"
            >
              <Filter className="h-4 w-4" aria-hidden="true" />
              Reset
            </button>
            <button
              type="button"
              onClick={loadAll}
              className="inline-flex min-h-[42px] items-center justify-center rounded-xl border border-line px-4 text-mirage transition-colors hover:bg-alt"
              aria-label="Refresh logs"
            >
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
            {ACTION_FILTERS.map((f) => {
              const count = actionFilterCounts[f.value] ?? 0;
            if (f.value !== "all" && count === 0) return null;
            return (
              <button
                key={f.value}
                type="button"
                onClick={() => setActionFilter(f.value)}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold transition-colors ${
                  actionFilter === f.value
                    ? "bg-secondary text-white"
                    : "bg-alt text-muted hover:bg-info-soft hover:text-secondary"
                }`}
              >
                {f.label}
                <span className="ml-0.5 text-[11px] opacity-70">{count}</span>
              </button>
            );
          })}
        </div>

        {topActions.length > 0 && actionFilter === "all" && !searchQuery && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {topActions.map(([action, count]) => (
              <button
                key={action}
                type="button"
                onClick={() => {
                  setActionFilter("all");
                  setSearchQuery(action);
                }}
                className="rounded-full border border-line px-2.5 py-1 text-[11px] font-medium text-muted transition-colors hover:bg-alt hover:text-navy"
                title={`Filter to ${action}`}
              >
                {action} · {count}
              </button>
            ))}
          </div>
        )}
      </section>

      {filteredLogs.length === 0 ? (
        <EmptyState
          title="No activity found"
          message={
            searchQuery || actionFilter !== "all" || actorFilter || targetTypeFilter !== "all" || resultFilter !== "all" || dateFrom || dateTo
              ? "No log entries match your filters."
              : "No activity has been recorded yet."
          }
          icon={ScrollText}
        >
          {searchQuery || actionFilter !== "all" || actorFilter || targetTypeFilter !== "all" || resultFilter !== "all" || dateFrom || dateTo ? (
            <button
              type="button"
              onClick={resetFilters}
              className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full bg-navy px-6 text-sm font-semibold text-white transition-colors hover:bg-secondary"
            >
              Reset Filters
            </button>
          ) : (
            <button
              type="button"
              onClick={loadAll}
              className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full bg-navy px-6 text-sm font-semibold text-white transition-colors hover:bg-secondary"
            >
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              Refresh
            </button>
          )}
        </EmptyState>
      ) : (
        <>
          <ul className="space-y-3">
            {visibleLogs.map((l) => {
              const sev = severityOf(l);
              const sensitive = isSensitiveAction(l.action);
              const needsReview = sensitive && !l.reviewed_at && user;
              const parsedDetails = tryParseJson(l.details);
              const isExpanded = expandedId === l.id;
              return (
                <li key={l.id} className="rounded-2xl border border-line bg-white shadow-[0_1px_2px_rgba(11,33,68,0.06)]">
                  <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold capitalize ${sev.cls}`}>
                          {sev.label}
                        </span>
                        <span className="font-mono text-[13px] font-semibold capitalize text-navy">
                          {l.action.replace(/[._]/g, " ")}
                        </span>
                        {l.result && (
                          <span
                            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                              l.result === "success" ? "bg-success-soft text-success" : "bg-critical-soft text-critical"
                            }`}
                          >
                            {l.result === "success" ? <CheckCircle2 className="h-3 w-3" aria-hidden="true" /> : <XCircle className="h-3 w-3" aria-hidden="true" />}
                            {l.result}
                          </span>
                        )}
                        {l.reviewed_at && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-success-soft px-2 py-0.5 text-[11px] font-semibold text-success">
                            <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                            Reviewed
                          </span>
                        )}
                      </div>
                      <p className="mt-1.5 text-[12.5px] text-muted">
                        {l.profiles?.display_name || "System"} · {l.entity_ref || l.target_type || "—"}
                        {l.target_id ? ` · ${l.target_id}` : ""}
                      </p>
                      <p className="mt-0.5 flex items-center gap-1 text-[12px] text-muted">
                        <Clock className="h-3 w-3" aria-hidden="true" />
                        {formatDateTime(l.created_at)}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      {needsReview && (
                        <button
                          type="button"
                          onClick={() => {
                            setReviewTarget(l);
                            setReviewResult("dismissed");
                            setReviewRemarks("");
                          }}
                          className="inline-flex items-center gap-1 rounded-full bg-navy px-4 py-2 text-[12px] font-semibold text-white transition-colors hover:bg-secondary"
                        >
                          <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
                          Review
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setExpandedId(isExpanded ? null : l.id)}
                        aria-expanded={isExpanded}
                        aria-label={isExpanded ? "Collapse details" : "Expand details"}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-line text-muted transition-colors hover:bg-alt hover:text-navy"
                      >
                        {isExpanded ? <ChevronUp className="h-4 w-4" aria-hidden="true" /> : <ChevronDown className="h-4 w-4" aria-hidden="true" />}
                      </button>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="border-t border-line bg-alt/40 p-4">
                      <dl className="grid gap-3 text-[12.5px] sm:grid-cols-2 lg:grid-cols-3">
                        <div>
                          <dt className="font-semibold text-mirage">Entry ID</dt>
                          <dd className="font-mono text-muted">{l.id}</dd>
                        </div>
                        <div>
                          <dt className="font-semibold text-mirage">Actor</dt>
                          <dd className="text-muted">{l.actor_id || "—"}</dd>
                        </div>
                        <div>
                          <dt className="font-semibold text-mirage">Target</dt>
                          <dd className="text-muted">
                            {l.target_type || "—"} {l.target_id ? `(${l.target_id})` : ""}
                          </dd>
                        </div>
                        <div>
                          <dt className="font-semibold text-mirage">Entity Ref</dt>
                          <dd className="text-muted">{l.entity_ref || "—"}</dd>
                        </div>
                        <div>
                          <dt className="font-semibold text-mirage">IP Address</dt>
                          <dd className="font-mono text-muted">{l.ip_address || "—"}</dd>
                        </div>
                        <div>
                          <dt className="font-semibold text-mirage">Reviewed</dt>
                          <dd className="text-muted">{l.reviewed_at ? formatDateTime(l.reviewed_at) : "No"}</dd>
                        </div>
                        <div className="sm:col-span-2 lg:col-span-3">
                          <dt className="font-semibold text-mirage">Remarks</dt>
                          <dd className="text-muted">{l.remarks || "—"}</dd>
                        </div>
                        <div className="sm:col-span-2 lg:col-span-3">
                          <dt className="font-semibold text-mirage">Details</dt>
                          <dd className="mt-1 whitespace-pre-wrap break-words rounded-xl border border-line bg-white p-3 font-mono text-[11.5px] text-muted">
                            {parsedDetails ? JSON.stringify(parsedDetails, null, 2) : typeof l.details === "string" && l.details ? l.details : "—"}
                          </dd>
                        </div>
                      </dl>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          {filteredLogs.length > visibleLogs.length && (
            <div className="flex justify-center">
              <button
                type="button"
                onClick={() => setLimit((n) => n + 50)}
                className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full border border-line bg-white px-6 text-sm font-semibold text-navy transition-colors hover:bg-alt"
              >
                Load More ({filteredLogs.length - visibleLogs.length} remaining)
              </button>
            </div>
          )}
        </>
      )}

      <ResidentModal
        open={reviewTarget !== null}
        onClose={() => setReviewTarget(null)}
        labelledBy="review-alert-title"
        title="Review Security Event"
        maxWidthClass="max-w-md"
      >
        {reviewTarget && (
          <div className="space-y-4">
            <div className="rounded-xl border border-line p-3">
              <p className="text-sm font-semibold capitalize text-navy">{reviewTarget.action.replace(/[._]/g, " ")}</p>
              <p className="mt-1 text-[12px] text-muted">
                {reviewTarget.profiles?.display_name || "System"} · {formatDateTime(reviewTarget.created_at)}
              </p>
            </div>
            <div>
              <label htmlFor="log-review-result" className="mb-1.5 block text-[13px] font-semibold text-mirage">Outcome</label>
              <select
                id="log-review-result"
                value={reviewResult}
                onChange={(e) => setReviewResult(e.target.value)}
                className="w-full rounded-xl border border-line bg-white px-3 py-2.5 text-[13px] text-navy focus:border-secondary focus:outline-none focus:ring-2 focus:ring-secondary/20"
              >
                {["success", "failed", "dismissed", "escalated"].map((r) => (
                  <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="log-review-remarks" className="mb-1.5 block text-[13px] font-semibold text-mirage">Remarks (optional)</label>
              <textarea
                id="log-review-remarks"
                value={reviewRemarks}
                onChange={(e) => setReviewRemarks(e.target.value)}
                rows={3}
                placeholder="Notes recorded with the review…"
                className="w-full rounded-xl border border-line bg-white px-3 py-2.5 text-[13px] text-navy placeholder:text-muted focus:border-secondary focus:outline-none focus:ring-2 focus:ring-secondary/20"
              />
            </div>
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setReviewTarget(null)}
                disabled={reviewBusy}
                className="inline-flex h-11 items-center justify-center rounded-full border border-line px-5 text-sm font-semibold text-mirage transition-colors hover:bg-alt disabled:opacity-60"
              >
                Cancel
              </button>
              <LoadingButton isLoading={reviewBusy} onClick={handleReview} disabled={reviewBusy}>
                Save Review
              </LoadingButton>
            </div>
          </div>
        )}
      </ResidentModal>
    </div>
  );
}
