"use client";

import { useMemo, useState, useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import {
  X,
  ArrowLeft,
  Ban,
  Download,
  ShieldAlert,
  FileText,
  Calendar,
  MapPin,
  User,
  Clock,
  Info,
  CheckCircle2,
  Circle,
  AlertCircle,
  File,
  FileImage,
  FileAudio,
  FileVideo,
} from "lucide-react";
import StatusBadge from "@/components/shared/StatusBadge";
import ResidentModal from "@/components/shared/ResidentModal";
import {
  getComplaintById,
  getComplaintEvidence,
  getComplaintHearings,
  getKpTracker,
  getCaseStatuses,
  getResidentComplaintDocuments,
  getDocumentSignedUrl,
  getResidentProfileName,
} from "@/repositories/complaintRepository";
import { getActiveReferralRequest, submitReferralRequest } from "@/repositories/referralRepository";
import { RESIDENT_ROUTES, residentComplaintStatus } from "@/lib/constants";
import KPTrackerSection from "@/components/resident/KPTrackerSection";
import ReklamoDocumentCard from "@/components/resident/ReklamoDocumentCard";
import InformationRequestPanel from "@/components/resident/InformationRequestPanel";
import { generateComplaintPdf } from "@/lib/complaintPdf";
import {
  formatResidentDate,
  formatResidentDateShort,
  formatResidentTime,
  formatFileSize as formatResidentFileSize,
} from "@/lib/residentDates";
import {
  buildResidentProgress,
  buildResidentTimeline,
  hasCaseNumber,
  residentCaseNumber,
  residentHearingStatus,
  residentRespondent,
  sortHearings,
} from "@/lib/residentCase";
import { RESIDENT_SECTION } from "@/lib/residentRoutes";
import { useAuth } from "@/context/AuthContext";
import { demoComplaintsEnabledFor, getDemoComplaint } from "@/lib/demoComplaints";

/* ── Helpers ─────────────────────────────────────────────────────────── */

async function fetchComplaintData(id) {
  const complaint = await getComplaintById(id);
  if (!complaint) return null;

  const [evidence, hearings, kpTracker, caseStatuses, officialDocuments, profileName] =
    await Promise.all([
      getComplaintEvidence(id),
      getComplaintHearings(id),
      getKpTracker(id),
      getCaseStatuses(id),
      getResidentComplaintDocuments(id).catch(() => []),
      getResidentProfileName().catch(() => null),
    ]);

  return {
    ...complaint,
    // A complaint filed from a resident account carries no walk-in snapshot,
    // so the complainant is the resident's own profile. Both come from the
    // canonical record — nothing here is typed in by the portal.
    complainantName: complaint.complainantName || profileName || undefined,
    evidence,
    hearings: sortHearings(hearings),
    kpTracker: kpTracker || { applicable: false, currentPhase: "Not Applicable" },
    caseStatuses,
    officialDocuments,
    progress_history: caseStatuses.map((cs) => ({
      id: cs.id,
      title: cs.status,
      // `case_statuses` stores the officer's wording in resident_visible_message
      // (Captain's own timeline reads the same column). `notes` is kept as a
      // fallback for older rows.
      description:
        cs.resident_visible_message ||
        cs.notes ||
        `Status changed to ${residentComplaintStatus(cs.status)}`,
      state: "completed",
      occurredAt: cs.created_at,
    })),
  };
}

/**
 * Local date helpers, kept under their original names so the 30-odd call
 * sites below did not have to be rewritten.
 *
 * They now delegate to `lib/residentDates.js`, which is the single place
 * that knows a SQL `date` and a SQL `time` are already-local barangay
 * calendar values and must never be routed through `new Date()`. The
 * previous implementations called `toLocaleDateString` without an
 * `Asia/Manila` zone, so a timestamp near midnight could print the day
 * before in Abuno, and a bare `date` column reinterpreted as UTC shifted
 * forward by eight hours.
 */
function formatDate(isoOrStr) {
  if (!isoOrStr) return "Not provided";
  return formatResidentDate(isoOrStr) || String(isoOrStr);
}

function formatDateTime(isoOrStr) {
  if (!isoOrStr) return "Not provided";
  const day = formatResidentDate(isoOrStr);
  const clock = formatResidentTime(isoOrStr);
  if (!day) return String(isoOrStr);
  return clock ? `${day} • ${clock}` : day;
}

function formatShortDate(isoOrStr) {
  if (!isoOrStr) return "";
  return formatResidentDateShort(isoOrStr);
}

function formatMonthDay(isoOrStr) {
  const day = formatResidentDate(isoOrStr);
  if (!day) return { month: "", day: "" };
  const parts = day.split(" ");
  return { month: (parts[0] || "").slice(0, 3).toUpperCase(), day: parts[1] || "" };
}

const formatFileSize = formatResidentFileSize;

function getStageLabel(complaint) {
  if (!complaint) return "Pending Review";
  return residentComplaintStatus(complaint.current_status || complaint.status);
}

/* ── File icon helper ───────────────────────────────────────────────── */

function getFileIconComponent(fileType) {
  if (!fileType) return File;
  if (fileType.startsWith("image/")) return FileImage;
  if (fileType.startsWith("audio/")) return FileAudio;
  if (fileType.startsWith("video/")) return FileVideo;
  if (fileType === "application/pdf") return FileText;
  return File;
}

function getFileTypeLabel(fileType) {
  if (!fileType) return "Document";
  const map = {
    "audio/mpeg": "Audio",
    "audio/wav": "Audio",
    "audio/mp3": "Audio",
    "audio/x-m4a": "Audio",
    "image/jpeg": "Photo",
    "image/png": "Photo",
    "image/jpg": "Photo",
    "application/pdf": "PDF",
    "application/zip": "Archive",
    "video/mp4": "Video",
  };
  return map[fileType] ?? fileType.split("/").pop().toUpperCase();
}

/* ── Resident-visible official documents ───────────────────────────── */

const OFFICIAL_DOCUMENT_LABELS = {
  hearing_notice: "Notice of Hearing",
  reklamo_form: "Reklamo Form",
  certificate_to_file_action: "Certificate to File Action",
  settlement: "Settlement",
  resolution: "Resolution",
  minutes: "Minutes",
};

/**
 * Documents the barangay has issued and marked `resident_visible`.
 *
 * Two things are deliberately not here. A Respondent Summons is served on
 * the respondent and never reaches the complainant, so `summons` is absent
 * from the label map. And no storage path is rendered: both actions mint a
 * short-lived signed URL at the moment of the click, so a link that is
 * copied out of the browser stops working in a few minutes.
 */
function ResidentOfficialDocuments({ documents }) {
  const [unavailable, setUnavailable] = useState(false);

  const open = async (documentRow, disposition) => {
    const { url, error } = await getDocumentSignedUrl(documentRow.storage_path);
    if (error || !url) {
      setUnavailable(true);
      return;
    }
    if (disposition === "attachment") {
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.rel = "noopener";
      anchor.download = documentRow.filename || "";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <section
      id="section-documents"
      className="mt-6 scroll-mt-28 rounded-2xl border border-line bg-white dark:bg-alt p-5 sm:p-6 shadow-[0_1px_2px_rgba(11,33,68,0.06)]"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[13px] font-semibold uppercase tracking-wide text-muted">
          Documents Issued To You
        </h2>
        <span className="rounded-full bg-alt px-3 py-1 text-[11px] font-semibold text-secondary">
          {documents.length}
        </span>
      </div>

      {documents.length === 0 ? (
        <p className="mt-3 text-sm leading-relaxed text-muted">
          No documents have been issued for this complaint yet. You will be
          notified here as soon as one is.
        </p>
      ) : (
        <ul className="mt-4 flex flex-col gap-3">
          {documents.map((documentRow) => (
            <li
              key={documentRow.id}
              className="flex flex-col gap-3 rounded-xl border border-line bg-canvas px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="text-[13.5px] font-semibold text-navy dark:text-secondary">
                  {OFFICIAL_DOCUMENT_LABELS[documentRow.document_type] ||
                    documentRow.title ||
                    "Document"}
                </p>
                <p className="mt-0.5 text-[12px] text-muted">
                  {formatResidentDate(documentRow.created_at) || ""}
                  {documentRow.file_size
                    ? ` · ${formatResidentFileSize(documentRow.file_size)}`
                    : ""}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => open(documentRow, "view")}
                  aria-label={`View ${
                    OFFICIAL_DOCUMENT_LABELS[documentRow.document_type] || "document"
                  }`}
                  className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border border-line bg-white dark:bg-alt px-3.5 text-[12.5px] font-semibold text-navy dark:text-secondary transition-colors hover:bg-alt focus-visible:outline-2 focus-visible:outline-secondary"
                >
                  View
                </button>
                <button
                  type="button"
                  onClick={() => open(documentRow, "attachment")}
                  aria-label={`Download ${
                    OFFICIAL_DOCUMENT_LABELS[documentRow.document_type] || "document"
                  }`}
                  className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border border-line bg-white dark:bg-alt px-3.5 text-[12.5px] font-semibold text-navy dark:text-secondary transition-colors hover:bg-alt focus-visible:outline-2 focus-visible:outline-secondary"
                >
                  <Download className="h-3.5 w-3.5" aria-hidden="true" />
                  Download
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {unavailable ? (
        <p className="mt-3 rounded-xl bg-critical-soft px-4 py-3 text-[12.5px] text-critical">
          This document is temporarily unavailable.
        </p>
      ) : null}
    </section>
  );
}

/* ── Constants ──────────────────────────────────────────────────────── */

const MAX_REASON_LENGTH = 500;

const INACTIVE_STATUSES = [
  "Resolved",
  "Closed",
  "Rejected",
];

const REFERRAL_STATUS_LABELS = {
  pending_review: "Pending Barangay Review",
  more_information_required: "More Information Required",
  approved: "Approved for Referral",
  declined: "Declined",
  officially_referred: "Referred to PNP",
  completed: "Completed",
  cancelled: "Cancelled",
};

/* ── Component ──────────────────────────────────────────────────────── */

function DemoComplaintDetail({ complaint }) {
  const router = useRouter();
  return (
    <section className="mx-auto max-w-[1100px] space-y-6">
      <button type="button" onClick={() => router.push(RESIDENT_ROUTES.complaints)}
        className="inline-flex min-h-[44px] items-center gap-2 text-sm font-semibold text-secondary">
        <ArrowLeft className="h-4 w-4" /> Back to My Complaints
      </button>
      <header className="rounded-2xl border border-line bg-white dark:bg-alt p-5 sm:p-6">
        <span className="text-xs font-semibold text-muted">Sample Case · Demo only · Not an official complaint</span>
        <h1 className="mt-2 font-heading text-2xl font-semibold text-navy dark:text-secondary">{complaint.title}</h1>
        <p className="mt-1 text-sm text-secondary">{complaint.reference_number}</p>
        <div className="mt-3"><StatusBadge label={complaint.current_status} /></div>
      </header>
      <section className="rounded-2xl border border-line bg-white dark:bg-alt p-5 sm:p-6">
        <h2 className="text-sm font-semibold uppercase text-muted">Complaint Details</h2>
        <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
          <div><dt className="text-muted">Complainant</dt><dd className="font-medium text-mirage">{complaint.complainantName}</dd></div>
          <div><dt className="text-muted">Respondent</dt><dd className="font-medium text-mirage">{complaint.respondent_name}</dd></div>
        </dl>
        <p className="mt-5 text-sm leading-relaxed text-mirage">{complaint.description}</p>
      </section>
      <section className="rounded-2xl border border-line bg-white dark:bg-alt p-5 sm:p-6">
        <h2 className="text-sm font-semibold uppercase text-muted">Sample Case History</h2>
        <ol className="mt-4 space-y-4">
          {complaint.timeline.map((step) => (
            <li key={step.id} className="border-l-2 border-secondary pl-4 text-sm text-mirage">
              <span className="font-medium">{step.label}</span>
              <span className="block text-xs text-muted">{formatDateTime(step.at)}</span>
            </li>
          ))}
        </ol>
        {complaint.current_status === "CFA Issued" ? (
          <p className="mt-4 text-xs text-muted">CFA stage shown for illustration only. No certificate or legal document has been issued.</p>
        ) : null}
      </section>
    </section>
  );
}

export default function ComplaintDetailView({ complaintId }) {
  const { user } = useAuth();
  const demo = getDemoComplaint(complaintId);
  if (demo) {
    return demoComplaintsEnabledFor(user) ? <DemoComplaintDetail complaint={demo} /> : (
      <p className="mx-auto max-w-[1100px] py-10 text-center text-sm text-muted">Case not found.</p>
    );
  }
  return <RealComplaintDetailView complaintId={complaintId} />;
}

function RealComplaintDetailView({ complaintId }) {
  const router = useRouter();
  const [complaint, setComplaint] = useState(null);
  const [loading, setLoading] = useState(true);

  /* ── Download state ────────────────────────────────────────────── */
  const [downloading, setDownloading] = useState(false);

  /* ── Referral state ────────────────────────────────────────────── */
  const [referralRequest, setReferralRequest] = useState(null);
  const [referralModalOpen, setReferralModalOpen] = useState(false);
  const [referralReason, setReferralReason] = useState("");
  const [safetyConcern, setSafetyConcern] = useState(false);
  const [submittingReferral, setSubmittingReferral] = useState(false);
  const referralButtonRef = useRef(null);

  /**
   * Reload the complaint. Re-run after the resident sends an
   * information response so the panel flips to "received" from the same
   * server row the Captain will see, rather than from local state that
   * could drift from the database.
   */
  const refresh = useCallback(async () => {
    try {
      const data = await fetchComplaintData(complaintId);
      setComplaint(data);
    } catch {
      /* keep the last good view rather than blanking the screen */
    }
  }, [complaintId]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const data = await fetchComplaintData(complaintId);
        if (!cancelled) setComplaint(data);
      } catch {
        if (!cancelled) setComplaint(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [complaintId]);

  /* ── Load referral request ─────────────────────────────────────── */
  useEffect(() => {
    if (!complaint?.id) return;
    let cancelled = false;
    async function load() {
      const req = await getActiveReferralRequest(complaint.id);
      if (!cancelled) setReferralRequest(req);
    }
    load();
    return () => { cancelled = true; };
  }, [complaint?.id]);

  const allHearings = useMemo(() => complaint?.hearings ?? [], [complaint]);

  const evidence = useMemo(() => complaint?.evidence ?? [], [complaint]);
  /* ── Resident-safe derivations ────────────────────────────────── */

  /**
   * Everything below is a read-only view over the canonical Captain-side
   * columns. Nothing is stored on the resident side and nothing here can
   * disagree with the dashboard, because both sides resolve the same
   * columns through the same helpers in `lib/residentCase.js`.
   */
  const caseNumber = useMemo(() => residentCaseNumber(complaint), [complaint]);
  const respondent = useMemo(() => residentRespondent(complaint), [complaint]);
  const residentDocuments = useMemo(
    () => complaint?.officialDocuments ?? [],
    [complaint]
  );

  /** Resident-visible history, newest first — also the "Latest Update". */
  const timeline = useMemo(
    () =>
      buildResidentTimeline(complaint, {
        caseStatuses: complaint?.caseStatuses ?? [],
        hearings: allHearings,
        documents: residentDocuments,
      }),
    [complaint, allHearings, residentDocuments]
  );
  const latestUpdate = timeline[0] ?? null;

  /** The six-stage view a resident follows, with N/A and skipped states. */
  const residentProgress = useMemo(
    () => buildResidentProgress(complaint, { hearings: allHearings }),
    [complaint, allHearings]
  );

  /* ── Deep links ─────────────────────────────────────────────────
   *
   * A notification that points at a complaint lands here with
   * `?section=progress` or `?section=resolution`. The id is read from the
   * URL and the matching panel is brought into view, so the resident sees
   * the thing the message was about instead of the top of the page.
   */
  useEffect(() => {
    if (loading) return;
    const params = new URLSearchParams(window.location.search);
    const section = params.get("section");
    if (!section) return;
    const node = document.getElementById(`section-${section}`);
    if (!node) return;
    node.scrollIntoView({ behavior: "smooth", block: "start" });
    node.focus({ preventScroll: true });
  }, [loading, complaintId]);

  /* ── Eligibility checks ────────────────────────────────────────── */
  const isComplaintActive = useMemo(() => {
    if (!complaint) return false;
    return !INACTIVE_STATUSES.includes(complaint.status);
  }, [complaint]);

  const referralButtonState = useMemo(() => {
    if (!complaint || !isComplaintActive) return "hidden";
    if (referralRequest) {
      if (referralRequest.status === "officially_referred") return "referred";
      return "requested";
    }
    return "available";
  }, [complaint, isComplaintActive, referralRequest]);

  /* ── Handlers ──────────────────────────────────────────────────── */

  const handleBack = useCallback(() => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
    } else {
      router.push(RESIDENT_ROUTES.complaints);
    }
  }, [router]);

  const handleDownload = useCallback(async () => {
    if (!complaint || downloading) return;
    setDownloading(true);
    const toastId = toast.loading("Preparing complaint summary...");
    try {
      generateComplaintPdf(complaint, {
        evidence: complaint.evidence ?? [],
        hearings: complaint.hearings ?? [],
        caseStatuses: complaint.caseStatuses ?? [],
        referralRequest,
      });
      toast.dismiss(toastId);
      toast.success("Complaint summary downloaded.");
    } catch {
      toast.dismiss(toastId);
      toast.error("Summary could not be downloaded.");
    } finally {
      setDownloading(false);
    }
  }, [complaint, downloading, referralRequest]);

  const handleOpenReferralModal = useCallback(() => {
    setReferralReason("");
    setSafetyConcern(false);
    setReferralModalOpen(true);
  }, []);

  const handleCloseReferralModal = useCallback(() => {
    if (submittingReferral) return;
    setReferralModalOpen(false);
    setReferralReason("");
    setSafetyConcern(false);
  }, [submittingReferral]);

  const handleSubmitReferral = useCallback(async () => {
    const trimmed = referralReason.trim();
    if (!trimmed) {
      toast.error("Enter a reason for your request.");
      return;
    }
    if (!complaint?.id) return;

    setSubmittingReferral(true);
    const toastId = toast.loading("Submitting referral request...");
    try {
      const result = await submitReferralRequest(
        complaint.id,
        trimmed,
        safetyConcern
      );

      if (!result.success) {
        toast.dismiss(toastId);
        if (result.error?.includes("already under review")) {
          toast.error("A referral request is already under review.");
        } else if (result.error === "Please sign in again.") {
          toast.error("Please sign in again.");
        } else {
          toast.error("Referral request could not be submitted.");
        }
        return;
      }

      toast.dismiss(toastId);
      toast.success("Referral request submitted for barangay review.");
      setReferralRequest(result.request);
      setReferralModalOpen(false);
      setReferralReason("");
      setSafetyConcern(false);
    } catch {
      toast.dismiss(toastId);
      toast.error("Referral request could not be submitted.");
    } finally {
      setSubmittingReferral(false);
    }
  }, [complaint, referralReason, safetyConcern]);

  const handleViewEvidence = useCallback((fileName) => {
    toast(
      `Preview of "${fileName}" \u2014 this is a prototype. In production, a document viewer would open.`,
      { icon: "\ud83d\udcc4", duration: 4000 }
    );
  }, []);

  /* ── Loading / Not found ──────────────────────────────────────────── */

  if (loading) {
    return (
      <section className="mx-auto max-w-[1100px] py-10 text-center">
        <div className="mx-auto h-12 w-12 animate-spin rounded-full border-4 border-secondary border-t-transparent" />
        <p className="mt-4 text-sm text-muted">Loading complaint details…</p>
      </section>
    );
  }

  if (!complaint) {
    return (
      <section className="mx-auto max-w-[1100px] py-10 text-center">
        <AlertCircle className="mx-auto h-12 w-12 text-critical" />
        <h1 className="mt-4 font-heading text-xl font-semibold text-navy dark:text-secondary">
          Not Found
        </h1>
        <p className="mt-2 text-sm text-muted">
          This complaint may have been removed or the link is invalid.
        </p>
        <button
          type="button"
          onClick={() => router.push(RESIDENT_ROUTES.complaints)}
          className="mt-6 inline-flex min-h-[44px] items-center gap-2 rounded-full bg-navy px-6 text-sm font-semibold text-white transition-colors hover:bg-secondary"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to My Complaints
        </button>
      </section>
    );
  }

  /* ── Overview values ──────────────────────────────────────────────── */

  const currentStage = getStageLabel(complaint);
  const confirmedCat = complaint.confirmedCategory ?? null;
  const confirmedUrg = complaint.confirmedPriority ?? null;
  const lastUpdated =
    complaint.updates?.length > 0
      ? complaint.updates[0].date
      : complaint.submittedOn;

  const showConfirmedValues = confirmedCat !== null && confirmedUrg !== null;

  /* ── Render ───────────────────────────────────────────────────────── */

  return (
    <>
    <div className="print-area">
      <section
          aria-labelledby="complaint-detail-title"
          className="mx-auto max-w-[1100px]"
        >
          {/* ── Page Header ──────────────────────────────────────────── */}
          <header className="flex flex-wrap items-start justify-between gap-4 no-print">
            <div className="min-w-0">
              <h1
                id="complaint-detail-title"
                className="font-heading text-2xl font-semibold tracking-tight text-navy dark:text-secondary sm:text-3xl"
              >
                {complaint.title}
              </h1>
              <p className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm text-muted">
                <span className="font-medium text-secondary">
                  {complaint.caseNo}
                </span>
                <span aria-hidden="true" className="text-muted/50">
                  ·
                </span>
                <span
                  className={
                    hasCaseNumber(complaint)
                      ? "font-medium text-secondary"
                      : "text-muted"
                  }
                >
                  Barangay Case No. {caseNumber}
                </span>
                <span aria-hidden="true" className="text-muted/50">
                  ·
                </span>
                <span>Filed {complaint.submittedOn}</span>
              </p>
            </div>
            <button
              type="button"
              onClick={handleBack}
              aria-label="Close complaint detail and return to complaints list"
              className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-line bg-white dark:bg-alt px-5 text-sm font-semibold text-mirage transition-colors hover:border-secondary hover:text-navy dark:text-secondary"
            >
              <X className="h-4 w-4" aria-hidden="true" />
              Close
            </button>
          </header>

          {/* ── 0. Latest resident-visible update ───────────────────── */}
          {latestUpdate ? (
            <div
              id={`section-${RESIDENT_SECTION.progress}`}
              tabIndex={-1}
              className="mt-6 scroll-mt-28 rounded-2xl border border-line bg-info-soft/40 p-5 sm:p-6 focus:outline-none"
            >
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                Latest Update
              </p>
              <p className="mt-2 text-[15px] leading-relaxed text-navy dark:text-secondary">
                {latestUpdate.label}
              </p>
              {latestUpdate.at ? (
                <p className="mt-1 text-[12.5px] text-muted">
                  {formatDateTime(latestUpdate.at)}
                </p>
              ) : null}
            </div>
          ) : null}

          {/* ── 1. Complaint Overview Cards ──────────────────────────── */}
          <div
              className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"
              role="list"
              aria-label="Complaint overview"
            >
              <div
                className="overview-card rounded-2xl border border-line bg-white dark:bg-alt p-5 shadow-[0_1px_2px_rgba(11,33,68,0.06)]"
                role="listitem"
              >
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                  Stage
                </p>
                <p className="mt-1.5 text-[15px] font-semibold text-navy dark:text-secondary">
                  {currentStage}
                </p>
              </div>
              <div
                className="overview-card rounded-2xl border border-line bg-white dark:bg-alt p-5 shadow-[0_1px_2px_rgba(11,33,68,0.06)]"
                role="listitem"
              >
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                  Category
                </p>
                <div className="mt-1.5">
                  {showConfirmedValues ? (
                    <StatusBadge label={confirmedCat} />
                  ) : (
                    <span className="text-[14px] font-medium text-muted">
                      Pending Confirmation
                    </span>
                  )}
                </div>
              </div>
              <div
                className="overview-card rounded-2xl border border-line bg-white dark:bg-alt p-5 shadow-[0_1px_2px_rgba(11,33,68,0.06)]"
                role="listitem"
              >
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                  Urgency
                </p>
                <div className="mt-1.5">
                  {showConfirmedValues ? (
                    <StatusBadge label={confirmedUrg} />
                  ) : (
                    <span className="text-[14px] font-medium text-muted">
                      Pending Confirmation
                    </span>
                  )}
                </div>
              </div>
              <div
                className="overview-card rounded-2xl border border-line bg-white dark:bg-alt p-5 shadow-[0_1px_2px_rgba(11,33,68,0.06)]"
                role="listitem"
              >
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                  Updated
                </p>
                <p className="mt-1.5 text-[15px] font-semibold text-navy dark:text-secondary">
                  {lastUpdated}
                </p>
              </div>
            </div>

          {/* ── 2. Deadline-Basis Notice ─────────────────────────────── */}
          {complaint.kpTracker && complaint.kpTracker.applicable && complaint.kpTracker.currentPhase !== "Not Applicable" && (
            <div className="deadline-notice mt-4 rounded-2xl border border-line bg-white dark:bg-alt p-4 sm:p-5 shadow-[0_1px_2px_rgba(11,33,68,0.06)]">
              <div className="flex items-start gap-3">
                <Info
                  className="mt-0.5 h-4 w-4 shrink-0 text-secondary"
                  aria-hidden="true"
                />
                <p className="text-[13px] leading-relaxed text-mirage">
                  Deadline basis: Mediation is counted from the parties&apos; first
                  meeting. Conciliation is counted from the Pangkat&apos;s
                  convening.
                </p>
              </div>
            </div>
          )}

          {/* ── 3. Complaint Information ─────────────────────────────── */}
          <div className="mt-6 rounded-2xl border border-line bg-white dark:bg-alt p-5 sm:p-6 shadow-[0_1px_2px_rgba(11,33,68,0.06)]">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-[13px] font-semibold uppercase tracking-wide text-muted">
                Complaint Details
              </h2>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-info-soft px-3 py-1 text-[11.5px] font-semibold text-secondary">
                <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                Original
              </span>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-info-soft">
                  <User className="h-4 w-4 text-secondary" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                    Complainant
                  </p>
                  <p className="mt-0.5 text-sm font-medium text-mirage">
                    {complaint.complainantName ?? "Not provided"}
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center rounded-lg bg-info-soft">
                  <User className="h-4 w-4 text-secondary" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                    Respondent
                  </p>
                  <p className="mt-0.5 text-sm font-medium text-mirage">
                    {respondent.label}
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center rounded-lg bg-info-soft">
                  <Calendar
                    className="h-4 w-4 text-secondary"
                    aria-hidden="true"
                  />
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                    Date
                  </p>
                  <p className="mt-0.5 text-sm font-medium text-mirage">
                    {formatDate(complaint.incidentDate)}
                  </p>
                </div>
              </div>

              {complaint.incidentTime && (
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center rounded-lg bg-info-soft">
                    <Clock
                      className="h-4 w-4 text-secondary"
                      aria-hidden="true"
                    />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                      Time
                    </p>
                    {/* `incident_time` is a SQL `time` — a local wall clock the
                        resident typed, not an instant. It is rendered by the
                        shared Manila formatter so a resident reads "8:00 PM"
                        rather than the raw 24-hour column. */}
                    <p className="mt-0.5 text-sm font-medium text-mirage">
                      {formatResidentTime(complaint.incidentTime) ||
                        complaint.incidentTime}
                    </p>
                  </div>
                </div>
              )}

              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center rounded-lg bg-info-soft">
                  <MapPin
                    className="h-4 w-4 text-secondary"
                    aria-hidden="true"
                  />
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                    Location
                  </p>
                  <p className="mt-0.5 text-sm font-medium text-mirage">
                    {complaint.location ?? "Not provided"}
                  </p>
                </div>
              </div>

              {complaint.personsInvolved &&
                complaint.personsInvolved !== complaint.respondent && (
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center rounded-lg bg-info-soft">
                      <User
                        className="h-4 w-4 text-secondary"
                        aria-hidden="true"
                      />
                    </div>
                    <div className="min-w-0">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                        People Involved
                      </p>
                      <p className="mt-0.5 text-sm font-medium text-mirage">
                        {complaint.personsInvolved}
                      </p>
                    </div>
                  </div>
                )}

              {complaint.witnesses && (
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center rounded-lg bg-info-soft">
                    <User
                      className="h-4 w-4 text-secondary"
                      aria-hidden="true"
                    />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                      Witnesses
                    </p>
                    <p className="mt-0.5 text-sm font-medium text-mirage">
                      {complaint.witnesses}
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Description */}
            <div className="mt-5 border-t border-line/70 pt-5">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                Description
              </p>
              <p className="mt-2 text-sm leading-relaxed text-mirage whitespace-pre-wrap">
                {complaint.description ?? complaint.summary}
              </p>
            </div>

            {/* Filed date and time */}
            <div className="mt-4 flex items-start gap-3">
              <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center rounded-lg bg-info-soft">
                <Clock className="h-4 w-4 text-secondary" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                  Filed
                </p>
                <p className="mt-0.5 text-sm font-medium text-mirage">
                  {formatDateTime(complaint.submittedAt)}
                </p>
              </div>
            </div>
          </div>

          {/* ── 4. Documents and Forms ──────────────────────────────── */}
          <ReklamoDocumentCard complaint={complaint} />

          {/* ── 4a. Official documents the barangay issued to you ──── */}
          <ResidentOfficialDocuments documents={residentDocuments} />

          {/* ── 4b. Information request ─────────────────────────────── */}
          {/* Sits directly under the documents because it is the one
              section that asks something of the resident: if an official
              has recorded that information is missing, this is where the
              answer is given. Renders nothing at all when no request is
              outstanding. */}
          <InformationRequestPanel complaint={complaint} onSent={refresh} />

          {/* ── 5. Evidence ──────────────────────────────────────────── */}
          <div className="mt-6 rounded-2xl border border-line bg-white dark:bg-alt p-5 sm:p-6 shadow-[0_1px_2px_rgba(11,33,68,0.06)]">
              <h2 className="text-[13px] font-semibold uppercase tracking-wide text-muted">
                Evidence
              </h2>
            {evidence.length > 0 ? (
              <>
                <p className="mt-1 text-sm text-muted">
                  {evidence.length}{" "}
                  {evidence.length === 1 ? "file" : "files"} attached
                </p>
                <ul className="mt-4 divide-y divide-line/70 rounded-xl border border-line/50 bg-canvas">
                  {evidence.map((file) => {
                    const IconComp = getFileIconComponent(file.fileType);
                    const typeLabel = getFileTypeLabel(file.fileType);
                    return (
                      <li
                        key={file.id}
                        className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <span
                            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white dark:bg-alt"
                            aria-hidden="true"
                          >
                            <IconComp className="h-5 w-5 text-secondary" />
                          </span>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-mirage">
                              {file.fileName}
                            </p>
                            <p className="text-[12px] text-muted">
                              {file.description
                                ? file.description
                                : `${typeLabel}${
                                    file.fileSize
                                      ? ` \u00b7 ${formatFileSize(file.fileSize)}`
                                      : ""
                                  }`}
                            </p>
                            {file.description && (
                              <p className="text-[11px] text-muted">
                                {typeLabel}
                                {file.fileSize
                                  ? ` \u00b7 ${formatFileSize(file.fileSize)}`
                                  : ""}
                                {file.uploadedAt
                                  ? ` \u00b7 ${formatDate(file.uploadedAt)}`
                                  : ""}
                              </p>
                            )}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleViewEvidence(file.fileName)}
                          aria-label={`Preview ${file.fileName}`}
                          className="shrink-0 inline-flex min-h-[36px] items-center gap-1.5 rounded-full border border-line bg-white dark:bg-alt px-4 text-[12.5px] font-semibold text-secondary transition-colors hover:border-secondary hover:bg-info-soft"
                        >
                          View
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </>
            ) : (
              <p className="mt-3 text-sm text-muted">
                No evidence attached.
              </p>
            )}
          </div>

          {/* ── 6. Deadline Tracker ──────────────────────────────────── */}
          <KPTrackerSection kpTracker={complaint.kpTracker} deadlineTracker={complaint.deadlineTracker} />

          {/* ── 7. Hearing Schedule ──────────────────────────────────── */}
          <div className="mt-6 rounded-2xl border border-line bg-white dark:bg-alt p-5 sm:p-6 shadow-[0_1px_2px_rgba(11,33,68,0.06)]">
              <h2 className="text-[13px] font-semibold uppercase tracking-wide text-muted">
                Hearings
              </h2>
            {allHearings.length > 0 ? (
              <p className="mt-1 text-sm text-muted">
                {allHearings.length}{" "}
                {allHearings.length === 1 ? "session" : "sessions"} scheduled
              </p>
            ) : null}

            {allHearings.length > 0 ? (
              <div className="mt-4 space-y-3">
                {allHearings.map((h) => {
                  const md = formatMonthDay(h.hearing_date);
                  return (
                    <div
                      key={h.id}
                      className="rounded-xl border border-line/50 bg-canvas p-4 sm:p-5"
                    >
                      <div className="flex flex-wrap items-start gap-4">
                        {/* Date badge */}
                        <div className="flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-xl bg-white dark:bg-alt border border-line">
                          <span className="text-[10px] font-bold uppercase tracking-wide text-muted">
                            {md.month}
                          </span>
                          <span className="text-lg font-bold text-navy dark:text-secondary leading-tight">
                            {md.day}
                          </span>
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <h3 className="text-sm font-semibold text-navy dark:text-secondary">
                              {h.title || h.hearing_type || "Hearing"}
                            </h3>
                            <StatusBadge label={residentHearingStatus(h.status)} />
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-3 text-[13px] text-mirage">
                            <span className="flex items-center gap-1.5">
                              <Clock
                                className="h-3.5 w-3.5 text-secondary"
                                aria-hidden="true"
                              />
                              {formatResidentTime(h.hearing_time) || "To be announced"}
                            </span>
                            {h.venue && (
                              <span className="flex items-center gap-1.5">
                                <MapPin
                                  className="h-3.5 w-3.5 text-secondary"
                                  aria-hidden="true"
                                />
                                {h.venue}
                              </span>
                            )}
                          </div>
                          {h.cancel_reason ? (
                            <p className="mt-2 text-[12.5px] text-muted">
                              Reason: {h.cancel_reason}
                            </p>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="mt-3 text-sm text-muted">
                No hearings scheduled yet.
              </p>
            )}
          </div>

          {/* ── 8. Case Progress ─────────────────────────────────────── */}
          {/*
            A resolution notification deep-links with `?section=resolution`
            (`resolveNotificationTarget` emits it), so this panel carries
            that id: stage 6 is Resolution and the badge above it is the
            outcome the message is about. It used to repeat `section-progress`
            — a duplicate of the Latest Update card — which left the
            resolution link with nothing to find and made `getElementById`
            ambiguous for both.
          */}
          <section
            id="section-resolution"
            tabIndex={-1}
            className="mt-6 scroll-mt-28 rounded-2xl border border-line bg-white dark:bg-alt p-5 sm:p-6 shadow-[0_1px_2px_rgba(11,33,68,0.06)] focus:outline-none"
          >
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-[13px] font-semibold uppercase tracking-wide text-muted">
                Progress
              </h2>
              <StatusBadge label={currentStage} />
            </div>

            {/*
              The six stages a resident follows, derived from canonical
              state on every render — never stored, so two complaints in
              the same state always show the same stages. A step the
              barangay will not take reads "Not Applicable" rather than
              being silently omitted, which is what stops a rejected case
              from appearing to hang at "Under Review".
            */}
            <ol className="mt-5 space-y-0">
              {residentProgress.map((stage, index) => {
                const isDone = stage.state === "done";
                const isCurrent = stage.state === "current";
                const isNotApplicable = stage.state === "not_applicable";
                const isLast = index === residentProgress.length - 1;

                return (
                  <li key={stage.key} className="relative flex gap-4">
                    {/* Timeline marker */}
                    <div className="flex flex-col items-center">
                      <div
                        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 ${
                          isDone
                            ? "border-success bg-success-soft"
                            : isCurrent
                            ? "border-secondary bg-info-soft"
                            : isNotApplicable
                            ? "border-dashed border-line bg-canvas"
                            : "border-line bg-canvas"
                        }`}
                        aria-hidden="true"
                      >
                        {isDone ? (
                          <CheckCircle2 className="h-4 w-4 text-success" />
                        ) : isCurrent ? (
                          <div className="h-3 w-3 rounded-full bg-secondary animate-pulse" />
                        ) : isNotApplicable ? (
                          <Ban className="h-3.5 w-3.5 text-muted/50" />
                        ) : (
                          <Circle className="h-4 w-4 text-muted/40" />
                        )}
                      </div>
                      {!isLast && (
                        <div
                          className={`w-0.5 flex-1 min-h-[24px] timeline-line ${
                            isDone
                              ? "border-l-2 border-dashed border-success"
                              : "border-l-2 border-dashed border-line"
                          }`}
                        />
                      )}
                    </div>

                    {/* Content */}
                    <div className="flex-1 pb-6">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <h3
                          className={`text-sm font-semibold ${
                            isDone
                              ? "text-navy dark:text-secondary"
                              : isCurrent
                              ? "text-secondary"
                              : "text-muted"
                          }`}
                        >
                          {stage.label}
                        </h3>
                        {isCurrent && <StatusBadge label="Current" />}
                        {isNotApplicable && (
                          <span className="text-[12px] text-muted/60">
                            Not Applicable
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-[13px] leading-relaxed text-muted">
                        {stage.note}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ol>

            {/* Written history, taken verbatim from the barangay's own
                resident-visible records. Nothing is summarised here. */}
            {timeline.length > 0 ? (
              <div className="mt-2 border-t border-line pt-4">
                <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                  Case History
                </h3>
                <ul className="mt-3 space-y-3">
                  {timeline.slice(0, 8).map((entry, index) => (
                    <li
                      key={`${entry.kind}-${entry.id || index}`}
                      className="flex items-start gap-3"
                    >
                      <span
                        aria-hidden="true"
                        className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-secondary"
                      />
                      <div className="min-w-0">
                        <p className="text-[13px] leading-relaxed text-mirage">
                          {entry.label}
                        </p>
                        {entry.at ? (
                          <p className="mt-0.5 text-[12px] text-muted">
                            {formatDateTime(entry.at)}
                          </p>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="mt-2 flex items-start gap-2.5 rounded-xl bg-canvas px-4 py-3">
              <Info
                className="mt-0.5 h-4 w-4 shrink-0 text-secondary"
                aria-hidden="true"
              />
              <p className="text-[13px] leading-relaxed text-secondary">
                Processing times may vary. You will be notified of updates.
              </p>
            </div>
          </section>

          {/* ── 9. PNP Referral Status ──────────────────────────────── */}
          {referralRequest && (
            <div className="mt-6 rounded-2xl border border-line bg-white dark:bg-alt p-5 sm:p-6 shadow-[0_1px_2px_rgba(11,33,68,0.06)]">
              <h2 className="text-[13px] font-semibold uppercase tracking-wide text-muted">
                PNP Referral Request
              </h2>
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                    Status
                  </p>
                  <p className="mt-1 text-sm font-semibold text-navy dark:text-secondary">
                    {REFERRAL_STATUS_LABELS[referralRequest.status] || referralRequest.status}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                    Date Requested
                  </p>
                  <p className="mt-1 text-sm font-medium text-mirage">
                    {formatDate(referralRequest.requested_at)}
                  </p>
                </div>
                {referralRequest.decision_note && (
                  <div className="sm:col-span-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                      Update
                    </p>
                    <p className="mt-1 text-sm text-mirage">
                      {referralRequest.decision_note}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── 9. Download Summary + Request PNP Referral ──────────── */}
          <div className="footer-actions mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between no-print">
            <div className="flex flex-wrap items-center gap-3">
              {complaint && (
                <button
                  type="button"
                  ref={referralButtonRef}
                  onClick={
                    referralButtonState === "available"
                      ? handleOpenReferralModal
                      : undefined
                  }
                  disabled={
                    referralButtonState === "requested" ||
                    referralButtonState === "referred" ||
                    referralButtonState === "hidden"
                  }
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-full bg-navy px-6 text-sm font-semibold text-white transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {referralButtonState === "requested" ? (
                    <>
                      <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                      Referral Requested
                    </>
                  ) : referralButtonState === "referred" ? (
                    <>
                      <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                      Referred to PNP
                    </>
                  ) : (
                    <>
                      <ShieldAlert className="h-4 w-4" aria-hidden="true" />
                      Request PNP Referral
                    </>
                  )}
                </button>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {complaint && (
                <button
                  type="button"
                  onClick={handleDownload}
                  disabled={downloading}
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-line bg-white dark:bg-alt px-6 text-sm font-semibold text-mirage transition-colors hover:border-secondary hover:text-navy dark:text-secondary disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {downloading ? (
                    <>
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-mirage border-t-transparent" />
                      Preparing...
                    </>
                  ) : (
                    <>
                      <Download className="h-4 w-4" aria-hidden="true" />
                      Download Summary
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        </section>
      </div>

      {/* ── Request PNP Referral Modal ─────────────────────────────── */}
      <ResidentModal
        open={referralModalOpen}
        onClose={handleCloseReferralModal}
        labelledBy="referral-modal-title"
        title="Request PNP Referral"
        maxWidthClass="max-w-lg"
      >
        <div className="space-y-4">
          <p className="text-[13px] leading-relaxed text-muted">
            Send this request to the barangay for review. This does not automatically create a police report or blotter entry.
          </p>

          <div>
            <label
              htmlFor="referral-reason"
              className="text-[11px] font-semibold uppercase tracking-wide text-muted"
            >
              Reason for referral request <span className="text-critical">*</span>
            </label>
            <textarea
              id="referral-reason"
              rows={4}
              value={referralReason}
              onChange={(e) =>
                setReferralReason(e.target.value.slice(0, MAX_REASON_LENGTH))
              }
              placeholder="Briefly explain why police referral may be needed."
              className="mt-1.5 w-full resize-none rounded-xl border border-line bg-white dark:bg-alt px-4 py-2.5 text-sm text-mirage placeholder:text-muted/50 focus:outline-none focus:ring-2 focus:ring-secondary"
            />
            <p className="mt-1 text-right text-[11px] text-muted">
              {referralReason.length}/{MAX_REASON_LENGTH}
            </p>
          </div>

          <div className="flex items-start gap-3">
            <input
              id="safety-concern"
              type="checkbox"
              checked={safetyConcern}
              onChange={(e) => setSafetyConcern(e.target.checked)}
              className="mt-1 h-4 w-4 shrink-0 rounded border-line text-secondary focus:ring-secondary"
            />
            <label htmlFor="safety-concern" className="text-[13px] text-mirage">
              There is an immediate safety concern.
            </label>
          </div>

          {safetyConcern && (
            <div className="rounded-xl border border-gold/40 bg-paledgold px-4 py-3">
              <p className="text-[13px] leading-relaxed text-bourbon">
                If anyone is in immediate danger, contact the police or emergency services directly. Do not wait for this request to be reviewed.
              </p>
            </div>
          )}

          <div className="rounded-xl bg-canvas px-4 py-3">
            <p className="text-[13px] leading-relaxed text-muted">
              Existing evidence remains part of the barangay case. Authorized officials will determine what may be included in an official referral.
            </p>
          </div>

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={handleCloseReferralModal}
              disabled={submittingReferral}
              className="inline-flex min-h-[40px] items-center gap-2 rounded-full border border-line bg-white dark:bg-alt px-5 text-sm font-semibold text-mirage transition-colors hover:border-secondary hover:text-navy dark:text-secondary disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmitReferral}
              disabled={submittingReferral || !referralReason.trim()}
              className="inline-flex min-h-[40px] items-center gap-2 rounded-full bg-navy px-5 text-sm font-semibold text-white transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submittingReferral ? (
                <>
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  Submitting...
                </>
              ) : (
                "Submit Request"
              )}
            </button>
          </div>
        </div>
      </ResidentModal>
    </>
  );
}
