"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { getErrorMessage, logSupabaseError } from "@/lib/supabaseError";
import EmptyState from "@/components/shared/EmptyState";
import {
  BarChart3,
  TrendingUp,
  CalendarDays,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Timer,
  Activity,
  MapPin,
  FileText,
  Loader2,
  RefreshCw,
} from "lucide-react";

const MAX_ROWS = 5000;

const CATEGORY_ORDER = ["Criminal", "Civil", "Administrative"];
const URGENCY_ORDER = ["Critical", "High", "Normal"];
const CATEGORY_COLORS = {
  Criminal: "#b5493b",
  Civil: "#1b4c8c",
  Administrative: "#6b7280",
};
const URGENCY_COLORS = {
  Critical: "#b5493b",
  High: "#d97706",
  Normal: "#6b7280",
};

const RANGE_PRESETS = [
  { key: "last30", label: "Last 30 days", days: 30 },
  { key: "last90", label: "Last 90 days", days: 90 },
  { key: "last12m", label: "Last 12 months", days: 365 },
  { key: "all", label: "All time", days: null },
];

function formatDate(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatDateTime(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function toISODate(d) {
  try {
    return d.toISOString().slice(0, 10);
  } catch {
    return "";
  }
}

function daysBetween(fromISO, toISO) {
  if (!fromISO || !toISO) return 0;
  const a = new Date(`${fromISO}T00:00:00`);
  const b = new Date(`${toISO}T00:00:00`);
  return Math.round((b - a) / (1000 * 60 * 60 * 24));
}

function resolveCategory(c) {
  return c.confirmed_category || c.predicted_category || "Uncategorized";
}

function resolveUrgency(c) {
  return c.confirmed_urgency || c.predicted_urgency || "Normal";
}

function isTerminal(status) {
  const s = (status || "").toLowerCase().trim();
  return s === "resolved" || s === "closed" || s === "rejected";
}

function isResolved(status) {
  const s = (status || "").toLowerCase().trim();
  return s === "resolved" || s === "closed";
}

function BarChart({ data, maxValue, colorMap, labelFn }) {
  const entries = Object.entries(data);
  const max = maxValue || Math.max(...entries.map(([, v]) => v), 1);
  if (entries.length === 0) {
    return <p className="mt-4 text-[13px] text-muted">No data in this range.</p>;
  }
  return (
    <div className="mt-4 space-y-3">
      {entries.map(([key, value]) => {
        const pct = (value / max) * 100;
        const color = colorMap?.[key] || "#1b4c8c";
        return (
          <div key={key}>
            <div className="mb-1 flex items-center justify-between text-[12px]">
              <span className="font-medium text-navy">
                {labelFn ? labelFn(key) : key}
              </span>
              <span className="font-semibold text-navy">{value}</span>
            </div>
            <div className="h-5 overflow-hidden rounded-full bg-alt">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${Math.max(pct, 1)}%`, backgroundColor: color }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function HorizontalBarChart({ data, maxValue, colorMap }) {
  const entries = Object.entries(data);
  const max = maxValue || Math.max(...entries.map(([, v]) => v), 1);
  if (entries.length === 0) {
    return <p className="mt-4 text-[13px] text-muted">No data in this range.</p>;
  }
  return (
    <div className="mt-4 space-y-3">
      {entries.map(([key, value]) => {
        const pct = (value / max) * 100;
        const color = colorMap?.[key] || "#1b4c8c";
        return (
          <div key={key} className="flex items-center gap-3">
            <span className="w-36 shrink-0 text-right text-[12px] font-medium text-navy">
              {key}
            </span>
            <div className="h-5 flex-1 overflow-hidden rounded-full bg-alt">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${Math.max(pct, 1)}%`, backgroundColor: color }}
              />
            </div>
            <span className="w-8 text-[12px] font-semibold text-navy">{value}</span>
          </div>
        );
      })}
    </div>
  );
}

function TimelineChart({ data }) {
  const max = Math.max(...data.map((d) => d.count), 1);
  return (
    <div className="mt-4">
      <div className="flex items-end gap-1" style={{ height: "160px" }}>
        {data.map((d, i) => {
          const height = (d.count / max) * 100;
          return (
            <div key={d.label} className="group relative flex flex-1 items-end" style={{ height: "100%" }}>
              <div
                className="mx-auto w-full max-w-[32px] rounded-t-md bg-secondary transition-all duration-500 group-hover:bg-jordy"
                style={{ height: `${Math.max(height, 2)}%` }}
                title={`${d.label}: ${d.count}${d.delta != null ? ` (${d.delta >= 0 ? "+" : ""}${d.delta}% vs prior 30 days)` : ""}`}
              />
              <div className="absolute -bottom-6 left-1/2 -translate-x-1/2 text-[9px] font-medium text-muted">
                {d.label}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-8" />
    </div>
  );
}

function StatCard({ icon: Icon, iconClass, label, value, subline }) {
  return (
    <div className="rounded-2xl border border-line bg-white p-5 shadow-[0_1px_2px_rgba(11,33,68,0.06)]">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${iconClass}`}>
            <Icon className="h-5 w-5" aria-hidden="true" />
          </span>
        </div>
        {subline}
      </div>
      <p className="mt-3 font-heading text-2xl font-semibold tracking-tight text-navy">{value}</p>
      <p className="mt-0.5 text-[12px] font-semibold text-mirage">{label}</p>
    </div>
  );
}

function DeltaHint({ pct }) {
  if (pct == null || Number.isNaN(pct)) {
    return (
      <span className="rounded-full bg-alt px-2 py-1 text-[11px] font-semibold text-muted">
        No prior data
      </span>
    );
  }
  const up = pct >= 0;
  return (
    <span
      className={`rounded-full px-2 py-1 text-[11px] font-semibold ${
        up ? "bg-critical-soft text-critical" : "bg-success-soft text-success"
      }`}
    >
      {up ? "▲" : "▼"} {Math.abs(pct).toFixed(1)}% vs prior period
    </span>
  );
}

export default function CaptainAnalyticsPage() {
  const supabaseClient = useMemo(() => createClient(), []);

  const [rangeKey, setRangeKey] = useState("last12m");
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 12);
    return toISODate(d);
  });
  const [endDate, setEndDate] = useState(() => toISODate(new Date()));

  const [complaints, setComplaints] = useState([]);
  const [hearings, setHearings] = useState([]);
  const [purokMap, setPurokMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [hitCap, setHitCap] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      setError(null);

      const [complaintsRes, hearingsRes, residentRes] = await Promise.all([
        supabaseClient
          .from("complaints")
          .select(
            "id, reference_number, title, confirmed_category, predicted_category, confirmed_urgency, predicted_urgency, current_status, submitted_at, resolved_at, resident_id"
          )
          .order("submitted_at", { ascending: false })
          .limit(MAX_ROWS),
        supabaseClient
          .from("hearings")
          .select("id, status, hearing_type, hearing_date, hearing_time, venue, created_at, complaint_id")
          .order("hearing_date", { ascending: false })
          .limit(MAX_ROWS),
        supabaseClient.from("resident_profiles").select("user_id, purok"),
      ]);

      setComplaints(complaintsRes.data || []);
      setHearings(hearingsRes.data || []);
      setHitCap((complaintsRes.data || []).length >= MAX_ROWS);

      const map = {};
      (residentRes.data || []).forEach((rp) => {
        if (rp.user_id && rp.purok) map[rp.user_id] = rp.purok;
      });
      setPurokMap(map);

      const firstErr = complaintsRes.error || hearingsRes.error || residentRes.error;
      if (firstErr) {
        logSupabaseError("Analytics load", complaintsRes.error, hearingsRes.error, residentRes.error);
        setError(getErrorMessage(firstErr, "Some analytics data could not be loaded."));
      }
    } catch (err) {
      logSupabaseError("Analytics load", err);
      setError(getErrorMessage(err, "Failed to load analytics data."));
    }
  }, [supabaseClient]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      await fetchData();
      if (!cancelled) setLoading(false);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [fetchData]);

  useEffect(() => {
    const channel = supabaseClient
      .channel("captain-analytics-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "complaints" }, () => {
        fetchData();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "hearings" }, () => {
        fetchData();
      })
      .subscribe();
    return () => {
      supabaseClient.removeChannel(channel);
    };
  }, [supabaseClient, fetchData]);

  const applyPreset = useCallback((presetKey, isoSpan) => {
    setRangeKey(presetKey);
    if (presetKey === "all") {
      setStartDate("");
      setEndDate("");
      return;
    }
    const end = new Date(isoSpan);
    const start = new Date(isoSpan);
    start.setDate(start.getDate() - ((RANGE_PRESETS.find((r) => r.key === presetKey) || {}).days || 30));
    setStartDate(toISODate(start));
    setEndDate(toISODate(end));
  }, []);

  const handleReset = useCallback(() => {
    applyPreset("last12m", new Date());
  }, [applyPreset]);

  const inRange = useCallback(
    (dateStrIso) => {
      if (!startDate || !endDate) return true;
      const d = typeof dateStrIso === "string" && dateStrIso ? dateStrIso.slice(0, 10) : "";
      if (!d) return true;
      return d >= startDate && d <= endDate;
    },
    [startDate, endDate]
  );

  const stats = useMemo(() => {
    const rangeComplaints = complaints.filter((c) =>
      inRange(c.submitted_at || c.created_at)
    );

    const periodLen = daysBetween(startDate, endDate);
    const prevStart = periodLen > 0 ? toISODate(new Date(`${startDate}T00:00:00`).getTime() - periodLen * 86400000) : "";
    const prevEnd = periodLen > 0 ? toISODate(new Date(`${startDate}T00:00:00`).getTime() - 86400000) : "";
    const previousTotal = periodLen > 0
      ? complaints.filter((c) => {
          const d = (c.submitted_at || c.created_at || "").slice(0, 10);
          return d >= prevStart && d <= prevEnd;
        }).length
      : 0;
    const deltaPct =
      previousTotal > 0
        ? ((rangeComplaints.length - previousTotal) / previousTotal) * 100
        : rangeComplaints.length > 0
          ? 100
          : NaN;

    const resolved = rangeComplaints.filter((c) => isResolved(c.current_status));
    const pendingReview = rangeComplaints.filter(
      (c) => (c.current_status || "").toLowerCase() === "pending review"
    );
    const active = rangeComplaints.filter((c) => !isTerminal(c.current_status));

    const resolvedDays = resolved
      .filter((c) => c.resolved_at && (c.submitted_at || c.created_at))
      .map((c) =>
        Math.max(
          0,
          (new Date(c.resolved_at) - new Date(c.submitted_at || c.created_at)) / 86400000
        )
      );
    const avgResolutionDays =
      resolvedDays.length > 0
        ? (resolvedDays.reduce((a, b) => a + b, 0) / resolvedDays.length).toFixed(1)
        : null;

    const categoryCounts = {};
    CATEGORY_ORDER.forEach((cat) => { categoryCounts[cat] = 0; });
    const urgencyCounts = {};
    URGENCY_ORDER.forEach((u) => { urgencyCounts[u] = 0; });
    const statusCounts = {};
    const purokCounts = {};

    rangeComplaints.forEach((c) => {
      const cat = resolveCategory(c);
      categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
      const urg = resolveUrgency(c);
      urgencyCounts[urg] = (urgencyCounts[urg] || 0) + 1;
      const st = c.current_status || "Pending Review";
      statusCounts[st] = (statusCounts[st] || 0) + 1;
      const purok = purokMap[c.resident_id];
      if (purok) purokCounts[purok] = (purokCounts[purok] || 0) + 1;
    });

    const sortedStatuses = Object.entries(statusCounts).sort((a, b) => b[1] - a[1]);
    const statusData = {};
    sortedStatuses.forEach(([k, v]) => { statusData[k] = v; });

    const topPuroks = Object.entries(purokCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const purokData = {};
    topPuroks.forEach(([k, v]) => { purokData[k] = v; });

    const rangeHearings = hearings.filter((h) => inRange(h.created_at));
    const hearingStatusCounts = { Upcoming: 0, Completed: 0, Cancelled: 0, Rescheduled: 0 };
    rangeHearings.forEach((h) => {
      const st = (h.status || "").trim();
      if (hearingStatusCounts[st] !== undefined) hearingStatusCounts[st]++;
      else hearingStatusCounts[st] = 1;
    });

    const monthlyData = [];
    const now = new Date();
    const oldest = new Date(now.getFullYear(), now.getMonth() - 11, 1);
    const newestEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    for (let d = new Date(oldest); d < newestEnd; d.setMonth(d.getMonth() + 1)) {
      const mStart = new Date(d.getFullYear(), d.getMonth(), 1);
      const mEnd = new Date(d.getFullYear(), d.getMonth() + 1, 1);
      const count = complaints.filter((c) => {
        const dt = new Date(`${(c.submitted_at || c.created_at || "").slice(0, 10)}T00:00:00`);
        return !Number.isNaN(dt.getTime()) && dt >= mStart && dt < mEnd;
      }).length;
      monthlyData.push({
        label: d.toLocaleDateString("en-PH", { month: "short", year: "2-digit" }),
        yearMonth: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
        count,
        delta: null,
      });
    }
    for (let i = 1; i < monthlyData.length; i++) {
      const prev = monthlyData[i - 1].count;
      const curr = monthlyData[i].count;
      monthlyData[i].delta = prev > 0 ? Math.round(((curr - prev) / prev) * 100) : null;
    }

    const pendingWorkload = {};
    rangeComplaints
      .filter((c) => !isTerminal(c.current_status))
      .forEach((c) => {
        const st = c.current_status || "Pending Review";
        pendingWorkload[st] = (pendingWorkload[st] || 0) + 1;
      });
    const sortedPending = Object.entries(pendingWorkload).sort((a, b) => b[1] - a[1]);
    const pendingData = {};
    sortedPending.forEach(([k, v]) => { pendingData[k] = v; });

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 7);
    const upcomingHearings = hearings.filter((h) => {
      if ((h.status || "").toLowerCase() !== "upcoming") return false;
      if (!h.hearing_date) return false;
      const hd = new Date(`${h.hearing_date}T00:00:00`);
      const t = new Date();
      t.setHours(0, 0, 0, 0);
      return hd >= t && hd <= tomorrow;
    });
    const overdueHearings = hearings.filter((h) => {
      if ((h.status || "").toLowerCase() !== "upcoming") return false;
      if (!h.hearing_date) return false;
      const t = new Date();
      t.setHours(0, 0, 0, 0);
      return new Date(`${h.hearing_date}T00:00:00`) < t;
    });

    const resolutionRate =
      rangeComplaints.length > 0
        ? ((resolved.length / rangeComplaints.length) * 100).toFixed(1)
        : 0;

    const recent = [...rangeComplaints]
      .sort((a, b) => {
        const da = a.submitted_at || a.created_at || "";
        const db = b.submitted_at || b.created_at || "";
        return db.localeCompare(da);
      })
      .slice(0, 5);

    return {
      rangeComplaints,
      total: rangeComplaints.length,
      deltaPct,
      resolved: resolved.length,
      pendingReview: pendingReview.length,
      active: active.length,
      avgResolutionDays,
      categoryCounts,
      urgencyCounts,
      statusData,
      purokData,
      hearingStatusCounts,
      monthlyData,
      pendingData,
      upcomingHearings: upcomingHearings.length,
      overdueHearings: overdueHearings.length,
      resolutionRate,
      recent,
      rangeHearings: rangeHearings.length,
      hasRangeData: rangeComplaints.length > 0 || rangeHearings.length > 0,
    };
  }, [complaints, hearings, purokMap, inRange, startDate, endDate]);

  const statusColorMap = {
    "Pending Review": "#d97706",
    "For Official Categorization": "#714bd8",
    Received: "#1b4c8c",
    "In Progress": "#1b4c8c",
    "Awaiting Meeting": "#b45309",
    Resolved: "#17774e",
    Closed: "#6b7280",
    Rejected: "#b5493b",
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-[1280px] space-y-6">
        <div className="flex items-center gap-3">
          <BarChart3 className="h-6 w-6 text-secondary" aria-hidden="true" />
          <h1 className="font-heading text-2xl font-semibold tracking-tight text-navy">Analytics</h1>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-2xl border border-line bg-white p-5">
              <div className="h-10 w-10 animate-pulse rounded-xl bg-alt" />
              <div className="mt-3 h-8 w-20 animate-pulse rounded bg-alt" />
              <div className="mt-2 h-3 w-28 animate-pulse rounded bg-alt" />
            </div>
          ))}
        </div>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-2xl border border-line bg-white p-6">
              <div className="h-4 w-40 animate-pulse rounded bg-alt" />
              <div className="mt-4 space-y-2">
                {Array.from({ length: 3 }).map((__, j) => (
                  <div key={j} className="h-5 animate-pulse rounded-full bg-alt/70" />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1280px] space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <BarChart3 className="h-6 w-6 text-secondary" aria-hidden="true" />
          <div>
            <h1 className="font-heading text-2xl font-semibold tracking-tight text-navy">Analytics</h1>
            <p className="text-[13px] text-muted">Complaint, hearing, and workload overview</p>
          </div>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-3 rounded-2xl border border-critical/25 bg-critical-soft px-4 py-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-critical" aria-hidden="true" />
          <div className="flex-1">
            <p className="text-[13px] font-semibold text-navy">Some analytics data could not be loaded.</p>
            <p className="mt-0.5 text-[12.5px] text-muted">{error}</p>
          </div>
          <button
            type="button"
            onClick={fetchData}
            className="inline-flex min-h-[36px] items-center justify-center gap-1.5 rounded-full bg-navy px-4 text-[12px] font-semibold text-white transition-colors hover:bg-secondary"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            Retry
          </button>
        </div>
      )}

      <section className="rounded-2xl border border-line bg-white p-4 shadow-[0_1px_2px_rgba(11,33,68,0.06)] sm:p-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="mb-2 text-[13px] font-semibold text-navy">Date Range</p>
            <div className="flex flex-wrap gap-2">
              {RANGE_PRESETS.map((preset) => (
                <button
                  key={preset.key}
                  type="button"
                  onClick={() => applyPreset(preset.key, new Date())}
                  className={`rounded-full px-3.5 py-2 text-[12px] font-semibold transition-colors ${
                    rangeKey === preset.key
                      ? "bg-secondary text-white"
                      : "bg-alt text-muted hover:bg-info-soft hover:text-secondary"
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label htmlFor="analytics-from" className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-muted">From</label>
              <input
                id="analytics-from"
                type="date"
                value={startDate}
                onChange={(e) => { setStartDate(e.target.value); setRangeKey("custom"); }}
                className="h-10 rounded-xl border border-line bg-canvas px-3 text-[13px] text-navy focus:border-secondary focus:outline-none focus:ring-2 focus:ring-secondary/20"
              />
            </div>
            <div>
              <label htmlFor="analytics-to" className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-muted">To</label>
              <input
                id="analytics-to"
                type="date"
                value={endDate}
                onChange={(e) => { setEndDate(e.target.value); setRangeKey("custom"); }}
                className="h-10 rounded-xl border border-line bg-canvas px-3 text-[13px] text-navy focus:border-secondary focus:outline-none focus:ring-2 focus:ring-secondary/20"
              />
            </div>
            <button
              type="button"
              onClick={handleReset}
              className="ml-auto rounded-full bg-alt px-4 py-2.5 text-[12px] font-semibold text-mirage transition-colors hover:bg-info-soft xl:ml-2"
            >
              Reset
            </button>
          </div>
        </div>
      </section>

      {hitCap && (
        <div className="flex items-start gap-2 rounded-2xl border border-warning/30 bg-warning-soft/40 px-4 py-3 text-[13px] text-navy">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
          <p>
            Showing the latest {MAX_ROWS.toLocaleString()} matching records. Analytics are capped at this
            threshold; export full data from the Reports page.
          </p>
        </div>
      )}

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={TrendingUp}
          iconClass="bg-info-soft text-secondary"
          label="Total Complaints (range)"
          value={stats.total}
          subline={<DeltaHint pct={stats.deltaPct} />}
        />
        <StatCard
          icon={CheckCircle2}
          iconClass="bg-success-soft text-success"
          label="Resolved / Closed"
          value={stats.resolved}
        />
        <StatCard
          icon={Clock}
          iconClass="bg-warning-soft text-warning"
          label="Pending Review"
          value={stats.pendingReview}
        />
        <StatCard
          icon={Timer}
          iconClass="bg-gold/10 text-gold"
          label="Avg. Resolution (days)"
          value={stats.avgResolutionDays == null ? "—" : stats.avgResolutionDays}
        />
      </section>

      {!stats.hasRangeData && stats.upcomingHearings === 0 ? (
        <EmptyState
          title="No data in this range"
          message="Analytics will appear here once complaints and hearings are recorded within the selected period."
          icon={BarChart3}
        >
          <button
            type="button"
            onClick={handleReset}
            className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full bg-navy px-6 text-sm font-semibold text-white transition-colors hover:bg-secondary"
          >
            Reset to last 12 months
          </button>
        </EmptyState>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <section aria-labelledby="chart-category" className="rounded-2xl border border-line bg-white p-6 shadow-[0_1px_2px_rgba(11,33,68,0.06)]">
            <h2 id="chart-category" className="flex items-center gap-2 font-heading text-base font-semibold tracking-tight text-navy">
              <BarChart3 className="h-5 w-5 text-gold" aria-hidden="true" />
              Complaints by Category
            </h2>
            <BarChart data={stats.categoryCounts} maxValue={stats.total} colorMap={CATEGORY_COLORS} />
          </section>

          <section aria-labelledby="chart-urgency" className="rounded-2xl border border-line bg-white p-6 shadow-[0_1px_2px_rgba(11,33,68,0.06)]">
            <h2 id="chart-urgency" className="flex items-center gap-2 font-heading text-base font-semibold tracking-tight text-navy">
              <AlertTriangle className="h-5 w-5 text-gold" aria-hidden="true" />
              Complaints by Urgency
            </h2>
            <BarChart data={stats.urgencyCounts} maxValue={stats.total} colorMap={URGENCY_COLORS} />
          </section>

          <section aria-labelledby="chart-status" className="rounded-2xl border border-line bg-white p-6 shadow-[0_1px_2px_rgba(11,33,68,0.06)]">
            <h2 id="chart-status" className="flex items-center gap-2 font-heading text-base font-semibold tracking-tight text-navy">
              <CheckCircle2 className="h-5 w-5 text-gold" aria-hidden="true" />
              Complaints by Status
            </h2>
            <HorizontalBarChart
              data={stats.statusData}
              maxValue={Math.max(...Object.values(stats.statusData), 1)}
              colorMap={statusColorMap}
            />
          </section>

          <section aria-labelledby="chart-purok" className="rounded-2xl border border-line bg-white p-6 shadow-[0_1px_2px_rgba(11,33,68,0.06)]">
            <h2 id="chart-purok" className="flex items-center gap-2 font-heading text-base font-semibold tracking-tight text-navy">
              <MapPin className="h-5 w-5 text-gold" aria-hidden="true" />
              Complaints by Purok (Top 5)
            </h2>
            <BarChart
              data={stats.purokData}
              maxValue={Math.max(...Object.values(stats.purokData), 1)}
              colorMap={{ Purok: "#1b4c8c" }}
            />
          </section>

          <section aria-labelledby="chart-hearings" className="rounded-2xl border border-line bg-white p-6 shadow-[0_1px_2px_rgba(11,33,68,0.06)]">
            <h2 id="chart-hearings" className="flex items-center gap-2 font-heading text-base font-semibold tracking-tight text-navy">
              <Activity className="h-5 w-5 text-gold" aria-hidden="true" />
              Hearings by Status (range)
            </h2>
            <BarChart
              data={stats.hearingStatusCounts}
              maxValue={Math.max(...Object.values(stats.hearingStatusCounts), 1)}
              colorMap={{
                Upcoming: "#1b4c8c",
                Completed: "#17774e",
                Cancelled: "#6b7280",
                Rescheduled: "#b45309",
              }}
            />
          </section>

          <section aria-labelledby="chart-timeline" className="rounded-2xl border border-line bg-white p-6 shadow-[0_1px_2px_rgba(11,33,68,0.06)] lg:col-span-2">
            <h2 id="chart-timeline" className="flex items-center gap-2 font-heading text-base font-semibold tracking-tight text-navy">
              <TrendingUp className="h-5 w-5 text-gold" aria-hidden="true" />
              Complaints Over Time (Last 12 Months)
            </h2>
            <TimelineChart data={stats.monthlyData} />
          </section>

          <section aria-labelledby="chart-resolution" className="rounded-2xl border border-line bg-white p-6 shadow-[0_1px_2px_rgba(11,33,68,0.06)]">
            <h2 id="chart-resolution" className="flex items-center gap-2 font-heading text-base font-semibold tracking-tight text-navy">
              <CheckCircle2 className="h-5 w-5 text-gold" aria-hidden="true" />
              Resolution Rate
            </h2>
            <div className="mt-4 flex items-center gap-6">
              <div className="relative h-32 w-32 shrink-0">
                <svg viewBox="0 0 36 36" className="h-full w-full -rotate-90">
                  <circle cx="18" cy="18" r="15.915" fill="none" stroke="#E5E7EB" strokeWidth="3" />
                  <circle
                    cx="18"
                    cy="18"
                    r="15.915"
                    fill="none"
                    stroke="#17774e"
                    strokeWidth="3"
                    strokeDasharray={`${stats.resolutionRate} ${100 - stats.resolutionRate}`}
                    strokeLinecap="round"
                    className="transition-all duration-500"
                  />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="font-heading text-xl font-bold text-navy">{stats.resolutionRate}%</span>
                </div>
              </div>
              <div className="space-y-2 text-[13px]">
                <div className="flex items-center gap-2">
                  <span className="inline-block h-2.5 w-2.5 rounded-sm bg-success" />
                  <span className="text-muted">Resolved/Closed</span>
                  <span className="font-semibold text-navy">{stats.resolved}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="inline-block h-2.5 w-2.5 rounded-sm bg-alt" />
                  <span className="text-muted">Remaining</span>
                  <span className="font-semibold text-navy">{Math.max(stats.total - stats.resolved, 0)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="inline-block h-2.5 w-2.5 rounded-sm bg-secondary" />
                  <span className="text-muted">Total</span>
                  <span className="font-semibold text-navy">{stats.total}</span>
                </div>
              </div>
            </div>
          </section>

          <section aria-labelledby="chart-workload" className="rounded-2xl border border-line bg-white p-6 shadow-[0_1px_2px_rgba(11,33,68,0.06)]">
            <h2 id="chart-workload" className="flex items-center gap-2 font-heading text-base font-semibold tracking-tight text-navy">
              <Clock className="h-5 w-5 text-gold" aria-hidden="true" />
              Active Workload by Status
            </h2>
            <BarChart
              data={stats.pendingData}
              maxValue={Math.max(...Object.values(stats.pendingData), 1)}
              colorMap={statusColorMap}
            />
          </section>

          <section aria-labelledby="recent-complaints" className="rounded-2xl border border-line bg-white p-6 shadow-[0_1px_2px_rgba(11,33,68,0.06)] lg:col-span-2">
            <h2 id="recent-complaints" className="flex items-center gap-2 font-heading text-base font-semibold tracking-tight text-navy">
              <FileText className="h-5 w-5 text-gold" aria-hidden="true" />
              Latest Complaints in Range
            </h2>
            {stats.recent.length === 0 ? (
              <p className="mt-4 text-[13px] text-muted">No complaints in this range.</p>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-[13px]">
                  <thead>
                    <tr className="border-b border-line text-[11px] font-semibold uppercase tracking-wider text-muted">
                      <th className="pb-3 pr-4">Reference</th>
                      <th className="pb-3 pr-4">Title</th>
                      <th className="pb-3 pr-4">Category</th>
                      <th className="pb-3 pr-4">Status</th>
                      <th className="pb-3">Submitted</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {stats.recent.map((c) => (
                      <tr key={c.id} className="transition-colors hover:bg-alt/40">
                        <td className="py-3 pr-4 font-medium text-secondary">{c.reference_number || c.id.slice(0, 8)}</td>
                        <td className="max-w-[220px] truncate py-3 pr-4 font-medium text-navy">{c.title}</td>
                        <td className="py-3 pr-4 text-muted">{resolveCategory(c)}</td>
                        <td className="py-3 pr-4 text-muted">{c.current_status}</td>
                        <td className="py-3 text-muted">{formatDateTime(c.submitted_at || c.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section aria-labelledby="hearing-upcoming" className="rounded-2xl border border-line bg-white p-6 shadow-[0_1px_2px_rgba(11,33,68,0.06)] lg:col-span-2">
            <h2 id="hearing-upcoming" className="flex items-center gap-2 font-heading text-base font-semibold tracking-tight text-navy">
              <CalendarDays className="h-5 w-5 text-gold" aria-hidden="true" />
              Upcoming & Overdue Hearings (next 7 days)
            </h2>
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="flex items-center justify-between rounded-xl border border-line p-4">
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-info-soft text-secondary">
                    <CalendarDays className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <div>
                    <p className="text-[12px] font-semibold uppercase tracking-wider text-muted">Upcoming</p>
                    <p className="font-heading text-xl font-bold text-navy">{stats.upcomingHearings}</p>
                  </div>
                </div>
                <p className="text-[12px] text-muted">within 7 days</p>
              </div>
              <div className="flex items-center justify-between rounded-xl border border-line p-4">
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-warning-soft text-warning">
                    <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <div>
                    <p className="text-[12px] font-semibold uppercase tracking-wider text-muted">Overdue</p>
                    <p className="font-heading text-xl font-bold text-navy">{stats.overdueHearings}</p>
                  </div>
                </div>
                <p className="text-[12px] text-muted">passed their date</p>
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}