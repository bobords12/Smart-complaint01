"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  FileText,
  Gavel,
  Inbox,
  Loader2,
  ScrollText,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { getRoleProfileDisplay } from "@/lib/roleProfileDisplay";
import {
  formatDate,
  formatDateTime,
  formatTime,
  getMyAssignments,
  isLeadRole,
  readClock,
} from "@/repositories/luponRepository";
import { LUPON_ROUTES } from "@/lib/constants";

/* ── Small pieces ────────────────────────────────────────── */

function StatCard({ icon: Icon, value, label, tone = "default", busy }) {
  const tones = {
    default: "text-secondary",
    warning: "text-warning",
    success: "text-success",
    critical: "text-critical",
  };
  return (
    <div className="rounded-2xl border border-line bg-white p-5 shadow-sm">
      <div className="flex items-center gap-3">
        <span
          className={`flex h-11 w-11 items-center justify-center rounded-xl bg-alt ${tones[tone]}`}
        >
          {busy ? (
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
          ) : (
            <Icon className="h-5 w-5" aria-hidden="true" />
          )}
        </span>
        <div className="min-w-0">
          <p className="font-heading text-2xl font-bold tracking-tight text-navy">
            {busy ? "—" : value}
          </p>
          <p className="truncate text-[13px] text-muted">{label}</p>
        </div>
      </div>
    </div>
  );
}

function EmptyState({ icon: Icon, title, message, action }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-line bg-white px-6 py-12 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-alt text-muted">
        <Icon className="h-6 w-6" aria-hidden="true" />
      </span>
      <h3 className="mt-4 font-heading text-base font-semibold text-navy">{title}</h3>
      <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-muted">{message}</p>
      {action}
    </div>
  );
}

function ClockBadge({ assignment }) {
  const clock = readClock(assignment);
  if (!clock) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-alt px-2.5 py-1 text-[11px] font-semibold text-muted">
        <CalendarClock className="h-3 w-3" aria-hidden="true" />
        Not convened
      </span>
    );
  }
  const terminal = clock.status === "Concluded" || clock.status === "Terminated";
  const urgent = !terminal && clock.daysLeft !== null && clock.daysLeft <= 3;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${
        terminal
          ? "bg-alt text-muted"
          : urgent
            ? "bg-critical-soft text-critical"
            : "bg-secondary/10 text-secondary"
      }`}
    >
      <CalendarClock className="h-3 w-3" aria-hidden="true" />
      {clock.label}
    </span>
  );
}

function RoleBadge({ role }) {
  const key = String(role ?? "").toLowerCase();
  const styles = {
    chairperson: "bg-secondary/10 text-secondary",
    secretary: "bg-gold/20 text-navy",
    member: "bg-alt text-muted",
    alternate: "bg-alt text-muted",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold capitalize ${
        styles[key] ?? styles.member
      }`}
    >
      {key || "member"}
    </span>
  );
}

function statusTone(status) {
  const key = String(status ?? "").toLowerCase();
  if (key === "resolved" || key === "closed") return "success";
  if (key === "pending" || key === "under_review") return "warning";
  return "default";
}

/* ── Dashboard ───────────────────────────────────────────── */

export default function LuponDashboard() {
  const { user } = useAuth();
  const displayName = user?.role === "lupon" ? getRoleProfileDisplay(user.role)?.primary : null;

  const [assignments, setAssignments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setAssignments(await getMyAssignments());
    } catch (err) {
      setError(err.message);
      setAssignments([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await load();
      if (cancelled) return;
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  // Realtime: another member or an official acting on the same
  // case should show up without a manual refresh. RLS applies to
  // realtime too, so this cannot leak rows either.
  useEffect(() => {
    // The client import is async, so this effect can be torn down
    // before `channel` is ever assigned. The cleanup then sees
    // undefined, unsubscribes nothing, and leaves the first
    // subscription alive — after which the remount calls .on() on a
    // channel that is already subscribed, and Supabase rejects it
    // with an unhandled "cannot add postgres_changes callbacks ...
    // after subscribe()". The flag makes teardown-before-subscribe a
    // clean no-op instead of a leak.
    let disposed = false;
    let channel;
    (async () => {
      const { createClient } = await import("@/lib/supabase/client");
      if (disposed) return;
      const supabase = createClient();
      channel = supabase
        .channel("lupon-dash-assignments")
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "lupon_panels" },
          () => load()
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "pangkat_trackers" },
          () => load()
        )
        .subscribe();
    })();
    return () => {
      disposed = true;
      if (channel) channel.unsubscribe();
    };
  }, [load]);

  const derived = useMemo(() => {
    const open = assignments.filter(
      (a) => a.outcome_type === null || a.outcome_type === undefined
    );
    const active = assignments.filter(
      (a) => a.tracker_status === "Active" && !a.outcome_type
    );
    const upcoming = assignments
      .filter((a) => a.next_hearing_id)
      .sort(
        (a, b) =>
          new Date(`${a.next_hearing_date}T00:00:00`) -
          new Date(`${b.next_hearing_date}T00:00:00`)
      );
    const needsMinutes = assignments.filter(
      (a) =>
        a.minutes_status &&
        a.minutes_status !== "Final" &&
        (a.minutes_status === "Submitted" || a.minutes_status === "Approved")
    );
    const leads = assignments.filter((a) => isLeadRole(a.my_role));
    return { open, active, upcoming, needsMinutes, leads };
  }, [assignments]);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {/* Header */}
      <header>
        <p className="text-[13px] font-semibold uppercase tracking-wider text-secondary">
          Lupon Member Portal
        </p>
        <h1 className="mt-1 font-heading text-2xl font-bold tracking-tight text-navy sm:text-3xl">
          Welcome back, {displayName}
        </h1>
        <p className="mt-1.5 text-sm text-muted">
          Here is where your assigned Pangkat cases stand today.
        </p>
      </header>

      {error ? (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-2xl border border-critical/30 bg-critical-soft p-4"
        >
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-critical" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-critical">
              We could not load your assignments
            </p>
            <p className="mt-0.5 text-[13px] text-muted">{error}</p>
          </div>
          <button
            type="button"
            onClick={load}
            className="shrink-0 rounded-lg border border-critical/30 px-3 py-1.5 text-[13px] font-semibold text-critical transition-colors hover:bg-critical/10"
          >
            Retry
          </button>
        </div>
      ) : null}

      {/* Stats */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={FileText}
          value={assignments.length}
          label="Assigned cases"
          busy={loading}
        />
        <StatCard
          icon={Gavel}
          value={derived.active.length}
          label="Active Pangkat"
          tone="success"
          busy={loading}
        />
        <StatCard
          icon={CalendarClock}
          value={derived.upcoming.length}
          label="Upcoming hearings"
          busy={loading}
        />
        <StatCard
          icon={ScrollText}
          value={derived.needsMinutes.length}
          label="Minutes need action"
          tone={derived.needsMinutes.length > 0 ? "warning" : "default"}
          busy={loading}
        />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {/* Upcoming hearings */}
        <section
          aria-labelledby="lupon-upcoming"
          className="rounded-2xl border border-line bg-white p-6 shadow-sm lg:col-span-2"
        >
          <div className="flex items-center justify-between gap-3">
            <h2
              id="lupon-upcoming"
              className="flex items-center gap-2 font-heading text-base font-semibold tracking-tight text-navy"
            >
              <CalendarClock className="h-5 w-5 text-gold" aria-hidden="true" />
              Upcoming Hearings
            </h2>
            <Link
              href={LUPON_ROUTES.schedule}
              className="inline-flex items-center gap-1 text-[13px] font-semibold text-secondary hover:underline"
            >
              Full schedule
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </div>

          {derived.upcoming.length === 0 ? (
            <div className="mt-4">
              <EmptyState
                icon={CalendarClock}
                title="No hearings scheduled"
                message="When the Pangkat sets a hearing for one of your cases, it will appear here with the date, time and venue."
              />
            </div>
          ) : (
            <ul className="mt-4 divide-y divide-line">
              {derived.upcoming.slice(0, 4).map((a) => (
                <li key={a.next_hearing_id} className="py-3 first:pt-0 last:pb-0">
                  <Link
                    href={LUPON_ROUTES.caseDetail(a.complaint_id)}
                    className="group flex flex-wrap items-center justify-between gap-3 rounded-xl p-2 transition-colors hover:bg-alt/60 focus-visible:outline-2 focus-visible:outline-secondary"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2 text-[13px] font-semibold text-navy">
                        <span className="text-secondary">{a.reference_number}</span>
                        <span className="truncate">{a.title}</span>
                      </p>
                      <p className="mt-1 text-[13px] text-muted">
                        {formatDate(a.next_hearing_date)} ·{" "}
                        {formatTime(a.next_hearing_time)}
                      </p>
                    </div>
                    <ArrowRight
                      className="h-4 w-4 shrink-0 text-muted transition-transform group-hover:translate-x-0.5"
                      aria-hidden="true"
                    />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* My role */}
        <section
          aria-labelledby="lupon-role"
          className="rounded-2xl border border-line bg-white p-6 shadow-sm"
        >
          <h2
            id="lupon-role"
            className="flex items-center gap-2 font-heading text-base font-semibold tracking-tight text-navy"
          >
            <CheckCircle2 className="h-5 w-5 text-gold" aria-hidden="true" />
            My Assignments
          </h2>

          {assignments.length === 0 ? (
            <div className="mt-4">
              <EmptyState
                icon={Inbox}
                title="No cases assigned yet"
                message="You will see a case here once the Barangay Captain assigns you to a Pangkat. Nothing else in the system is visible to you until then."
              />
            </div>
          ) : (
            <ul className="mt-4 space-y-2.5">
              {assignments.slice(0, 5).map((a) => (
                <li key={a.complaint_id}>
                  <Link
                    href={LUPON_ROUTES.caseDetail(a.complaint_id)}
                    className="block rounded-xl border border-line p-3 transition-colors hover:border-secondary/40 hover:bg-alt/50 focus-visible:outline-2 focus-visible:outline-secondary"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[12px] font-semibold text-secondary">
                        {a.reference_number}
                      </span>
                      <RoleBadge role={a.my_role} />
                    </div>
                    <p className="mt-1 truncate text-[13px] font-medium text-navy">
                      {a.title}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <ClockBadge assignment={a} />
                      {a.outcome_type ? (
                        <span className="rounded-full bg-success/10 px-2.5 py-1 text-[11px] font-semibold text-success">
                          {a.outcome_type}
                        </span>
                      ) : null}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}

          {derived.leads.length > 0 ? (
            <p className="mt-4 rounded-xl bg-alt p-3 text-[12px] leading-relaxed text-muted">
              You are the Chairperson or Secretary on{" "}
              <strong className="font-semibold text-navy">
                {derived.leads.length} case{derived.leads.length === 1 ? "" : "s"}
              </strong>
              . Only the Secretary can finalize the minutes.
            </p>
          ) : null}
        </section>
      </div>

      {/* Case table */}
      {assignments.length > 0 ? (
        <section
          aria-labelledby="lupon-cases"
          className="overflow-hidden rounded-2xl border border-line bg-white shadow-sm"
        >
          <div className="border-b border-line px-6 py-4">
            <h2
              id="lupon-cases"
              className="font-heading text-base font-semibold tracking-tight text-navy"
            >
              Case Status
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-[13px]">
              <thead className="bg-alt/60 text-[11px] uppercase tracking-wider text-muted">
                <tr>
                  <th scope="col" className="px-6 py-3 font-semibold">Reference</th>
                  <th scope="col" className="px-6 py-3 font-semibold">Case</th>
                  <th scope="col" className="px-6 py-3 font-semibold">My Role</th>
                  <th scope="col" className="px-6 py-3 font-semibold">Pangkat</th>
                  <th scope="col" className="px-6 py-3 font-semibold">Status</th>
                  <th scope="col" className="px-6 py-3 font-semibold">
                    <span className="sr-only">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {assignments.map((a) => (
                  <tr key={a.complaint_id} className="hover:bg-alt/40">
                    <td className="whitespace-nowrap px-6 py-3.5 font-semibold text-secondary">
                      {a.reference_number}
                    </td>
                    <td className="max-w-[240px] truncate px-6 py-3.5 text-navy">
                      {a.title}
                    </td>
                    <td className="px-6 py-3.5"><RoleBadge role={a.my_role} /></td>
                    <td className="whitespace-nowrap px-6 py-3.5">
                      <ClockBadge assignment={a} />
                    </td>
                    <td className="whitespace-nowrap px-6 py-3.5">
                      <span
                        className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                          statusTone(a.current_status) === "success"
                            ? "bg-success/10 text-success"
                            : statusTone(a.current_status) === "warning"
                              ? "bg-warning/15 text-navy"
                              : "bg-alt text-muted"
                        }`}
                      >
                        {a.current_status?.replace(/_/g, " ") ?? "—"}
                      </span>
                    </td>
                    <td className="px-6 py-3.5 text-right">
                      <Link
                        href={LUPON_ROUTES.caseDetail(a.complaint_id)}
                        className="inline-flex items-center gap-1 font-semibold text-secondary hover:underline"
                      >
                        Open
                        <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}
