"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, FileText, TableProperties } from "lucide-react";
import { RESIDENT_ROUTES, residentComplaintStatus } from "@/lib/constants";
import useResidentComplaints from "@/hooks/useResidentComplaints";
import StatusBadge from "@/components/shared/StatusBadge";
import { formatResidentDateShort } from "@/lib/residentDates";
import {
  latestResidentUpdate,
  residentCategory,
  residentUrgency,
} from "@/lib/residentCase";
import { residentComplaintRoute } from "@/lib/residentRoutes";

/**
 * The three most recent complaints, each one a link straight to its own
 * detail page.
 *
 * The whole card is the target so a resident never has to find a small
 * "View" control, and the trailing arrow is decorative — it sits inside
 * the same link rather than beside it, which is what keeps the card one
 * tab stop with one destination instead of two competing clicks.
 */
export default function RecentComplaints() {
  const router = useRouter();
  const {
    complaints,
    loading,
    caseStatusesByComplaint,
    hearingsByComplaint,
    documentsByComplaint,
  } = useResidentComplaints();

  const recent = useMemo(() => complaints.slice(0, 3), [complaints]);

  const updates = useMemo(() => {
    const map = new Map();
    for (const complaint of recent) {
      map.set(
        complaint.id,
        latestResidentUpdate(complaint, {
          caseStatuses: caseStatusesByComplaint[complaint.id] ?? [],
          hearings: hearingsByComplaint[complaint.id] ?? [],
          documents: documentsByComplaint[complaint.id] ?? [],
        })
      );
    }
    return map;
  }, [recent, caseStatusesByComplaint, hearingsByComplaint, documentsByComplaint]);

  return (
    <section
      aria-labelledby="recent-complaints-heading"
      className="flex flex-col rounded-2xl border border-line bg-white dark:bg-alt p-5 shadow-[0_1px_2px_rgba(11,33,68,0.06)]"
    >
      <header className="flex items-center justify-between gap-3">
        <h2
          id="recent-complaints-heading"
          className="font-heading text-base font-semibold tracking-tight text-navy dark:text-secondary"
        >
          Recent Complaints
        </h2>
        <span className="rounded-full bg-alt px-3 py-1 text-[11px] font-semibold text-secondary">
          {recent.length} of {complaints.length}
        </span>
      </header>

      <p className="mt-1 text-[13px] text-muted">
        Select a complaint to open its full details.
      </p>

      {loading ? (
        <div aria-busy="true" aria-label="Loading complaints" className="mt-4 space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl border border-line bg-alt/40" />
          ))}
        </div>
      ) : recent.length === 0 ? (
        <div className="mt-6 flex flex-col items-center justify-center rounded-xl border border-dashed border-line bg-alt/40 px-4 py-10 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-alt text-secondary">
            <FileText className="h-5 w-5" aria-hidden="true" />
          </span>
          <p className="mt-3 text-sm font-semibold text-mirage">No complaints yet</p>
          <p className="mt-1 text-[13px] text-muted">
            Submit your first complaint and it will appear here.
          </p>
        </div>
      ) : (
        <ul className="mt-4 flex flex-col gap-3" role="list">
          {recent.map((complaint) => {
            const caseNo = complaint.reference_number || complaint.id;
            const category = residentCategory(complaint);
            const urgency = residentUrgency(complaint);
            const normalizedStatus = residentComplaintStatus(
              complaint.current_status || complaint.status
            );
            const submitted = formatResidentDateShort(complaint.submitted_at);
            const latest = updates.get(complaint.id);
            const href = residentComplaintRoute(complaint.id);

            return (
              <li key={complaint.id}>
                <button
                  type="button"
                  onClick={() => router.push(href)}
                  aria-label={`Open complaint ${caseNo}: ${complaint.title}. Current status ${normalizedStatus}.`}
                  className="w-full rounded-xl border border-line bg-white dark:bg-canvas p-4 text-left transition-colors hover:border-secondary/50 hover:bg-alt/50 focus-visible:outline-2 focus-visible:outline-secondary"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[15px] font-semibold text-navy dark:text-secondary">
                        {complaint.title}
                      </p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted">
                        <span className="inline-flex items-center gap-1.5 font-medium text-secondary">
                          <TableProperties className="h-3.5 w-3.5" aria-hidden="true" />
                          {caseNo}
                        </span>
                        <span className="inline-block h-1 w-1 rounded-full bg-muted/40" aria-hidden="true" />
                        <span>{category}</span>
                        <span className="inline-block h-1 w-1 rounded-full bg-muted/40" aria-hidden="true" />
                        <span>{urgency}</span>
                        {submitted ? (
                          <>
                            <span className="inline-block h-1 w-1 rounded-full bg-muted/40" aria-hidden="true" />
                            <span>Submitted {submitted}</span>
                          </>
                        ) : null}
                      </div>
                      {latest ? (
                        <p className="mt-2 line-clamp-2 text-[13px] leading-relaxed text-mirage">
                          {latest.label}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-3 sm:flex-col sm:items-end">
                      <StatusBadge label={normalizedStatus} />
                      <ArrowRight
                        className="h-4 w-4 text-muted/50 transition-colors group-hover:text-secondary sm:rotate-0"
                        aria-hidden="true"
                      />
                    </div>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {complaints.length > 3 ? (
        <Link
          href={RESIDENT_ROUTES.complaints}
          className="mt-4 inline-flex items-center justify-center gap-2 rounded-full border border-line px-5 py-2.5 text-[13px] font-semibold text-secondary transition-colors hover:border-secondary hover:bg-info-soft"
        >
          View all complaints
        </Link>
      ) : null}
    </section>
  );
}
