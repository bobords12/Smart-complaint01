"use client";

/**
 * Captain Portal -> Complaints: SUMMONS, MEDIATION & ATTENDANCE.
 *
 * WHAT THIS SECTION IS NOW
 *   Two panels, in the order the work happens:
 *
 *     1. Mediation Schedule   the date, time and venue, with the single
 *                             schedule / reschedule / cancel controls
 *     2. Hearing Documents    the current document and the next action,
 *                             one column per party, equal weight
 *
 *   The section header carries one status for the whole section (see
 *   mediationSectionStatusFor() in ../../lib/captainComplaintWorkflow.js),
 *   and each panel keeps a single current-state chip. The ladders of status
 *   chips this file used to render — Notice Not Generated -> Notice
 *   Generated -> Physical Copy Recorded -> Digital Copy Sent -> Viewed, and
 *   Not Generated -> Generated -> Issued -> Served -> Acknowledged — are
 *   gone. History lives in the case timeline and the audit log; the panel
 *   shows where the case stands and what to do next.
 *
 * WHAT IS NOT HERE, ON PURPOSE
 *   * "TEMPLATE REQUIRED" is not a status. When the Notice of Hearing
 *     cannot be produced, the officer sees one concise message at the moment
 *     they ask for the document — "Document generation unavailable. The
 *     required barangay template is not configured." — with an optional
 *     View Details, and nothing else.
 *   * No "Why is this not generated?" button, no long technical
 *     paragraphs, and no banner about what the software will not decide.
 *   * Generated is not issued, issued is not served, and served is not
 *     acknowledged. Nothing here advances a state on its own.
 *   * No respondent digital copy: there is no respondent portal.
 *   * "Viewed" is not shown. Nothing in the application writes a 'viewed'
 *     lifecycle event, so the read is not knowable and is not guessed at.
 *
 * WHAT IS REUSED, NOT REBUILT
 *   The schedule writes the same `hearings` row and the same audit entry it
 *   always wrote, and reuses rescheduleHearing() and the existing
 *   cancellation dialog. Documents are produced by the shared generator in
 *   ../../lib/hearing/mediationDocuments.js — the same code DocumentsTab
 *   runs — and only for the Notice of Hearing, the one document this portal
 *   can actually make. Service and delivery reuse the existing ServiceModal
 *   against `summons_service_records`, which is a real row with a real
 *   recorder.
 *
 * NOTHING IS STORED AS A NEW STATUS
 *   Every state below is derived by summonsPartyStatusFor(); this file only
 *   renders it.
 */

import { useCallback, useMemo, useState } from "react";
import toast from "react-hot-toast";
import {
  AlertTriangle,
  CalendarDays,
  Check,
  Clock,
  Eye,
  FileText,
  Gavel,
  Info,
  MapPin,
  Printer,
  User,
} from "lucide-react";
import { rescheduleHearing, scheduleFailureMessage, summonsPartyStatusFor } from "@/lib/captainComplaintWorkflow";
import { routingGate } from "@/lib/captainComplaintRouting";
import {
  generateNoticeOfHearing,
  prepareMediationDocuments,
} from "@/lib/hearing/mediationDocuments";
import { logComplaintActivity } from "@/lib/complaintQueries";
import { SITE } from "@/lib/constants";
import {
  SecondaryAction,
  WorkflowChip,
  WorkflowField,
  WorkflowNote,
  WorkflowPanel,
} from "./captainWorkflowUi";
import ServiceModal from "./ServiceModal";
import SendSummonsCopyButton from "./SendSummonsCopyButton";
import HearingLifecycleModal from "./HearingLifecycleModal";
import { formatDateShort, formatDateTime, formatTime, resolveComplainantName } from "./complaintMeta";
import { useDocumentViewer } from "@/components/shared/DocumentViewerProvider";

const SUMMONS_BUCKET = "documents";
const HEARING_TYPE = "Mediation";

function ordinal(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/** One party's column: identity, current status, document, actions. */
function PartyColumn({ title, name, chip, children }) {
  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-2xl border border-line bg-canvas p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <User className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">{title}</p>
            <p className="truncate text-sm font-semibold text-navy">{name || "Not identified"}</p>
          </div>
        </div>
        {chip}
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

/** The document row with its view / print actions. */
function DocumentLine({ label, doc, onView, onPrint, action }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-white px-3 py-2.5">
      <div className="flex min-w-0 items-center gap-2">
        <FileText className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold text-mirage">{label}</p>
          <p className="truncate text-[11px] text-muted">
            {doc
              ? `${doc.title}${doc.created_at ? ` — ${formatDateShort(doc.created_at)}` : ""}`
              : "Not generated"}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {doc ? (
          <>
            <SecondaryAction
              onClick={() => onView(doc)}
              className="h-9 px-3 text-xs"
              title={`View ${label} without downloading it`}
            >
              <Eye className="h-3.5 w-3.5" aria-hidden="true" />
              View
            </SecondaryAction>
            <SecondaryAction
              onClick={() => onPrint(doc)}
              className="h-9 px-3 text-xs"
              title={`Print ${label}`}
            >
              <Printer className="h-3.5 w-3.5" aria-hidden="true" />
              Print
            </SecondaryAction>
          </>
        ) : null}
        {action}
      </div>
    </div>
  );
}

export default function SummonsTracker({
  complaint,
  supabase,
  user,
  summons = [],
  serviceRecords = [],
  documents = [],
  hearings = [],
  minutes = [],
  lifecycleEvents = [],
  activityLogs = [],
  onChanged,
}) {
  const [issuing, setIssuing] = useState(false);
  const [serviceFor, setServiceFor] = useState(null);
  const [scheduling, setScheduling] = useState(false);
  const [scheduleError, setScheduleError] = useState("");
  // Set while the Captain is correcting an existing schedule. The row is then
  // updated in place, so a reschedule never leaves a duplicate behind.
  const [reschedulingId, setReschedulingId] = useState(null);
  const [schedule, setSchedule] = useState({
    hearing_date: "",
    hearing_time: "",
    venue: SITE.hall,
  });
  const [cancellingId, setCancellingId] = useState(null);
  const [cancelTarget, setCancelTarget] = useState(null);
  // Set only after a generation attempt actually failed, so a missing
  // template is reported once, on demand, and never as a standing status.
  const [documentError, setDocumentError] = useState(null);
  const [documentErrorDetail, setDocumentErrorDetail] = useState(null);
  const [showDocumentDetails, setShowDocumentDetails] = useState(false);
  const [noticeBusy, setNoticeBusy] = useState(false);

  const { viewDocument } = useDocumentViewer();

  const gate = useMemo(() => routingGate(complaint), [complaint]);
  const complainantName = useMemo(() => resolveComplainantName(complaint), [complaint]);

  const status = useMemo(
    () =>
      summonsPartyStatusFor({
        complaint,
        complainantName,
        summons,
        serviceRecords,
        documents,
        hearings,
        minutes,
        lifecycleEvents,
        activityLogs,
      }),
    [
      complaint,
      complainantName,
      summons,
      serviceRecords,
      documents,
      hearings,
      minutes,
      lifecycleEvents,
      activityLogs,
    ]
  );

  const { hearing, respondentSummons, complainant, respondent, complaintCopy, nextAction } = status;

  const summonsIssued = Boolean(respondentSummons.issuedRow);
  const summonsDocument = respondentSummons.document || null;

  /* ── Open a case document ─────────────────────────────────────
   *
   * View hands the file to the shared in-app viewer, so reading a notice
   * or a summons no longer downloads it. Print still goes through the
   * browser's own document viewer in a new tab, which is what produces a
   * faithful printed copy of a Word file.
   */
  const viewDoc = useCallback(
    (doc) => {
      if (!doc?.storage_path) {
        toast.error("This document has no stored file.");
        return;
      }
      viewDocument({
        supabase,
        bucket: SUMMONS_BUCKET,
        storagePath: doc.storage_path,
        title: doc.title || "Document",
        subtitle: doc.filename || null,
        filename: doc.filename || null,
        mime: doc.mime_type || null,
      });
    },
    [supabase, viewDocument]
  );

  const printDoc = useCallback(
    async (doc) => {
      if (!doc?.storage_path) {
        toast.error("This document has no stored file.");
        return;
      }
      const { data, error } = await supabase.storage
        .from(SUMMONS_BUCKET)
        .createSignedUrl(doc.storage_path, 3600);
      if (error || !data?.signedUrl) {
        toast.error("Could not open this document.");
        return;
      }
      window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    },
    [supabase]
  );

  const reportDocumentError = (error, detail) => {
    setDocumentError(error);
    setDocumentErrorDetail(detail || null);
    setShowDocumentDetails(false);
    if (error) toast.error(error, { duration: 9000 });
  };

  /* ── Generate the Notice of Hearing ─────────────────────────────
   *
   * Runs the shared generator, the same one DocumentsTab runs. It is
   * offered only while no active notice exists, so an existing document a
   * party already holds is never replaced by a second print from here.
   */
  const handleGenerateNotice = async () => {
    if (!hearing?.id) {
      toast.error("No hearing schedule has been saved for this case.");
      return;
    }
    setNoticeBusy(true);
    try {
      const result = await generateNoticeOfHearing(supabase, {
        complaint,
        user,
        hearing,
        documents,
      });
      if (!result.success) {
        reportDocumentError(result.error, result.detail);
        return;
      }
      setDocumentError(null);
      setDocumentErrorDetail(null);
      toast.success("Notice of Hearing generated and stored.");
      onChanged?.();
    } finally {
      setNoticeBusy(false);
    }
  };

  /* ── Issue the Notice of Hearing to the respondent ─────────────
   *
   * The `summons` row is the issuance record: its issued_at column is
   * NOT NULL DEFAULT now(), so this insert is what stamps the issue date.
   * What it points at is the Notice of Hearing, which is the one document
   * both parties are named on. Issuing records nothing about service.
   *
   * The stored `action` strings (hearing_notice_generated,
   * respondent_summons_issued) are audit keys read back by
   * captainComplaintWorkflow, so they keep their historical names even
   * though the document is now a notice.
   */
  const handleIssue = async () => {
    const doc = summonsDocument;
    if (!doc?.storage_path) {
      toast.error("Generate the Notice of Hearing before issuing it.");
      return;
    }
    setIssuing(true);
    try {
      const { data: summonsInsert, error: summonsError } = await supabase
        .from("summons")
        .insert({
          complaint_id: complaint.id,
          hearing_id: hearing?.id || null,
          storage_path: doc.storage_path,
        })
        .select("id")
        .single();
      if (summonsError) throw summonsError;

      await supabase.from("document_lifecycle_events").insert({
        document_id: doc.id,
        complaint_id: complaint.id,
        event_type: "released",
        actor_id: user?.id || null,
        notes:
          "Notice of Hearing issued to the respondent. Service to the respondent is still to be recorded separately.",
      });

      await logComplaintActivity(supabase, {
        action: "respondent_summons_issued",
        complaintId: complaint.id,
        ref: complaint.reference_number || undefined,
        details: {
          title: "Notice of Hearing",
          summons_id: summonsInsert?.id || null,
          hearing_id: hearing?.id || null,
          document_id: doc.id,
        },
      });

      toast.success("Notice of Hearing issued. Service still has to be recorded.");
      onChanged?.();
    } catch {
      toast.error("Could not issue the Notice of Hearing.");
    } finally {
      setIssuing(false);
    }
  };

  /* ── Schedule the mediation ─────────────────────────────────────
   *
   * Writes the same `hearings` row and the same audit entry it always
   * wrote. Once the row is committed, the save-success boundary calls
   * prepareMediationDocuments(), which prepares the Notice of Hearing from
   * the shared generator — the one document both parties are named on, so
   * there is no second file to prepare afterwards. A document that cannot
   * be prepared never undoes a schedule that was saved.
   */
  const handleSchedule = async (event) => {
    event?.preventDefault?.();
    setScheduleError("");

    // ── Validate before touching the database ──────────────────
    const date = String(schedule.hearing_date || "").trim();
    const time = String(schedule.hearing_time || "").trim();
    const venue = String(schedule.venue || "").trim();

    if (!date) {
      setScheduleError("Select a hearing date.");
      return;
    }
    if (Number.isNaN(Date.parse(date))) {
      setScheduleError("That hearing date is not a valid date.");
      return;
    }
    if (!time) {
      setScheduleError("Select a hearing time.");
      return;
    }
    if (!venue) {
      setScheduleError("Enter a venue for the hearing.");
      return;
    }
    if (!complaint?.id) {
      setScheduleError("This complaint could not be identified, so nothing was saved.");
      return;
    }
    if (!gate.open) {
      setScheduleError(`${gate.headline}. ${gate.detail}`);
      return;
    }

    const rescheduling = Boolean(reschedulingId);

    setScheduling(true);
    try {
      let savedId = reschedulingId;

      if (rescheduling) {
        // Rescheduling preserves the original. The RPC marks the existing
        // hearing Rescheduled and creates a linked replacement, so the date
        // that was originally set stays on the case.
        const result = await rescheduleHearing(supabase, {
          hearingId: reschedulingId,
          date,
          time,
          venue,
        });
        if (!result.success) throw new Error(result.error);
        savedId = result.newHearingId || reschedulingId;
      } else {
        const sessionNumber =
          (hearings || []).filter((h) => h.hearing_type === HEARING_TYPE).length + 1;

        const { data, error } = await supabase
          .from("hearings")
          .insert({
            complaint_id: complaint.id,
            hearing_type: HEARING_TYPE,
            title: `${ordinal(sessionNumber)} Captain Mediation`,
            hearing_date: date,
            hearing_time: time,
            venue,
            status: "Upcoming",
            created_by: user?.id || null,
          })
          .select("id")
          .maybeSingle();

        if (error) throw error;
        if (!data) {
          throw new Error(
            "The hearing was not saved. Supabase accepted the request but returned no record."
          );
        }
        savedId = data.id;
      }

      // The hearing is already committed at this point. The audit entry is
      // best-effort: a failure here must not be reported as a failed save.
      const { error: auditError } = await logComplaintActivity(supabase, {
        action: rescheduling ? "hearing_rescheduled" : "hearing_scheduled",
        complaintId: complaint.id,
        ref: complaint.reference_number || undefined,
        details: {
          hearing_id: savedId,
          date,
          time,
          venue,
        },
      });
      if (auditError) {
        console.error("SummonsTracker: hearing saved but audit log failed", {
          hearingId: savedId,
          complaintId: complaint.id,
          error: auditError,
        });
      }

      setSchedule({ hearing_date: "", hearing_time: "", venue: SITE.hall });
      setReschedulingId(null);
      setScheduleError("");
      toast.success(
        rescheduling
          ? "Hearing rescheduled. The original date is preserved on the case."
          : "Hearing scheduled."
      );

      // ── Save-success boundary for document preparation ───────
      // The hearing is committed above. Everything in this block only
      // prepares documents, so a failure here is reported as a document
      // problem and never as a failed schedule.
      // The Notice of Hearing is prepared once, from the shared generator.
      // An existing notice is left alone, so a reschedule can never
      // overwrite a document a party already holds.
      try {
        const prepared = await prepareMediationDocuments(supabase, {
          complaint,
          user,
          hearingId: savedId,
        });
        if (prepared.notice?.success && !prepared.notice.skipped) {
          toast.success("Notice of Hearing prepared.");
        } else if (!prepared.notice?.success) {
          reportDocumentError(prepared.notice?.error, prepared.notice?.detail);
        }
      } catch (prepError) {
        console.error("SummonsTracker: hearing saved but documents could not be prepared", {
          hearingId: savedId,
          complaintId: complaint.id,
          error: prepError,
        });
        reportDocumentError(
          prepError?.message || "Could not prepare the hearing documents.",
          null
        );
      }

      onChanged?.();
    } catch (caught) {
      // The real reason is surfaced instead of a generic failure, so a
      // blocked routing gate or a policy problem is readable in the UI.
      const message = scheduleFailureMessage(caught);
      // Logged as plain strings on purpose: the dev overlay renders an
      // object argument collapsed (as "{}"), which hides the very text
      // needed to diagnose a failed save.
      console.error(
        "SummonsTracker: could not save hearing",
        `complaint=${complaint?.id || "?"} reschedulingId=${reschedulingId || "-"} ` +
          `date=${date} time=${time} venue=${venue} code=${caught?.code || "-"} ` +
          `error=${caught?.message || String(caught ?? "unknown error")}`
      );
      setScheduleError(message);
      toast.error(message, { duration: 9000 });
    } finally {
      setScheduling(false);
    }
  };

  const startReschedule = (hearingRow) => {
    setReschedulingId(hearingRow.id);
    setScheduleError("");
    setSchedule({
      hearing_date: hearingRow.hearing_date || "",
      hearing_time: String(hearingRow.hearing_time || "").slice(0, 5),
      venue: hearingRow.venue || SITE.hall,
    });
  };

  const cancelReschedule = () => {
    setReschedulingId(null);
    setScheduleError("");
    setSchedule({ hearing_date: "", hearing_time: "", venue: SITE.hall });
  };

  const scheduleChip = !hearing.id
    ? { tone: "warning", label: "Not scheduled" }
    : hearing.trackKey === "held"
      ? { tone: "ok", label: "Hearing Held" }
      : { tone: "info", label: "Scheduled" };

  const respondentChip = (() => {
    switch (respondentSummons.key) {
      case "acknowledged":
      case "served":
        return { tone: "ok", label: respondentSummons.label };
      case "issued":
      case "generated":
        return { tone: "info", label: respondentSummons.label };
      default:
        return { tone: "neutral", label: respondentSummons.label };
    }
  })();

  return (
    <>
      {/* ── 1. Mediation Schedule ─────────────────────────────── */}
      <WorkflowPanel
        title="Mediation Schedule"
        description="The date, time and venue of the mediation session."
        action={<WorkflowChip tone={scheduleChip.tone}>{scheduleChip.label}</WorkflowChip>}
      >
        <div className="space-y-4">
          {/* The one thing still outstanding for this section. */}
          <WorkflowNote tone="info" icon={Gavel}>
            <span className="font-semibold uppercase tracking-wide">Next action: </span>
            {nextAction.message}
          </WorkflowNote>

          {hearing.id ? (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                <WorkflowField label="Date">{formatDateShort(hearing.hearing_date)}</WorkflowField>
                <WorkflowField label="Time">
                  <span className="inline-flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5 text-muted" aria-hidden="true" />
                    {formatTime(hearing.hearing_time)}
                  </span>
                </WorkflowField>
                <WorkflowField label="Venue">
                  <span className="inline-flex items-start gap-1.5">
                    <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted" aria-hidden="true" />
                    {hearing.venue}
                  </span>
                </WorkflowField>
                {/* The stored hearing_status value, never a derived guess. */}
                <WorkflowField label="Status">{hearing.status}</WorkflowField>
              </div>

              {hearing.instructions ? (
                <p className="text-[11px] text-muted">Instructions: {hearing.instructions}</p>
              ) : null}

              {/* A scheduled hearing can still be corrected or withdrawn.
                  Rescheduling keeps the original row and creates a linked
                  replacement; cancelling requires a written reason and keeps
                  the row, so the session history is never destroyed. */}
              {hearing.lifecycle?.scheduled ? (
                <div className="flex flex-wrap items-center gap-2">
                  <SecondaryAction
                    onClick={() => startReschedule(hearing)}
                    title="Change the date, time or venue. The original hearing is kept and linked to the new one."
                  >
                    <CalendarDays className="h-4 w-4" aria-hidden="true" />
                    Reschedule
                  </SecondaryAction>
                  <SecondaryAction
                    onClick={() => {
                      setCancellingId(hearing.id);
                      setCancelTarget(hearing);
                    }}
                    disabled={cancellingId === hearing.id}
                    title="Cancel this hearing. A reason is required and is stored with the record."
                  >
                    <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                    Cancel Hearing
                  </SecondaryAction>
                </div>
              ) : null}
            </>
          ) : (
            <form className="space-y-3" onSubmit={handleSchedule} noValidate>
              <p className="text-sm text-mirage">
                Not scheduled. Set the date, time and venue — the Notice of Hearing prints them,
                so it cannot be prepared until this is saved.
              </p>

              {/* The database refuses a party step while the routing gate is
                  closed, so the form says why instead of failing on save. */}
              {!gate.open ? (
                <WorkflowNote tone="warning" icon={AlertTriangle}>
                  <span className="font-semibold">{gate.headline}. </span>
                  {gate.detail}
                </WorkflowNote>
              ) : null}

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-muted" htmlFor="hearing-date">
                    Date <span aria-hidden="true">*</span>
                  </label>
                  <input
                    id="hearing-date"
                    type="date"
                    required
                    value={schedule.hearing_date}
                    onChange={(e) => {
                      setScheduleError("");
                      setSchedule({ ...schedule, hearing_date: e.target.value });
                    }}
                    className="h-11 w-full rounded-full border border-line bg-white px-4 text-sm text-mirage outline-none focus:border-secondary"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-muted" htmlFor="hearing-time">
                    Time <span aria-hidden="true">*</span>
                  </label>
                  <input
                    id="hearing-time"
                    type="time"
                    required
                    value={schedule.hearing_time}
                    onChange={(e) => {
                      setScheduleError("");
                      setSchedule({ ...schedule, hearing_time: e.target.value });
                    }}
                    className="h-11 w-full rounded-full border border-line bg-white px-4 text-sm text-mirage outline-none focus:border-secondary"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-muted" htmlFor="hearing-venue">
                    Venue <span aria-hidden="true">*</span>
                  </label>
                  <input
                    id="hearing-venue"
                    type="text"
                    required
                    value={schedule.venue}
                    onChange={(e) => {
                      setScheduleError("");
                      setSchedule({ ...schedule, venue: e.target.value });
                    }}
                    placeholder={SITE.hall}
                    className="h-11 w-full rounded-full border border-line bg-white px-4 text-sm text-mirage outline-none focus:border-secondary"
                  />
                </div>
              </div>

              {scheduleError ? (
                <p role="alert" className="text-sm font-medium text-critical">
                  {scheduleError}
                </p>
              ) : null}

              <SecondaryAction
                type="submit"
                disabled={scheduling || !gate.open}
                title={gate.open ? undefined : gate.reason}
              >
                <CalendarDays className="h-4 w-4" aria-hidden="true" />
                {scheduling ? "Saving…" : "Schedule Mediation"}
              </SecondaryAction>
            </form>
          )}

          {/* Reschedule reuses the same validated form, and updates the
              existing hearing row rather than inserting a second one. */}
          {reschedulingId && hearing.id ? (
            <form
              className="space-y-3 border-t border-line pt-4"
              onSubmit={handleSchedule}
              noValidate
            >
              <p className="text-sm font-semibold text-mirage">Rescheduling this hearing</p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-muted" htmlFor="reschedule-date">
                    New date <span aria-hidden="true">*</span>
                  </label>
                  <input
                    id="reschedule-date"
                    type="date"
                    required
                    value={schedule.hearing_date}
                    onChange={(e) => {
                      setScheduleError("");
                      setSchedule({ ...schedule, hearing_date: e.target.value });
                    }}
                    className="h-11 w-full rounded-full border border-line bg-white px-4 text-sm text-mirage outline-none focus:border-secondary"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-muted" htmlFor="reschedule-time">
                    New time <span aria-hidden="true">*</span>
                  </label>
                  <input
                    id="reschedule-time"
                    type="time"
                    required
                    value={schedule.hearing_time}
                    onChange={(e) => {
                      setScheduleError("");
                      setSchedule({ ...schedule, hearing_time: e.target.value });
                    }}
                    className="h-11 w-full rounded-full border border-line bg-white px-4 text-sm text-mirage outline-none focus:border-secondary"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-muted" htmlFor="reschedule-venue">
                    New venue <span aria-hidden="true">*</span>
                  </label>
                  <input
                    id="reschedule-venue"
                    type="text"
                    required
                    value={schedule.venue}
                    onChange={(e) => {
                      setScheduleError("");
                      setSchedule({ ...schedule, venue: e.target.value });
                    }}
                    className="h-11 w-full rounded-full border border-line bg-white px-4 text-sm text-mirage outline-none focus:border-secondary"
                  />
                </div>
              </div>

              {scheduleError ? (
                <p role="alert" className="text-sm font-medium text-critical">
                  {scheduleError}
                </p>
              ) : null}

              <div className="flex flex-wrap items-center gap-2">
                <SecondaryAction type="submit" disabled={scheduling}>
                  <Check className="h-4 w-4" aria-hidden="true" />
                  {scheduling ? "Saving…" : "Save new schedule"}
                </SecondaryAction>
                <SecondaryAction type="button" onClick={cancelReschedule} disabled={scheduling}>
                  Keep current schedule
                </SecondaryAction>
              </div>
            </form>
          ) : null}
        </div>
      </WorkflowPanel>

      {/* ── 2. Hearing Documents ──────────────────────────────── */}
      <WorkflowPanel
        title="Hearing Documents"
        description="The current document for each party and the action that is available now."
      >
        <div className="space-y-4">
          {/* Shown only when a generation attempt actually failed. */}
          {documentError ? (
            <WorkflowNote tone="warning" icon={AlertTriangle}>
              <span>{documentError}</span>
              {documentErrorDetail ? (
                <span className="mt-1 block">
                  <button
                    type="button"
                    onClick={() => setShowDocumentDetails((v) => !v)}
                    className="font-semibold underline underline-offset-2"
                  >
                    {showDocumentDetails ? "Hide details" : "View Details"}
                  </button>
                  {showDocumentDetails ? (
                    <span className="mt-1 block text-[11px]">{documentErrorDetail}</span>
                  ) : null}
                </span>
              ) : null}
            </WorkflowNote>
          ) : null}

          {/* One column per party, stacked on small screens. */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* ── Complainant ─────────────────────────────────── */}
            <PartyColumn
              title="Complainant"
              name={complainant.name}
              chip={
                <WorkflowChip tone={complainant.noticeGenerated ? "ok" : "neutral"}>
                  {complainant.noticeGenerated ? "Generated" : "Not Generated"}
                </WorkflowChip>
              }
            >
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <WorkflowField label="Document Status">
                  {complainant.noticeGenerated ? "Generated" : "Not Generated"}
                </WorkflowField>
                <WorkflowField label="Delivery Status">
                  {complainant.physicalRecorded ? "Delivered" : "Not Recorded"}
                </WorkflowField>
              </div>

              <DocumentLine
                label="Notice of Hearing"
                doc={complainant.noticeDoc}
                onView={viewDoc}
                onPrint={printDoc}
                action={
                  !complainant.noticeDoc ? (
                    <SecondaryAction
                      onClick={handleGenerateNotice}
                      disabled={noticeBusy}
                      title="Prepare the Notice of Hearing for the scheduled mediation."
                    >
                      <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                      {noticeBusy ? "Preparing…" : "Generate Notice"}
                    </SecondaryAction>
                  ) : null
                }
              />

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <WorkflowField label="Delivery Date">
                  {complainant.physicalRecorded
                    ? formatDateShort(complainant.physicalServedOn)
                    : "Not recorded"}
                </WorkflowField>
                <WorkflowField label="Delivered To">
                  {complainant.physicalServedTo || (complainant.physicalRecorded ? "Not recorded" : "—")}
                </WorkflowField>
              </div>

              {complainant.recordedBy && complainant.physicalRecorded ? (
                <WorkflowField label="Recorded By">{complainant.recordedBy}</WorkflowField>
              ) : null}

              {/* The genuine resident-portal delivery: a notification the
                  complainant receives on their own account, proven by the
                  audit entry the send writes. Whether they opened it is not
                  recorded anywhere, so it is not shown. */}
              <div className="border-t border-line pt-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                  Resident Portal copy
                </p>
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <WorkflowChip tone={complainant.digitalSent ? "ok" : "neutral"}>
                    {complainant.digitalSent ? "Sent via Resident Portal" : "Not Sent"}
                  </WorkflowChip>
                  {complainant.digitalSentAt ? (
                    <span className="text-[11px] text-muted">
                      Sent {formatDateTime(complainant.digitalSentAt)}
                    </span>
                  ) : null}
                </div>
                {/* Only offered when there is a document copy to send. */}
                {summonsIssued || summonsDocument ? (
                  <div className="mt-2">
                    <SendSummonsCopyButton
                      supabase={supabase}
                      complaint={complaint}
                      summonsRow={respondentSummons.issuedRow}
                      documentRow={summonsDocument}
                      hearingId={hearing.id || null}
                      alreadySent={complainant.digitalSent}
                      onSent={onChanged}
                    />
                  </div>
                ) : null}
              </div>

              <div className="border-t border-line pt-3">
                <SecondaryAction
                  onClick={() => setServiceFor("complainant")}
                  disabled={!complainant.noticeGenerated && !summonsIssued}
                  title={
                    complainant.noticeGenerated || summonsIssued
                      ? undefined
                      : "Generate the Notice of Hearing before recording its delivery."
                  }
                >
                  Record Delivery
                </SecondaryAction>
              </div>
            </PartyColumn>

            {/* ── Respondent ──────────────────────────────────── */}
            <PartyColumn
              title="Respondent"
              name={respondent.name}
              chip={<WorkflowChip tone={respondentChip.tone}>{respondentChip.label}</WorkflowChip>}
            >
              <div className="rounded-xl border border-line bg-white px-3 py-2.5">
                <WorkflowField label="Notice Addressee">
                  {respondentSummons.respondentName || "No respondent identified"}
                </WorkflowField>
                <WorkflowField label="Case Number" className="mt-2">
                  {respondentSummons.caseNo}
                </WorkflowField>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <WorkflowField label="Document Status">
                  {summonsDocument ? "Generated" : "Not Generated"}
                </WorkflowField>
                <WorkflowField label="Issued">
                  {respondentSummons.issuedAt
                    ? formatDateTime(respondentSummons.issuedAt)
                    : "Not issued"}
                </WorkflowField>
              </div>

              {/* Same file as the complainant's: one Notice of Hearing names
                  the respondent by name and address and the complainant on
                  the "Complainant/s:" line, so both columns read the same
                  document. Generating it from either column produces the one
                  file and flips both columns at once. */}
              <DocumentLine
                label="Notice of Hearing"
                doc={summonsDocument}
                onView={viewDoc}
                onPrint={printDoc}
                action={
                  !summonsDocument ? (
                    <SecondaryAction
                      onClick={handleGenerateNotice}
                      disabled={noticeBusy}
                      title="Prepare the Notice of Hearing for the scheduled mediation."
                    >
                      <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                      {noticeBusy ? "Preparing…" : "Generate Notice"}
                    </SecondaryAction>
                  ) : respondentSummons.key === "generated" ? (
                    <SecondaryAction
                      onClick={handleIssue}
                      disabled={issuing}
                      title="Issue the prepared Notice of Hearing. Issuing records no service."
                    >
                      {issuing ? "Issuing…" : "Issue Notice"}
                    </SecondaryAction>
                  ) : null
                }
              />

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <WorkflowField label="Served On">
                  {respondent.servedOn ? formatDateShort(respondent.servedOn) : "Not served"}
                </WorkflowField>
                <WorkflowField label="Served By">
                  {respondent.servedBy || (respondent.served ? "Not recorded" : "—")}
                </WorkflowField>
              </div>

              {respondent.servedTo ? (
                <WorkflowField label="Served To">{respondent.servedTo}</WorkflowField>
              ) : null}
              {respondent.modeOfService ? (
                <WorkflowField label="Mode">{respondent.modeOfService}</WorkflowField>
              ) : null}
              {respondent.acknowledged ? (
                <WorkflowField label="Acknowledged">
                  {formatDateShort(respondent.acknowledgedOn)}
                </WorkflowField>
              ) : null}

              <div className="border-t border-line pt-3">
                <SecondaryAction
                  onClick={() => setServiceFor("respondent")}
                  disabled={!summonsIssued}
                  title={
                    summonsIssued
                      ? undefined
                      : "Issue the Notice of Hearing before recording service."
                  }
                >
                  Record Service
                </SecondaryAction>
              </div>

              {respondentSummons.missing.length ? (
                <WorkflowNote tone="warning" icon={AlertTriangle}>
                  <span className="font-semibold">
                    Still needed before the Notice of Hearing can be generated:{" "}
                  </span>
                  {respondentSummons.missing.join(" ")}
                </WorkflowNote>
              ) : null}
            </PartyColumn>
          </div>

          {/* ── Attachments ───────────────────────────────────── */}
          <div className="rounded-2xl border border-line bg-white p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
              Attachments
            </p>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-canvas px-3 py-2.5">
              <div className="flex min-w-0 items-center gap-2">
                <FileText className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold text-mirage">
                    Complaint / Reklamo Form
                  </p>
                  <p className="truncate text-[11px] text-muted">
                    {complaintCopy.attached
                      ? `${complaintCopy.document.title} — ${formatDateShort(complaintCopy.document.created_at)}`
                      : "No complaint copy is on file for this case."}
                  </p>
                </div>
              </div>
              {complaintCopy.attached ? (
                <div className="flex shrink-0 items-center gap-1">
                  <SecondaryAction
                    onClick={() => viewDoc(complaintCopy.document)}
                    className="h-9 px-3 text-xs"
                  >
                    <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                    View
                  </SecondaryAction>
                  <WorkflowChip tone="ok">Available</WorkflowChip>
                </div>
              ) : (
                <WorkflowChip tone="neutral">Not Attached</WorkflowChip>
              )}
            </div>
          </div>

          <WorkflowNote tone="neutral" icon={Info}>
            Document generation, issuance, and service are recorded separately.
          </WorkflowNote>
        </div>
      </WorkflowPanel>

      {/* Mounted per party so each dialog opens on a clean form. */}
      {serviceFor ? (
        <ServiceModal
          key={serviceFor}
          open
          onClose={() => setServiceFor(null)}
          supabase={supabase}
          complaint={complaint}
          summons={respondentSummons.issuedRow}
          user={user}
          initialPartyRole={serviceFor}
          lockParty
          title={serviceFor === "respondent" ? "Record Service to Respondent" : "Record Delivery"}
          submitLabel={serviceFor === "respondent" ? "Record Service" : "Record Delivery"}
          onSaved={() => {
            setServiceFor(null);
            onChanged?.();
          }}
        />
      ) : null}

      {/* Cancellation is a separate dialog because it requires a written
          reason. A hearing that vanishes without one is indistinguishable
          from one that was never scheduled. */}
      {cancelTarget ? (
        <HearingLifecycleModal
          key={`cancel-${cancelTarget.id}`}
          open
          mode="cancel"
          onClose={() => {
            setCancelTarget(null);
            setCancellingId(null);
          }}
          supabase={supabase}
          complaint={complaint}
          hearing={cancelTarget}
          onSaved={() => {
            setCancelTarget(null);
            setCancellingId(null);
            onChanged?.();
          }}
        />
      ) : null}
    </>
  );
}
