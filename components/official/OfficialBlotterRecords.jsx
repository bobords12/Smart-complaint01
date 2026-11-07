"use client";

import Link from "next/link";
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
  FileText,
  Plus,
  Search,
  Filter,
  Eye,
  Edit3,
  ClipboardCheck,
  MapPin,
  User,
  Calendar,
  Tag,
  AlertCircle,
  ChevronDown,
  CheckCircle2,
  Archive,
  RefreshCw,
  PenLine,
} from "lucide-react";

const STATUS_FILTERS = ["All", "open", "resolved", "archived", "corrected"];
const CATEGORIES = ["Criminal", "Civil", "Administrative"];
const URGENCY_LEVELS = ["Critical", "High", "Normal"];

function formatDate(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function resolveReference(c) {
  if (!c) return "—";
  return c.reference_number || c.case_number || c.id;
}

export default function CaptainBlotterPage() {
  const { user } = useAuth();

  const [records, setRecords] = useState([]);
  const [complaints, setComplaints] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [statusFilter, setStatusFilter] = useState("All");
  const [searchInput, setSearchInput] = useState("");
  // Responsive on every keystroke; only the table re-filters on a pause.

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [showActionModal, setShowActionModal] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const [createForm, setCreateForm] = useState({
    complaint_id: "",
    incident_summary: "",
    complainant_name: "",
    respondent_name: "",
    incident_date: "",
    incident_location: "",
    category: "Civil",
    urgency: "Normal",
  });
  const [statusForm, setStatusForm] = useState({ new_status: "" });
  const [actionForm, setActionForm] = useState({ action_taken: "" });

  const fetchRecords = useCallback(async () => {
    const supabase = createClient();
    const { data, error: fetchErr } = await supabase
      .from("blotter_records")
      .select("*, complaints!left(id, reference_number, title)")
      .order("recorded_at", { ascending: false });

    if (fetchErr) {
      setError(fetchErr.message);
      return [];
    }
    setRecords(data || []);
    return data || [];
  }, []);

  const fetchComplaints = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("complaints")
      .select("id, reference_number, title, current_status")
      .order("submitted_at", { ascending: false });

    setComplaints(data || []);
    return data || [];
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      await Promise.all([fetchRecords(), fetchComplaints()]);
      if (!cancelled) setLoading(false);
    }

    load();
    return () => { cancelled = true; };
  }, [fetchRecords, fetchComplaints]);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("captain-blotter-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "blotter_records" }, () => {
        fetchRecords();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [fetchRecords]);

  // The searchable text for each record is concatenated and lowercased
  // ONCE per data change. The previous version lowercased five separate
  // fields and called resolveReference() for every record on every render,
  // so each keystroke in the search box redid all of that for the whole
  // table and then reconciled the list twice (desktop table + mobile
  // cards).
  const recordsWithSearchIndex = useMemo(
    () =>
      records.map((r) => ({
        record: r,
        haystack: [
          r.blotter_number,
          r.incident_summary,
          r.complainant_name,
          r.respondent_name,
          resolveReference(r.complaints),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase(),
      })),
    [records]
  );

  const filteredRecords = useMemo(() => {
    const needle = searchInput.trim().toLowerCase();

    return recordsWithSearchIndex
      .filter(({ record, haystack }) => {
        if (statusFilter !== "All" && (record.current_status || "open") !== statusFilter) {
          return false;
        }
        if (needle) return haystack.includes(needle);
        return true;
      })
      .map(({ record }) => record);
  }, [recordsWithSearchIndex, searchInput, statusFilter]);

  function openCreateModal() {
    setCreateForm({
      complaint_id: "",
      incident_summary: "",
      complainant_name: "",
      respondent_name: "",
      incident_date: "",
      incident_location: "",
      category: "Civil",
      urgency: "Normal",
    });
    setShowCreateModal(true);
  }

  function openDetailsModal(record) {
    setSelectedRecord(record);
    setShowDetailsModal(true);
  }

  function openStatusModal(record) {
    setSelectedRecord(record);
    setStatusForm({ new_status: record.current_status || "open" });
    setShowStatusModal(true);
  }

  function openActionModal(record) {
    setSelectedRecord(record);
    setActionForm({ action_taken: record.action_taken || "" });
    setShowActionModal(true);
  }

  async function handleCreate(e) {
    e.preventDefault();
    if (!createForm.incident_summary || !createForm.complainant_name) {
      toast.error("Please fill in all required fields.");
      return;
    }

    setSubmitting(true);
    const toastId = toast.loading("Creating blotter record…");

    try {
      const supabase = createClient();

      let blotterNumber = null;
      try {
        const { data: rpcData } = await supabase.rpc("generate_blotter_number");
        blotterNumber = rpcData;
      } catch {
        blotterNumber = `BLT-${Date.now()}`;
      }

      const { error: insertErr } = await supabase.from("blotter_records").insert({
        blotter_number: blotterNumber,
        complaint_id: createForm.complaint_id || null,
        incident_summary: createForm.incident_summary,
        complainant_name: createForm.complainant_name,
        respondent_name: createForm.respondent_name || null,
        incident_date: createForm.incident_date || null,
        incident_location: createForm.incident_location || null,
        confirmed_category: createForm.category,
        confirmed_urgency: createForm.urgency,
        current_status: "open",
        recorded_by: user?.id || null,
      });
      if (insertErr) throw insertErr;

      toast.success("Blotter record created!", { id: toastId });
      setShowCreateModal(false);
      fetchRecords();
    } catch (err) {
      toast.error(err.message || "Failed to create record.", { id: toastId });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUpdateStatus(e) {
    e.preventDefault();
    if (!selectedRecord) return;

    setSubmitting(true);
    const toastId = toast.loading("Updating status…");

    try {
      const supabase = createClient();
      const { error: updateErr } = await supabase
        .from("blotter_records")
        .update({ current_status: statusForm.new_status, last_updated: new Date().toISOString() })
        .eq("id", selectedRecord.id);

      if (updateErr) throw updateErr;

      toast.success("Status updated!", { id: toastId });
      setShowStatusModal(false);
      setSelectedRecord(null);
      fetchRecords();
    } catch (err) {
      toast.error(err.message || "Failed to update status.", { id: toastId });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAddAction(e) {
    e.preventDefault();
    if (!selectedRecord) return;

    setSubmitting(true);
    const toastId = toast.loading("Saving action taken…");

    try {
      const supabase = createClient();
      const { error: updateErr } = await supabase
        .from("blotter_records")
        .update({ action_taken: actionForm.action_taken, last_updated: new Date().toISOString() })
        .eq("id", selectedRecord.id);

      if (updateErr) throw updateErr;

      toast.success("Action taken saved!", { id: toastId });
      setShowActionModal(false);
      setSelectedRecord(null);
      fetchRecords();
    } catch (err) {
      toast.error(err.message || "Failed to save action.", { id: toastId });
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-[1280px] space-y-6">
        <div className="flex items-center gap-3">
          <FileText className="h-6 w-6 text-secondary" />
          <h1 className="font-heading text-2xl font-semibold tracking-tight text-navy">
            Blotter Records
          </h1>
        </div>
        <div className="rounded-2xl border border-line bg-white p-6 shadow-[0_1px_2px_rgba(11,33,68,0.06)]">
          <div className="space-y-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4">
                <div className="h-4 w-24 animate-pulse rounded bg-alt" />
                <div className="h-4 w-40 animate-pulse rounded bg-alt" />
                <div className="h-4 w-20 animate-pulse rounded bg-alt" />
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
          <FileText className="h-6 w-6 text-secondary" />
          <div>
            <h1 className="font-heading text-2xl font-semibold tracking-tight text-navy">
              Blotter Records
            </h1>
            <p className="text-[13px] text-muted">
              Manage incident blotter records
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={openCreateModal}
          className="inline-flex items-center gap-2 rounded-full bg-jordy px-5 py-2.5 text-sm font-semibold text-white shadow-button transition-colors hover:bg-secondary"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          Create Blotter
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
                className={`rounded-full px-3 py-1.5 text-[12px] font-semibold capitalize transition-colors ${
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
        <div className="relative sm:w-64">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" />
          <input
            type="text"
            placeholder="Search blotter…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="w-full rounded-full border border-line bg-canvas py-2 pl-9 pr-4 text-[13px] text-navy placeholder:text-muted focus:border-secondary focus:outline-none focus:ring-1 focus:ring-secondary"
          />
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

      {/* Records */}
      {filteredRecords.length === 0 ? (
        <div className="rounded-2xl border border-line bg-white shadow-[0_1px_2px_rgba(11,33,68,0.06)]">
          <EmptyState
            title={statusFilter !== "All" ? `No ${statusFilter} records` : "No blotter records"}
            message="Create a blotter record to start documenting incidents."
            icon={FileText}
          >
            <button
              type="button"
              onClick={openCreateModal}
              className="inline-flex items-center gap-2 rounded-full bg-jordy px-5 py-2.5 text-sm font-semibold text-white shadow-button transition-colors hover:bg-secondary"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Create Blotter
            </button>
          </EmptyState>
        </div>
      ) : (
        <>
          {/* Desktop Table */}
          <div className="hidden rounded-2xl border border-line bg-white shadow-[0_1px_2px_rgba(11,33,68,0.06)] lg:block">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1100px] text-left text-[13px]">
                <thead>
                  <tr className="border-b border-line text-[11px] font-semibold uppercase tracking-wider text-muted">
                    <th className="pb-3 pl-6 pr-4 pt-4">Blotter No.</th>
                    <th className="pb-3 pr-4 pt-4">Complaint Ref</th>
                    <th className="pb-3 pr-4 pt-4">Summary</th>
                    <th className="pb-3 pr-4 pt-4">Complainant</th>
                    <th className="pb-3 pr-4 pt-4">Respondent</th>
                    <th className="pb-3 pr-4 pt-4">Date</th>
                    <th className="pb-3 pr-4 pt-4">Category</th>
                    <th className="pb-3 pr-4 pt-4">Urgency</th>
                    <th className="pb-3 pr-4 pt-4">Status</th>
                    <th className="pb-3 pr-6 pt-4">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {filteredRecords.map((r) => (
                    <tr
                      key={r.id}
                      className="transition-colors hover:bg-alt/40"
                    >
                      <td className="py-3 pl-6 pr-4 font-medium text-secondary">
                        {r.blotter_number || "—"}
                      </td>
                      <td className="py-3 pr-4 font-medium text-navy">
                        {r.complaints?.id ? (
                          <Link
                            href={`/captain/complaints/${r.complaints.id}`}
                            className="text-secondary hover:underline"
                          >
                            {resolveReference(r.complaints)}
                          </Link>
                        ) : (
                          resolveReference(r.complaints)
                        )}
                      </td>
                      <td className="max-w-[200px] truncate py-3 pr-4 text-muted">
                        {r.incident_summary || "—"}
                      </td>
                      <td className="py-3 pr-4 text-muted">
                        {r.complainant_name || "—"}
                      </td>
                      <td className="py-3 pr-4 text-muted">
                        {r.respondent_name || "—"}
                      </td>
                      <td className="py-3 pr-4 text-muted">
                        {formatDate(r.incident_date)}
                      </td>
                      <td className="py-3 pr-4">
                        <StatusBadge label={r.confirmed_category || "Civil"} />
                      </td>
                      <td className="py-3 pr-4">
                        <StatusBadge label={r.confirmed_urgency || "Normal"} />
                      </td>
                      <td className="py-3 pr-4">
                        <StatusBadge label={r.current_status || "open"} />
                      </td>
                      <td className="py-3 pr-6">
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => openDetailsModal(r)}
                            className="inline-flex h-7 w-7 items-center justify-center rounded-full text-muted transition-colors hover:bg-alt hover:text-navy"
                            title="View Details"
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => openStatusModal(r)}
                            className="inline-flex h-7 w-7 items-center justify-center rounded-full text-muted transition-colors hover:bg-alt hover:text-navy"
                            title="Update Status"
                          >
                            <Edit3 className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => openActionModal(r)}
                            className="inline-flex h-7 w-7 items-center justify-center rounded-full text-muted transition-colors hover:bg-alt hover:text-navy"
                            title="Add Action Taken"
                          >
                            <PenLine className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Mobile Cards */}
          <div className="space-y-3 lg:hidden">
            {filteredRecords.map((r) => (
              <div
                key={r.id}
                className="rounded-2xl border border-line bg-white p-4 shadow-[0_1px_2px_rgba(11,33,68,0.06)]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-[12px] font-semibold text-secondary">
                      {r.blotter_number || "—"}
                    </p>
                    <p className="mt-0.5 text-[12px] text-muted">
                      {r.complaints?.id ? (
                        <Link
                          href={`/captain/complaints/${r.complaints.id}`}
                          className="text-secondary hover:underline"
                        >
                          {resolveReference(r.complaints)}
                        </Link>
                      ) : (
                        resolveReference(r.complaints)
                      )}
                    </p>
                  </div>
                  <StatusBadge label={r.current_status || "open"} />
                </div>
                <p className="mt-2 line-clamp-2 text-[13px] font-medium text-navy">
                  {r.incident_summary || "—"}
                </p>
                <div className="mt-3 grid grid-cols-1 gap-2 text-[12px] sm:grid-cols-2">
                  <div className="flex items-center gap-1.5 text-muted">
                    <User className="h-3.5 w-3.5" aria-hidden="true" />
                    {r.complainant_name || "—"}
                  </div>
                  <div className="flex items-center gap-1.5 text-muted">
                    <User className="h-3.5 w-3.5" aria-hidden="true" />
                    {r.respondent_name || "—"}
                  </div>
                  <div className="flex items-center gap-1.5 text-muted">
                    <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
                    {formatDate(r.incident_date)}
                  </div>
                  <div className="flex items-center gap-1.5 text-muted">
                    <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
                    {r.incident_location || "—"}
                  </div>
                </div>
                <div className="mt-3 flex gap-2 border-t border-line pt-3">
                  <StatusBadge label={r.confirmed_category || "Civil"} />
                  <StatusBadge label={r.confirmed_urgency || "Normal"} />
                </div>
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={() => openDetailsModal(r)}
                    className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-[12px] font-semibold text-muted transition-colors hover:bg-alt hover:text-navy"
                  >
                    <Eye className="h-3 w-3" aria-hidden="true" />
                    Details
                  </button>
                  <button
                    type="button"
                    onClick={() => openStatusModal(r)}
                    className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-[12px] font-semibold text-muted transition-colors hover:bg-alt hover:text-navy"
                  >
                    <Edit3 className="h-3 w-3" aria-hidden="true" />
                    Status
                  </button>
                  <button
                    type="button"
                    onClick={() => openActionModal(r)}
                    className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-[12px] font-semibold text-muted transition-colors hover:bg-alt hover:text-navy"
                  >
                    <PenLine className="h-3 w-3" aria-hidden="true" />
                    Action
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Create Blotter Modal */}
      <ResidentModal
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        labelledBy="create-blotter-title"
        title="Create Blotter Record"
        maxWidthClass="max-w-lg"
      >
        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <label htmlFor="blotter-complaint" className="mb-1 block text-[12px] font-semibold text-navy">
              Linked Complaint (Optional)
            </label>
            <select
              id="blotter-complaint"
              value={createForm.complaint_id}
              onChange={(e) =>
                setCreateForm((f) => ({ ...f, complaint_id: e.target.value }))
              }
              className="w-full rounded-xl border border-line bg-canvas px-4 py-2.5 text-[13px] text-navy focus:border-secondary focus:outline-none focus:ring-1 focus:ring-secondary"
            >
              <option value="">No linked complaint</option>
              {complaints.map((c) => (
                <option key={c.id} value={c.id}>
                  {resolveReference(c)} — {c.title}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="blotter-summary" className="mb-1 block text-[12px] font-semibold text-navy">
              Incident Summary <span className="text-critical">*</span>
            </label>
            <textarea
              id="blotter-summary"
              rows={3}
              value={createForm.incident_summary}
              onChange={(e) =>
                setCreateForm((f) => ({ ...f, incident_summary: e.target.value }))
              }
              placeholder="Describe the incident…"
              className="w-full resize-none rounded-xl border border-line bg-canvas px-4 py-2.5 text-[13px] text-navy placeholder:text-muted focus:border-secondary focus:outline-none focus:ring-1 focus:ring-secondary"
              required
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="blotter-complainant" className="mb-1 block text-[12px] font-semibold text-navy">
                Complainant Name <span className="text-critical">*</span>
              </label>
              <input
                id="blotter-complainant"
                type="text"
                value={createForm.complainant_name}
                onChange={(e) =>
                  setCreateForm((f) => ({ ...f, complainant_name: e.target.value }))
                }
                className="w-full rounded-xl border border-line bg-canvas px-4 py-2.5 text-[13px] text-navy focus:border-secondary focus:outline-none focus:ring-1 focus:ring-secondary"
                required
              />
            </div>
            <div>
              <label htmlFor="blotter-respondent" className="mb-1 block text-[12px] font-semibold text-navy">
                Respondent Name
              </label>
              <input
                id="blotter-respondent"
                type="text"
                value={createForm.respondent_name}
                onChange={(e) =>
                  setCreateForm((f) => ({ ...f, respondent_name: e.target.value }))
                }
                className="w-full rounded-xl border border-line bg-canvas px-4 py-2.5 text-[13px] text-navy focus:border-secondary focus:outline-none focus:ring-1 focus:ring-secondary"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="blotter-date" className="mb-1 block text-[12px] font-semibold text-navy">
                Incident Date
              </label>
              <input
                id="blotter-date"
                type="date"
                value={createForm.incident_date}
                onChange={(e) =>
                  setCreateForm((f) => ({ ...f, incident_date: e.target.value }))
                }
                className="w-full rounded-xl border border-line bg-canvas px-4 py-2.5 text-[13px] text-navy focus:border-secondary focus:outline-none focus:ring-1 focus:ring-secondary"
              />
            </div>
            <div>
              <label htmlFor="blotter-location" className="mb-1 block text-[12px] font-semibold text-navy">
                Incident Location
              </label>
              <input
                id="blotter-location"
                type="text"
                value={createForm.incident_location}
                onChange={(e) =>
                  setCreateForm((f) => ({ ...f, incident_location: e.target.value }))
                }
                className="w-full rounded-xl border border-line bg-canvas px-4 py-2.5 text-[13px] text-navy focus:border-secondary focus:outline-none focus:ring-1 focus:ring-secondary"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="blotter-category" className="mb-1 block text-[12px] font-semibold text-navy">
                Category
              </label>
              <select
                id="blotter-category"
                value={createForm.category}
                onChange={(e) =>
                  setCreateForm((f) => ({ ...f, category: e.target.value }))
                }
                className="w-full rounded-xl border border-line bg-canvas px-4 py-2.5 text-[13px] text-navy focus:border-secondary focus:outline-none focus:ring-1 focus:ring-secondary"
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="blotter-urgency" className="mb-1 block text-[12px] font-semibold text-navy">
                Urgency
              </label>
              <select
                id="blotter-urgency"
                value={createForm.urgency}
                onChange={(e) =>
                  setCreateForm((f) => ({ ...f, urgency: e.target.value }))
                }
                className="w-full rounded-xl border border-line bg-canvas px-4 py-2.5 text-[13px] text-navy focus:border-secondary focus:outline-none focus:ring-1 focus:ring-secondary"
              >
                {URGENCY_LEVELS.map((u) => (
                  <option key={u} value={u}>{u}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={() => setShowCreateModal(false)}
              disabled={submitting}
              className="inline-flex h-11 items-center justify-center rounded-full border border-line px-5 text-sm font-semibold text-mirage transition-colors hover:bg-alt disabled:opacity-60"
            >
              Cancel
            </button>
            <LoadingButton isLoading={submitting} disabled={submitting}>
              Create Blotter
            </LoadingButton>
          </div>
        </form>
      </ResidentModal>

      {/* View Details Modal */}
      <ResidentModal
        open={showDetailsModal}
        onClose={() => { setShowDetailsModal(false); setSelectedRecord(null); }}
        labelledBy="blotter-details-title"
        title="Blotter Details"
        maxWidthClass="max-w-lg"
      >
        {selectedRecord && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Blotter No.</p>
                <p className="mt-0.5 text-[13px] font-semibold text-secondary">{selectedRecord.blotter_number || "—"}</p>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Status</p>
                <div className="mt-0.5"><StatusBadge label={selectedRecord.current_status || "open"} /></div>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Complaint Ref</p>
                {selectedRecord.complaints?.id ? (
                  <Link
                    href={`/captain/complaints/${selectedRecord.complaints.id}`}
                    className="mt-0.5 inline-block text-[13px] font-medium text-secondary hover:underline"
                  >
                    {resolveReference(selectedRecord.complaints)}
                  </Link>
                ) : (
                  <p className="mt-0.5 text-[13px] font-medium text-navy">{resolveReference(selectedRecord.complaints)}</p>
                )}
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Complaint Title</p>
                <p className="mt-0.5 text-[13px] font-medium text-navy">{selectedRecord.complaints?.title || "—"}</p>
              </div>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Incident Summary</p>
              <p className="mt-0.5 text-[13px] leading-relaxed text-navy">{selectedRecord.incident_summary || "—"}</p>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Complainant</p>
                <p className="mt-0.5 text-[13px] font-medium text-navy">{selectedRecord.complainant_name || "—"}</p>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Respondent</p>
                <p className="mt-0.5 text-[13px] font-medium text-navy">{selectedRecord.respondent_name || "—"}</p>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Incident Date</p>
                <p className="mt-0.5 text-[13px] text-navy">{formatDate(selectedRecord.incident_date) || "—"}</p>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Location</p>
                <p className="mt-0.5 text-[13px] text-navy">{selectedRecord.incident_location || "—"}</p>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Category</p>
                <div className="mt-0.5"><StatusBadge label={selectedRecord.confirmed_category || "Civil"} /></div>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Urgency</p>
                <div className="mt-0.5"><StatusBadge label={selectedRecord.confirmed_urgency || "Normal"} /></div>
              </div>
            </div>
            {selectedRecord.action_taken && (
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Action Taken</p>
                <p className="mt-0.5 text-[13px] leading-relaxed text-navy">{selectedRecord.action_taken}</p>
              </div>
            )}
            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setShowDetailsModal(false)}
                className="inline-flex h-11 items-center justify-center rounded-full border border-line px-5 text-sm font-semibold text-mirage transition-colors hover:bg-alt"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </ResidentModal>

      {/* Update Status Modal */}
      <ResidentModal
        open={showStatusModal}
        onClose={() => { setShowStatusModal(false); setSelectedRecord(null); }}
        labelledBy="update-status-title"
        title="Update Status"
        maxWidthClass="max-w-md"
      >
        <form onSubmit={handleUpdateStatus} className="space-y-4">
          <div>
            <label htmlFor="status-select" className="mb-1 block text-[12px] font-semibold text-navy">
              New Status
            </label>
            <select
              id="status-select"
              value={statusForm.new_status}
              onChange={(e) => setStatusForm({ new_status: e.target.value })}
              className="w-full rounded-xl border border-line bg-canvas px-4 py-2.5 text-[13px] text-navy focus:border-secondary focus:outline-none focus:ring-1 focus:ring-secondary"
            >
              <option value="open">Open</option>
              <option value="resolved">Resolved</option>
              <option value="archived">Archived</option>
              <option value="corrected">Corrected</option>
            </select>
          </div>
          <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={() => setShowStatusModal(false)}
              disabled={submitting}
              className="inline-flex h-11 items-center justify-center rounded-full border border-line px-5 text-sm font-semibold text-mirage transition-colors hover:bg-alt disabled:opacity-60"
            >
              Cancel
            </button>
            <LoadingButton isLoading={submitting} disabled={submitting}>
              Update Status
            </LoadingButton>
          </div>
        </form>
      </ResidentModal>

      {/* Add Action Taken Modal */}
      <ResidentModal
        open={showActionModal}
        onClose={() => { setShowActionModal(false); setSelectedRecord(null); }}
        labelledBy="add-action-title"
        title="Add Action Taken"
        maxWidthClass="max-w-lg"
      >
        <form onSubmit={handleAddAction} className="space-y-4">
          <div>
            <label htmlFor="action-notes" className="mb-1 block text-[12px] font-semibold text-navy">
              Action Taken Notes
            </label>
            <textarea
              id="action-notes"
              rows={4}
              value={actionForm.action_taken}
              onChange={(e) => setActionForm({ action_taken: e.target.value })}
              placeholder="Describe the action taken…"
              className="w-full resize-none rounded-xl border border-line bg-canvas px-4 py-2.5 text-[13px] text-navy placeholder:text-muted focus:border-secondary focus:outline-none focus:ring-1 focus:ring-secondary"
            />
          </div>
          <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={() => setShowActionModal(false)}
              disabled={submitting}
              className="inline-flex h-11 items-center justify-center rounded-full border border-line px-5 text-sm font-semibold text-mirage transition-colors hover:bg-alt disabled:opacity-60"
            >
              Cancel
            </button>
            <LoadingButton isLoading={submitting} disabled={submitting}>
              Save Action
            </LoadingButton>
          </div>
        </form>
      </ResidentModal>
    </div>
  );
}