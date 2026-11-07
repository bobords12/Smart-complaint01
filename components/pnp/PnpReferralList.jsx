"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { FileText, Inbox, RotateCcw, Search } from "lucide-react";
import { fetchMyReferrals } from "@/repositories/pnpReferralRepository";
import {
  ACTIVE_REFERRAL_STATUSES,
  REFERAL_STATUSES,
  formatDate,
  humanize,
  referralAge,
} from "@/lib/pnpReferral";
import { PNP_ROUTES } from "@/lib/constants";
import {
  EmptyState,
  LoadingBlock,
  PnpPageHeader,
  ReferralStatusBadge,
  SafetyConcernFlag,
  SetupMissingNotice,
} from "./PnpPrimitives";

/**
 * The officer's referral queue.
 *
 * Filtering happens in two places on purpose. The status filter and
 * the search term are sent to Postgres because they narrow the query;
 * they never widen it. The grouping is client-side because it only
 * reorganises rows the officer was already entitled to. Neither the
 * status list nor the search box can produce a referral the officer
 * is not assigned to.
 */

const FILTERS = [
  { key: "all", label: "All" },
  { key: "active", label: "Open" },
  { key: "referred", label: "Awaiting acknowledgement" },
  { key: "in_progress", label: "In progress" },
  { key: "needs_information", label: "Waiting on barangay" },
  { key: "completed", label: "Completed" },
  { key: "closed", label: "Closed / ended" },
];

function matchesFilter(referral, key) {
  if (key === "all") return true;
  if (key === "active") return ACTIVE_REFERRAL_STATUSES.includes(referral.status);
  return referral.status === key;
}

export default function PnpReferralList() {
  const [referrals, setReferrals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [filter, setFilter] = useState("all");
  const [term, setTerm] = useState("");
  const [appliedTerm, setAppliedTerm] = useState("");

  const load = useCallback(async (status) => {
    const result = await fetchMyReferrals({
      status: status || null,
      search: appliedTerm || null,
      limit: 200,
    });
    setReferrals(result.referrals);
    setUnavailable(result.unavailable);
    setLoading(false);
  }, [appliedTerm]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await load(filter === "active" || filter === "all" ? null : filter);
      if (cancelled) return;
    })();
    return () => {
      cancelled = true;
    };
  }, [load, filter]);

  const onSubmitSearch = (event) => {
    event.preventDefault();
    setAppliedTerm(term.trim());
  };

  const visible = useMemo(
    () =>
      referrals
        .filter((r) => matchesFilter(r, filter))
        .sort((a, b) => new Date(b.referred_at) - new Date(a.referred_at)),
    [referrals, filter]
  );

  const total = referrals.length;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PnpPageHeader
        title="Referred Cases"
        subtitle="Every formal referral assigned to you. If a case you expected is not here, it has not been assigned to you yet — ask the Captain to assign it."
      />

      {unavailable ? <SetupMissingNotice /> : null}

      {/* Filters */}
      <div className="space-y-3">
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {FILTERS.map((item) => {
            const active = filter === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setFilter(item.key)}
                aria-pressed={active}
                className={`min-h-[36px] shrink-0 rounded-full border px-3.5 text-[13px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary ${
                  active
                    ? "border-secondary bg-secondary text-white"
                    : "border-line bg-white text-muted hover:border-secondary/50 hover:text-navy"
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </div>

        <form onSubmit={onSubmitSearch} className="flex gap-2">
          <div className="relative flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
              aria-hidden="true"
            />
            <input
              type="search"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder="Search by referral reference or summary"
              aria-label="Search referrals"
              className="w-full rounded-xl border border-line bg-white py-2.5 pl-9 pr-3.5 text-sm text-navy outline-none transition-colors placeholder:text-muted/60 focus:border-secondary focus:ring-2 focus:ring-secondary/20"
            />
          </div>
          <button
            type="submit"
            className="min-h-[42px] shrink-0 rounded-xl bg-secondary px-4 text-[13px] font-semibold text-white transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary"
          >
            Search
          </button>
          {appliedTerm ? (
            <button
              type="button"
              onClick={() => {
                setTerm("");
                setAppliedTerm("");
              }}
              className="inline-flex min-h-[42px] shrink-0 items-center gap-1.5 rounded-xl border border-line bg-white px-3.5 text-[13px] font-semibold text-muted transition-colors hover:border-secondary/50 hover:text-navy"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              Clear
            </button>
          ) : null}
        </form>
      </div>

      {loading ? (
        <LoadingBlock label="Loading your referrals…" />
      ) : visible.length === 0 ? (
        total === 0 ? (
          <EmptyState
            icon={Inbox}
            title="No referrals assigned to you"
            message="Referrals appear here once the barangay assigns them to you. You will be notified when that happens."
            action={
              <Link
                href={PNP_ROUTES.dashboard}
                className="inline-flex min-h-[40px] items-center rounded-xl bg-secondary px-4 text-[13px] font-semibold text-white transition-opacity hover:opacity-90"
              >
                Back to Dashboard
              </Link>
            }
          />
        ) : (
          <EmptyState
            icon={FileText}
            title="Nothing matches this view"
            message="No assigned referral matches the current filter or search. Clear the search to see all of them."
            action={
              <button
                type="button"
                onClick={() => {
                  setFilter("all");
                  setTerm("");
                  setAppliedTerm("");
                }}
                className="inline-flex min-h-[40px] items-center rounded-xl border border-line bg-white px-4 text-[13px] font-semibold text-navy transition-colors hover:border-secondary/50"
              >
                Reset filters
              </button>
            }
          />
        )
      ) : (
        <>
          <p className="text-[13px] text-muted" aria-live="polite">
            Showing {visible.length} of {total} assigned referral
            {total === 1 ? "" : "s"}.
          </p>

          <ul className="flex flex-col gap-3">
            {visible.map((referral) => (
              <li key={referral.id}>
                <Link
                  href={PNP_ROUTES.referralDetail(referral.id)}
                  className="block rounded-2xl border border-line bg-white p-5 shadow-sm transition-colors hover:border-secondary/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[13px] font-semibold text-secondary">
                          {referral.referral_reference}
                        </span>
                        {/* The barangay case number, snapshotted onto the
                            referral by migration 32. It is the number a
                            police report is filed under, so it sits beside
                            the referral reference rather than being
                            discoverable only on the detail page. */}
                        {referral.complaint_reference ? (
                          <span className="font-mono text-[12px] text-muted">
                            Case {referral.complaint_reference}
                          </span>
                        ) : null}
                        <ReferralStatusBadge status={referral.status} />
                        {referral.has_safety_concern ? <SafetyConcernFlag /> : null}
                      </div>
                      <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-navy">
                        {referral.summary}
                      </p>
                      <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-muted">
                        <div className="flex gap-1.5">
                          <dt>Referred:</dt>
                          <dd className="font-medium text-navy">
                            {formatDate(referral.referred_at)}
                          </dd>
                        </div>
                        <div className="flex gap-1.5">
                          <dt>Age:</dt>
                          <dd className="font-medium text-navy">
                            {referralAge(referral.referred_at)}
                          </dd>
                        </div>
                        {referral.incident_date ? (
                          <div className="flex gap-1.5">
                            <dt>Incident:</dt>
                            <dd className="font-medium text-navy">
                              {formatDate(referral.incident_date)}
                            </dd>
                          </div>
                        ) : null}
                        {referral.incident_location ? (
                          <div className="flex gap-1.5">
                            <dt>Location:</dt>
                            <dd className="font-medium text-navy">
                              {referral.incident_location}
                            </dd>
                          </div>
                        ) : null}
                        <div className="flex gap-1.5">
                          <dt>Basis:</dt>
                          <dd className="font-medium text-navy">
                            {humanize(referral.referral_basis)}
                          </dd>
                        </div>
                      </dl>
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}

      {/* Legend, so a status is never a mystery word. */}
      <details className="rounded-2xl border border-line bg-white p-4">
        <summary className="cursor-pointer text-[13px] font-semibold text-navy">
          What the referral statuses mean
        </summary>
        <dl className="mt-3 grid gap-2 sm:grid-cols-2">
          {REFERAL_STATUSES.map((status) => (
            <div key={status} className="flex items-start gap-2.5">
              <dt className="shrink-0">
                <ReferralStatusBadge status={status} size="sm" />
              </dt>
              <dd className="text-[12px] leading-relaxed text-muted">
                {STATUS_MEANING[status]}
              </dd>
            </div>
          ))}
        </dl>
      </details>
    </div>
  );
}

const STATUS_MEANING = {
  referred: "The barangay handed this over. No officer has taken it on yet.",
  acknowledged: "An officer has taken responsibility for this referral.",
  in_progress: "Work is underway on the PNP side.",
  needs_information: "The PNP asked the barangay a question and is waiting for the answer.",
  information_submitted: "The barangay answered; the PNP is reviewing it.",
  completed: "The PNP finished its own handling of this referral.",
  returned: "Returned to the barangay. The barangay decides what happens next.",
  declined: "The PNP declined to take this on. Only the barangay can record this.",
  closed: "Finished and closed. This is the final state.",
};
