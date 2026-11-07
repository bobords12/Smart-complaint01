"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { getErrorMessage, logSupabaseError } from "@/lib/supabaseError";
import { useAuth } from "@/context/AuthContext";
import EmptyState from "@/components/shared/EmptyState";
import ConfirmDialog from "@/components/shared/ConfirmDialog";
import ResidentModal from "@/components/shared/ResidentModal";
import LoadingButton from "@/components/shared/LoadingButton";
import {
  BarChart3,
  FileText,
  CalendarDays,
  AlertTriangle,
  CheckCircle2,
  Download,
  Filter,
  Clock,
  History,
  CalendarPlus,
  Trash2,
  Eye,
  Loader2,
  RefreshCw,
} from "lucide-react";
import toast from "react-hot-toast";

const REPORT_TYPES = [
  {
    key: "complaint-status-report",
    label: "Complaint Status Report",
    icon: FileText,
    description: "Overview of all complaints with their current status.",
  },
  {
    key: "monthly-complaint-summary",
    label: "Monthly Complaint Summary",
    icon: BarChart3,
    description: "Monthly totals of new, resolved, and pending complaints.",
  },
  {
    key: "hearing-summary",
    label: "Hearing Summary Report",
    icon: CalendarDays,
    description: "Hearings scheduled, held, and cancelled in the period.",
  },
  {
    key: "case-resolution-report",
    label: "Case Resolution Report",
    icon: CheckCircle2,
    description: "Resolved and closed cases with resolution timelines.",
  },
  {
    key: "blotter-summary-report",
    label: "Blotter Summary Report",
    icon: AlertTriangle,
    description: "Blotter records and their current statuses.",
  },
  {
    key: "category-urgency-report",
    label: "Category & Urgency Report",
    icon: Filter,
    description: "Breakdown of cases by category and urgency level.",
  },
];

const PREVIEW_LIMIT = 250;

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

function todayFormatted() {
  return new Date().toLocaleDateString("en-PH", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function toISODate(d) {
  try {
    return d.toISOString().slice(0, 10);
  } catch {
    return "";
  }
}

function monthLabel(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-PH", { month: "long", year: "numeric" });
}

function resolveCategory(c) {
  return (c.confirmed_category || c.predicted_category || "Uncategorized").trim();
}

function resolveUrgency(c) {
  return (c.confirmed_urgency || c.predicted_urgency || "Normal").trim();
}

function resolveComplainantName(c) {
  const rp = c.profiles?.resident_profiles || c.resident_profiles;
  if (rp) {
    return [rp.first_name, rp.last_name].filter(Boolean).join(" ") || "Unknown";
  }
  return "—";
}

function resolveReference(c) {
  return c.reference_number || c.case_number || c.id;
}

function daysToResolve(c) {
  if (!c.resolved_at || !(c.submitted_at || c.created_at)) return null;
  const diff = (new Date(c.resolved_at) - new Date(c.submitted_at || c.created_at)) / 86400000;
  return Math.max(0, Math.round(diff * 10) / 10);
}

function escapeCSV(val) {
  if (val === null || val === undefined) return "";
  const str = String(val);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function buildReportRows({ reportType, complaints, blotters, hearings, dateFrom, dateTo }) {
  const inStrongRange = (dateStr) => {
    if (!dateStr) return false;
    const d = dateStr.slice(0, 10);
    return d >= dateFrom && d <= dateTo;
  };

  if (reportType === "complaint-status-report") {
    const inComplaints = complaints.filter((c) => inStrongRange(c.submitted_at || c.created_at));
    const byStatus = {};
    inComplaints.forEach((c) => {
      const s = c.current_status || "Pending Review";
      byStatus[s] = (byStatus[s] || 0) + 1;
    });
    return {
      summary: [
        { label: "Total Complaints", value: inComplaints.length },
        ...Object.entries(byStatus)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([status, count]) => ({ label: status, value: count })),
      ],
      headers: ["Reference", "Title", "Complainant", "Category", "Urgency", "Status", "Submitted"],
      rows: inComplaints.map((c) => [
        resolveReference(c),
        c.title || "",
        resolveComplainantName(c),
        resolveCategory(c),
        resolveUrgency(c),
        c.current_status || "Pending Review",
        formatDate(c.submitted_at || c.created_at),
      ]),
      count: inComplaints.length,
    };
  }

  if (reportType === "monthly-complaint-summary") {
    const months = [];
    const cursor = new Date(`${dateFrom}T00:00:00`);
    const end = new Date(`${dateTo}T00:00:00`);
    while (cursor <= end) {
      const mStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
      const mEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
      months.push({ label: monthLabel(mStart), mStart, mEnd });
      cursor.setMonth(cursor.getMonth() + 1);
    }
    const buckets = months.map((m) => ({ ...m, items: [] }));
    complaints.forEach((c) => {
      const dt = new Date(`${(c.submitted_at || c.created_at || "").slice(0, 10)}T00:00:00`);
      if (Number.isNaN(dt.getTime())) return;
      const bucket = buckets.find((b) => dt >= b.mStart && dt < b.mEnd);
      if (bucket && inStrongRange(c.submitted_at || c.created_at)) bucket.items.push(c);
    });
    const rows = buckets.map((b) => {
      const resolved = b.items.filter((c) => {
        const s = (c.current_status || "").toLowerCase();
        return s === "resolved" || s === "closed";
      }).length;
      const pending = b.items.filter((c) => (c.current_status || "").toLowerCase() === "pending review").length;
      return [b.label, b.items.length, resolved, pending, Math.max(b.items.length - resolved - pending, 0)];
    }).filter((r) => r[1] > 0 || r[2] > 0 || r[3] > 0 || r[4] > 0);
    const total = buckets.reduce((a, b) => a + b.items.length, 0);
    return {
      summary: [
        { label: "Months Covered", value: buckets.length },
        { label: "Complaints (range)", value: total },
        { label: "Avg / Month", value: buckets.length > 0 ? (total / buckets.length).toFixed(1) : 0 },
      ],
      headers: ["Month", "New", "Resolved/Closed", "Pending Review", "Other"],
      rows,
      count: total,
    };
  }

  if (reportType === "hearing-summary") {
    const inHearings = hearings.filter((h) => inStrongRange(h.hearing_date));
    const byStatus = { Upcoming: 0, Completed: 0, Cancelled: 0, Rescheduled: 0 };
    inHearings.forEach((h) => {
      const s = (h.status || "Upcoming").trim();
      byStatus[s] = (byStatus[s] || 0) + 1;
    });
    return {
      summary: [
        { label: "Total Hearings", value: inHearings.length },
        { label: "Upcoming", value: byStatus.Upcoming },
        { label: "Completed", value: byStatus.Completed },
      ],
      headers: ["Complaint Ref", "Type", "Title", "Date", "Status", "Venue"],
      rows: inHearings.map((h) => [
        h.complaints?.reference_number || "—",
        h.hearing_type || "—",
        h.title || "",
        formatDate(h.hearing_date),
        h.status || "Upcoming",
        h.venue || "—",
      ]),
      count: inHearings.length,
    };
  }

  if (reportType === "case-resolution-report") {
    const inComplaints = complaints.filter((c) => inStrongRange(c.submitted_at || c.created_at));
    const resolved = inComplaints.filter((c) => {
      const s = (c.current_status || "").toLowerCase();
      return s === "resolved" || s === "closed";
    });
    const avgDays =
      resolved.length > 0
        ? (resolved.reduce((sum, c) => sum + (daysToResolve(c) || 0), 0) / resolved.length).toFixed(1)
        : 0;
    const rate =
      inComplaints.length > 0 ? ((resolved.length / inComplaints.length) * 100).toFixed(1) : "0.0";
    return {
      summary: [
        { label: "Total Cases (range)", value: inComplaints.length },
        { label: "Resolved / Closed", value: resolved.length },
        { label: "Resolution Rate", value: `${rate}%` },
        { label: "Avg. Days to Resolve", value: avgDays },
      ],
      headers: ["Reference", "Title", "Complainant", "Status", "Submitted", "Resolved", "Days"],
      rows: resolved.map((c) => [
        resolveReference(c),
        c.title || "",
        resolveComplainantName(c),
        c.current_status || "—",
        formatDate(c.submitted_at || c.created_at),
        formatDate(c.resolved_at),
        daysToResolve(c) ?? "—",
      ]),
      count: resolved.length,
    };
  }

  if (reportType === "blotter-summary-report") {
    const inBlotters = blotters.filter((b) => inStrongRange(b.recorded_at));
    const byStatus = {};
    inBlotters.forEach((b) => {
      const s = b.current_status || "open";
      byStatus[s] = (byStatus[s] || 0) + 1;
    });
    return {
      summary: [
        { label: "Total Blotter Records", value: inBlotters.length },
        ...Object.entries(byStatus).map(([status, count]) => ({ label: status, value: count })),
      ],
      headers: ["Blotter No.", "Complaint Ref", "Summary", "Status", "Recorded"],
      rows: inBlotters.map((b) => [
        b.blotter_number || b.id,
        b.complaints?.reference_number || "—",
        b.incident_summary || "",
        b.current_status || "—",
        formatDate(b.recorded_at),
      ]),
      count: inBlotters.length,
    };
  }

  // category-urgency-report
  const inComplaints = complaints.filter((c) => inStrongRange(c.submitted_at || c.created_at));
  const byCategory = {};
  const byUrgency = {};
  inComplaints.forEach((c) => {
    byCategory[resolveCategory(c)] = (byCategory[resolveCategory(c)] || 0) + 1;
    byUrgency[resolveUrgency(c)] = (byUrgency[resolveUrgency(c)] || 0) + 1;
  });
  const rows = [
    ...Object.entries(byCategory).map(([v, n]) => ["Category", v, n]),
    ...Object.entries(byUrgency).map(([v, n]) => ["Urgency", v, n]),
  ];
  return {
    summary: [
      { label: "Total Complaints (range)", value: inComplaints.length },
      ...Object.entries(byCategory).map(([v, n]) => ({ label: v, value: n })),
      ...Object.entries(byUrgency).filter(([v]) => !Object.prototype.hasOwnProperty.call(byCategory, v)).map(([v, n]) => ({ label: v, value: n })),
    ].slice(0, 6),
    headers: ["Dimension", "Value", "Count"],
    rows,
    count: inComplaints.length,
  };
}

export default function CaptainReportsPage() {
  const { user } = useAuth();
  const currentUserId = user?.id;
  const currentUserFullName = user?.fullName || "SCBMS User";
  const [activeReport, setActiveReport] = useState("complaint-status-report");
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return toISODate(d);
  });
  const [dateTo, setDateTo] = useState(() => toISODate(new Date()));

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [generating, setGenerating] = useState(false);

  const [complaints, setComplaints] = useState([]);
  const [blotters, setBlotters] = useState([]);
  const [hearings, setHearings] = useState([]);

  // History / schedule tables are added by manual SQL 22. If they are
  // missing, the pages still work and show a "not configured" notice.
  const [histories, setHistories] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [historyError, setHistoryError] = useState(null);
  const [scheduleError, setScheduleError] = useState(null);

  const [deleteTarget, setDeleteTarget] = useState(null); // {kind:'history'|'schedule', id}
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleBusy, setScheduleBusy] = useState(false);
  const [scheduleForm, setScheduleForm] = useState({
    reportType: "complaint-status-report",
    frequency: "monthly",
    runTime: "08:00",
  });

  const fetchMain = useCallback(async () => {
    const supabase = createClient();
    const [complaintsRes, blottersRes, hearingsRes] = await Promise.all([
      supabase
        .from("complaints")
        .select("*, profiles!complaints_resident_id_fkey(display_name, resident_profiles(first_name, last_name))")
        .order("submitted_at", { ascending: false }),
      supabase
        .from("blotter_records")
        .select("*, complaints(reference_number, title)")
        .order("recorded_at", { ascending: false }),
      supabase
        .from("hearings")
        .select("*, complaints(reference_number, title)")
        .order("hearing_date", { ascending: false }),
    ]);
    if (complaintsRes.error) throw complaintsRes.error;
    if (blottersRes.error) throw blottersRes.error;
    if (hearingsRes.error) throw hearingsRes.error;
    setComplaints(complaintsRes.data || []);
    setBlotters(blottersRes.data || []);
    setHearings(hearingsRes.data || []);
  }, []);

  const fetchHistory = useCallback(async () => {
    const supabase = createClient();
    const { data, error: err } = await supabase
      .from("generated_reports")
      .select("id, report_type, report_title, date_from, date_to, filters, row_count, generated_by, generated_at, profiles(display_name)")
      .order("generated_at", { ascending: false });
    if (err) {
      setHistoryError(getErrorMessage(err, "Could not load report history."));
      return;
    }
    setHistoryError(null);
    setHistories(data || []);
  }, []);

  const fetchSchedules = useCallback(async () => {
    const supabase = createClient();
    const { data, error: err } = await supabase
      .from("report_schedules")
      .select("id, report_type, frequency, run_time, enabled, created_at")
      .order("created_at", { ascending: false });
    if (err) {
      setScheduleError(getErrorMessage(err, "Could not load report schedules."));
      return;
    }
    setScheduleError(null);
    setSchedules(data || []);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        await fetchMain();
        if (!cancelled) { setError(null); setLoading(false); }
      } catch (err) {
        logSupabaseError("Reports load", err);
        if (!cancelled) { setError(getErrorMessage(err, "Failed to load report data.")); setLoading(false); }
      }
      fetchHistory();
      fetchSchedules();
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [fetchMain, fetchHistory, fetchSchedules]);

  const reportData = useMemo(
    () =>
      buildReportRows({
        reportType: activeReport,
        complaints,
        blotters,
        hearings,
        dateFrom,
        dateTo,
      }),
    [activeReport, complaints, blotters, hearings, dateFrom, dateTo]
  );

  const generatedThisMonth = useMemo(() => {
    const now = new Date();
    return histories.filter((h) => {
      const d = new Date(h.generated_at);
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    }).length;
  }, [histories]);

  const totalRowsGenerated = useMemo(() => {
    return histories.reduce((a, h) => a + (h.row_count || 0), 0);
  }, [histories]);

  const saveHistory = useCallback(
    async (rowsCount) => {
      const supabase = createClient();
      const { error: err } = await supabase
        .from("generated_reports")
        .upsert(
          {
            report_type: activeReport,
            report_title: REPORT_TYPES.find((r) => r.key === activeReport)?.label || activeReport,
            date_from: dateFrom,
            date_to: dateTo,
            filters: { range: `${dateFrom}..${dateTo}` },
            row_count: rowsCount,
            generated_by: currentUserId,
          },
          { onConflict: "report_type,date_from,date_to,generated_by" }
        );
      if (err) throw err;
      await fetchHistory();
    },
    [activeReport, dateFrom, dateTo, currentUserId, fetchHistory]
  );

  const generatePDF = useCallback(async () => {
    const supabase = createClient();
    const { default: jsPDF } = await import("jspdf");
    const doc = new jsPDF();
    const type = REPORT_TYPES.find((r) => r.key === activeReport);
    const label = type?.label || "Report";

    doc.setFontSize(16);
    doc.setFont(undefined, "bold");
    doc.text("Barangay Abuno — Smart Complaint & Blotter Management System", 14, 18);
    doc.setFontSize(14);
    doc.text(label, 14, 27);
    doc.setFont(undefined, "normal");
    doc.setFontSize(10);
    doc.text(`Generated: ${todayFormatted()} by ${currentUserFullName}`, 14, 35);
    doc.text(`Period: ${formatDate(dateFrom)} to ${formatDate(dateTo)}`, 14, 40);
    doc.setLineWidth(0.5);
    doc.line(14, 44, 196, 44);

    let y = 52;
    doc.setFontSize(11);
    doc.setFont(undefined, "bold");
    reportData.summary.forEach((s) => {
      doc.text(`${s.label}: ${s.value}`, 14, y);
      y += 6;
    });
    doc.setFont(undefined, "normal");
    y += 2;

    const headers = reportData.headers;

    const pageFooter = () => {
      const pages = doc.getNumberOfPages();
      for (let i = 1; i <= pages; i++) {
        doc.setPage(i);
        doc.setFontSize(9);
        doc.text(`Page ${i} of ${pages}`, 196, 290, { align: "right" });
      }
    };

    doc.setFontSize(11);
    doc.setFont(undefined, "bold");
    headers.forEach((h, i) => {
      doc.text(h, 14 + i * 36, y);
    });
    doc.setFont(undefined, "normal");
    y += 5;

    if (reportData.rows.length === 0) {
      doc.text("No records found for this period.", 14, y);
      pageFooter();
      doc.save(`scbms_${activeReport}_${Date.now()}.pdf`);
      return { count: 0, saved: true };
    }

    reportData.rows.forEach((row) => {
      if (y > 270) {
        doc.addPage();
        y = 20;
        doc.setFont(undefined, "bold");
        headers.forEach((h, i) => doc.text(h, 14 + i * 36, y));
        doc.setFont(undefined, "normal");
        y += 5;
      }
      row.forEach((cell, i) => {
        doc.setFontSize(8);
        doc.text(String(cell ?? "").substring(0, 34), 14 + i * 36, y);
      });
      y += 5;
    });

    pageFooter();
    doc.save(`scbms_${activeReport}_${Date.now()}.pdf`);
    return { count: reportData.rows.length, saved: true };
  }, [activeReport, dateFrom, dateTo, reportData, currentUserFullName]);

  const handleGenerate = useCallback(async () => {
    if (!dateFrom || !dateTo || dateFrom > dateTo) {
      toast.error("Select a valid date range.");
      return;
    }
    if (reportData.rows.length === 0 && reportData.count === 0 && activeReport !== "monthly-complaint-summary") {
      toast.error("No data to generate a report for this period.");
      return;
    }
    setGenerating(true);
    const toastId = toast.loading(`Generating ${REPORT_TYPES.find((r) => r.key === activeReport)?.label}…`);
    try {
      const result = await generatePDF();
      let historySaved = false;
      try {
        await saveHistory(result.count);
        historySaved = true;
      } catch (historyErr) {
        console.error("History save error:", historyErr);
      }
      toast.success(
        historySaved
          ? "Report generated and downloaded."
          : "Report generated and downloaded. Report history requires manual SQL script 22."
      );
    } catch (err) {
      console.error("Report generation error:", err);
      toast.error("Report generation failed. Please try again.");
    } finally {
      toast.dismiss(toastId);
      setGenerating(false);
    }
  }, [dateFrom, dateTo, activeReport, reportData, generatePDF, saveHistory]);

  const handleExportCSV = useCallback(() => {
    if (reportData.rows.length === 0) {
      toast.error("No data to export.");
      return;
    }
    const csvContent = [
      reportData.headers.map(escapeCSV).join(","),
      ...reportData.rows.map((row) => row.map(escapeCSV).join(",")),
    ].join("\n");
    downloadBlob(new Blob([`\uFEFF${csvContent}`], { type: "text/csv;charset=utf-8;" }), `scbms_${activeReport}_${Date.now()}.csv`);
    toast.success("CSV exported.");
  }, [activeReport, reportData]);

  const handleAddSchedule = useCallback(async () => {
    const supabase = createClient();
    setScheduleBusy(true);
    const toastId = toast.loading("Saving schedule…");
    try {
      const { error: err } = await supabase.from("report_schedules").insert({
        report_type: scheduleForm.reportType,
        frequency: scheduleForm.frequency,
        run_time: `${scheduleForm.runTime}:00`,
        created_by: currentUserId,
      });
      if (err) throw err;
      toast.success("Report schedule saved.");
      setScheduleOpen(false);
      await fetchSchedules();
    } catch (err) {
      console.error("Schedule error:", err);
      toast.error(
        "Could not save schedule. Run manual SQL script 22 to enable report scheduling."
      );
    } finally {
      toast.dismiss(toastId);
      setScheduleBusy(false);
    }
  }, [scheduleForm, currentUserId, fetchSchedules]);

  const handleConfirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    const supabase = createClient();
    setDeleteBusy(true);
    const toastId = toast.loading("Deleting…");
    try {
      const table = deleteTarget.kind === "history" ? "generated_reports" : "report_schedules";
      const { error: err } = await supabase.from(table).delete().eq("id", deleteTarget.id);
      if (err) throw err;
      toast.success(deleteTarget.kind === "history" ? "History entry removed." : "Schedule removed.");
      setDeleteTarget(null);
      if (deleteTarget.kind === "history") await fetchHistory();
      else await fetchSchedules();
    } catch (err) {
      console.error("Delete error:", err);
      toast.error("Delete failed. Please try again.");
    } finally {
      toast.dismiss(toastId);
      setDeleteBusy(false);
    }
  }, [deleteTarget, fetchHistory, fetchSchedules]);

  const openReportFromHistory = useCallback((h) => {
    setActiveReport(h.report_type);
    setDateFrom(h.date_from);
    setDateTo(h.date_to);
    toast(`Loaded ${h.report_title} — regenerate to download the latest copy.`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  if (loading) {
    return (
      <div className="mx-auto max-w-[1280px] space-y-6">
        <div className="flex items-center gap-3">
          <BarChart3 className="h-6 w-6 text-secondary" aria-hidden="true" />
          <h1 className="font-heading text-2xl font-semibold tracking-tight text-navy">Reports</h1>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-2xl border border-line bg-white p-6">
              <div className="h-10 w-10 animate-pulse rounded-xl bg-alt" />
              <div className="mt-3 h-4 w-32 animate-pulse rounded bg-alt" />
              <div className="mt-2 h-3 w-44 animate-pulse rounded bg-alt" />
            </div>
          ))}
        </div>
        <div className="h-40 animate-pulse rounded-2xl border border-line bg-white" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-[1280px] space-y-6">
        <div className="flex items-center gap-3">
          <BarChart3 className="h-6 w-6 text-secondary" aria-hidden="true" />
          <h1 className="font-heading text-2xl font-semibold tracking-tight text-navy">Reports</h1>
        </div>
        <EmptyState title="Could not load report data" message={error} icon={AlertTriangle}>
          <button
            type="button"
            onClick={fetchMain}
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
      <div className="flex items-center gap-3">
        <BarChart3 className="h-6 w-6 text-secondary" aria-hidden="true" />
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight text-navy">Reports</h1>
          <p className="text-[13px] text-muted">Generate, preview, and export system reports.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {REPORT_TYPES.map((rt) => {
          const Icon = rt.icon;
          const isActive = activeReport === rt.key;
          return (
            <button
              key={rt.key}
              type="button"
              onClick={() => setActiveReport(rt.key)}
              className={`rounded-2xl border p-4 text-left transition-all ${
                isActive
                  ? "border-secondary bg-info-soft shadow-[0_2px_8px_rgba(27,76,140,0.12)]"
                  : "border-line bg-white shadow-[0_1px_2px_rgba(11,33,68,0.06)] hover:border-secondary/40"
              }`}
            >
              <div className="flex items-start gap-3">
                <span
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                    isActive ? "bg-secondary text-white" : "bg-alt text-muted"
                  }`}
                >
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <p className={`text-sm font-semibold ${isActive ? "text-secondary" : "text-navy"}`}>
                    {rt.label}
                  </p>
                  <p className="mt-0.5 text-[12px] text-muted line-clamp-2">{rt.description}</p>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <section className="rounded-2xl border border-line bg-white p-5 shadow-[0_1px_2px_rgba(11,33,68,0.06)] sm:p-6">
        <header className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-info-soft">
            <Filter className="h-5 w-5 text-secondary" aria-hidden="true" />
          </span>
          <div>
            <h2 className="font-heading text-base font-semibold tracking-tight text-navy">Date Range & Actions</h2>
            <p className="text-[12px] text-muted">
              Records are filtered by this period on every report type.
            </p>
          </div>
        </header>

        <div className="mt-5 flex flex-col gap-4 lg:flex-row lg:items-end">
          <div className="flex-1">
            <label htmlFor="report-from" className="mb-1.5 block text-[13px] font-semibold text-mirage">From</label>
            <input
              id="report-from"
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-full rounded-xl border border-line bg-white px-3 py-2.5 text-[13px] text-navy focus:border-secondary focus:outline-none focus:ring-2 focus:ring-secondary/20"
            />
          </div>
          <div className="flex-1">
            <label htmlFor="report-to" className="mb-1.5 block text-[13px] font-semibold text-mirage">To</label>
            <input
              id="report-to"
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-full rounded-xl border border-line bg-white px-3 py-2.5 text-[13px] text-navy focus:border-secondary focus:outline-none focus:ring-2 focus:ring-secondary/20"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleGenerate}
              disabled={generating}
              className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full bg-navy px-6 text-sm font-semibold text-white transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-70"
            >
              {generating ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <FileText className="h-4 w-4" aria-hidden="true" />
              )}
              {generating ? "Generating…" : "Generate PDF"}
            </button>
            <button
              type="button"
              onClick={handleExportCSV}
              className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full border border-line bg-white px-5 text-sm font-semibold text-navy transition-colors hover:bg-alt"
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              CSV
            </button>
            <button
              type="button"
              onClick={() => {
                setScheduleForm((f) => ({ ...f, reportType: activeReport }));
                setScheduleOpen(true);
              }}
              className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full border border-line bg-white px-5 text-sm font-semibold text-navy transition-colors hover:bg-alt"
            >
              <CalendarPlus className="h-4 w-4" aria-hidden="true" />
              Schedule
            </button>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-line bg-white p-5 shadow-[0_1px_2px_rgba(11,33,68,0.06)]">
          <p className="text-[12px] font-semibold uppercase tracking-wider text-muted">Generated This Month</p>
          <p className="mt-1 font-heading text-2xl font-bold text-navy">{generatedThisMonth}</p>
          <p className="mt-1 text-[12px] text-muted">
            {historyError ? "History unavailable — run script 22" : "from report history"}
          </p>
        </div>
        <div className="rounded-2xl border border-line bg-white p-5 shadow-[0_1px_2px_rgba(11,33,68,0.06)]">
          <p className="text-[12px] font-semibold uppercase tracking-wider text-muted">Records Generated</p>
          <p className="mt-1 font-heading text-2xl font-bold text-navy">{totalRowsGenerated.toLocaleString()}</p>
          <p className="mt-1 text-[12px] text-muted">sum of row counts in history</p>
        </div>
        <div className="rounded-2xl border border-line bg-white p-5 shadow-[0_1px_2px_rgba(11,33,68,0.06)]">
          <p className="text-[12px] font-semibold uppercase tracking-wider text-muted">{REPORT_TYPES.find((r) => r.key === activeReport)?.label || "Report"}</p>
          <p className="mt-1 font-heading text-2xl font-bold text-navy">{reportData.count}</p>
          <p className="mt-1 text-[12px] text-muted">records in selected period</p>
        </div>
      </div>

      <section className="rounded-2xl border border-line bg-white p-5 shadow-[0_1px_2px_rgba(11,33,68,0.06)] sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-heading text-base font-semibold tracking-tight text-navy">
            Preview — {REPORT_TYPES.find((r) => r.key === activeReport)?.label || ""}
          </h2>
          <p className="text-[13px] text-secondary">
            {formatDate(dateFrom)} to {formatDate(dateTo)}
          </p>
        </div>

        {reportData.summary.length > 0 && (
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {reportData.summary.map((s) => (
              <div key={s.label} className="rounded-xl border border-line p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">{s.label}</p>
                <p className="mt-0.5 font-heading text-lg font-bold text-navy">{s.value}</p>
              </div>
            ))}
          </div>
        )}

        {reportData.rows.length === 0 ? (
          <EmptyState
            title="No records for this period"
            message="Change the report type or widen the date range, then generate again."
            icon={FileText}
          />
        ) : (
          <>
            <div className="mt-5 overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-[13px]">
                <thead>
                  <tr className="border-b border-line text-[11px] font-semibold uppercase tracking-wider text-muted">
                    {reportData.headers.map((h) => (
                      <th key={h} className="pb-3 pr-4">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {reportData.rows.slice(0, PREVIEW_LIMIT).map((row, i) => (
                    <tr key={i} className="transition-colors hover:bg-alt/40">
                      {reportData.headers.map((h, j) => (
                        <td key={`${h}-${j}`} className="max-w-[220px] truncate py-3 pr-4 text-navy first:font-medium first:text-secondary">
                          {row[j] ?? ""}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {reportData.rows.length > PREVIEW_LIMIT && (
              <p className="mt-3 text-center text-[12px] text-muted">
                Previewing {PREVIEW_LIMIT} of {reportData.rows.length} records. Generate the PDF or export CSV for the full set.
              </p>
            )}
          </>
        )}
      </section>

      <section className="rounded-2xl border border-line bg-white p-5 shadow-[0_1px_2px_rgba(11,33,68,0.06)] sm:p-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-info-soft">
              <History className="h-5 w-5 text-secondary" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2 className="font-heading text-base font-semibold tracking-tight text-navy">Recent Reports</h2>
              <p className="text-[12px] text-muted">Saved from previous generations. Re-generating the same type and period updates the entry.</p>
            </div>
          </div>
          {!historyError && (
            <button
              type="button"
              onClick={fetchHistory}
              className="inline-flex min-h-[40px] shrink-0 items-center justify-center gap-2 rounded-full border border-line px-4 text-[12px] font-semibold text-navy transition-colors hover:bg-alt"
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              Refresh
            </button>
          )}
        </header>

        {historyError ? (
          <div className="mt-4">
            <EmptyState
              title="Report history is not configured"
              message="The generated_reports table is missing. Apply supabase/manual/22_admin_monitoring_pages.sql in the Supabase SQL Editor to enable report history."
              icon={History}
            />
          </div>
        ) : histories.length === 0 ? (
          <div className="mt-4">
            <EmptyState
              title="No report history yet"
              message="Generated reports will appear here so you can find and regenerate them."
              icon={History}
            />
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-[13px]">
              <thead>
                <tr className="border-b border-line text-[11px] font-semibold uppercase tracking-wider text-muted">
                  <th className="pb-3 pr-4">Report</th>
                  <th className="pb-3 pr-4">Period</th>
                  <th className="pb-3 pr-4">Records</th>
                  <th className="pb-3 pr-4">Generated By</th>
                  <th className="pb-3 pr-4">When</th>
                  <th className="pb-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {histories.map((h) => (
                  <tr key={h.id} className="transition-colors hover:bg-alt/40">
                    <td className="py-3 pr-4 font-medium text-navy">{h.report_title}</td>
                    <td className="py-3 pr-4 text-muted">{formatDate(h.date_from)} — {formatDate(h.date_to)}</td>
                    <td className="py-3 pr-4 text-muted">{h.row_count}</td>
                    <td className="py-3 pr-4 text-muted">{h.profiles?.display_name || "—"}</td>
                    <td className="py-3 pr-4 text-muted">{formatDateTime(h.generated_at)}</td>
                    <td className="py-3">
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => openReportFromHistory(h)}
                          className="inline-flex items-center gap-1 rounded-full border border-line px-3 py-1.5 text-[12px] font-semibold text-navy transition-colors hover:bg-alt"
                        >
                          <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                          Load
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteTarget({ kind: "history", id: h.id })}
                          className="inline-flex items-center gap-1 rounded-full border border-line px-3 py-1.5 text-[12px] font-semibold text-critical transition-colors hover:bg-critical-soft"
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-line bg-white p-5 shadow-[0_1px_2px_rgba(11,33,68,0.06)] sm:p-6">
        <header className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-warning-soft">
            <CalendarPlus className="h-5 w-5 text-warning" aria-hidden="true" />
          </span>
          <div>
            <h2 className="font-heading text-base font-semibold tracking-tight text-navy">Scheduled Reports</h2>
            <p className="text-[12px] text-muted">
              Schedules are stored for an external scheduler to execute — nothing runs automatically from this page.
            </p>
          </div>
        </header>

        {scheduleError ? (
          <div className="mt-4">
            <EmptyState
              title="Scheduling is not configured"
              message="The report_schedules table is missing. Apply supabase/manual/22_admin_monitoring_pages.sql in the Supabase SQL Editor to enable scheduling."
              icon={CalendarPlus}
            />
          </div>
        ) : schedules.length === 0 ? (
          <div className="mt-4">
            <EmptyState
              title="No scheduled reports"
              message="Use the Schedule button to define recurring report generation."
              icon={CalendarPlus}
            />
          </div>
        ) : (
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {schedules.map((s) => (
              <div key={s.id} className="rounded-xl border border-line p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold capitalize text-navy">
                      {REPORT_TYPES.find((r) => r.key === s.report_type)?.label || s.report_type}
                    </p>
                    <p className="mt-1 text-[12px] capitalize text-muted">
                      {s.frequency} at {s.run_time?.slice(0, 5)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setDeleteTarget({ kind: "schedule", id: s.id })}
                    aria-label={`Delete schedule for ${REPORT_TYPES.find((r) => r.key === s.report_type)?.label || s.report_type}`}
                    className="flex h-8 w-8 items-center justify-center rounded-full text-muted transition-colors hover:bg-critical-soft hover:text-critical"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <ResidentModal
        open={scheduleOpen}
        onClose={() => setScheduleOpen(false)}
        labelledBy="schedule-report-title"
        title="Schedule Report"
        maxWidthClass="max-w-md"
      >
        <div className="space-y-4">
          <div>
            <label htmlFor="schedule-type" className="mb-1.5 block text-[13px] font-semibold text-mirage">Report type</label>
            <select
              id="schedule-type"
              value={scheduleForm.reportType}
              onChange={(e) => setScheduleForm((f) => ({ ...f, reportType: e.target.value }))}
              className="w-full rounded-xl border border-line bg-white px-3 py-2.5 text-[13px] text-navy focus:border-secondary focus:outline-none focus:ring-2 focus:ring-secondary/20"
            >
              {REPORT_TYPES.map((r) => (
                <option key={r.key} value={r.key}>{r.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="schedule-frequency" className="mb-1.5 block text-[13px] font-semibold text-mirage">Frequency</label>
            <select
              id="schedule-frequency"
              value={scheduleForm.frequency}
              onChange={(e) => setScheduleForm((f) => ({ ...f, frequency: e.target.value }))}
              className="w-full rounded-xl border border-line bg-white px-3 py-2.5 text-[13px] text-navy focus:border-secondary focus:outline-none focus:ring-2 focus:ring-secondary/20"
            >
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </div>
          <div>
            <label htmlFor="schedule-time" className="mb-1.5 block text-[13px] font-semibold text-mirage">Run at</label>
            <input
              id="schedule-time"
              type="time"
              value={scheduleForm.runTime}
              onChange={(e) => setScheduleForm((f) => ({ ...f, runTime: e.target.value }))}
              className="w-full rounded-xl border border-line bg-white px-3 py-2.5 text-[13px] text-navy focus:border-secondary focus:outline-none focus:ring-2 focus:ring-secondary/20"
            />
          </div>
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={() => setScheduleOpen(false)}
              disabled={scheduleBusy}
              className="inline-flex h-11 items-center justify-center rounded-full border border-line px-5 text-sm font-semibold text-mirage transition-colors hover:bg-alt disabled:opacity-60"
            >
              Cancel
            </button>
            <LoadingButton isLoading={scheduleBusy} onClick={handleAddSchedule} disabled={scheduleBusy}>
              Save Schedule
            </LoadingButton>
          </div>
        </div>
      </ResidentModal>

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleConfirmDelete}
        busy={deleteBusy}
        title={deleteTarget?.kind === "history" ? "Remove report history?" : "Delete schedule?"}
        message={
          deleteTarget?.kind === "history"
            ? "This removes the history entry only. Past downloadable files are unaffected."
            : "This removes the scheduled report definition."
        }
        confirmLabel="Delete"
      />
    </div>
  );
}