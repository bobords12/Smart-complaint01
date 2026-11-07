"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  CalendarDays,
  CalendarOff,
  CheckCircle2,
  ChevronDown,
  Clock,
  Download,
  ExternalLink,
  FileText,
  FilterX,
  MapPin,
  Scale,
  Search,
  Users,
} from "lucide-react";
import StatusBadge from "@/components/shared/StatusBadge";
import EmptyState from "@/components/shared/EmptyState";
import useResidentComplaints from "@/hooks/useResidentComplaints";
import {
  formatResidentDate,
  formatResidentSchedule,
  formatResidentTime,
  formatFileSize,
} from "@/lib/residentDates";
import {
  buildResidentTimeline,
  hearingSessionLabel,
  isUpcomingHearing,
  residentCaseNumber,
  residentHearingStatus,
  residentRespondent,
  resolveRescheduledPredecessor,
  resolveRescheduledSuccessor,
  sortHearings,
  summarizeHearings,
} from "@/lib/residentCase";
import { residentComplaintStatus } from "@/lib/constants";
import {
  getDocumentSignedUrl,
  getResidentProfileName,
} from "@/repositories/complaintRepository";

const TABS = ["All", "Upcoming", "Completed", "Rescheduled", "Cancelled"];

const SUMMARY_CARDS = [
  { key: "upcoming", label: "Upcoming", iconBg: "bg-secondary/10", iconClass: "text-secondary" },
  { key: "completed", label: "Completed", iconBg: "bg-success/10", iconClass: "text-success" },
  { key: "rescheduled", label: "Rescheduled", iconBg: "bg-warning/10", iconClass: "text-warning" },
  { key: "cancelled", label: "Cancelled", iconBg: "bg-alt", iconClass: "text-muted" },
];

const ACCENT_BY_STATUS = {
  Upcoming: "bg-secondary",
  Completed: "bg-success",
  Rescheduled: "bg-warning",
  Cancelled: "bg-muted",
};

/* ── Resident-visible document actions ──────────────────────────────── */

const DOCUMENT_LABELS = {
  hearing_notice: "Notice of Hearing",
  reklamo_form: "Reklamo Form",
};

function documentLabel(documentRow) {
  if (DOCUMENT_LABELS[documentRow?.document_type]) {
    return DOCUMENT_LABELS[documentRow.document_type];
  }
  return documentRow?.title || "Document";
}

/**
 * View / Download for one resident-visible document.
 *
 * Both go through a short-lived signed URL minted at the moment of the
 * click. The storage path never reaches the DOM and no public URL is
 * published anywhere, so a link cannot be forwarded and stay valid.
 */
function ResidentDocumentActions({ documentRow, onUnavailable }) {
  const [busy, setBusy] = useState(false);

  const open = async (disposition) => {
    setBusy(true);
    const { url, error } = await getDocumentSignedUrl(documentRow.storage_path);
    setBusy(false);
    if (error || !url) {
      onUnavailable?.();
      return;
    }
    if (disposition === "attachment") {
      const anchor = window.document.createElement("a");
      anchor.href = url;
      anchor.rel = "noopener";
      anchor.download = documentRow.filename || "";
      window.document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const name = documentLabel(documentRow);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => open("view")}
        disabled={busy}
        aria-label={`View ${name}`}
        className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border border-line bg-white dark:bg-alt px-3.5 text-[12.5px] font-semibold text-navy dark:text-secondary transition-colors hover:bg-alt focus-visible:outline-2 focus-visible:outline-secondary disabled:opacity-60"
      >
        <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
        View
      </button>
      <button
        type="button"
        onClick={() => open("attachment")}
        disabled={busy}
        aria-label={`Download ${name}`}
        className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border border-line bg-white dark:bg-alt px-3.5 text-[12.5px] font-semibold text-navy dark:text-secondary transition-colors hover:bg-alt focus-visible:outline-2 focus-visible:outline-secondary disabled:opacity-60"
      >
        <Download className="h-3.5 w-3.5" aria-hidden="true" />
        Download
      </button>
    </div>
  );
}

/* ── Detail building blocks ─────────────────────────────────────────── */

function DetailHeading({ icon: Icon, children, id }) {
  return (
    <h2
      id={id}
      className="flex items-center gap-2 text-[11.5px] font-bold uppercase tracking-[0.14em] text-muted"
    >
      <Icon className="h-4 w-4 text-secondary" aria-hidden="true" />
      {children}
    </h2>
  );
}

function Field({ label, children, className = "" }) {
  return (
    <div className={className}>
      <dt className="text-[10.5px] font-bold uppercase tracking-wide text-muted">
        {label}
      </dt>
      <dd className="mt-1 text-[13.5px] font-medium leading-relaxed text-navy dark:text-secondary">
        {children ?? "—"}
      </dd>
    </div>
  );
}

function Panel({ id, icon, title, children, className = "" }) {
  return (
    <section
      id={id}
      className={`scroll-mt-28 rounded-2xl border border-line bg-white dark:bg-alt p-5 ${className}`}
    >
      <DetailHeading icon={icon}>{title}</DetailHeading>
      <div className="mt-4">{children}</div>
    </section>
  );
}

/* ── The full hearing workspace ─────────────────────────────────────── */

function HearingDetail({ hearing, hearingList, complaints, documents, caseStatuses, complainantName, section, onBack }) {
  const [documentError, setDocumentError] = useState(false);
  const noticeRef = useRef(null);

  const hearingId = hearing.id;
  const complaintId = hearing.complaint_id;

  const complaint = useMemo(
    () => complaints.find((row) => row.id === complaintId) ?? null,
    [complaints, complaintId]
  );
  const siblingHearings = useMemo(
    () => sortHearings(hearingList.filter((row) => row.complaint_id === complaintId)),
    [hearingList, complaintId]
  );
  const complaintCases = useMemo(
    () => (caseStatuses || []).filter((row) => row.complaint_id === complaintId),
    [caseStatuses, complaintId]
  );
  const complaintHearings = useMemo(
    () => hearingList.filter((row) => row.complaint_id === complaintId),
    [hearingList, complaintId]
  );
  const sessionIndex = siblingHearings.findIndex((row) => row.id === hearingId);
  const status = residentHearingStatus(hearing.status);
  const respondent = residentRespondent(complaint);

  const complaintDocuments = useMemo(
    () => documents.filter((row) => row.complaint_id === complaintId),
    [documents, complaintId]
  );
  const notice = useMemo(
    () => complaintDocuments.find((row) => row.document_type === "hearing_notice") ?? null,
    [complaintDocuments]
  );

  const timeline = useMemo(() => {
    if (!complaint) return [];
    return buildResidentTimeline(complaint, {
      caseStatuses: complaintCases,
      hearings: complaintHearings,
      documents: complaintDocuments,
    });
  }, [complaint, complaintCases, complaintHearings, complaintDocuments]);

  const predecessor = resolveRescheduledPredecessor(hearing, siblingHearings);
  const successor = resolveRescheduledSuccessor(hearing, siblingHearings);
  const hasScheduleHistory = Boolean(predecessor || successor || hearing.cancel_reason);

  /* Ask the notice panel to come into view when a deep link requested it. */
  useEffect(() => {
    if (section !== "notice") return;
    const node = noticeRef.current;
    if (!node) return;
    node.scrollIntoView({ behavior: "smooth", block: "start" });
    const previous = document.activeElement;
    node.focus({ preventScroll: true });
    return () => {
      if (previous && typeof previous.focus === "function") previous.focus();
    };
  }, [section, notice]);

  return (
    <div className="space-y-5">
      {/* Back + identity */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex min-h-[40px] items-center gap-2 rounded-full border border-line bg-white dark:bg-alt px-4 text-[13px] font-semibold text-navy dark:text-secondary transition-colors hover:border-secondary hover:bg-info-soft"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to hearings
        </button>
        <StatusBadge label={status} />
      </div>

      <header>
        <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-muted">
          Hearing details
        </p>
        <h1 className="mt-1 font-heading text-2xl font-semibold tracking-tight text-navy dark:text-secondary sm:text-3xl">
          {hearingSessionLabel(hearing, sessionIndex < 0 ? 0 : sessionIndex)}
        </h1>
        {complaint ? (
          <p className="mt-1 text-sm text-muted">
            {complaint.title} · {complaint.reference_number}
          </p>
        ) : (
          <p className="mt-1 text-sm text-muted">Case details unavailable.</p>
        )}
      </header>

      {/* CASE INFORMATION */}
      <Panel id="section-case-information" icon={FileText} title="Case Information">
        <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-3">
          <Field label="Complaint">{complaint?.title ?? "—"}</Field>
          <Field label="Reference Number">
            {complaint?.reference_number ?? "—"}
          </Field>
          <Field label="Barangay Case No.">
            {complaint ? residentCaseNumber(complaint) : "—"}
          </Field>
          <Field label="Case Status">
            {complaint ? residentComplaintStatus(complaint.current_status) : "—"}
          </Field>
          <Field label="Category">
            {complaint?.confirmed_category || complaint?.predicted_category || "—"}
          </Field>
          <Field label="Filed">
            {formatResidentDate(complaint?.submitted_at) || "—"}
          </Field>
        </dl>
      </Panel>

      {/* PARTIES */}
      <Panel id="section-parties" icon={Users} title="Parties">
        <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
          <Field label="Complainant">
            {complainantName || "You"}
            <span className="ml-2 text-[12px] font-normal text-muted">
              (you filed this complaint)
            </span>
          </Field>
          <Field label="Respondent">{respondent.label}</Field>
        </dl>
      </Panel>

      {/* HEARING INFORMATION */}
      <Panel id="section-hearing-information" icon={CalendarDays} title="Hearing Information">
        <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Session Type">{hearing.hearing_type || "—"}</Field>
          <Field label="Session">
            {hearingSessionLabel(hearing, sessionIndex < 0 ? 0 : sessionIndex)}
          </Field>
          <Field label="Date">
            {formatResidentDate(hearing.hearing_date) || "To be announced"}
          </Field>
          <Field label="Time">
            {formatResidentTime(hearing.hearing_time) || "To be announced"}
          </Field>
          <Field label="Venue" className="sm:col-span-2">
            <span className="inline-flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5 shrink-0 text-secondary" aria-hidden="true" />
              {hearing.venue || "Barangay Abuno Hall"}
            </span>
          </Field>
          <Field label="Status">{status}</Field>
        </dl>
        {hearing.instructions ? (
          <p className="mt-4 rounded-xl bg-canvas px-4 py-3 text-[13px] leading-relaxed text-mirage">
            {hearing.instructions}
          </p>
        ) : null}
      </Panel>

      {/* DOCUMENTS */}
      <Panel
        id="section-notice"
        icon={FileText}
        title="Documents"
        className="focus:outline-none"
      >
        <div ref={noticeRef} tabIndex={-1} className="focus:outline-none">
          {complaintDocuments.length === 0 ? (
            <p className="text-[13px] leading-relaxed text-muted">
              No documents have been issued for this hearing yet.
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {complaintDocuments.map((documentRow) => {
                const isNotice = documentRow.document_type === "hearing_notice";
                return (
                  <li
                    key={documentRow.id}
                    className="flex flex-col gap-3 rounded-xl border border-line bg-canvas px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 text-[13.5px] font-semibold text-navy dark:text-secondary">
                        {documentLabel(documentRow)}
                        <span className="rounded-full bg-success-soft px-2 py-0.5 text-[11px] font-bold text-success">
                          Available
                        </span>
                      </p>
                      <p className="mt-0.5 text-[12px] text-muted">
                        {formatResidentDate(documentRow.created_at) || ""}
                        {documentRow.file_size
                          ? ` · ${formatFileSize(documentRow.file_size)}`
                          : ""}
                      </p>
                      {isNotice ? (
                        <p className="mt-1 text-[12px] text-muted">
                          Issued for the {formatResidentSchedule(hearing.hearing_date, hearing.hearing_time)} session.
                        </p>
                      ) : null}
                    </div>
                    <ResidentDocumentActions
                      documentRow={documentRow}
                      onUnavailable={() => setDocumentError(true)}
                    />
                  </li>
                );
              })}
            </ul>
          )}

          {notice ? null : (
            <p className="mt-3 text-[12.5px] text-muted">
              Notice of Hearing — not yet available. You will be notified as
              soon as it is issued.
            </p>
          )}

          {documentError ? (
            <p className="mt-3 rounded-xl bg-critical-soft px-4 py-3 text-[12.5px] text-critical">
              This document is temporarily unavailable.
            </p>
          ) : null}
        </div>
      </Panel>

      {/* SCHEDULE HISTORY */}
      {hasScheduleHistory ? (
        <Panel id="section-schedule" icon={Clock} title="Schedule History">
          <ol className="space-y-4">
            {predecessor ? (
              <li className="flex items-start gap-3">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-warning-soft">
                  <Clock className="h-3.5 w-3.5 text-warning" aria-hidden="true" />
                </span>
                <div>
                  <p className="text-[13px] font-semibold text-navy dark:text-secondary">
                    Originally scheduled —{" "}
                    {formatResidentSchedule(
                      predecessor.hearing_date,
                      predecessor.hearing_time
                    )}
                  </p>
                  <p className="mt-0.5 text-[12px] text-muted">
                    Rescheduled
                  </p>
                </div>
              </li>
            ) : null}

            <li className="flex items-start gap-3">
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-info-soft">
                <CalendarDays className="h-3.5 w-3.5 text-secondary" aria-hidden="true" />
              </span>
              <div>
                <p className="text-[13px] font-semibold text-navy dark:text-secondary">
                  {status === "Rescheduled" ? "Moved from" : "Current schedule"} —{" "}
                  {formatResidentSchedule(hearing.hearing_date, hearing.hearing_time)}
                </p>
                <p className="mt-0.5 text-[12px] text-muted">{status}</p>
              </div>
            </li>

            {successor ? (
              <li className="flex items-start gap-3">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-success-soft">
                  <CheckCircle2 className="h-3.5 w-3.5 text-success" aria-hidden="true" />
                </span>
                <div>
                  <p className="text-[13px] font-semibold text-navy dark:text-secondary">
                    New schedule —{" "}
                    {formatResidentSchedule(successor.hearing_date, successor.hearing_time)}
                  </p>
                  <p className="mt-0.5 text-[12px] text-muted">
                    {residentHearingStatus(successor.status)}
                  </p>
                </div>
              </li>
            ) : null}

            {hearing.cancel_reason ? (
              <li className="flex items-start gap-3">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-alt">
                  <CalendarOff className="h-3.5 w-3.5 text-muted" aria-hidden="true" />
                </span>
                <div>
                  <p className="text-[13px] font-semibold text-navy dark:text-secondary">
                    Cancellation reason
                  </p>
                  <p className="mt-0.5 text-[13px] leading-relaxed text-muted">
                    {hearing.cancel_reason}
                  </p>
                </div>
              </li>
            ) : null}
          </ol>
        </Panel>
      ) : null}

      {/* ATTENDANCE */}
      <Panel id="section-attendance" icon={Users} title="Attendance">
        {status === "Upcoming" || status === "Rescheduled" ? (
          <p className="text-[13px] leading-relaxed text-muted">
            Attendance is recorded on the day of the session.
          </p>
        ) : (
          <p className="text-[13px] leading-relaxed text-muted">
            A record of attendance is kept by the barangay and is shared with
            you together with the result of this session.
          </p>
        )}
      </Panel>

      {/* HEARING RESULT */}
      <Panel id="section-result" icon={Scale} title="Hearing Result">
        {status === "Completed" ? (
          <p className="text-[13px] leading-relaxed text-mirage">
            This session has been completed. The outcome is recorded on your
            complaint below.
          </p>
        ) : status === "Cancelled" ? (
          <p className="text-[13px] leading-relaxed text-mirage">
            This session did not proceed.
            {hearing.cancel_reason ? ` ${hearing.cancel_reason}` : ""}
          </p>
        ) : status === "Rescheduled" ? (
          <p className="text-[13px] leading-relaxed text-mirage">
            This session was moved. See the new schedule below.
          </p>
        ) : (
          <p className="text-[13px] leading-relaxed text-muted">Awaiting hearing.</p>
        )}

        {successor ? (
          <p className="mt-3 rounded-xl bg-info-soft px-4 py-3 text-[13px] font-medium text-secondary">
            Next session:{" "}
            {formatResidentSchedule(successor.hearing_date, successor.hearing_time)} ·{" "}
            {successor.venue}
          </p>
        ) : null}
      </Panel>

      {/* CASE UPDATE */}
      <Panel id="section-case-update" icon={CalendarDays} title="Case Update">
        {timeline.length === 0 ? (
          <p className="text-[13px] leading-relaxed text-muted">
            No updates recorded yet.
          </p>
        ) : (
          <ol className="space-y-3">
            {timeline.slice(0, 6).map((entry, index) => (
              <li key={`${entry.kind}-${entry.id || index}`} className="flex items-start gap-3">
                <span
                  aria-hidden="true"
                  className="mt-2 h-2 w-2 shrink-0 rounded-full bg-secondary"
                />
                <div>
                  <p className="text-[13px] leading-relaxed text-mirage">{entry.label}</p>
                  {entry.at ? (
                    <p className="mt-0.5 text-[12px] text-muted">
                      {formatResidentDate(entry.at)}
                    </p>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        )}

        {complaint ? (
          <Link
            href={`/resident/complaints/${complaint.id}`}
            className="mt-4 inline-flex min-h-[40px] items-center gap-2 rounded-full border border-line px-4 text-[13px] font-semibold text-navy dark:text-secondary transition-colors hover:border-secondary hover:bg-info-soft"
          >
            <FileText className="h-4 w-4" aria-hidden="true" />
            Open full complaint
          </Link>
        ) : null}
      </Panel>
    </div>
  );
}

/* ── The page ───────────────────────────────────────────────────────── */

export default function HearingsNotices() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedHearingId = searchParams.get("hearing");
  const requestedSection = searchParams.get("section");

  const {
    hearings,
    complaints,
    documents,
    caseStatuses,
    loading,
    error,
    refresh,
  } = useResidentComplaints();

  const [activeTab, setActiveTab] = useState("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortOrder, setSortOrder] = useState("nearest");
  const [showSortDropdown, setShowSortDropdown] = useState(false);
  const [complainantName, setComplainantName] = useState(null);

  useEffect(() => {
    let cancelled = false;
    getResidentProfileName().then((name) => {
      if (!cancelled) setComplainantName(name);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const sorted = useMemo(() => sortHearings(hearings), [hearings]);

  /**
   * A deep-linked session is resolved against the resident's own hearings.
   * An id that is not in that list is treated exactly like one that does
   * not exist — the resident is told the record is unavailable and nothing
   * about another resident's session is revealed.
   */
  const selectedHearing = useMemo(() => {
    if (!requestedHearingId) return null;
    return sorted.find((row) => row.id === requestedHearingId) ?? null;
  }, [sorted, requestedHearingId]);

  const counts = useMemo(() => summarizeHearings(sorted), [sorted]);

  const filteredHearings = useMemo(() => {
    let result = [...sorted];

    if (activeTab !== "All") {
      result = result.filter(
        (hearing) => residentHearingStatus(hearing.status) === activeTab
      );
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter((hearing) => {
        const complaint = complaints.find((row) => row.id === hearing.complaint_id);
        return (
          (complaint?.reference_number || "").toLowerCase().includes(q) ||
          (complaint?.title || "").toLowerCase().includes(q) ||
          (hearing.hearing_type || "").toLowerCase().includes(q) ||
          (hearing.title || "").toLowerCase().includes(q)
        );
      });
    }

    return result;
  }, [sorted, complaints, activeTab, searchQuery]);

  /** Move between the list and one session while keeping the URL honest. */
  const navigateTo = useCallback(
    (nextParams, scroll = false) => {
      const query = nextParams.toString();
      router.push(query ? `${window.location.pathname}?${query}` : window.location.pathname, {
        scroll,
      });
    },
    [router]
  );

  const openHearing = useCallback(
    (hearingId) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("hearing", hearingId);
      params.delete("section");
      navigateTo(params);
    },
    [navigateTo, searchParams]
  );

  /**
   * Return to the list. The query is rebuilt rather than patched so a
   * resident who arrived from a notification lands back on the list they
   * came from instead of a half-cleared URL.
   */
  const closeDetail = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("hearing");
    params.delete("section");
    navigateTo(params);
  }, [navigateTo, searchParams]);

  const header = (
    <div className="mb-8">
      <h1 className="font-heading text-2xl font-bold tracking-tight text-navy dark:text-secondary sm:text-3xl">
        Hearings
      </h1>
      <p className="mt-2 max-w-2xl text-[13.5px] text-muted">
        Every session set for your complaints, with the documents the barangay
        has issued for each one.
      </p>
    </div>
  );

  if (loading && !selectedHearing) {
    return (
      <section className="min-h-screen bg-canvas">
        <div className="container-scbms py-8">
          {header}
          <div
            role="status"
            aria-live="polite"
            className="flex items-center justify-center py-20"
          >
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-secondary border-t-transparent" />
            <span className="ml-3 text-sm text-muted">Loading hearings…</span>
          </div>
        </div>
      </section>
    );
  }

  if (requestedHearingId && !selectedHearing) {
    return (
      <section className="min-h-screen bg-canvas">
        <div className="container-scbms py-8">
          {header}
          <div className="rounded-2xl border border-line bg-white dark:bg-alt">
            <EmptyState
              title="This hearing record is unavailable."
              message="It may have been removed, or it is not part of your cases."
              icon={AlertTriangle}
            >
              <button
                type="button"
                onClick={closeDetail}
                className="inline-flex min-h-[40px] items-center gap-2 rounded-full bg-navy px-5 text-[13px] font-semibold text-white transition-colors hover:bg-secondary"
              >
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                Back to hearings
              </button>
            </EmptyState>
          </div>
        </div>
      </section>
    );
  }

  if (selectedHearing) {
    return (
      <section className="min-h-screen bg-canvas">
        <div className="container-scbms py-8">
          {error ? (
            <p className="mb-4 rounded-xl bg-critical-soft px-4 py-3 text-[12.5px] text-critical">
              Some information could not be refreshed.
            </p>
          ) : null}
          <HearingDetail
            hearing={selectedHearing}
            hearingList={sorted}
            complaints={complaints}
            documents={documents}
            caseStatuses={caseStatuses}
            complainantName={complainantName}
            section={requestedSection}
            onBack={closeDetail}
          />
        </div>
      </section>
    );
  }

  return (
    <section className="min-h-screen bg-canvas">
      <div className="container-scbms py-8">
        {header}

        {/* Canonical summary counts */}
        <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
          {SUMMARY_CARDS.map((card) => (
            <div
              key={card.key}
              className="group relative overflow-hidden rounded-2xl border border-line bg-white dark:bg-alt p-5 shadow-feather transition-shadow hover:shadow-soft"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <p className="text-[11.5px] font-semibold uppercase tracking-wide text-muted">
                    {card.label}
                  </p>
                  <p className="mt-2 text-3xl font-bold tracking-tight text-navy dark:text-secondary">
                    {counts[card.key]}
                  </p>
                </div>
                <div
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${card.iconBg}`}
                >
                  <CalendarDays className={`h-5 w-5 ${card.iconClass}`} aria-hidden="true" />
                </div>
              </div>
              <div
                className={`absolute inset-x-0 bottom-0 h-0.5 opacity-0 transition-opacity group-hover:opacity-100 ${ACCENT_BY_STATUS[card.label] ?? "bg-secondary"}`}
              />
            </div>
          ))}
        </div>

        {/* Filters */}
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div
            role="tablist"
            aria-label="Filter hearings by status"
            className="flex flex-wrap gap-1 rounded-xl border border-line bg-white dark:bg-alt p-1"
          >
            {TABS.map((tab) => {
              const active = activeTab === tab;
              return (
                <button
                  key={tab}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setActiveTab(tab)}
                  className={`rounded-lg px-3.5 py-2 text-[12.5px] font-semibold transition-colors ${
                    active
                      ? "bg-navy text-white shadow-sm"
                      : "text-muted hover:bg-alt hover:text-navy dark:hover:text-secondary"
                  }`}
                >
                  {tab}
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-3">
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
                aria-hidden="true"
              />
              <input
                type="text"
                placeholder="Search case or title…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-52 rounded-xl border border-line bg-white dark:bg-alt py-2 pl-9 pr-3 text-[13px] text-navy dark:text-secondary placeholder-muted transition-colors focus:border-secondary focus:outline-none focus:ring-1 focus:ring-secondary/30 sm:w-64"
              />
              {searchQuery ? (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted hover:bg-alt hover:text-navy dark:hover:text-secondary"
                  aria-label="Clear search"
                >
                  <FilterX className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>

            <div className="relative">
              <button
                type="button"
                onClick={() => setShowSortDropdown(!showSortDropdown)}
                aria-expanded={showSortDropdown}
                className="flex items-center gap-2 rounded-xl border border-line bg-white dark:bg-alt px-3.5 py-2 text-[13px] font-medium text-navy dark:text-secondary transition-colors hover:bg-alt"
              >
                <Clock className="h-4 w-4 text-muted" aria-hidden="true" />
                {sortOrder === "nearest" ? "Nearest first" : "Latest first"}
                <ChevronDown
                  className={`h-3.5 w-3.5 text-muted transition-transform ${showSortDropdown ? "rotate-180" : ""}`}
                  aria-hidden="true"
                />
              </button>
              {showSortDropdown ? (
                <div className="pop-menu absolute right-0 top-full z-30 mt-1 w-40 overflow-hidden rounded-xl border border-line bg-white dark:bg-alt py-1 shadow-float">
                  {["nearest", "latest"].map((order) => (
                    <button
                      key={order}
                      type="button"
                      onClick={() => {
                        setSortOrder(order);
                        setShowSortDropdown(false);
                      }}
                      className={`flex w-full items-center gap-2 px-3.5 py-2 text-left text-[13px] transition-colors ${
                        sortOrder === order
                          ? "bg-info-soft font-semibold text-secondary"
                          : "text-navy dark:text-secondary hover:bg-alt"
                      }`}
                    >
                      <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                      {order === "nearest" ? "Nearest first" : "Latest first"}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </div>

        {error ? (
          <div className="mb-4 rounded-2xl border border-line bg-white dark:bg-alt">
            <EmptyState
              title="Hearings could not be loaded."
              message="Please try again in a moment."
              icon={AlertTriangle}
            >
              <button
                type="button"
                onClick={refresh}
                className="inline-flex min-h-[40px] items-center gap-2 rounded-full bg-navy px-5 text-[13px] font-semibold text-white transition-colors hover:bg-secondary"
              >
                Retry
              </button>
            </EmptyState>
          </div>
        ) : null}

        {/* Sessions */}
        {!error && filteredHearings.length === 0 ? (
          <EmptyState
            title={sorted.length === 0 ? "No hearings scheduled." : "No hearings found"}
            message={
              sorted.length === 0
                ? "You will be notified as soon as a session is set for one of your complaints."
                : "Try changing your filters."
            }
            icon={CalendarDays}
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {filteredHearings.map((hearing) => {
              const complaint = complaints.find((row) => row.id === hearing.complaint_id);
              const status = residentHearingStatus(hearing.status);
              const complaintDocuments = documents.filter(
                (row) => row.complaint_id === hearing.complaint_id
              );
              const hasNotice = complaintDocuments.some(
                (row) => row.document_type === "hearing_notice"
              );
              const siblings = sortHearings(
                sorted.filter((row) => row.complaint_id === hearing.complaint_id)
              );
              const index = siblings.findIndex((row) => row.id === hearing.id);

              return (
                <article
                  key={hearing.id}
                  className="group relative overflow-hidden rounded-2xl border border-line bg-white dark:bg-alt shadow-feather transition-all hover:shadow-soft"
                >
                  <div className={`h-1 ${ACCENT_BY_STATUS[status] ?? "bg-muted"}`} />

                  <div className="p-5">
                    <div className="mb-3 flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                          {complaint?.reference_number ?? ""}
                        </p>
                        <h3 className="mt-1 truncate text-[15px] font-bold text-navy dark:text-secondary">
                          {complaint?.title ?? "Hearing"}
                        </h3>
                      </div>
                      <StatusBadge label={status} />
                    </div>

                    <div className="mb-3 space-y-1.5">
                      <div className="flex items-center gap-2 text-[12.5px] text-muted">
                        <Scale className="h-3.5 w-3.5 shrink-0 text-secondary" aria-hidden="true" />
                        <span className="font-medium">
                          {hearingSessionLabel(hearing, index < 0 ? 0 : index)}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-[12.5px] text-muted">
                        <CalendarDays className="h-3.5 w-3.5 shrink-0 text-secondary" aria-hidden="true" />
                        <span>
                          {formatResidentSchedule(hearing.hearing_date, hearing.hearing_time)}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-[12.5px] text-muted">
                        <MapPin className="h-3.5 w-3.5 shrink-0 text-secondary" aria-hidden="true" />
                        <span>{hearing.venue || "Barangay Abuno Hall"}</span>
                      </div>
                      <div className="flex items-center gap-2 text-[12.5px] text-muted">
                        <FileText
                          className={`h-3.5 w-3.5 shrink-0 ${hasNotice ? "text-success" : "text-muted/60"}`}
                          aria-hidden="true"
                        />
                        <span>
                          Notice of Hearing —{" "}
                          {hasNotice ? "Available" : "Not yet available"}
                        </span>
                      </div>
                    </div>

                    {hearing.instructions ? (
                      <p className="mb-4 line-clamp-2 text-[12.5px] leading-relaxed text-muted">
                        {hearing.instructions}
                      </p>
                    ) : null}

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => openHearing(hearing.id)}
                        aria-label={`View hearing details for ${complaint?.title ?? "this case"}`}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-navy px-4 py-2 text-[12.5px] font-semibold text-white transition-colors hover:bg-navy/90 focus-visible:outline-2 focus-visible:outline-secondary"
                      >
                        <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                        View
                      </button>
                      {isUpcomingHearing(hearing) ? (
                        <span className="text-[12px] text-muted">
                          You are expected to attend.
                        </span>
                      ) : null}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
