"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/context/AuthContext";
import StatusBadge from "@/components/shared/StatusBadge";
import EmptyState from "@/components/shared/EmptyState";
import {
  LayoutDashboard,
  FileText,
  AlertTriangle,
  Clock,
  CalendarDays,
  TrendingUp,
  ArrowRight,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Users,
  Plus,
  ShieldAlert,
} from "lucide-react";
import Link from "next/link";
import {
  useOfficialPortal,
  useOfficialRoutes,
} from "@/components/official/OfficialPortalProvider";
import { OFFICIAL_ROLE_SHORT_LABELS } from "@/lib/permissions";
import CaptainCaseVolumeTrend from "@/components/captain/dashboard/CaptainCaseVolumeTrend";

/* â”€â”€ Constants â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

const DAYSOfWeek = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const URGENCY_COLORS = {
  Critical: "#b5493b",
  High: "#d97706",
  Normal: "#1b4c8c",
};

/* â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function resolveCategory(c) {
  return c.confirmed_category || c.predicted_category || "Uncategorized";
}

function resolveUrgency(c) {
  return c.confirmed_urgency || c.predicted_urgency || "Normal";
}

function resolveComplainantName(c) {
  const profile = c.profiles;
  const resident = profile?.resident_profiles;
  const name = resident
    ? [resident.first_name, resident.last_name].filter(Boolean).join(" ")
    : "";
  return name || profile?.display_name || "Resident";
}

function resolveReference(c) {
  return c.reference_number || c.id;
}

function formatDate(dateStr) {
  if (!dateStr) return "\u2014";
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
}

function formatTime(timeStr) {
  if (!timeStr) return "\u2014";
  const [h, m] = timeStr.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 || 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${period}`;
}

function getWeekRange(date) {
  const d = new Date(date);
  const day = d.getDay();
  const start = new Date(d);
  start.setDate(d.getDate() - day);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

function getMonthKey(dateStr) {
  if (!dateStr) return null;
  return dateStr.slice(0, 7);
}

/* â”€â”€ SVG Line Chart â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

function CaseVolumeChart({ data }) {
  if (!data || data.length === 0) {
    return (
      <div className="flex h-[280px] items-center justify-center">
        <EmptyState
          title="No case trend data available"
          message="Complaint volume will appear here once cases are filed."
          icon={TrendingUp}
        />
      </div>
    );
  }

  const width = 700;
  const height = 280;
  const padding = { top: 20, right: 20, bottom: 40, left: 45 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  const allValues = data.flatMap((d) => [d.Critical || 0, d.High || 0, d.Normal || 0]);
  const maxVal = Math.max(...allValues, 1);

  const xStep = data.length > 1 ? chartW / (data.length - 1) : chartW / 2;
  const toX = (i) => padding.left + (data.length > 1 ? i * xStep : chartW / 2);
  const toY = (v) => padding.top + chartH - (v / maxVal) * chartH;

  function buildPath(key) {
    return data
      .map((d, i) => `${i === 0 ? "M" : "L"} ${toX(i)} ${toY(d[key] || 0)}`)
      .join(" ");
  }

  const yTicks = 5;
  const yTickValues = Array.from({ length: yTicks + 1 }, (_, i) => Math.round((maxVal / yTicks) * i));

  return (
    <div className="w-full overflow-hidden">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-auto w-full"
        role="img"
        aria-label="Case volume and urgency trend chart"
      >
        {/* Y-axis grid lines */}
        {yTickValues.map((v, i) => (
          <g key={`tick-${i}-${v}`}>
            <line
              x1={padding.left}
              y1={toY(v)}
              x2={width - padding.right}
              y2={toY(v)}
              stroke="#e7eef7"
              strokeWidth="1"
            />
            <text
              x={padding.left - 8}
              y={toY(v) + 4}
              textAnchor="end"
              className="fill-muted"
              fontSize="11"
            >
              {v}
            </text>
          </g>
        ))}

        {/* X-axis labels */}
        {data.map((d, i) => (
          <text
            key={`label-${i}`}
            x={toX(i)}
            y={height - 8}
            textAnchor="middle"
            className="fill-muted"
            fontSize="11"
          >
            {d.label}
          </text>
        ))}

        {/* Lines */}
        {["Normal", "High", "Critical"].map((key) => (
          <path
            key={key}
            d={buildPath(key)}
            fill="none"
            stroke={URGENCY_COLORS[key]}
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}

        {/* Dots */}
        {["Normal", "High", "Critical"].map((key) =>
          data.map((d, i) => (
            <circle
              key={`${key}-${i}`}
              cx={toX(i)}
              cy={toY(d[key] || 0)}
              r="3.5"
              fill="white"
              stroke={URGENCY_COLORS[key]}
              strokeWidth="2"
            >
              <title>{`${d.label} \u2014 ${key}: ${d[key] || 0}`}</title>
            </circle>
          ))
        )}
      </svg>

      {/* Legend */}
      <div className="mt-3 flex flex-wrap justify-center gap-x-5 gap-y-1">
        {Object.entries(URGENCY_COLORS).map(([label, color]) => (
          <div key={label} className="flex items-center gap-2 text-[12px]">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: color }} />
            <span className="font-medium text-muted">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* â”€â”€ Calendar Component â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

function HearingCalendar({ hearingDates, selectedDate, onSelectDate }) {
  const now = new Date();
  const [viewMonth, setViewMonth] = useState(now.getMonth());
  const [viewYear, setViewYear] = useState(now.getFullYear());

  const firstDay = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

  const hearingDaySet = useMemo(() => {
    const s = new Set();
    hearingDates.forEach((d) => s.add(d));
    return s;
  }, [hearingDates]);

  const todayStr = todayISO();

  const cells = [];
  for (let i = 0; i < firstDay; i++) {
    cells.push(<div key={`empty-${i}`} className="h-9" />);
  }
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const isToday = dateStr === todayStr;
    const isSelected = dateStr === selectedDate;
    const hasHearing = hearingDaySet.has(dateStr);
    cells.push(
      <button
        key={day}
        type="button"
        onClick={() => onSelectDate(dateStr)}
        aria-label={`${MONTH_NAMES[viewMonth]} ${day}${hasHearing ? ", has hearings" : ""}`}
        className={`relative flex h-9 items-center justify-center rounded-lg text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-secondary ${
          isSelected
            ? "bg-secondary text-white"
            : isToday
            ? "bg-gold/15 text-gold font-bold"
            : hasHearing
            ? "bg-info-soft text-secondary font-semibold hover:bg-info-soft/70"
            : "text-mirage hover:bg-alt"
        }`}
      >
        {day}
        {hasHearing && !isSelected && (
          <span className="absolute bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-secondary" />
        )}
      </button>
    );
  }

  return (
    <div className="w-full">
      <div className="mb-3 flex items-center justify-between">
        <button
          type="button"
          onClick={() => {
            if (viewMonth === 0) { setViewMonth(11); setViewYear((y) => y - 1); }
            else setViewMonth((m) => m - 1);
          }}
          aria-label="Previous month"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-alt hover:text-navy"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="text-sm font-semibold text-navy">
          {MONTH_NAMES[viewMonth]} {viewYear}
        </span>
        <button
          type="button"
          onClick={() => {
            if (viewMonth === 11) { setViewMonth(0); setViewYear((y) => y + 1); }
            else setViewMonth((m) => m + 1);
          }}
          aria-label="Next month"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-alt hover:text-navy"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1">
        {DAYSOfWeek.map((d) => (
          <div key={d} className="flex h-8 items-center justify-center text-[11px] font-semibold uppercase tracking-wider text-muted">
            {d}
          </div>
        ))}
        {cells}
      </div>
    </div>
  );
}

/* â”€â”€ Summary Card â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

function SummaryCard({ icon: Icon, label, value, href, iconBg, accent }) {
  return (
    <div className={`rounded-2xl border bg-white p-5 shadow-sm transition-shadow hover:shadow-md ${accent || "border-line"}`}>
      <div className="flex items-start justify-between">
        <span className={`flex h-11 w-11 items-center justify-center rounded-xl ${iconBg}`}>
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
        {href && (
          <Link
            href={href}
            className="inline-flex items-center gap-1 text-[12px] font-semibold text-secondary hover:underline"
          >
            View details
            <ArrowRight className="h-3 w-3" aria-hidden="true" />
          </Link>
        )}
      </div>
      <p className="mt-3 font-heading text-[30px] font-bold leading-none tracking-tight text-navy">
        {value}
      </p>
      <p className="mt-1.5 text-[13px] font-medium text-muted">{label}</p>
    </div>
  );
}

/* â”€â”€ Main Dashboard â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

export default function CaptainDashboardPage({ captainTrend = false }) {
  const { user } = useAuth();
  const { role } = useOfficialPortal();
  const routes = useOfficialRoutes();
  const welcomeHeading = `Welcome, ${OFFICIAL_ROLE_SHORT_LABELS[role] || "Official"}`;
  const [complaints, setComplaints] = useState([]);
  const [hearings, setHearings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [dateFilter, setDateFilter] = useState("all");

  /* â”€â”€ Data fetching â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

  const fetchComplaints = useCallback(async () => {
    const supabase = createClient();
    const { data, error: fetchErr } = await supabase
      .from("complaints")
      .select(
        "*, profiles!complaints_resident_id_fkey(display_name, resident_profiles(first_name, last_name))"
      )
      .order("submitted_at", { ascending: false });

    if (fetchErr) { setError(fetchErr.message); return []; }
    setComplaints(data || []);
    return data || [];
  }, []);

  const fetchHearings = useCallback(async () => {
    const supabase = createClient();
    const { data, error: fetchErr } = await supabase
      .from("hearings")
      .select("*, complaints(reference_number, id, title)")
      .order("hearing_date", { ascending: true });

    if (fetchErr) { setError(fetchErr.message); return []; }
    setHearings(data || []);
    return data || [];
  }, []);

  /* â”€â”€ Initial load â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      await Promise.all([fetchComplaints(), fetchHearings()]);
      if (!cancelled) setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [fetchComplaints, fetchHearings]);

  /* â”€â”€ Realtime subscriptions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

  useEffect(() => {
    const supabase = createClient();
    const complaintsChannel = supabase
      .channel("captain-dash-complaints")
      .on("postgres_changes", { event: "*", schema: "public", table: "complaints" }, () => fetchComplaints())
      .subscribe();
    const hearingsChannel = supabase
      .channel("captain-dash-hearings")
      .on("postgres_changes", { event: "*", schema: "public", table: "hearings" }, () => fetchHearings())
      .subscribe();
    return () => {
      supabase.removeChannel(complaintsChannel);
      supabase.removeChannel(hearingsChannel);
    };
  }, [fetchComplaints, fetchHearings]);

  /* â”€â”€ Derived data â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

  const today = todayISO();

  const filteredComplaints = useMemo(() => {
    if (dateFilter === "all") return complaints;
    const now = new Date();
    const cutoff = new Date(now);
    if (dateFilter === "1d") cutoff.setDate(now.getDate() - 1);
    else if (dateFilter === "7d") cutoff.setDate(now.getDate() - 7);
    else if (dateFilter === "1m") cutoff.setMonth(now.getMonth() - 1);
    else if (dateFilter === "1y") cutoff.setFullYear(now.getFullYear() - 1);
    const cutoffStr = cutoff.toISOString();
    return complaints.filter((c) => (c.submitted_at || c.created_at) >= cutoffStr);
  }, [complaints, dateFilter]);

  const stats = useMemo(() => ({
    pendingApproval: filteredComplaints.filter((c) => {
      const s = (c.current_status || "").toLowerCase();
      return s === "pending review" || s === "received";
    }).length,
    inMediation: filteredComplaints.filter((c) => {
      const s = (c.current_status || "").toLowerCase();
      return s === "in progress" || s === "awaiting meeting";
    }).length,
    critical: filteredComplaints.filter((c) => {
      const pred = (c.predicted_urgency || "").toLowerCase();
      const conf = (c.confirmed_urgency || "").toLowerCase();
      return pred === "critical" || conf === "critical";
    }).length,
  }), [filteredComplaints]);

  const recentComplaints = useMemo(() => filteredComplaints.slice(0, 8), [filteredComplaints]);

  /* â”€â”€ Chart data: group by month â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

  const chartData = useMemo(() => {
    if (filteredComplaints.length === 0) return [];
    const groups = {};
    filteredComplaints.forEach((c) => {
      const key = getMonthKey(c.submitted_at || c.created_at);
      if (!key) return;
      if (!groups[key]) groups[key] = { Critical: 0, High: 0, Normal: 0 };
      const urg = (c.confirmed_urgency || c.predicted_urgency || "Normal");
      if (urg === "Critical") groups[key].Critical++;
      else if (urg === "High") groups[key].High++;
      else groups[key].Normal++;
    });
    return Object.entries(groups)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-6)
      .map(([key, counts]) => {
        const [y, m] = key.split("-");
        return { label: `${MONTH_NAMES[parseInt(m, 10) - 1]?.slice(0, 3)} '${y.slice(2)}`, ...counts };
      });
  }, [filteredComplaints]);

  /* â”€â”€ Hearing dates for calendar â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

  const hearingDates = useMemo(() => hearings.map((h) => h.hearing_date).filter(Boolean), [hearings]);
  const [selectedCalDate, setSelectedCalDate] = useState(today);

  const selectedDayHearings = useMemo(
    () => hearings.filter((h) => h.hearing_date === selectedCalDate && (h.status || "").toLowerCase() === "upcoming"),
    [hearings, selectedCalDate]
  );

  /* â”€â”€ Scheduled today count â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

  const scheduledToday = useMemo(
    () => hearings.filter((h) => h.hearing_date === today && (h.status || "").toLowerCase() === "upcoming"),
    [hearings, today]
  );

  /* â”€â”€ Upcoming this week â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

  const upcomingThisWeek = useMemo(() => {
    const { start, end } = getWeekRange(today);
    return hearings.filter((h) => {
      const d = h.hearing_date;
      return d >= start && d <= end && (h.status || "").toLowerCase() === "upcoming";
    });
  }, [hearings, today]);

  /* â”€â”€ Time filter buttons â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

  const FILTERS = [
    { key: "1d", label: "1d" },
    { key: "7d", label: "7d" },
    { key: "1m", label: "1m" },
    { key: "1y", label: "1y" },
    { key: "all", label: "All" },
  ];

  /* â”€â”€ Loading state â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <div className="h-8 w-48 animate-pulse rounded-lg bg-alt" />
            <div className="mt-2 h-4 w-72 animate-pulse rounded bg-alt" />
          </div>
          <div className="h-9 w-24 animate-pulse rounded-lg bg-alt" />
        </div>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-2xl border border-line bg-white p-5 shadow-sm">
              <div className="h-11 w-11 animate-pulse rounded-xl bg-alt" />
              <div className="mt-3 h-9 w-16 animate-pulse rounded bg-alt" />
              <div className="mt-1.5 h-4 w-24 animate-pulse rounded bg-alt" />
            </div>
          ))}
        </div>
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          <div className="h-[340px] animate-pulse rounded-2xl bg-alt lg:col-span-2" />
          <div className="space-y-5">
            <div className="h-[280px] animate-pulse rounded-2xl bg-alt" />
            <div className="h-24 animate-pulse rounded-2xl bg-alt" />
          </div>
        </div>
      </div>
    );
  }

  /* â”€â”€ Error state â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

  if (error) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="font-heading text-[28px] font-bold tracking-tight text-navy">
            {welcomeHeading}
          </h1>
        </div>
        <div className="rounded-2xl border border-critical/20 bg-critical-soft p-8 text-center">
          <AlertCircle className="mx-auto h-10 w-10 text-critical" />
          <p className="mt-3 text-sm font-semibold text-critical">Failed to load dashboard</p>
          <p className="mt-1 text-[13px] text-muted">{error}</p>
          <button
            type="button"
            onClick={() => { setError(null); setLoading(true); Promise.all([fetchComplaints(), fetchHearings()]).finally(() => setLoading(false)); }}
            className="mt-4 rounded-xl bg-secondary px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-navy"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  /* â”€â”€ Render â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

  return (
    <div className="space-y-6">
      {/* Page heading */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-heading text-[28px] font-bold tracking-tight text-navy">
            {welcomeHeading}
          </h1>
          <p className="mt-0.5 text-sm text-muted">
            Overview of current complaints, hearings, and case activity.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] text-muted">{formatDate(today)}</span>
          <div className="flex rounded-lg border border-line bg-white p-0.5">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setDateFilter(f.key)}
                className={`rounded-md px-3 py-1.5 text-[12px] font-semibold transition-colors ${
                  dateFilter === f.key
                    ? "bg-secondary text-white"
                    : "text-muted hover:text-navy"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <Link
            href={routes.hearings}
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl bg-secondary px-4 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-navy focus-visible:outline-2 focus-visible:outline-secondary"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            New Summons
          </Link>
        </div>
      </div>

      {role === "oic" ? (
        <div className="flex items-start gap-3 rounded-2xl border border-gold-soft bg-paledgold px-4 py-3.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/70">
            <ShieldAlert className="h-4 w-4 text-warning" aria-hidden="true" />
          </span>
          <div>
            <p className="text-sm font-semibold text-navy">Delegated Authority Active</p>
            <p className="mt-0.5 text-[13px] leading-relaxed text-mirage">
              You are currently serving as Officer-in-Charge. User and role management remains
              exclusive to the Barangay Captain.
            </p>
          </div>
        </div>
      ) : null}
      {role === "secretary" ? (
        <div className="flex items-start gap-3 rounded-2xl border border-info/20 bg-info-soft px-4 py-3.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/70">
            <ShieldAlert className="h-4 w-4 text-secondary" aria-hidden="true" />
          </span>
          <div>
            <p className="text-sm font-semibold text-navy">Secretary Access</p>
            <p className="mt-0.5 text-[13px] leading-relaxed text-mirage">
              You can access official case-processing pages except Case Categorization, Lupon
              Panels, and Users and Roles.
            </p>
          </div>
        </div>
      ) : null}

      {/* Summary cards */}
      <section aria-label="Dashboard statistics" className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        <SummaryCard
          icon={Clock}
          label="Pending Approval"
          value={stats.pendingApproval}
          href={`${routes.complaints}?status=pending-review`}
          iconBg="bg-warning-soft text-warning"
          accent="border-l-4 border-l-warning"
        />
        <SummaryCard
          icon={Users}
          label="In Mediation"
          value={stats.inMediation}
          href={`${routes.complaints}?status=in-progress`}
          iconBg="bg-info-soft text-secondary"
          accent="border-l-4 border-l-secondary"
        />
        <SummaryCard
          icon={AlertTriangle}
          label="Critical Cases"
          value={stats.critical}
          href={`${routes.complaints}?urgency=Critical`}
          iconBg="bg-critical-soft text-critical"
          accent="border-l-4 border-l-critical"
        />
      </section>

      {/* Main content grid */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(280px,0.75fr)]">
        {/* Left column: chart + recent cases */}
        <div className="space-y-5">
          {/* Case Volume chart */}
          <section
            aria-labelledby="case-volume-chart"
            className="rounded-2xl border border-line bg-white p-6 shadow-sm"
          >
            <h2
              id="case-volume-chart"
              className="flex items-center gap-2 font-heading text-base font-semibold tracking-tight text-navy"
            >
              <TrendingUp className="h-5 w-5 text-gold" aria-hidden="true" />
              Case Volume &amp; Urgency Trend
            </h2>
            <div className="mt-4">
              {captainTrend ? <CaptainCaseVolumeTrend filter={dateFilter} userId={user?.id} /> : <CaseVolumeChart data={chartData} />}
            </div>
          </section>

          {/* Recent Case Updates */}
          <section
            aria-labelledby="recent-cases"
            className="rounded-2xl border border-line bg-white p-6 shadow-sm"
          >
            <header className="flex flex-wrap items-center justify-between gap-3">
              <h2
                id="recent-cases"
                className="flex items-center gap-2 font-heading text-base font-semibold tracking-tight text-navy"
              >
                <FileText className="h-5 w-5 text-gold" aria-hidden="true" />
                Recent Case Updates
              </h2>
              <Link
                href={routes.complaints}
                className="inline-flex shrink-0 items-center gap-1.5 text-[13px] font-semibold text-secondary hover:underline"
              >
                View all
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </header>

            {recentComplaints.length === 0 ? (
              <EmptyState
                title="No recent case activity"
                message="Complaints filed through the system will appear here."
                icon={FileText}
              />
            ) : (
              <>
                {/* Desktop table */}
                <div className="mt-4 hidden overflow-x-auto md:block">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-line text-[12px] font-semibold uppercase tracking-wider text-muted">
                        <th className="pb-3 pr-4">Reference</th>
                        <th className="pb-3 pr-4">Title</th>
                        <th className="pb-3 pr-4">Complainant</th>
                        <th className="pb-3 pr-4">Status</th>
                        <th className="pb-3 pr-4">Filed</th>
                        <th className="pb-3">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {recentComplaints.map((c) => (
                        <tr key={c.id} className="transition-colors hover:bg-alt/40">
                          <td className="py-3 pr-4 font-medium text-secondary">
                            {resolveReference(c)}
                          </td>
                          <td className="max-w-[200px] truncate py-3 pr-4 font-medium text-navy">
                            {c.title}
                          </td>
                          <td className="py-3 pr-4 text-muted">
                            {resolveComplainantName(c)}
                          </td>
                          <td className="py-3 pr-4">
                            <StatusBadge label={c.current_status || "Pending Review"} />
                          </td>
                          <td className="py-3 pr-4 text-muted">
                            {formatDate(c.submitted_at)}
                          </td>
                          <td className="py-3">
                            <Link
                              href={`${routes.complaints}/${c.id}`}
                              className="inline-flex items-center gap-1 rounded-full bg-alt px-3 py-1.5 text-[12px] font-semibold text-secondary transition-colors hover:bg-info-soft hover:text-secondary"
                            >
                              View
                              <ArrowRight className="h-3 w-3" aria-hidden="true" />
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Mobile cards */}
                <div className="mt-4 space-y-3 md:hidden">
                  {recentComplaints.map((c) => (
                    <Link
                      key={c.id}
                      href={`${routes.complaints}/${c.id}`}
                      className="block rounded-xl border border-line p-4 transition-colors hover:bg-alt/40"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-navy">{c.title}</p>
                          <p className="mt-0.5 text-[13px] text-muted">
                            {resolveReference(c)} {'\u00b7'} {resolveComplainantName(c)}
                          </p>
                        </div>
                        <StatusBadge label={c.current_status || "Pending Review"} />
                      </div>
                      <div className="mt-2 flex items-center justify-between text-[12px] text-muted">
                        <span>{formatDate(c.submitted_at)}</span>
                        <span className="font-semibold text-secondary">View {'\u2192'}</span>
                      </div>
                    </Link>
                  ))}
                </div>
              </>
            )}
          </section>
        </div>

        {/* Right column: calendar + summary cards */}
        <div className="space-y-5">
          {/* Hearing Calendar */}
          <section
            aria-labelledby="hearing-calendar"
            className="rounded-2xl border border-line bg-white p-5 shadow-sm"
          >
            <h2
              id="hearing-calendar"
              className="mb-4 flex items-center gap-2 font-heading text-base font-semibold tracking-tight text-navy"
            >
              <CalendarDays className="h-5 w-5 text-gold" aria-hidden="true" />
              Hearing Calendar
            </h2>
            <HearingCalendar
              hearingDates={hearingDates}
              selectedDate={selectedCalDate}
              onSelectDate={setSelectedCalDate}
            />
          </section>

          {/* Scheduled Today */}
          <section className="rounded-2xl border border-line bg-white p-5 shadow-sm">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-heading text-sm font-semibold tracking-tight text-navy">
                Scheduled Today
              </h3>
              <span className="shrink-0 text-[12px] font-medium text-muted">
                {formatDate(selectedCalDate)}
              </span>
            </div>
            {selectedDayHearings.length === 0 ? (
              <p className="text-[13px] text-muted">No hearings scheduled for this date.</p>
            ) : (
              <ul className="space-y-2">
                {selectedDayHearings.map((h) => (
                  <li key={h.id} className="rounded-lg bg-alt/60 px-3 py-2.5">
                    <p className="text-[13px] font-semibold text-navy">
                      {h.hearing_type || "Hearing"}
                    </p>
                    <p className="text-[12px] text-muted">
                      {h.complaints?.title || h.complaints?.reference_number || ""}
                    </p>
                    <div className="mt-1 flex items-center gap-3 text-[12px] text-muted">
                      {h.hearing_time && <span>{formatTime(h.hearing_time)}</span>}
                      {h.venue && <span>{h.venue}</span>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Critical Cases Flagged */}
          <section className="rounded-2xl border-l-4 border-l-critical border border-line bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-critical-soft">
                <AlertTriangle className="h-4 w-4 text-critical" aria-hidden="true" />
              </span>
              <div>
                <p className="font-heading text-[22px] font-bold leading-none text-navy">
                  {stats.critical}
                </p>
                <p className="text-[12px] font-medium text-muted">Critical Cases Flagged</p>
              </div>
            </div>
          </section>

          {/* Upcoming Hearings This Week */}
          <section className="rounded-2xl border-l-4 border-l-[#7c3aed] border border-line bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#f3f0ff]">
                <CalendarDays className="h-4 w-4 text-[#7c3aed]" aria-hidden="true" />
              </span>
              <div>
                <p className="font-heading text-[22px] font-bold leading-none text-navy">
                  {upcomingThisWeek.length}
                </p>
                <p className="text-[12px] font-medium text-muted">Upcoming Hearings This Week</p>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
