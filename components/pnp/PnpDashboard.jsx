"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ClipboardList,
  HelpCircle,
  Inbox,
  Loader2,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { getRoleProfileDisplay } from "@/lib/roleProfileDisplay";
import { fetchMyReferrals } from "@/repositories/pnpReferralRepository";
import {
  PNP_OFFERED_TRANSITIONS,
  formatDate,
  formatDateTime,
  referralAge,
} from "@/lib/pnpReferral";
import { PNP_ROUTES } from "@/lib/constants";
import {
  BoundaryNote,
  EmptyState,
  LoadingBlock,
  PnpPageHeader,
  ReferralStatusBadge,
  SafetyConcernFlag,
  SetupMissingNotice,
  StatCard,
} from "./PnpPrimitives";

/**
 * The PNP dashboard.
 *
 * Everything on this page is derived from the officer's own
 * assignments. There is no system-wide count, no "total referred
 * cases" and no unassigned queue: an officer who is not assigned to
 * a referral cannot see that it exists, so a dashboard that tried to
 * count them would be counting rows the database refuses to hand
 * over. The numbers here are therefore "yours", and the copy says so.
 */

const STATUS_GROUPS = [
  {
    key: "new",
    label: "Awaiting acknowledgement",
    statuses: ["referred"],
    icon: Inbox,
    tone: "warning",
  },
  {
    key: "active",
    label: "In progress",
    statuses: ["acknowledged", "in_progress", "information_submitted"],
    icon: ClipboardList,
    tone: "default",
  },
  {
    key: "waiting",
    label: "Waiting on the barangay",
    statuses: ["needs_information"],
    icon: HelpCircle,
    tone: "critical",
  },
  {
    key: "done",
    label: "Completed",
    statuses: ["completed", "closed", "returned", "declined"],
    icon: CheckCircle2,
    tone: "success",
  },
];

export default function PnpDashboard() {
  const { user } = useAuth();
  const [referrals, setReferrals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);

  const displayName = user?.role === "pnp_officer" ? getRoleProfileDisplay(user.role)?.primary : null;

  const load = useCallback(async () => {
    const result = await fetchMyReferrals({ limit: 200 });
    setReferrals(result.referrals);
    setUnavailable(result.unavailable);
    setLoading(false);
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

  const counts = useMemo(() => {
    const map = {};
    for (const group of STATUS_GROUPS) {
      map[group.key] = referrals.filter((r) => group.statuses.includes(r.status)).length;
    }
    map.safety = referrals.filter((r) => r.has_safety_concern).length;
    return map;
  }, [referrals]);

  /**
   * The next thing this officer can actually do. A referral with an
   * offered transition is a referral that is waiting on them; one
   * without is either done or blocked on the barangay.
   */
  const actionable = useMemo(
    () =>
      referrals
        .filter((r) => (PNP_OFFERED_TRANSITIONS[r.status] || []).length > 0)
        .sort((a, b) => {
          if (a.has_safety_concern !== b.has_safety_concern) {
            return a.has_safety_concern ? -1 : 1;
          }
          return new Date(a.referred_at) - new Date(b.referred_at);
        }),
    [referrals]
  );

  const recent = useMemo(
    () =>
      [...referrals]
        .sort((a, b) => new Date(b.referred_at) - new Date(a.referred_at))
        .slice(0, 5),
    [referrals]
  );

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PnpPageHeader
        title={`Welcome, ${displayName || "Officer"}`}
        subtitle="These are the barangay referrals currently assigned to you. You will see a referral appear here only after the Captain or OIC assigns it to you."
      />

      {unavailable ? <SetupMissingNotice /> : null}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {STATUS_GROUPS.map((group) => (
          <StatCard
            key={group.key}
            icon={group.icon}
            value={loading ? "—" : counts[group.key]}
            label={group.label}
            tone={group.tone}
            busy={loading}
          />
        ))}
      </div>

      {loading ? (
        <LoadingBlock label="Loading your assigned referrals…" />
      ) : referrals.length === 0 && !unavailable ? (
        <EmptyState
          icon={Inbox}
          title="No referrals assigned to you yet"
          message="When the barangay refers a case to the PNP and assigns it to you, it will appear here with its summary and the evidence the Captain chose to share."
          action={
            <Link
              href={PNP_ROUTES.referrals}
              className="inline-flex min-h-[40px] items-center gap-2 rounded-xl bg-secondary px-4 text-[13px] font-semibold text-white transition-opacity hover:opacity-90"
            >
              Open Referred Cases
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          }
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-5">
          {/* Actionable */}
          <div className="lg:col-span-3">
            <section className="rounded-2xl border border-line bg-white shadow-sm">
              <div className="border-b border-line px-5 py-4">
                <h2 className="font-heading text-base font-semibold text-navy">
                  Waiting on you
                </h2>
                <p className="mt-0.5 text-[13px] leading-relaxed text-muted">
                  Referrals that are assigned to you and have an action available. A referral
                  that is waiting on the barangay is not listed here.
                </p>
              </div>
              <div className="p-3">
                {actionable.length === 0 ? (
                  <p className="px-2 py-8 text-center text-sm text-muted">
                    Nothing is waiting on you right now.
                  </p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {actionable.slice(0, 6).map((referral) => (
                      <li key={referral.id}>
                        <Link
                          href={PNP_ROUTES.referralDetail(referral.id)}
                          className="flex flex-col gap-2 rounded-xl border border-line p-3.5 transition-colors hover:border-secondary/50 focus-visible:outline-2 focus-visible:outline-secondary sm:flex-row sm:items-center sm:justify-between"
                        >
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-mono text-[12px] font-semibold text-secondary">
                                {referral.referral_reference}
                              </span>
                              <ReferralStatusBadge status={referral.status} size="sm" />
                              {referral.has_safety_concern ? (
                                <SafetyConcernFlag compact />
                              ) : null}
                            </div>
                            <p className="mt-1.5 line-clamp-1 text-sm text-navy">
                              {referral.summary}
                            </p>
                            <p className="mt-0.5 text-[12px] text-muted">
                              Referred {formatDate(referral.referred_at)} ·{" "}
                              {referralAge(referral.referred_at)} old
                            </p>
                          </div>
                          <span className="shrink-0 text-[13px] font-semibold text-secondary">
                            Open
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          </div>

          {/* Recent + boundary */}
          <div className="space-y-6 lg:col-span-2">
            <section className="rounded-2xl border border-line bg-white shadow-sm">
              <div className="border-b border-line px-5 py-4">
                <h2 className="font-heading text-base font-semibold text-navy">
                  Recently referred
                </h2>
              </div>
              <ul className="divide-y divide-line">
                {recent.length === 0 ? (
                  <li className="px-5 py-6 text-sm text-muted">No referrals yet.</li>
                ) : (
                  recent.map((referral) => (
                    <li key={referral.id}>
                      <Link
                        href={PNP_ROUTES.referralDetail(referral.id)}
                        className="flex flex-col gap-1.5 px-5 py-3.5 transition-colors hover:bg-alt/40 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-secondary"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono text-[12px] font-semibold text-secondary">
                            {referral.referral_reference}
                          </span>
                          <ReferralStatusBadge status={referral.status} size="sm" />
                        </div>
                        <p className="line-clamp-1 text-[13px] text-navy">
                          {referral.summary}
                        </p>
                        <p className="text-[11px] text-muted">
                          {formatDateTime(referral.referred_at)}
                        </p>
                      </Link>
                    </li>
                  ))
                )}
              </ul>
              <div className="border-t border-line px-5 py-3">
                <Link
                  href={PNP_ROUTES.referrals}
                  className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-secondary hover:text-navy"
                >
                  View all assigned referrals
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Link>
              </div>
            </section>

            {counts.safety > 0 ? (
              <div className="rounded-2xl border border-critical/30 bg-critical-soft p-5">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-critical" aria-hidden="true" />
                  <div>
                    <p className="font-heading text-sm font-semibold text-navy">
                      {counts.safety} referral{counts.safety === 1 ? "" : "s"} flagged as a safety
                      concern
                    </p>
                    <p className="mt-1 text-[13px] leading-relaxed text-muted">
                      The flag is set by the referring official as a triage marker. It is not a
                      finding, and this system does not record police determinations.
                    </p>
                  </div>
                </div>
              </div>
            ) : null}

            <BoundaryNote title="Why you do not see everything">
              <p>
                This portal shows only the referrals assigned to you, and on each one only the
                summary and the evidence files the Captain explicitly shared. The resident&apos;s
                full complaint, the barangay&apos;s internal notes, its blotters, and other
                officers&apos; cases are not readable here &mdash; that is enforced in the
                database, not hidden in the interface.
              </p>
            </BoundaryNote>
          </div>
        </div>
      )}

      {loading ? (
        <p className="sr-only" aria-live="polite">
          <Loader2 aria-hidden="true" /> Loading
        </p>
      ) : null}
    </div>
  );
}
