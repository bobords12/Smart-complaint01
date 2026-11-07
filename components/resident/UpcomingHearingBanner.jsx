"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarDays, MapPin, FileText, CalendarOff } from "lucide-react";
import useResidentComplaints from "@/hooks/useResidentComplaints";
import {
  formatResidentDate,
  formatResidentTime,
} from "@/lib/residentDates";
import {
  hearingSessionLabel,
  residentHearingStatus,
  selectNearestUpcomingHearing,
} from "@/lib/residentCase";
import { RESIDENT_SECTION, residentHearingRoute } from "@/lib/residentRoutes";
import { RESIDENT_ROUTES } from "@/lib/constants";

/**
 * The next session the resident actually has to attend.
 *
 * The banner used to take the first row whose status read "Upcoming",
 * which could be a date that had already passed, and it offered a
 * "Summons" button backed by hardcoded prototype data. A summons is the
 * document served on the respondent — it is never the complainant's
 * document — so the complainant's action here is the Notice of Hearing,
 * and only once one has actually been generated.
 */
export default function UpcomingHearingBanner() {
  const router = useRouter();
  const { hearings, documents, loading } = useResidentComplaints();

  const hearing = useMemo(() => selectNearestUpcomingHearing(hearings), [hearings]);

  /**
   * A Notice is offered only when a resident-visible copy really exists
   * for this session's complaint. Nothing is fabricated: if the barangay
   * has not generated one yet, the resident gets the plain hearing detail
   * link instead of a button that would open nothing.
   */
  const noticeDocument = useMemo(() => {
    if (!hearing) return null;
    return (
      documents.find(
        (documentRow) =>
          documentRow.complaint_id === hearing.complaint_id &&
          documentRow.document_type === "hearing_notice" &&
          documentRow.visibility === "resident_visible"
      ) ?? null
    );
  }, [hearing, documents]);

  if (loading && !hearing) return null;

  if (!hearing) {
    return (
      <section aria-labelledby="upcoming-hearing-title">
        <div className="flex flex-col items-start gap-3 rounded-[20px] border border-dashed border-line bg-white dark:bg-alt px-5 py-5 sm:flex-row sm:items-center sm:px-7">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-alt text-muted">
            <CalendarOff className="h-6 w-6" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <h2
              id="upcoming-hearing-title"
              className="font-heading text-base font-semibold tracking-tight text-navy dark:text-secondary"
            >
              No upcoming hearing scheduled.
            </h2>
            <p className="mt-1 text-[13px] leading-relaxed text-muted">
              You will be notified here and on your complaint the moment a
              session is set.
            </p>
          </div>
          <Link
            href={RESIDENT_ROUTES.hearings}
            className="inline-flex min-h-[40px] items-center gap-2 self-start rounded-full border border-line px-5 text-[13px] font-semibold text-navy dark:text-secondary transition-colors hover:border-secondary hover:bg-info-soft sm:self-center"
          >
            View Hearings
          </Link>
        </div>
      </section>
    );
  }

  const caseNo = hearing.complaints?.reference_number || "—";
  const complaintTitle = hearing.complaints?.title || "";
  const title = hearingSessionLabel(hearing, 0);
  const date = formatResidentDate(hearing.hearing_date);
  const time = formatResidentTime(hearing.hearing_time);
  const venue = hearing.venue || "Barangay Abuno Hall";
  const status = residentHearingStatus(hearing.status);

  const hasNotice = Boolean(noticeDocument);
  const href = hasNotice
    ? residentHearingRoute(hearing.id, RESIDENT_SECTION.notice)
    : residentHearingRoute(hearing.id);

  return (
    <section aria-labelledby="upcoming-hearing-title">
      <div className="relative overflow-hidden rounded-[20px] bg-navy p-5 text-white sm:p-7">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-secondary/40 blur-2xl"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-20 -left-10 h-52 w-52 rounded-full bg-action/30 blur-2xl"
        />

        <div className="relative flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex gap-4">
            <span className="hidden h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-secondary/70 sm:flex">
              <CalendarDays className="h-7 w-7 text-white" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-bold uppercase tracking-[0.16em] text-gold-soft">
                <span>Upcoming hearing · Case #{caseNo}</span>
                <span
                  aria-label={`Hearing status ${status}`}
                  className="rounded-full bg-white/10 px-2 py-0.5 tracking-normal normal-case"
                >
                  {status}
                </span>
              </p>
              <h2
                id="upcoming-hearing-title"
                className="mt-1 font-heading text-lg font-semibold tracking-tight sm:text-xl"
              >
                {title}
              </h2>
              {complaintTitle ? (
                <p className="mt-0.5 text-[13px] text-white/70">{complaintTitle}</p>
              ) : null}
              <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-white/80">
                <span className="inline-flex items-center gap-1.5">
                  <CalendarDays className="h-4 w-4 shrink-0" aria-hidden="true" />
                  {date}
                  {time ? ` / ${time}` : ""}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <MapPin className="h-4 w-4 shrink-0" aria-hidden="true" />
                  {venue}
                </span>
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => router.push(href)}
            aria-label={
              hasNotice
                ? `Notice of Hearing for case ${caseNo}. Opens the hearing and its Notice of Hearing.`
                : `Hearing details for case ${caseNo}.`
            }
            className="inline-flex min-h-[44px] items-center justify-center gap-2 self-start rounded-full bg-gold px-6 text-sm font-semibold text-navy transition-transform duration-200 hover:-translate-y-0.5 active:translate-y-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold lg:self-center"
          >
            <FileText className="h-4 w-4" aria-hidden="true" />
            {hasNotice ? "Notice of Hearing" : "View Hearing Details"}
          </button>
        </div>

        {!hasNotice ? (
          <p className="relative mt-4 text-[12px] text-white/60">
            The Notice of Hearing has not been issued yet. These details will
            be confirmed in writing once it is.
          </p>
        ) : null}
      </div>
    </section>
  );
}
