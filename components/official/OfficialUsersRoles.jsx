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
  Users,
  Search,
  Filter,
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  Loader2,
  RefreshCw,
  UserPlus,
  Lock,
  Mail,
  Clock,
  UserCheck,
  CheckCircle2,
} from "lucide-react";
import toast from "react-hot-toast";

const MANAGEABLE_ROLES = [
  { value: "resident", label: "Resident" },
  { value: "captain", label: "Barangay Captain" },
  { value: "oic", label: "OIC / Acting Captain" },
  { value: "secretary", label: "Secretary" },
  { value: "lupon", label: "Lupon Member" },
  { value: "admin", label: "Admin" },
];

const ROLE_LABELS = {
  resident: "Resident",
  captain: "Barangay Captain",
  oic: "OIC / Acting Captain",
  secretary: "Secretary",
  lupon: "Lupon Member",
  admin: "Admin",
  staff: "Staff",
  police: "Police",
};

const ROLE_BADGE_CLASSES = {
  resident: "bg-alt text-muted",
  captain: "bg-secondary text-white",
  oic: "bg-info-soft text-secondary",
  secretary: "bg-success-soft text-success",
  lupon: "bg-gold/10 text-gold",
  admin: "bg-navy text-white",
  staff: "bg-alt text-muted",
  police: "bg-critical-soft text-critical",
};

const STATUS_BADGE_CLASSES = {
  active: "bg-success-soft text-success",
  pending: "bg-warning-soft text-warning",
  suspended: "bg-critical-soft text-critical",
  disabled: "bg-alt text-muted",
};

const STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "pending", label: "Pending" },
  { value: "suspended", label: "Suspended" },
  { value: "disabled", label: "Disabled" },
];

const REVIEW_RESULTS = ["success", "failed", "dismissed", "escalated"];

const SENSITIVE_PATTERNS = [
  "user.role_changed",
  "user.status_changed",
  "user.account_suspended",
  "user.account_disabled",
  "role.changed",
  "deleted",
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

function resolveDisplayName(profile, residentProfile) {
  if (residentProfile) {
    const name = [residentProfile.first_name, residentProfile.last_name].filter(Boolean).join(" ");
    if (name) return name;
  }
  return profile.display_name || "Unknown User";
}

function resolveRegisteredName(profile, residentProfile) {
  const validName = (value) => {
    const name = typeof value === "string" ? value.trim() : "";
    return name && !/^resident\s+user$/i.test(name) && !name.includes("@") ? name : null;
  };
  const residentName = validName(
    [residentProfile?.first_name, residentProfile?.last_name].filter(Boolean).join(" ")
  );
  const profileName = validName(profile.display_name);

  // Officials use profiles.display_name; promoted residents may retain a real
  // name in resident_profiles even when the signup display name is a placeholder.
  return (profile.role === "resident"
    ? residentName || profileName
    : profileName || residentName) || "Name not set";
}

function resolvePosition(profile) {
  return profile.official_profiles?.position || null;
}

function isSensitiveAction(action) {
  if (!action) return false;
  const lower = action.toLowerCase();
  return SENSITIVE_PATTERNS.some((p) => lower.includes(p.toLowerCase()));
}

export default function CaptainUsersPage({ resolveRegisteredNames = false }) {
  const { user } = useAuth();
  const nameFor = resolveRegisteredNames ? resolveRegisteredName : resolveDisplayName;
  const [profiles, setProfiles] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchInput, setSearchInput] = useState("");
  // Up to 1,000 profiles are fetched and the list is rendered twice (a
  // desktop table and a mobile card list), so re-filtering on every
  // keystroke reconciled roughly 2,000 rows per character. The box stays
  // responsive; the list re-filters on a pause.
  const [roleFilter, setRoleFilter] = useState("all");

  const [roleTarget, setRoleTarget] = useState(null);
  const [roleValue, setRoleValue] = useState("");
  const [roleBusy, setRoleBusy] = useState(false);

  const [statusTarget, setStatusTarget] = useState(null);
  const [statusValue, setStatusValue] = useState("");
  const [statusBusy, setStatusBusy] = useState(false);

  const [reviewTarget, setReviewTarget] = useState(null);
  const [reviewResult, setReviewResult] = useState("dismissed");
  const [reviewRemarks, setReviewRemarks] = useState("");
  const [reviewBusy, setReviewBusy] = useState(false);

  const [addOpen, setAddOpen] = useState(false);
  const [addMethod, setAddMethod] = useState("link");
  const [addBusy, setAddBusy] = useState(false);
  const [addForm, setAddForm] = useState({
    uuid: "",
    email: "",
    password: "",
    displayName: "",
    role: "secretary",
  });

  const fetchProfiles = useCallback(async () => {
    const supabase = createClient();
    return selectWithOptionalColumns(
      supabase,
      "profiles",
      [
        "id",
        "role",
        "display_name",
        "account_status",
        "created_at",
        "updated_at",
        "resident_profiles(user_id, first_name, middle_name, last_name, purok, mobile_number)",
        "official_profiles(position)",
      ],
      ["email", "last_sign_in_at"],
      { orderField: "created_at", limit: 1000 }
    );
  }, []);

  const fetchAlerts = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("activity_logs")
      // Pinned to actor_id: activity_logs also has a reviewed_by foreign
      // key to profiles, which makes the bare embed ambiguous.
      .select("id, action, result, remarks, reviewed_at, created_at, actor_id, target_id, target_type, entity_ref, details, profiles!actor_id(display_name, role)")
      .order("created_at", { ascending: false })
      .limit(500);
    const sensitiveUnreviewed = (data || []).filter(
      (l) => isSensitiveAction(l.action) && !l.reviewed_at
    );
    setAlerts(sensitiveUnreviewed);
  }, []);

  const loadAll = useCallback(async () => {
    setError(null);
    try {
      const [p, a] = await Promise.all([fetchProfiles(), fetchAlerts()]);
      setProfiles(p);
      void a;
    } catch (err) {
      logSupabaseError("Users load", err);
      setError(getErrorMessage(err, "Failed to load users."));
    }
  }, [fetchProfiles, fetchAlerts]);

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

  const filteredProfiles = useMemo(() => {
    return profiles.filter((p) => {
      const matchesRole = roleFilter === "all" || p.role === roleFilter;
      if (!matchesRole) return false;
      if (!searchInput.trim()) return true;
      const q = searchInput.toLowerCase();
      const resident = p.resident_profiles;
      const name = nameFor(p, resident).toLowerCase();
      const email = (p.email || "").toLowerCase();
      return name.includes(q) || email.includes(q);
    });
  }, [profiles, roleFilter, searchInput, nameFor]);

  const roleCounts = useMemo(() => {
    const counts = {};
    profiles.forEach((p) => {
      counts[p.role] = (counts[p.role] || 0) + 1;
    });
    return counts;
  }, [profiles]);

  const visibleRoleChips = useMemo(() => {
    return MANAGEABLE_ROLES.filter((r) => roleCounts[r.value]);
  }, [roleCounts]);

  const isCurrentUser = useCallback(
    (id) => {
      return !!user && id === user.id;
    },
    [user]
  );

  const handleChangeRole = useCallback(async () => {
    if (!roleTarget) return;
    const supabase = createClient();
    setRoleBusy(true);
    const toastId = toast.loading("Changing role…");
    try {
      const { error: err } = await supabase.rpc("update_user_role", {
        p_user_id: roleTarget.id,
        p_new_role: roleValue,
      });
      if (err) throw err;
      toast.success("Role updated.");
      setRoleTarget(null);
      await Promise.all([fetchProfiles(), fetchAlerts()]);
    } catch (err) {
      console.error("Role change error:", err);
      toast.error(err.message || "Role change failed.");
    } finally {
      toast.dismiss(toastId);
      setRoleBusy(false);
    }
  }, [roleTarget, roleValue, fetchProfiles, fetchAlerts]);

  const handleChangeStatus = useCallback(async () => {
    if (!statusTarget) return;
    const supabase = createClient();
    setStatusBusy(true);
    const toastId = toast.loading("Updating account status…");
    try {
      const { error: err } = await supabase.rpc("update_user_status", {
        p_user_id: statusTarget.id,
        p_status: statusValue,
      });
      if (err) throw err;
      toast.success("Account status updated.");
      setStatusTarget(null);
      await Promise.all([fetchProfiles(), fetchAlerts()]);
    } catch (err) {
      console.error("Status change error:", err);
      toast.error(err.message || "Status update failed.");
    } finally {
      toast.dismiss(toastId);
      setStatusBusy(false);
    }
  }, [statusTarget, statusValue, fetchProfiles, fetchAlerts]);

  const handleReviewAlert = useCallback(async () => {
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
      await fetchAlerts();
    } catch (err) {
      console.error("Review error:", err);
      toast.error(err.message || "Could not record review.");
    } finally {
      toast.dismiss(toastId);
      setReviewBusy(false);
    }
  }, [reviewTarget, reviewResult, reviewRemarks, fetchAlerts]);

  const handleAddUser = useCallback(async () => {
    const supabase = createClient();
    setAddBusy(true);
    const toastId = toast.loading("Creating user…");
    try {
      if (addMethod === "link") {
        if (!addForm.uuid.trim()) throw new Error("Paste the auth user UUID first.");
        if (!addForm.displayName.trim()) throw new Error("Display name is required.");
        const { error: err } = await supabase.rpc("setup_official_account", {
          p_user_id: addForm.uuid.trim(),
          p_role: addForm.role,
          p_display_name: addForm.displayName.trim(),
        });
        if (err) throw err;
        toast.success("Official account linked and role assigned.");
      } else {
        if (!addForm.email.trim()) throw new Error("Email is required.");
        if (addForm.password.length < 6) throw new Error("Password must be at least 6 characters.");
        if (!addForm.displayName.trim()) throw new Error("Display name is required.");
        const parts = addForm.displayName.trim().split(/\s+/);
        const { data: signupData, error: err } = await supabase.auth.signUp({
          email: addForm.email.trim(),
          password: addForm.password,
          options: {
            data: {
              first_name: parts[0],
              last_name: parts.slice(1).join(" ") || parts[0],
              display_name: addForm.displayName.trim(),
            },
          },
        });
        if (err) throw err;

        if (addForm.role !== "resident") {
          const newUserId = signupData?.user?.id;
          if (!newUserId) {
            throw new Error("Account was created but the user id was not returned. Use Link existing user instead.");
          }
          if (addForm.role === "captain" || addForm.role === "oic" || addForm.role === "secretary" || addForm.role === "lupon") {
            const { error: setupErr } = await supabase.rpc("setup_official_account", {
              p_user_id: newUserId,
              p_role: addForm.role,
              p_display_name: addForm.displayName.trim(),
            });
            if (setupErr) throw setupErr;
          } else {
            const { error: roleErr } = await supabase.rpc("update_user_role", {
              p_user_id: newUserId,
              p_new_role: addForm.role,
            });
            if (roleErr) throw roleErr;
          }
        }

        toast.success(
          addForm.role === "resident"
            ? "Resident account created. They may need to confirm their email before signing in."
            : "Account created with the assigned role. Confirm their email, then they can sign in."
        );
      }
      setAddOpen(false);
      await fetchProfiles();
    } catch (err) {
      console.error("Add user error:", err);
      toast.error(err.message || "Could not add user.");
    } finally {
      toast.dismiss(toastId);
      setAddBusy(false);
    }
  }, [addMethod, addForm, fetchProfiles]);

  if (loading) {
    return (
      <div className="mx-auto max-w-[1280px] space-y-6">
        <div className="flex items-center gap-3">
          <Users className="h-6 w-6 text-secondary" aria-hidden="true" />
          <div>
            <h1 className="font-heading text-2xl font-semibold tracking-tight text-navy">Users & Roles</h1>
            <p className="text-[13px] text-muted">Manage accounts, roles, and statuses.</p>
          </div>
        </div>
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 rounded-2xl border border-line bg-white p-4">
              <div className="h-10 w-10 animate-pulse rounded-full bg-alt" />
              <div className="flex-1 space-y-2">
                <div className="h-3 w-40 animate-pulse rounded bg-alt" />
                <div className="h-3 w-24 animate-pulse rounded bg-alt" />
              </div>
              <div className="h-6 w-16 animate-pulse rounded-full bg-alt" />
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
          <Users className="h-6 w-6 text-secondary" aria-hidden="true" />
          <h1 className="font-heading text-2xl font-semibold tracking-tight text-navy">Users & Roles</h1>
        </div>
        <EmptyState title="Could not load users" message={error} icon={AlertTriangle}>
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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <Users className="h-6 w-6 shrink-0 text-secondary" aria-hidden="true" />
          <div className="min-w-0">
            <h1 className="font-heading text-xl font-semibold tracking-tight text-navy sm:text-2xl">Users & Roles</h1>
            <p className="text-[13px] text-muted">
              {profiles.length} user{profiles.length !== 1 ? "s" : ""} registered
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          className="inline-flex min-h-[44px] shrink-0 items-center justify-center gap-2 rounded-full bg-navy px-5 text-sm font-semibold text-white transition-colors hover:bg-secondary"
        >
          <UserPlus className="h-4 w-4" aria-hidden="true" />
          Add User
        </button>
      </div>

      {alerts.length > 0 && (
        <section className="rounded-2xl border border-warning/30 bg-warning-soft/40 p-4 sm:p-5">
          <div className="flex items-start gap-3">
            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-warning" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-navy">
                {alerts.length} unreviewed security event{alerts.length !== 1 ? "s" : ""}
              </p>
              <p className="mt-0.5 text-[13px] text-muted">
                Role and account-status changes are flagged automatically. Review them below to record the outcome in the audit trail.
              </p>
            </div>
          </div>
          <ul className="mt-4 space-y-2">
            {alerts.slice(0, 5).map((l) => (
              <li
                key={l.id}
                className="flex flex-col gap-2 rounded-xl border border-warning/20 bg-white p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-semibold capitalize text-navy">{l.action.replace(/[._]/g, " ")}</p>
                  <p className="text-[12px] text-muted">
                    {l.profiles?.display_name || "Unknown"} · {formatDateTime(l.created_at)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setReviewTarget(l);
                    setReviewResult("dismissed");
                    setReviewRemarks("");
                  }}
                  className="inline-flex shrink-0 items-center justify-center gap-2 rounded-full bg-navy px-4 py-2 text-[12px] font-semibold text-white transition-colors hover:bg-secondary"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                  Review
                </button>
              </li>
            ))}
          </ul>
          {alerts.length > 5 && (
            <p className="mt-3 text-center text-[12px] text-muted">
              Showing 5 of {alerts.length} — review them one by one.
            </p>
          )}
        </section>
      )}

      <section className="rounded-2xl border border-line bg-white p-5 shadow-[0_1px_2px_rgba(11,33,68,0.06)] sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label htmlFor="user-search" className="mb-1.5 block text-[13px] font-semibold text-mirage">Search by name or email</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" />
              <input
                id="user-search"
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search users..."
                className="w-full rounded-xl border border-line bg-white py-2.5 pl-10 pr-3 text-[13px] text-navy placeholder:text-muted focus:border-secondary focus:outline-none focus:ring-2 focus:ring-secondary/20"
              />
            </div>
          </div>
          <div className="sm:w-56">
            <label htmlFor="role-filter" className="mb-1.5 block text-[13px] font-semibold text-mirage">Role</label>
            <div className="relative">
              <select
                id="role-filter"
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value)}
                className="w-full appearance-none rounded-xl border border-line bg-white px-3 py-2.5 text-[13px] text-navy focus:border-secondary focus:outline-none focus:ring-2 focus:ring-secondary/20"
              >
                <option value="all">All Roles</option>
                {MANAGEABLE_ROLES.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
              <Filter className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" />
            </div>
          </div>
        </div>
        {visibleRoleChips.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {visibleRoleChips.map((r) => (
              <button
                key={r.value}
                type="button"
                onClick={() => setRoleFilter(roleFilter === r.value ? "all" : r.value)}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold transition-colors ${
                  roleFilter === r.value
                    ? "bg-secondary text-white"
                    : "bg-alt text-muted hover:bg-info-soft hover:text-secondary"
                }`}
              >
                {r.label}
                <span className="ml-0.5 text-[11px] opacity-70">{roleCounts[r.value]}</span>
              </button>
            ))}
          </div>
        )}
      </section>

      <div className="flex items-start gap-3 rounded-2xl border border-info/20 bg-info-soft/40 p-4">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-secondary" aria-hidden="true" />
        <p className="text-[13px] leading-relaxed text-navy">
          Role and status changes are performed through database functions that write an immutable audit trail. The Barangay Captain
          account is protected, and you cannot change your own role. Any change you cannot perform here is blocked for security — apply{" "}
          <code className="rounded bg-white px-1.5 py-0.5 text-[12px]">supabase/manual/22_admin_monitoring_pages.sql</code> to enable the role
          and status actions.
        </p>
      </div>

      {filteredProfiles.length === 0 ? (
        <EmptyState
          title="No users found"
          message={
            searchInput || roleFilter !== "all"
              ? "No users match your search criteria."
              : "No users have been registered yet."
          }
          icon={Users}
        />
      ) : (
        <>
          <section className="hidden rounded-2xl border border-line bg-white shadow-[0_1px_2px_rgba(11,33,68,0.06)] md:block">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[13px]">
                <thead>
                  <tr className="border-b border-line text-[11px] font-semibold uppercase tracking-wider text-muted">
                    <th className="p-4">Name</th>
                    <th className="p-4">Email</th>
                    <th className="p-4">Role</th>
                    <th className="p-4">Status</th>
                    <th className="p-4">Member Since</th>
                    <th className="p-4">Last Sign In</th>
                    <th className="p-4">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {filteredProfiles.map((p) => {
                    const resident = p.resident_profiles;
                    const name = nameFor(p, resident);
                    const email = p.email || "—";
                    const position = resolvePosition(p);
                    const locked = p.role === "captain";
                    const self = isCurrentUser(p.id);
                    return (
                      <tr key={p.id} className="transition-colors hover:bg-alt/40">
                        <td className="p-4">
                          <div className="flex items-center gap-3">
                            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-info-soft text-[13px] font-bold text-secondary">
                              {name.charAt(0).toUpperCase()}
                            </span>
                            <div className="min-w-0">
                              <p className="flex items-center gap-1.5 font-medium text-navy">
                                {name}
                                {self && <span className="rounded-full bg-alt px-2 py-0.5 text-[10px] font-semibold uppercase text-muted">You</span>}
                                {locked && <Lock className="h-3 w-3 text-muted" aria-hidden="true" />}
                              </p>
                              <p className="text-[11.5px] text-muted">
                                {position ? `Position: ${position}` : resident?.purok ? `Purok ${resident.purok}` : ""}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="p-4">
                          <span className="inline-flex items-center gap-1.5 text-muted">
                            <Mail className="h-3.5 w-3.5" aria-hidden="true" />
                            {email}
                          </span>
                        </td>
                        <td className="p-4">
                          <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11.5px] font-semibold ${ROLE_BADGE_CLASSES[p.role] || "bg-alt text-muted"}`}>
                            {ROLE_LABELS[p.role] || p.role}
                          </span>
                        </td>
                        <td className="p-4">
                          <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11.5px] font-semibold capitalize ${STATUS_BADGE_CLASSES[p.account_status] || "bg-alt text-muted"}`}>
                            {p.account_status || "pending"}
                          </span>
                        </td>
                        <td className="p-4 text-muted">{formatDate(p.created_at)}</td>
                        <td className="p-4 text-muted">{p.last_sign_in_at ? formatDateTime(p.last_sign_in_at) : "—"}</td>
                        <td className="p-4">
                          <div className="flex gap-2">
                            <button
                              type="button"
                              disabled={locked || self}
                              onClick={() => {
                                setRoleTarget(p);
                                setRoleValue(p.role);
                              }}
                              title={locked ? "The Barangay Captain role is protected" : self ? "You cannot change your own role" : "Change role"}
                              className="inline-flex items-center gap-1 rounded-full border border-line px-3 py-1.5 text-[12px] font-semibold text-navy transition-colors hover:bg-alt disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              <UserCheck className="h-3.5 w-3.5" aria-hidden="true" />
                              Role
                            </button>
                            <button
                              type="button"
                              disabled={locked || self}
                              onClick={() => {
                                setStatusTarget(p);
                                setStatusValue(p.account_status || "active");
                              }}
                              title={locked ? "The Barangay Captain account is protected" : self ? "You cannot change your own status" : "Change status"}
                              className="inline-flex items-center gap-1 rounded-full border border-line px-3 py-1.5 text-[12px] font-semibold text-navy transition-colors hover:bg-alt disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                              Status
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <div className="space-y-3 md:hidden">
            {filteredProfiles.map((p) => {
              const resident = p.resident_profiles;
              const name = nameFor(p, resident);
              const email = p.email || "—";
              const locked = p.role === "captain";
              const self = isCurrentUser(p.id);
              return (
                <div key={p.id} className="rounded-2xl border border-line bg-white p-4 shadow-[0_1px_2px_rgba(11,33,68,0.06)]">
                  <div className="flex items-start gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-info-soft text-sm font-bold text-secondary">
                      {name.charAt(0).toUpperCase()}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-1.5 font-medium text-navy">
                        {name}
                        {self && <span className="rounded-full bg-alt px-2 py-0.5 text-[10px] font-semibold uppercase text-muted">You</span>}
                        {locked && <Lock className="h-3 w-3 text-muted" aria-hidden="true" />}
                      </p>
                      <p className="truncate text-[12px] text-muted">{email}</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold ${ROLE_BADGE_CLASSES[p.role] || "bg-alt text-muted"}`}>
                          {ROLE_LABELS[p.role] || p.role}
                        </span>
                        <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold capitalize ${STATUS_BADGE_CLASSES[p.account_status] || "bg-alt text-muted"}`}>
                          {p.account_status || "pending"}
                        </span>
                      </div>
                      <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted">
                        <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" aria-hidden="true" /> Joined {formatDate(p.created_at)}</span>
                        <span>Last sign in {p.last_sign_in_at ? formatDateTime(p.last_sign_in_at) : "—"}</span>
                      </p>
                      <div className="mt-3 flex gap-2">
                        <button
                          type="button"
                          disabled={locked || self}
                          onClick={() => { setRoleTarget(p); setRoleValue(p.role); }}
                          className="inline-flex flex-1 items-center justify-center gap-1 rounded-full border border-line px-3 py-2 text-[12px] font-semibold text-navy transition-colors hover:bg-alt disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <UserCheck className="h-3.5 w-3.5" aria-hidden="true" />
                          Role
                        </button>
                        <button
                          type="button"
                          disabled={locked || self}
                          onClick={() => { setStatusTarget(p); setStatusValue(p.account_status || "active"); }}
                          className="inline-flex flex-1 items-center justify-center gap-1 rounded-full border border-line px-3 py-2 text-[12px] font-semibold text-navy transition-colors hover:bg-alt disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                          Status
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      <ResidentModal
        open={roleTarget !== null}
        onClose={() => setRoleTarget(null)}
        labelledBy="change-role-title"
        title="Change Role"
        maxWidthClass="max-w-md"
      >
        {roleTarget && (
          <div className="space-y-4">
            <p className="text-sm text-muted">
              Changing the role of <span className="font-semibold text-navy">{nameFor(roleTarget, roleTarget.resident_profiles)}</span> to:
            </p>
            <select
              id="change-role-value"
              value={roleValue}
              onChange={(e) => setRoleValue(e.target.value)}
              className="w-full rounded-xl border border-line bg-white px-3 py-2.5 text-[13px] text-navy focus:border-secondary focus:outline-none focus:ring-2 focus:ring-secondary/20"
            >
              {MANAGEABLE_ROLES.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
            <div className="flex items-start gap-2 rounded-xl bg-warning-soft/40 p-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
              <p className="text-[12px] text-muted">
                This change is applied immediately and recorded in the immutable activity log.
              </p>
            </div>
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setRoleTarget(null)}
                disabled={roleBusy}
                className="inline-flex h-11 items-center justify-center rounded-full border border-line px-5 text-sm font-semibold text-mirage transition-colors hover:bg-alt disabled:opacity-60"
              >
                Cancel
              </button>
              <LoadingButton isLoading={roleBusy} onClick={handleChangeRole} disabled={roleBusy}>
                Save Role
              </LoadingButton>
            </div>
          </div>
        )}
      </ResidentModal>

      <ResidentModal
        open={statusTarget !== null}
        onClose={() => setStatusTarget(null)}
        labelledBy="change-status-title"
        title="Change Account Status"
        maxWidthClass="max-w-md"
      >
        {statusTarget && (
          <div className="space-y-4">
            <p className="text-sm text-muted">
              Set the status of <span className="font-semibold text-navy">{nameFor(statusTarget, statusTarget.resident_profiles)}</span> to:
            </p>
            <select
              id="change-status-value"
              value={statusValue}
              onChange={(e) => setStatusValue(e.target.value)}
              className="w-full rounded-xl border border-line bg-white px-3 py-2.5 text-[13px] text-navy focus:border-secondary focus:outline-none focus:ring-2 focus:ring-secondary/20"
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
            {statusValue === "suspended" || statusValue === "disabled" ? (
              <div className="flex items-start gap-2 rounded-xl bg-critical-soft/50 p-3">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-critical" aria-hidden="true" />
                <p className="text-[12px] text-muted">
                  Suspended or disabled accounts can no longer sign in until reactivated.
                </p>
              </div>
            ) : null}
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setStatusTarget(null)}
                disabled={statusBusy}
                className="inline-flex h-11 items-center justify-center rounded-full border border-line px-5 text-sm font-semibold text-mirage transition-colors hover:bg-alt disabled:opacity-60"
              >
                Cancel
              </button>
              <LoadingButton isLoading={statusBusy} onClick={handleChangeStatus} disabled={statusBusy}>
                Save Status
              </LoadingButton>
            </div>
          </div>
        )}
      </ResidentModal>

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
                {reviewTarget.profiles?.display_name || "Unknown actor"} · {formatDateTime(reviewTarget.created_at)}
              </p>
              {reviewTarget.target_type && (
                <p className="mt-1 text-[12px] text-muted">
                  Target: {reviewTarget.target_type} ({reviewTarget.target_id || "—"})
                </p>
              )}
            </div>
            <div>
              <label htmlFor="review-result" className="mb-1.5 block text-[13px] font-semibold text-mirage">Outcome</label>
              <select
                id="review-result"
                value={reviewResult}
                onChange={(e) => setReviewResult(e.target.value)}
                className="w-full rounded-xl border border-line bg-white px-3 py-2.5 text-[13px] text-navy focus:border-secondary focus:outline-none focus:ring-2 focus:ring-secondary/20"
              >
                {REVIEW_RESULTS.map((r) => (
                  <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="review-remarks" className="mb-1.5 block text-[13px] font-semibold text-mirage">Remarks (optional)</label>
              <textarea
                id="review-remarks"
                value={reviewRemarks}
                onChange={(e) => setReviewRemarks(e.target.value)}
                rows={3}
                placeholder="Notes recorded with the review…"
                className="w-full rounded-xl border border-line bg-white px-3 py-2.5 text-[13px] text-navy placeholder:text-muted focus:border-secondary focus:outline-none focus:ring-2 focus:ring-secondary/20"
              />
            </div>
            <div className="flex items-start gap-2 rounded-xl bg-info-soft/40 p-3">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-secondary" aria-hidden="true" />
              <p className="text-[12px] text-muted">
                The review is recorded on this entry and a separate activity log entry is created. The original record is never modified.
              </p>
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
              <LoadingButton isLoading={reviewBusy} onClick={handleReviewAlert} disabled={reviewBusy}>
                Save Review
              </LoadingButton>
            </div>
          </div>
        )}
      </ResidentModal>

      <ResidentModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        labelledBy="add-user-title"
        title="Add User"
        maxWidthClass="max-w-lg"
      >
        <div className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={() => setAddMethod("link")}
              className={`flex-1 rounded-xl border px-4 py-2.5 text-[13px] font-semibold transition-colors ${
                addMethod === "link" ? "border-secondary bg-info-soft text-secondary" : "border-line text-muted hover:bg-alt"
              }`}
            >
              Link existing user
            </button>
            <button
              type="button"
              onClick={() => setAddMethod("signup")}
              className={`flex-1 rounded-xl border px-4 py-2.5 text-[13px] font-semibold transition-colors ${
                addMethod === "signup" ? "border-secondary bg-info-soft text-secondary" : "border-line text-muted hover:bg-alt"
              }`}
            >
              Create new account
            </button>
          </div>

          {addMethod === "link" ? (
            <>
              <p className="text-[13px] text-muted">
                For officials already created in Supabase Dashboard (Authentication → Users), paste the auth UUID. The account is linked and
                the role is assigned immediately.
              </p>
              <div>
                <label htmlFor="add-uuid" className="mb-1.5 block text-[13px] font-semibold text-mirage">Auth user UUID</label>
                <input
                  id="add-uuid"
                  type="text"
                  value={addForm.uuid}
                  onChange={(e) => setAddForm((f) => ({ ...f, uuid: e.target.value }))}
                  placeholder="Paste the user UUID"
                  className="w-full rounded-xl border border-line bg-white px-3 py-2.5 text-[13px] text-navy placeholder:text-muted focus:border-secondary focus:outline-none focus:ring-2 focus:ring-secondary/20"
                />
              </div>
            </>
          ) : (
            <>
              <p className="text-[13px] text-muted">
                Creates a new account with the assigned role. If email confirmation is enabled, the user must confirm before signing in.
                For durable official accounts, creating the user in Supabase Dashboard first is recommended.
              </p>
              <div>
                <label htmlFor="add-email" className="mb-1.5 block text-[13px] font-semibold text-mirage">Email</label>
                <input
                  id="add-email"
                  type="email"
                  value={addForm.email}
                  onChange={(e) => setAddForm((f) => ({ ...f, email: e.target.value }))}
                  placeholder="user@barangayabuno.ph"
                  className="w-full rounded-xl border border-line bg-white px-3 py-2.5 text-[13px] text-navy placeholder:text-muted focus:border-secondary focus:outline-none focus:ring-2 focus:ring-secondary/20"
                />
              </div>
              <div>
                <label htmlFor="add-password" className="mb-1.5 block text-[13px] font-semibold text-mirage">Temporary password</label>
                <input
                  id="add-password"
                  type="password"
                  value={addForm.password}
                  onChange={(e) => setAddForm((f) => ({ ...f, password: e.target.value }))}
                  placeholder="At least 6 characters"
                  className="w-full rounded-xl border border-line bg-white px-3 py-2.5 text-[13px] text-navy placeholder:text-muted focus:border-secondary focus:outline-none focus:ring-2 focus:ring-secondary/20"
                />
              </div>
            </>
          )}

          <div>
            <label htmlFor="add-display-name" className="mb-1.5 block text-[13px] font-semibold text-mirage">Display name</label>
            <input
              id="add-display-name"
              type="text"
              value={addForm.displayName}
              onChange={(e) => setAddForm((f) => ({ ...f, displayName: e.target.value }))}
              placeholder="Juan Dela Cruz"
              className="w-full rounded-xl border border-line bg-white px-3 py-2.5 text-[13px] text-navy placeholder:text-muted focus:border-secondary focus:outline-none focus:ring-2 focus:ring-secondary/20"
            />
          </div>
          <div>
            <label htmlFor="add-role" className="mb-1.5 block text-[13px] font-semibold text-mirage">Role</label>
            <select
              id="add-role"
              value={addForm.role}
              onChange={(e) => setAddForm((f) => ({ ...f, role: e.target.value }))}
              className="w-full rounded-xl border border-line bg-white px-3 py-2.5 text-[13px] text-navy focus:border-secondary focus:outline-none focus:ring-2 focus:ring-secondary/20"
            >
              {MANAGEABLE_ROLES.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </div>

          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={() => setAddOpen(false)}
              disabled={addBusy}
              className="inline-flex h-11 items-center justify-center rounded-full border border-line px-5 text-sm font-semibold text-mirage transition-colors hover:bg-alt disabled:opacity-60"
            >
              Cancel
            </button>
            <LoadingButton isLoading={addBusy} onClick={handleAddUser} disabled={addBusy}>
              <UserPlus className="h-4 w-4" aria-hidden="true" />
              Add User
            </LoadingButton>
          </div>
        </div>
      </ResidentModal>
    </div>
  );
}
