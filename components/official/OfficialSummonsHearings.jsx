"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/context/AuthContext";
import StatusBadge from "@/components/shared/StatusBadge";
import EmptyState from "@/components/shared/EmptyState";
import ResidentModal from "@/components/shared/ResidentModal";
import LoadingButton from "@/components/shared/LoadingButton";
import ConfirmDialog from "@/components/shared/ConfirmDialog";
import toast from "react-hot-toast";
import {
  CalendarDays,
  Plus,
  Search,
  Filter,
  ArrowUpDown,
  Clock,
  MapPin,
  FileText,
  MoreVertical,
  CheckCircle2,
  XCircle,
  RefreshCw,
  ChevronDown,
  Building2,
  Loader2,
} from "lucide-react";
import { SITE } from "@/lib/constants";

const STATUS_FILTERS = ["All", "Upcoming", "Completed", "Rescheduled", "Cancelled"];
const HEARING_TYPES = ["Initial Mediation", "Second Mediation", "Conciliation", "Settlement"];
const DEFAULT_VENUE = SITE.hall;

function formatDate(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatTime(timeStr) {
  if (!timeStr) return "";
  const [h, m] = timeStr.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 || 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${period}`;
}

function resolveReference(c) {
  if (!c) return "—";
  return c.reference_number || c.case_number || c.id;
}

export default function CaptainHearingsPage() {
  const { user } = useAuth();

  const [hearings, setHearings] = useState([]);
  const [complaints, setComplaints] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [statusFilter, setStatusFilter] = useState("All");
  const [searchInput, setSearchInput] = useState("");
  // The box stays responsive on every keystroke; only the list re-filters
  // once the typist pauses.
  const [sortAsc, setSortAsc] = useState(true);
  const [actionMenuId, setActionMenuId] = useState(null);

  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [showRescheduleModal, setShowRescheduleModal] = useState(false);
  const [showCompleteConfirm, setShowCompleteConfirm] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [selectedHearing, setSelectedHearing] = useState(null);

  const [scheduleForm, setScheduleForm] = useState({
    complaint_id: "",
    hearing_type: HEARING_TYPES[0],
    hearing_date: "",
    hearing_time: "",
    venue: DEFAULT_VENUE,
    instructions: "",
  });
  const [rescheduleForm, setRescheduleForm] = useState({
    hearing_date: "",
    hearing_time: "",
    venue: DEFAULT_VENUE,
  });

  const [submitting, setSubmitting] = useState(false);

  const fetchHearings = useCallback(async () => {
    const supabase = createClient();
    const { data, error: fetchErr } = await supabase
      .from("hearings")
      .select("*, complaints!inner(id, reference_number, title, current_status)")
      .order("hearing_date", { ascending: true });

    if (fetchErr) {
      setError(fetchErr.message);
      return [];
    }
    setHearings(data || []);
    return data || [];
  }, []);

  const fetchComplaints = useCallback(async () => {
    const supabase = createClient();
    const { data, error: fetchErr } = await supabase
      .from("complaints")
      .select("id, reference_number, title, current_status")
      .order("created_at", { ascending: false });

    if (fetchErr) return [];
    setComplaints(data || []);
    return data || [];
  }, []);

  const fetchSummonsCounts = useCallback(async (hearingList) => {
    if (hearingList.length === 0) return {};
    const supabase = createClient();
    const hearingIds = hearingList.map((h) => h.id);
    const { data } = await supabase
      .from("summons")
      .select("hearing_id")
      .in("hearing_id", hearingIds);

    const counts = {};
    (data || []).forEach((s) => {
      counts[s.hearing_id] = (counts[s.hearing_id] || 0) + 1;
    });
    return counts;
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      const [hearingData] = await Promise.all([fetchHearings(), fetchComplaints()]);
      if (!cancelled) {
        const counts = await fetchSummonsCounts(hearingData);
        if (!cancelled) {
          setHearings((prev) =>
            prev.map((h) => ({ ...h, summonsCount: counts[h.id] || 0 }))
          );
        }
      }
      if (!cancelled) setLoading(false);
    }

    load();
    return () => { cancelled = true; };
  }, [fetchHearings, fetchComplaints, fetchSummonsCounts]);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("captain-hearings-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "hearings" }, () => {
        fetchHearings();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "summons" }, () => {
        fetchHearings().then((data) => fetchSummonsCounts(data));
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [fetchHearings, fetchSummonsCounts]);

  // Decorated once per data change, not once per keystroke.
  // The previous version re-filtered, re-sorted and re-allocated two Date
  // objects inside the sort comparator on every render, so every character
  // typed into the search box cost an O(n log n) sort plus a full re-render
  // of both the desktop table and the mobile card list.
  const visibleHearings = useMemo(() => {
    const needle = searchInput.trim().toLowerCase();

    const decorated = hearings.map((h) => ({
      hearing: h,
      time: new Date(`${h.hearing_date || ""}T00:00:00`).getTime() || 0,
      haystack: needle
        ? `${resolveReference(h.complaints)} ${h.title || ""}`.toLowerCase()
        : "",
    }));

    if (statusFilter !== "All") {
      decorated.forEach((d) => {
        if (d.hearing.status !== statusFilter) d.dropped = true;
      });
    }
    if (needle) {
      decorated.forEach((d) => {
        if (!d.haystack.includes(needle)) d.dropped = true;
      });
    }

    const kept = decorated.filter((d) => !d.dropped);
    kept.sort((a, b) => (sortAsc ? a.time - b.time : b.time - a.time));
    return kept.map((d) => d.hearing);
  }, [hearings, searchInput, statusFilter, sortAsc]);

  const activeComplaints = useMemo(() => {
    return complaints.filter((c) => {
      const status = (c.current_status || "").toLowerCase();
      return status !== "resolved" && status !== "closed" && status !== "rejected";
    });
  }, [complaints]);

  function openScheduleModal() {
    setScheduleForm({
      complaint_id: "",
      hearing_type: HEARING_TYPES[0],
      hearing_date: "",
      hearing_time: "",
      venue: DEFAULT_VENUE,
      instructions: "",
    });
    setShowScheduleModal(true);
  }

  function openRescheduleModal(hearing) {
    setSelectedHearing(hearing);
    setRescheduleForm({
      hearing_date: hearing.hearing_date || "",
      hearing_time: hearing.hearing_time || "",
      venue: hearing.venue || DEFAULT_VENUE,
    });
    setShowRescheduleModal(true);
    setActionMenuId(null);
  }

  function openCompleteConfirm(hearing) {
    setSelectedHearing(hearing);
    setShowCompleteConfirm(true);
    setActionMenuId(null);
  }

  function openCancelConfirm(hearing) {
    setSelectedHearing(hearing);
    setShowCancelConfirm(true);
    setActionMenuId(null);
  }

  async function handleScheduleHearing(e) {
    e.preventDefault();
    if (!scheduleForm.complaint_id || !scheduleForm.hearing_date) {
      toast.error("Please fill in all required fields.");
      return;
    }

    setSubmitting(true);
    const toastId = toast.loading("Scheduling hearing…");

    try {
      const supabase = createClient();
      const { error: insertErr } = await supabase.from("hearings").insert({
        complaint_id: scheduleForm.complaint_id,
        hearing_type: scheduleForm.hearing_type,
        title: scheduleForm.hearing_type,
        hearing_date: scheduleForm.hearing_date,
        hearing_time: scheduleForm.hearing_time || null,
        venue: scheduleForm.venue,
        instructions: scheduleForm.instructions || null,
        status: "Upcoming",
        created_by: user?.id || null,
      });

      if (insertErr) throw insertErr;

      toast.success("Hearing scheduled successfully!", { id: toastId });
      setShowScheduleModal(false);
      fetchHearings();
    } catch (err) {
      toast.error(err.message || "Failed to schedule hearing.", { id: toastId });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleReschedule(e) {
    e.preventDefault();
    if (!selectedHearing || !rescheduleForm.hearing_date) {
      toast.error("Please select a new date.");
      return;
    }

    setSubmitting(true);
    const toastId = toast.loading("Rescheduling hearing…");

    try {
      const supabase = createClient();
      const { error: updateErr } = await supabase
        .from("hearings")
        .update({
          hearing_date: rescheduleForm.hearing_date,
          hearing_time: rescheduleForm.hearing_time || null,
          venue: rescheduleForm.venue,
          status: "Rescheduled",
        })
        .eq("id", selectedHearing.id);

      if (updateErr) throw updateErr;

      toast.success("Hearing rescheduled!", { id: toastId });
      setShowRescheduleModal(false);
      setSelectedHearing(null);
      fetchHearings();
    } catch (err) {
      toast.error(err.message || "Failed to reschedule.", { id: toastId });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleMarkComplete() {
    if (!selectedHearing) return;

    setSubmitting(true);
    const toastId = toast.loading("Marking as completed…");

    try {
      const supabase = createClient();
      const { error: updateErr } = await supabase
        .from("hearings")
        .update({ status: "Completed" })
        .eq("id", selectedHearing.id);

      if (updateErr) throw updateErr;

      toast.success("Hearing marked as completed!", { id: toastId });
      setShowCompleteConfirm(false);
      setSelectedHearing(null);
      fetchHearings();
    } catch (err) {
      toast.error(err.message || "Failed to update status.", { id: toastId });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCancelHearing() {
    if (!selectedHearing) return;

    setSubmitting(true);
    const toastId = toast.loading("Cancelling hearing…");

    try {
      const supabase = createClient();
      const { error: updateErr } = await supabase
        .from("hearings")
        .update({ status: "Cancelled" })
        .eq("id", selectedHearing.id);

      if (updateErr) throw updateErr;

      toast.success("Hearing cancelled.", { id: toastId });
      setShowCancelConfirm(false);
      setSelectedHearing(null);
      fetchHearings();
    } catch (err) {
      toast.error(err.message || "Failed to cancel hearing.", { id: toastId });
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-[1280px] space-y-6">
        <div className="flex items-center gap-3">
          <CalendarDays className="h-6 w-6 text-secondary" />
          <h1 className="font-heading text-2xl font-semibold tracking-tight text-navy">
            Summons &amp; Hearings
          </h1>
        </div>
        <div className="rounded-2xl border border-line bg-white p-6 shadow-[0_1px_2px_rgba(11,33,68,0.06)]">
          <div className="space-y-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4">
                <div className="h-4 w-24 animate-pulse rounded bg-alt" />
                <div className="h-4 w-32 animate-pulse rounded bg-alt" />
                <div className="h-4 w-20 animate-pulse rounded bg-alt" />
                <div className="h-4 w-16 animate-pulse rounded bg-alt" />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1280px] space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <CalendarDays className="h-6 w-6 text-secondary" />
          <div>
            <h1 className="font-heading text-2xl font-semibold tracking-tight text-navy">
              Summons &amp; Hearings
            </h1>
            <p className="text-[13px] text-muted">
              Schedule and manage case hearings
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={openScheduleModal}
          className="inline-flex items-center gap-2 rounded-full bg-jordy px-5 py-2.5 text-sm font-semibold text-white shadow-button transition-colors hover:bg-secondary"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          Schedule Hearing
        </button>
      </div>

      {/* Filters & Search */}
      <div className="flex flex-col gap-4 rounded-2xl border border-line bg-white p-4 shadow-[0_1px_2px_rgba(11,33,68,0.06)] sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-muted" aria-hidden="true" />
          <div className="flex flex-wrap gap-1.5">
            {STATUS_FILTERS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatusFilter(s)}
                className={`rounded-full px-3 py-1.5 text-[12px] font-semibold transition-colors ${
                  statusFilter === s
                    ? "bg-secondary text-white"
                    : "bg-alt text-muted hover:bg-info-soft hover:text-secondary"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative flex-1 sm:w-64">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" />
            <input
              type="text"
              placeholder="Search by reference or title…"
value={searchInput}
      onChange={(e) => setSearchInput(e.target.value)}
              className="w-full rounded-full border border-line bg-canvas py-2 pl-9 pr-4 text-[13px] text-navy placeholder:text-muted focus:border-secondary focus:outline-none focus:ring-1 focus:ring-secondary"
            />
          </div>
          <button
            type="button"
            onClick={() => setSortAsc((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-full border border-line bg-canvas px-3 py-2 text-[12px] font-semibold text-muted transition-colors hover:bg-alt hover:text-navy"
            title={sortAsc ? "Earliest first" : "Latest first"}
          >
            <ArrowUpDown className="h-3.5 w-3.5" aria-hidden="true" />
            {sortAsc ? "Oldest" : "Newest"}
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div
          role="alert"
          className="rounded-xl border border-critical/30 bg-critical-soft px-4 py-3 text-sm font-semibold text-critical"
        >
          {error}
        </div>
      )}

      {/* Desktop Table */}
      {visibleHearings.length === 0 ? (
        <div className="rounded-2xl border border-line bg-white shadow-[0_1px_2px_rgba(11,33,68,0.06)]">
          <EmptyState
            title={statusFilter !== "All" ? `No ${statusFilter.toLowerCase()} hearings` : "No hearings scheduled"}
            message="Schedule a hearing to get started. Hearings will appear here."
            icon={CalendarDays}
          >
            <button
              type="button"
              onClick={openScheduleModal}
              className="inline-flex items-center gap-2 rounded-full bg-jordy px-5 py-2.5 text-sm font-semibold text-white shadow-button transition-colors hover:bg-secondary"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Schedule Hearing
            </button>
          </EmptyState>
        </div>
      ) : (
        <>
          {/* Desktop */}
          <div className="hidden rounded-2xl border border-line bg-white shadow-[0_1px_2px_rgba(11,33,68,0.06)] lg:block">
            <div className="overflow-x-auto overflow-y-visible">
              <table className="w-full min-w-[900px] text-left text-[13px]">
                <thead>
                  <tr className="border-b border-line text-[11px] font-semibold uppercase tracking-wider text-muted">
                    <th className="pb-3 pl-6 pr-4 pt-4">Complaint Ref</th>
                    <th className="pb-3 pr-4 pt-4">Title</th>
                    <th className="pb-3 pr-4 pt-4">Type</th>
                    <th className="pb-3 pr-4 pt-4">Date</th>
                    <th className="pb-3 pr-4 pt-4">Time</th>
                    <th className="pb-3 pr-4 pt-4">Venue</th>
                    <th className="pb-3 pr-4 pt-4">Summons</th>
                    <th className="pb-3 pr-4 pt-4">Status</th>
                    <th className="pb-3 pr-6 pt-4">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {visibleHearings.map((h) => (
                    <tr
                      key={h.id}
                      className="transition-colors hover:bg-alt/40"
                    >
                      <td className="py-3 pl-6 pr-4 font-medium text-secondary">
                        {resolveReference(h.complaints)}
                      </td>
                      <td className="max-w-[180px] truncate py-3 pr-4 font-medium text-navy">
                        {h.title || h.hearing_type || "—"}
                      </td>
                      <td className="py-3 pr-4 text-muted">
                        {h.hearing_type || "—"}
                      </td>
                      <td className="py-3 pr-4 text-muted">
                        {formatDate(h.hearing_date)}
                      </td>
                      <td className="py-3 pr-4 text-muted">
                        {formatTime(h.hearing_time)}
                      </td>
                      <td className="max-w-[140px] truncate py-3 pr-4 text-muted">
                        {h.venue || "—"}
                      </td>
                      <td className="py-3 pr-4 text-muted">
                        {h.summonsCount || 0}
                      </td>
                      <td className="py-3 pr-4">
                        <StatusBadge label={h.status || "Upcoming"} />
                      </td>
                      <td className="relative py-3 pr-6">
                        <button
                          type="button"
                          onClick={() =>
                            setActionMenuId(actionMenuId === h.id ? null : h.id)
                          }
                          className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted transition-colors hover:bg-alt hover:text-navy"
                          aria-label="Actions"
                        >
                          <MoreVertical className="h-4 w-4" />
                        </button>
                        {actionMenuId === h.id && (
                          <div className="absolute right-4 top-full z-20 mt-1 w-48 overflow-hidden rounded-xl border border-line bg-white shadow-lg">
                            {h.status === "Upcoming" && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => openRescheduleModal(h)}
                                  className="flex w-full items-center gap-2 px-4 py-2.5 text-[13px] font-medium text-navy transition-colors hover:bg-alt"
                                >
                                  <RefreshCw className="h-4 w-4 text-warning" aria-hidden="true" />
                                  Reschedule
                                </button>
                                <button
                                  type="button"
                                  onClick={() => openCompleteConfirm(h)}
                                  className="flex w-full items-center gap-2 px-4 py-2.5 text-[13px] font-medium text-navy transition-colors hover:bg-alt"
                                >
                                  <CheckCircle2 className="h-4 w-4 text-success" aria-hidden="true" />
                                  Mark Complete
                                </button>
                                <button
                                  type="button"
                                  onClick={() => openCancelConfirm(h)}
                                  className="flex w-full items-center gap-2 px-4 py-2.5 text-[13px] font-medium text-critical transition-colors hover:bg-critical-soft"
                                >
                                  <XCircle className="h-4 w-4" aria-hidden="true" />
                                  Cancel
                                </button>
                              </>
                            )}
                            {(h.status === "Completed" || h.status === "Cancelled" || h.status === "Rescheduled") && (
                              <button
                                type="button"
                                onClick={() => openRescheduleModal(h)}
                                className="flex w-full items-center gap-2 px-4 py-2.5 text-[13px] font-medium text-navy transition-colors hover:bg-alt"
                              >
                                <RefreshCw className="h-4 w-4 text-warning" aria-hidden="true" />
                                Reschedule
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Mobile Cards */}
          <div className="space-y-3 lg:hidden">
            {visibleHearings.map((h) => (
              <div
                key={h.id}
                className="rounded-2xl border border-line bg-white p-4 shadow-[0_1px_2px_rgba(11,33,68,0.06)]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-[12px] font-semibold text-secondary">
                      {resolveReference(h.complaints)}
                    </p>
                    <p className="mt-0.5 truncate font-medium text-navy">
                      {h.title || h.hearing_type || "—"}
                    </p>
                  </div>
                  <StatusBadge label={h.status || "Upcoming"} />
                </div>
                <div className="mt-3 grid grid-cols-1 gap-2 text-[12px] sm:grid-cols-2">
                  <div className="flex items-center gap-1.5 text-muted">
                    <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
                    {formatDate(h.hearing_date)}
                  </div>
                  <div className="flex items-center gap-1.5 text-muted">
                    <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                    {formatTime(h.hearing_time) || "—"}
                  </div>
                  <div className="flex items-center gap-1.5 text-muted">
                    <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
                    {h.venue || "—"}
                  </div>
                  <div className="flex items-center gap-1.5 text-muted">
                    <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                    Summons: {h.summonsCount || 0}
                  </div>
                </div>
                {h.status === "Upcoming" && (
                  <div className="mt-3 flex gap-2 border-t border-line pt-3">
                    <button
                      type="button"
                      onClick={() => openRescheduleModal(h)}
                      className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-[12px] font-semibold text-muted transition-colors hover:bg-alt hover:text-navy"
                    >
                      <RefreshCw className="h-3 w-3" aria-hidden="true" />
                      Reschedule
                    </button>
                    <button
                      type="button"
                      onClick={() => openCompleteConfirm(h)}
                      className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-[12px] font-semibold text-success transition-colors hover:bg-success-soft"
                    >
                      <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                      Complete
                    </button>
                    <button
                      type="button"
                      onClick={() => openCancelConfirm(h)}
                      className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-[12px] font-semibold text-critical transition-colors hover:bg-critical-soft"
                    >
                      <XCircle className="h-3 w-3" aria-hidden="true" />
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {/* Schedule Hearing Modal */}
      <ResidentModal
        open={showScheduleModal}
        onClose={() => setShowScheduleModal(false)}
        labelledBy="schedule-hearing-title"
        title="Schedule Hearing"
        maxWidthClass="max-w-lg"
      >
        <form onSubmit={handleScheduleHearing} className="space-y-4">
          <div>
            <label htmlFor="complaint-select" className="mb-1 block text-[12px] font-semibold text-navy">
              Complaint <span className="text-critical">*</span>
            </label>
            <select
              id="complaint-select"
              value={scheduleForm.complaint_id}
              onChange={(e) =>
                setScheduleForm((f) => ({ ...f, complaint_id: e.target.value }))
              }
              className="w-full rounded-xl border border-line bg-canvas px-4 py-2.5 text-[13px] text-navy focus:border-secondary focus:outline-none focus:ring-1 focus:ring-secondary"
              required
            >
              <option value="">Select a complaint…</option>
              {activeComplaints.map((c) => (
                <option key={c.id} value={c.id}>
                  {resolveReference(c)} — {c.title}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="hearing-type" className="mb-1 block text-[12px] font-semibold text-navy">
              Hearing Type <span className="text-critical">*</span>
            </label>
            <select
              id="hearing-type"
              value={scheduleForm.hearing_type}
              onChange={(e) =>
                setScheduleForm((f) => ({ ...f, hearing_type: e.target.value }))
              }
              className="w-full rounded-xl border border-line bg-canvas px-4 py-2.5 text-[13px] text-navy focus:border-secondary focus:outline-none focus:ring-1 focus:ring-secondary"
            >
              {HEARING_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="hearing-date" className="mb-1 block text-[12px] font-semibold text-navy">
                Date <span className="text-critical">*</span>
              </label>
              <input
                id="hearing-date"
                type="date"
                value={scheduleForm.hearing_date}
                onChange={(e) =>
                  setScheduleForm((f) => ({ ...f, hearing_date: e.target.value }))
                }
                className="w-full rounded-xl border border-line bg-canvas px-4 py-2.5 text-[13px] text-navy focus:border-secondary focus:outline-none focus:ring-1 focus:ring-secondary"
                required
              />
            </div>
            <div>
              <label htmlFor="hearing-time" className="mb-1 block text-[12px] font-semibold text-navy">
                Time
              </label>
              <input
                id="hearing-time"
                type="time"
                value={scheduleForm.hearing_time}
                onChange={(e) =>
                  setScheduleForm((f) => ({ ...f, hearing_time: e.target.value }))
                }
                className="w-full rounded-xl border border-line bg-canvas px-4 py-2.5 text-[13px] text-navy focus:border-secondary focus:outline-none focus:ring-1 focus:ring-secondary"
              />
            </div>
          </div>

          <div>
            <label htmlFor="hearing-venue" className="mb-1 block text-[12px] font-semibold text-navy">
              Venue
            </label>
            <div className="relative">
              <Building2 className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" />
              <input
                id="hearing-venue"
                type="text"
                value={scheduleForm.venue}
                onChange={(e) =>
                  setScheduleForm((f) => ({ ...f, venue: e.target.value }))
                }
                className="w-full rounded-xl border border-line bg-canvas py-2.5 pl-9 pr-4 text-[13px] text-navy focus:border-secondary focus:outline-none focus:ring-1 focus:ring-secondary"
              />
            </div>
          </div>

          <div>
            <label htmlFor="hearing-instructions" className="mb-1 block text-[12px] font-semibold text-navy">
              Instructions / Notes
            </label>
            <textarea
              id="hearing-instructions"
              rows={3}
              value={scheduleForm.instructions}
              onChange={(e) =>
                setScheduleForm((f) => ({ ...f, instructions: e.target.value }))
              }
              placeholder="Optional notes for this hearing…"
              className="w-full resize-none rounded-xl border border-line bg-canvas px-4 py-2.5 text-[13px] text-navy placeholder:text-muted focus:border-secondary focus:outline-none focus:ring-1 focus:ring-secondary"
            />
          </div>

          <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={() => setShowScheduleModal(false)}
              disabled={submitting}
              className="inline-flex h-11 items-center justify-center rounded-full border border-line px-5 text-sm font-semibold text-mirage transition-colors hover:bg-alt disabled:opacity-60"
            >
              Cancel
            </button>
            <LoadingButton isLoading={submitting} disabled={submitting}>
              Schedule Hearing
            </LoadingButton>
          </div>
        </form>
      </ResidentModal>

      {/* Reschedule Modal */}
      <ResidentModal
        open={showRescheduleModal}
        onClose={() => setShowRescheduleModal(false)}
        labelledBy="reschedule-hearing-title"
        title="Reschedule Hearing"
        maxWidthClass="max-w-md"
      >
        <form onSubmit={handleReschedule} className="space-y-4">
          <div>
            <label htmlFor="reschedule-date" className="mb-1 block text-[12px] font-semibold text-navy">
              New Date <span className="text-critical">*</span>
            </label>
            <input
              id="reschedule-date"
              type="date"
              value={rescheduleForm.hearing_date}
              onChange={(e) =>
                setRescheduleForm((f) => ({ ...f, hearing_date: e.target.value }))
              }
              className="w-full rounded-xl border border-line bg-canvas px-4 py-2.5 text-[13px] text-navy focus:border-secondary focus:outline-none focus:ring-1 focus:ring-secondary"
              required
            />
          </div>
          <div>
            <label htmlFor="reschedule-time" className="mb-1 block text-[12px] font-semibold text-navy">
              New Time
            </label>
            <input
              id="reschedule-time"
              type="time"
              value={rescheduleForm.hearing_time}
              onChange={(e) =>
                setRescheduleForm((f) => ({ ...f, hearing_time: e.target.value }))
              }
              className="w-full rounded-xl border border-line bg-canvas px-4 py-2.5 text-[13px] text-navy focus:border-secondary focus:outline-none focus:ring-1 focus:ring-secondary"
            />
          </div>
          <div>
            <label htmlFor="reschedule-venue" className="mb-1 block text-[12px] font-semibold text-navy">
              Venue
            </label>
            <input
              id="reschedule-venue"
              type="text"
              value={rescheduleForm.venue}
              onChange={(e) =>
                setRescheduleForm((f) => ({ ...f, venue: e.target.value }))
              }
              className="w-full rounded-xl border border-line bg-canvas px-4 py-2.5 text-[13px] text-navy focus:border-secondary focus:outline-none focus:ring-1 focus:ring-secondary"
            />
          </div>
          <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={() => setShowRescheduleModal(false)}
              disabled={submitting}
              className="inline-flex h-11 items-center justify-center rounded-full border border-line px-5 text-sm font-semibold text-mirage transition-colors hover:bg-alt disabled:opacity-60"
            >
              Cancel
            </button>
            <LoadingButton isLoading={submitting} disabled={submitting}>
              Reschedule
            </LoadingButton>
          </div>
        </form>
      </ResidentModal>

      {/* Mark Complete Confirm */}
      <ConfirmDialog
        open={showCompleteConfirm}
        onClose={() => { setShowCompleteConfirm(false); setSelectedHearing(null); }}
        onConfirm={handleMarkComplete}
        busy={submitting}
        title="Mark as Completed?"
        message="This hearing will be marked as completed. This action cannot be undone."
        confirmLabel="Mark Complete"
      />

      {/* Cancel Confirm */}
      <ConfirmDialog
        open={showCancelConfirm}
        onClose={() => { setShowCancelConfirm(false); setSelectedHearing(null); }}
        onConfirm={handleCancelHearing}
        busy={submitting}
        title="Cancel Hearing?"
        message="This hearing will be cancelled. This action cannot be undone."
        confirmLabel="Cancel Hearing"
      />
    </div>
  );
}