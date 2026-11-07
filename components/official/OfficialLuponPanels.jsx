"use client";

import { useState, useEffect, useCallback, useMemo } from "react";

const ROLE_ORDER = { chairperson: 0, secretary: 1, member: 2, alternate: 3 };
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/context/AuthContext";
import StatusBadge from "@/components/shared/StatusBadge";
import EmptyState from "@/components/shared/EmptyState";
import ResidentModal from "@/components/shared/ResidentModal";
import LoadingButton from "@/components/shared/LoadingButton";
import ConfirmDialog from "@/components/shared/ConfirmDialog";
import toast from "react-hot-toast";
import {
  Users,
  Plus,
  Search,
  Filter,
  UserPlus,
  ArrowRightLeft,
  XCircle,
  Shield,
  User,
  ChevronDown,
  AlertCircle,
} from "lucide-react";

// Order matters: it is the display order in the panel list, lead
// roles first. `secretary` was added when the Lupon portal shipped;
// the DB CHECK constraint on lupon_panels.role accepts it, and the
// Secretary is the only role that can finalise minutes.
const ROLES = [
  { value: "chairperson", label: "Chairperson" },
  { value: "secretary", label: "Secretary" },
  { value: "member", label: "Member" },
  { value: "alternate", label: "Alternate (legacy)" },
];

// Roles that may run case actions. Kept in sync with
// lupon_leads_case() in the migration.
const LEAD_ROLES = ["chairperson", "secretary"];

  const STATUS_FILTERS = [
    "All",
    "Pending Review",
    "For Official Categorization",
    "In Progress",
    "Awaiting Meeting",
    "Resolved",
    "Closed",
  ];


function resolveReference(c) {
  if (!c) return "—";
  return c.reference_number || c.case_number || c.id;
}

function resolveProfileName(p) {
  if (!p) return "Unknown";
  return p.display_name || [p.first_name, p.last_name].filter(Boolean).join(" ") || "Unknown";
}

export default function CaptainLuponPanelsPage() {
  const { user } = useAuth();

  const [panels, setPanels] = useState([]);
  const [complaints, setComplaints] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [statusFilter, setStatusFilter] = useState("All");
  const [searchInput, setSearchInput] = useState("");
  // Responsive per keystroke; the panel list re-filters on a pause.

  const [showAssignModal, setShowAssignModal] = useState(false);
  const [showReplaceModal, setShowReplaceModal] = useState(false);
  const [showRemoveConfirm, setShowRemoveConfirm] = useState(false);
  const [selectedPanel, setSelectedPanel] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const [assignForm, setAssignForm] = useState({
    complaint_id: "",
    member_id: "",
    role: "member",
  });
  const [replaceForm, setReplaceForm] = useState({
    new_member_id: "",
    replace_reason: "",
  });

  const fetchPanels = useCallback(async () => {
    const supabase = createClient();
    const { data, error: fetchErr } = await supabase
      .from("lupon_panels")
      // Pinned to member_id: lupon_panels has three foreign keys to profiles
      // (member_id, assigned_by, replaced_by), so the bare embed was rejected
      // as ambiguous and this page never loaded. first_name/last_name are not
      // columns on profiles (they live on resident_profiles) and resolveProfileName
      // reads display_name first anyway.
      .select("*, complaints!inner(id, reference_number, title, current_status), profiles!member_id!inner(id, display_name)")
      .order("assigned_at", { ascending: false });

    if (fetchErr) {
      setError(fetchErr.message);
      return [];
    }
    setPanels(data || []);
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

  const fetchProfiles = useCallback(async () => {
    const supabase = createClient();
    const { data, error: fetchErr } = await supabase
      .from("profiles")
      // profiles has no first_name/last_name column (they live on resident_profiles);
      // resolveProfileName reads display_name first, so only that is requested.
      .select("id, display_name, role")
      .eq("role", "lupon")
      .order("display_name", { ascending: true });

    if (fetchErr) return [];
    setProfiles(data || []);
    return data || [];
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      await Promise.all([fetchPanels(), fetchComplaints(), fetchProfiles()]);
      if (!cancelled) setLoading(false);
    }

    load();
    return () => { cancelled = true; };
  }, [fetchPanels, fetchComplaints, fetchProfiles]);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("captain-lupon-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "lupon_panels" }, () => {
        fetchPanels();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [fetchPanels]);

  const filteredPanels = useMemo(() => {
    const needle = searchInput.trim().toLowerCase();

    return panels.filter((p) => {
      if (statusFilter !== "All") {
        const status = (p.complaints?.current_status || "").toLowerCase();
        if (status !== statusFilter.toLowerCase()) return false;
      }
      if (needle) {
        // Built once per panel per data change rather than per keystroke.
        const haystack = `${resolveReference(p.complaints)} ${
          p.complaints?.title || ""
        } ${resolveProfileName(p.profiles)}`.toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    });
  }, [panels, searchInput, statusFilter]);

  const activePanels = useMemo(
    () => filteredPanels.filter((p) => p.status === "active"),
    [filteredPanels]
  );
  const inactivePanels = useMemo(
    () => filteredPanels.filter((p) => p.status !== "active"),
    [filteredPanels]
  );

  // Complaint ids that already have an active chairperson, collected once
  // into a Set. The previous version ran a panels.some() inside a
  // complaints.filter(), which is O(complaints x panels) predicate calls
  // on every render - and therefore on every keystroke.
  const complaintIdsWithChairperson = useMemo(() => {
    const ids = new Set();
    for (const p of panels) {
      if (p.role === "chairperson" && p.status === "active") {
        ids.add(p.complaint_id);
      }
    }
    return ids;
  }, [panels]);

  const complaintsNeedingAssignment = useMemo(() => {
    return complaints.filter((c) => {
      const status = (c.current_status || "").toLowerCase();
      if (status === "resolved" || status === "closed" || status === "rejected") {
        return false;
      }
      return !complaintIdsWithChairperson.has(c.id);
    });
  }, [complaints, complaintIdsWithChairperson]);

  function openAssignModal() {
    setAssignForm({ complaint_id: "", member_id: "", role: "member" });
    setShowAssignModal(true);
  }

  function openReplaceModal(panel) {
    setSelectedPanel(panel);
    setReplaceForm({ new_member_id: "", replace_reason: "" });
    setShowReplaceModal(true);
  }

  function openRemoveConfirm(panel) {
    setSelectedPanel(panel);
    setShowRemoveConfirm(true);
  }

  async function handleAssign(e) {
    e.preventDefault();
    if (!assignForm.complaint_id || !assignForm.member_id) {
      toast.error("Please select a complaint and a member.");
      return;
    }

    setSubmitting(true);
    const toastId = toast.loading("Assigning member…");

    try {
      const supabase = createClient();

      // A case can have at most ONE active chairperson and at most
      // ONE active secretary. The migration backs both with a
      // partial unique index, so an unguarded second insert would be
      // rejected with a raw constraint error. Demoting the previous
      // holder to 'replaced' first keeps the assignment usable and
      // drops their access immediately, because every RLS policy
      // requires status = 'active'.
      if (LEAD_ROLES.includes(assignForm.role)) {
        const existingLead = panels.find(
          (p) =>
            p.complaint_id === assignForm.complaint_id &&
            p.role === assignForm.role &&
            p.status === "active"
        );

        if (existingLead) {
          if (existingLead.member_id === assignForm.member_id) {
            toast.error(
              "That member already holds this role on this case.",
              { id: toastId }
            );
            return;
          }
          await supabase
            .from("lupon_panels")
            .update({ status: "replaced" })
            .eq("id", existingLead.id);
        }
      }

      const { error: insertErr } = await supabase.from("lupon_panels").insert({
        complaint_id: assignForm.complaint_id,
        member_id: assignForm.member_id,
        role: assignForm.role,
        assigned_by: user?.id || null,
        status: "active",
      });

      if (insertErr) throw insertErr;

      toast.success("Member assigned to panel!", { id: toastId });
      setShowAssignModal(false);
      fetchPanels();
    } catch (err) {
      toast.error(err.message || "Failed to assign member.", { id: toastId });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleReplace(e) {
    e.preventDefault();
    if (!selectedPanel || !replaceForm.new_member_id) {
      toast.error("Please select a replacement member.");
      return;
    }

    setSubmitting(true);
    const toastId = toast.loading("Replacing member…");

    try {
      const supabase = createClient();

      const { error: updateErr } = await supabase
        .from("lupon_panels")
        .update({
          status: "replaced",
          replaced_by: replaceForm.new_member_id,
          replaced_at: new Date().toISOString(),
          replace_reason: replaceForm.replace_reason || null,
        })
        .eq("id", selectedPanel.id);

      if (updateErr) throw updateErr;

      const { error: insertErr } = await supabase.from("lupon_panels").insert({
        complaint_id: selectedPanel.complaint_id,
        member_id: replaceForm.new_member_id,
        role: selectedPanel.role,
        assigned_by: user?.id || null,
        status: "active",
      });

      if (insertErr) throw insertErr;

      toast.success("Member replaced!", { id: toastId });
      setShowReplaceModal(false);
      setSelectedPanel(null);
      fetchPanels();
    } catch (err) {
      toast.error(err.message || "Failed to replace member.", { id: toastId });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRemove() {
    if (!selectedPanel) return;

    setSubmitting(true);
    const toastId = toast.loading("Removing member…");

    try {
      const supabase = createClient();
      const { error: updateErr } = await supabase
        .from("lupon_panels")
        .update({ status: "removed" })
        .eq("id", selectedPanel.id);

      if (updateErr) throw updateErr;

      toast.success("Member removed from panel.", { id: toastId });
      setShowRemoveConfirm(false);
      setSelectedPanel(null);
      fetchPanels();
    } catch (err) {
      toast.error(err.message || "Failed to remove member.", { id: toastId });
    } finally {
      setSubmitting(false);
    }
  }

  // Grouping and ordering rebuilt only when the panel list changes. This
  // also stops sorting a memoized array in place during render, which made
  // the result depend on how many times the component happened to render.
  const groupedPanels = useMemo(() => {
    const grouped = {};
    for (const p of activePanels) {
      const key = p.complaint_id;
      if (!grouped[key]) {
        grouped[key] = { complaint: p.complaints, members: [] };
      }
      grouped[key].members.push(p);
    }
    for (const g of Object.values(grouped)) {
      g.members.sort(
        (a, b) => (ROLE_ORDER[a.role] ?? 3) - (ROLE_ORDER[b.role] ?? 3)
      );
    }
    return grouped;
  }, [activePanels]);

  if (loading) {
    return (
      <div className="mx-auto max-w-[1280px] space-y-6">
        <div className="flex items-center gap-3">
          <Users className="h-6 w-6 text-secondary" />
          <h1 className="font-heading text-2xl font-semibold tracking-tight text-navy">
            Lupon Panel Assignment
          </h1>
        </div>
        <div className="rounded-2xl border border-line bg-white p-6 shadow-[0_1px_2px_rgba(11,33,68,0.06)]">
          <div className="space-y-4">
            {Array.from({ length: 4 }).map((_, i) => (
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
          <Users className="h-6 w-6 text-secondary" />
          <div>
            <h1 className="font-heading text-2xl font-semibold tracking-tight text-navy">
              Lupon Panel Assignment
            </h1>
            <p className="text-[13px] text-muted">
              Manage panel members for case complaints
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={openAssignModal}
          className="inline-flex items-center gap-2 rounded-full bg-jordy px-5 py-2.5 text-sm font-semibold text-white shadow-button transition-colors hover:bg-secondary"
        >
          <UserPlus className="h-4 w-4" aria-hidden="true" />
          Assign Member
        </button>
      </div>

      {/* Complaints Needing Assignment */}
      {complaintsNeedingAssignment.length > 0 && (
        <div className="rounded-2xl border border-warning/30 bg-warning-soft p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-warning" aria-hidden="true" />
            <div>
              <p className="text-sm font-semibold text-navy">
                {complaintsNeedingAssignment.length} complaint{complaintsNeedingAssignment.length !== 1 ? "s" : ""} need{complaintsNeedingAssignment.length === 1 ? "s" : ""} a chairperson
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {complaintsNeedingAssignment.slice(0, 5).map((c) => (
                  <span
                    key={c.id}
                    className="inline-flex items-center gap-1.5 rounded-full border border-warning/30 bg-white px-3 py-1 text-[12px] font-semibold text-navy"
                  >
                    {resolveReference(c)} — {c.title}
                  </span>
                ))}
                {complaintsNeedingAssignment.length > 5 && (
                  <span className="text-[12px] font-semibold text-muted">
                    +{complaintsNeedingAssignment.length - 5} more
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

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
        <div className="relative sm:w-64">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" />
          <input
            type="text"
            placeholder="Search complaint or member…"
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

      {/* Panel Groups */}
      {Object.keys(groupedPanels).length === 0 && complaintsNeedingAssignment.length === 0 ? (
        <div className="rounded-2xl border border-line bg-white shadow-[0_1px_2px_rgba(11,33,68,0.06)]">
          <EmptyState
            title="No panel assignments"
            message="Assign lupon members to complaints to start building panels."
            icon={Users}
          >
            <button
              type="button"
              onClick={openAssignModal}
              className="inline-flex items-center gap-2 rounded-full bg-jordy px-5 py-2.5 text-sm font-semibold text-white shadow-button transition-colors hover:bg-secondary"
            >
              <UserPlus className="h-4 w-4" aria-hidden="true" />
              Assign Member
            </button>
          </EmptyState>
        </div>
      ) : (
        <div className="space-y-4">
          {Object.entries(groupedPanels).map(([complaintId, group]) => (
            <div
              key={complaintId}
              className="rounded-2xl border border-line bg-white shadow-[0_1px_2px_rgba(11,33,68,0.06)]"
            >
              <div className="border-b border-line px-6 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-[12px] font-semibold text-secondary">
                      {resolveReference(group.complaint)}
                    </p>
                    <p className="font-heading text-base font-semibold text-navy break-words">
                      {group.complaint?.title || "—"}
                    </p>
                  </div>
                  <StatusBadge
                    label={group.complaint?.current_status || "Pending Review"}
                  />
                </div>
              </div>
              <div className="divide-y divide-line">
                {group.members.map((m) => (
                  <div
                    key={m.id}
                    className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6"
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-info-soft">
                        <User className="h-4 w-4 text-secondary" aria-hidden="true" />
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-[13px] font-semibold text-navy">
                          {resolveProfileName(m.profiles)}
                        </p>
                        <p className="text-[12px] capitalize text-muted">
                          {m.role}
                        </p>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        onClick={() => openReplaceModal(m)}
                        className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-[12px] font-semibold text-muted transition-colors hover:bg-alt hover:text-navy"
                      >
                        <ArrowRightLeft className="h-3 w-3" aria-hidden="true" />
                        Replace
                      </button>
                      <button
                        type="button"
                        onClick={() => openRemoveConfirm(m)}
                        className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-[12px] font-semibold text-critical transition-colors hover:bg-critical-soft"
                      >
                        <XCircle className="h-3 w-3" aria-hidden="true" />
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Replaced/Removed History */}
      {inactivePanels.length > 0 && (
        <div className="rounded-2xl border border-line bg-white p-6 shadow-[0_1px_2px_rgba(11,33,68,0.06)]">
          <h2 className="font-heading text-base font-semibold tracking-tight text-navy">
            Assignment History
          </h2>
          <p className="mt-1 text-[13px] text-muted">
            Previously assigned or removed members
          </p>
          <div className="mt-4 space-y-2">
            {inactivePanels.slice(0, 10).map((p) => (
              <div
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-canvas px-4 py-2.5"
              >
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-alt">
                    <User className="h-3.5 w-3.5 text-muted" aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-[12px] font-medium text-navy">
                      {resolveProfileName(p.profiles)}
                    </p>
                    <p className="text-[11px] text-muted">
                      {resolveReference(p.complaints)} — {p.role}
                    </p>
                  </div>
                </div>
                <StatusBadge
                  label={p.status === "replaced" ? "Replaced" : "Removed"}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Assign Member Modal */}
      <ResidentModal
        open={showAssignModal}
        onClose={() => setShowAssignModal(false)}
        labelledBy="assign-member-title"
        title="Assign Member to Panel"
        maxWidthClass="max-w-lg"
      >
        <form onSubmit={handleAssign} className="space-y-4">
          <div>
            <label htmlFor="assign-complaint" className="mb-1 block text-[12px] font-semibold text-navy">
              Complaint <span className="text-critical">*</span>
            </label>
            <select
              id="assign-complaint"
              value={assignForm.complaint_id}
              onChange={(e) =>
                setAssignForm((f) => ({ ...f, complaint_id: e.target.value }))
              }
              className="w-full rounded-xl border border-line bg-canvas px-4 py-2.5 text-[13px] text-navy focus:border-secondary focus:outline-none focus:ring-1 focus:ring-secondary"
              required
            >
              <option value="">Select a complaint…</option>
              {complaints
                .filter((c) => {
                  const status = (c.current_status || "").toLowerCase();
                  return status !== "resolved" && status !== "closed" && status !== "rejected";
                })
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {resolveReference(c)} — {c.title}
                  </option>
                ))}
            </select>
          </div>

          <div>
            <label htmlFor="assign-member" className="mb-1 block text-[12px] font-semibold text-navy">
              Lupon Member <span className="text-critical">*</span>
            </label>
            <select
              id="assign-member"
              value={assignForm.member_id}
              onChange={(e) =>
                setAssignForm((f) => ({ ...f, member_id: e.target.value }))
              }
              className="w-full rounded-xl border border-line bg-canvas px-4 py-2.5 text-[13px] text-navy focus:border-secondary focus:outline-none focus:ring-1 focus:ring-secondary"
              required
            >
              <option value="">Select a member…</option>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {resolveProfileName(p)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="assign-role" className="mb-1 block text-[12px] font-semibold text-navy">
              Role
            </label>
            <select
              id="assign-role"
              value={assignForm.role}
              onChange={(e) =>
                setAssignForm((f) => ({ ...f, role: e.target.value }))
              }
              className="w-full rounded-xl border border-line bg-canvas px-4 py-2.5 text-[13px] text-navy focus:border-secondary focus:outline-none focus:ring-1 focus:ring-secondary"
            >
              {ROLES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={() => setShowAssignModal(false)}
              disabled={submitting}
              className="inline-flex h-11 items-center justify-center rounded-full border border-line px-5 text-sm font-semibold text-mirage transition-colors hover:bg-alt disabled:opacity-60"
            >
              Cancel
            </button>
            <LoadingButton isLoading={submitting} disabled={submitting}>
              Assign Member
            </LoadingButton>
          </div>
        </form>
      </ResidentModal>

      {/* Replace Member Modal */}
      <ResidentModal
        open={showReplaceModal}
        onClose={() => setShowReplaceModal(false)}
        labelledBy="replace-member-title"
        title="Replace Panel Member"
        maxWidthClass="max-w-lg"
      >
        <form onSubmit={handleReplace} className="space-y-4">
          {selectedPanel && (
            <div className="rounded-xl border border-line bg-canvas p-4">
              <p className="text-[12px] font-semibold text-muted">Replacing</p>
              <p className="text-[13px] font-semibold text-navy">
                {resolveProfileName(selectedPanel.profiles)} ({selectedPanel.role})
              </p>
            </div>
          )}

          <div>
            <label htmlFor="replace-member" className="mb-1 block text-[12px] font-semibold text-navy">
              New Member <span className="text-critical">*</span>
            </label>
            <select
              id="replace-member"
              value={replaceForm.new_member_id}
              onChange={(e) =>
                setReplaceForm((f) => ({ ...f, new_member_id: e.target.value }))
              }
              className="w-full rounded-xl border border-line bg-canvas px-4 py-2.5 text-[13px] text-navy focus:border-secondary focus:outline-none focus:ring-1 focus:ring-secondary"
              required
            >
              <option value="">Select a replacement…</option>
              {profiles
                .filter((p) => p.id !== selectedPanel?.member_id)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {resolveProfileName(p)}
                  </option>
                ))}
            </select>
          </div>

          <div>
            <label htmlFor="replace-reason" className="mb-1 block text-[12px] font-semibold text-navy">
              Reason for Replacement
            </label>
            <textarea
              id="replace-reason"
              rows={3}
              value={replaceForm.replace_reason}
              onChange={(e) =>
                setReplaceForm((f) => ({ ...f, replace_reason: e.target.value }))
              }
              placeholder="Optional reason…"
              className="w-full resize-none rounded-xl border border-line bg-canvas px-4 py-2.5 text-[13px] text-navy placeholder:text-muted focus:border-secondary focus:outline-none focus:ring-1 focus:ring-secondary"
            />
          </div>

          <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={() => setShowReplaceModal(false)}
              disabled={submitting}
              className="inline-flex h-11 items-center justify-center rounded-full border border-line px-5 text-sm font-semibold text-mirage transition-colors hover:bg-alt disabled:opacity-60"
            >
              Cancel
            </button>
            <LoadingButton isLoading={submitting} disabled={submitting}>
              Replace Member
            </LoadingButton>
          </div>
        </form>
      </ResidentModal>

      {/* Remove Confirm */}
      <ConfirmDialog
        open={showRemoveConfirm}
        onClose={() => { setShowRemoveConfirm(false); setSelectedPanel(null); }}
        onConfirm={handleRemove}
        busy={submitting}
        title="Remove from Panel?"
        message="This member will be removed from the panel. This action can be undone by assigning them again."
        confirmLabel="Remove"
      />
    </div>
  );
}