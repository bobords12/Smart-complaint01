"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import toast from "react-hot-toast";
import {
  CalendarClock,
  Download,
  FileText,
  Hash,
  MapPin,
  Paperclip,
  ShieldCheck,
  Users,
} from "lucide-react";
import { useDocumentViewer } from "@/components/shared/DocumentViewerProvider";
import {
  addReferralNote,
  createReferralEvidenceUrl,
  fetchMyReferral,
  fetchReferralEvidence,
  fetchReferralTimeline,
  requestReferralInformation,
  setReferralExternalReference,
  updateReferralStatus,
} from "@/repositories/pnpReferralRepository";
import {
  PNP_OFFERED_TRANSITIONS,
  formatDate,
  formatDateTime,
  humanize,
  isTerminalStatus,
  referralAge,
  statusNeedsReason,
} from "@/lib/pnpReferral";
import { PNP_ROUTES } from "@/lib/constants";
import {
  AuthorLabel,
  BoundaryNote,
  DetailField,
  EmptyState,
  LoadingBlock,
  PnpPageHeader,
  ReferralStatusBadge,
  SafetyConcernFlag,
  SecondaryButton,
  TextField,
} from "./PnpPrimitives";

/* ── Evidence file list ──────────────────────────────────── */

/**
 * The shared evidence.
 *
 * Opening a file is a two-step act on purpose. This component asks
 * the database for the file list (which is already restricted to
 * what the Captain shared on this referral), then mints a 120-second
 * URL for one file at a time. The URL is never stored, never written
 * to the timeline, and stops working almost immediately. If the
 * assignment is released while the page is open, the next open
 * attempt is refused by the storage policy — the list on screen does
 * not stay live.
 */
function EvidenceList({ referralId }) {
  const { viewDocument } = useDocumentViewer();
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [openingId, setOpeningId] = useState(null);

  const load = useCallback(async () => {
    const result = await fetchReferralEvidence(referralId);
    setFiles(result.files);
    setUnavailable(result.unavailable);
    setLoading(false);
  }, [referralId]);

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

  // Shared referral files are shown in the in-app viewer. The link from the
  // repository is short-lived, which is fine: the viewer fetches the file as
  // soon as it opens.
  const openFile = async (file) => {
    setOpeningId(file.evidence_id);
    try {
      const result = await createReferralEvidenceUrl(file.storage_path);
      if (!result.success || !result.url) {
        toast.error(result.error || "This file could not be opened.");
        return;
      }
      viewDocument({
        url: result.url,
        title: file.original_filename || "Shared file",
        subtitle: "Referral evidence",
        filename: file.original_filename,
        mime: file.mime_type,
        errorMessage: "This file could not be opened.",
      });
    } finally {
      setOpeningId(null);
    }
  };

  if (loading) {
    return <p className="py-4 text-center text-sm text-muted">Loading shared files…</p>;
  }
  if (unavailable) {
    return (
      <p className="py-4 text-center text-sm text-muted">
        The evidence reader is not available. Apply the PNP migration files.
      </p>
    );
  }
  if (files.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-line bg-alt/40 px-4 py-6 text-center">
        <Paperclip className="mx-auto h-5 w-5 text-muted" aria-hidden="true" />
        <p className="mt-2 text-sm font-medium text-navy">No evidence shared yet</p>
        <p className="mt-1 text-[13px] leading-relaxed text-muted">
          The Captain has not attached any files to this referral. The complaint&apos;s other
          evidence is not visible here and is not shared by default.
        </p>
      </div>
    );
  }

  return (
    <>
      <ul className="flex flex-col gap-2">
        {files.map((file) => (
          <li
            key={file.share_id}
            className="flex flex-col gap-2 rounded-xl border border-line p-3.5 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-navy">
                {file.original_filename}
              </p>
              <p className="mt-0.5 text-[12px] text-muted">
                {file.mime_type || "File"}
                {file.file_size ? ` · ${formatBytes(file.file_size)}` : ""} · shared{" "}
                {formatDate(file.shared_at)}
              </p>
              {file.note ? (
                <p className="mt-1 text-[12px] italic text-muted">{file.note}</p>
              ) : null}
            </div>
            <SecondaryButton
              type="button"
              onClick={() => openFile(file)}
              disabled={openingId === file.evidence_id}
              className="shrink-0"
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              {openingId === file.evidence_id ? "Opening…" : "Open"}
            </SecondaryButton>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[12px] leading-relaxed text-muted">
        Files open in a new tab through a link that expires in two minutes. The link is not saved
        anywhere, and stops working if this referral is reassigned away from you.
      </p>
    </>
  );
}

function formatBytes(bytes) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/* ── Timeline ────────────────────────────────────────────── */

const TIMELINE_ICON = {
  created: "＋",
  status_change: "↻",
  assigned: "👤",
  note: "✎",
  information_request: "?",
  information_response: "↩",
  evidence_shared: "📎",
  external_reference: "#",
};

function Timeline({ entries, loading }) {
  if (loading) {
    return <p className="py-6 text-center text-sm text-muted">Loading the timeline…</p>;
  }
  if (entries.length === 0) {
    return <p className="py-6 text-center text-sm text-muted">No entries yet.</p>;
  }
  return (
    <ol className="flex flex-col">
      {entries.map((entry) => (
        <li key={entry.id} className="flex gap-3 pb-5 last:pb-0">
          <span
            aria-hidden="true"
            className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-alt text-[12px] text-muted"
          >
            {TIMELINE_ICON[entry.update_type] || "•"}
          </span>
          <div className="min-w-0 flex-1 border-b border-line pb-4 last:border-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-[13px] font-semibold capitalize text-navy">
                {humanize(entry.update_type)}
              </span>
              {entry.status_after && entry.status_before ? (
                <span className="text-[12px] text-muted">
                  {humanize(entry.status_before)} → {humanize(entry.status_after)}
                </span>
              ) : entry.status_after ? (
                <span className="text-[12px] text-muted">
                  status: {humanize(entry.status_after)}
                </span>
              ) : null}
            </div>
            {entry.message ? (
              <p className="mt-1 text-[13px] leading-relaxed text-mirage">{entry.message}</p>
            ) : null}
            <div className="mt-1.5 flex flex-wrap items-center gap-x-2">
              <AuthorLabel role={entry.author_role} />
              <span aria-hidden="true" className="text-muted/50">
                ·
              </span>
              <span className="text-[12px] text-muted">
                {formatDateTime(entry.created_at)}
              </span>
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}

/* ── Action panel ────────────────────────────────────────── */

/**
 * The officer's actions.
 *
 * Which buttons appear is decided by PNP_OFFERED_TRANSITIONS, which
 * mirrors the transition table in pnp_update_referral_status(). That
 * mirroring is a UI convenience only: the RPC re-checks the move and
 * will refuse anything illegal, so a stale button produces an error
 * message rather than a wrong state. Returning, declining and closing
 * are absent on purpose — those are the barangay's decisions and the
 * RPC refuses them for a PNP officer regardless of what is clicked.
 */
function ActionPanel({ referral, onChanged }) {
  const [busy, setBusy] = useState(null);
  const [note, setNote] = useState("");
  const [question, setQuestion] = useState("");
  const [externalRef, setExternalRef] = useState(referral.external_reference || "");
  const [reasonFor, setReasonFor] = useState(null);
  const [reason, setReason] = useState("");

  const transitions = PNP_OFFERED_TRANSITIONS[referral.status] || [];
  const isDone = isTerminalStatus(referral.status) || referral.status === "completed";

  const run = async (key, fn, successMessage) => {
    setBusy(key);
    try {
      const result = await fn();
      if (!result.success) {
        toast.error(result.error || "That action could not be completed.");
        return false;
      }
      toast.success(successMessage);
      setNote("");
      setQuestion("");
      setReason("");
      setReasonFor(null);
      await onChanged();
      return true;
    } finally {
      setBusy(null);
    }
  };

  if (isDone) {
    return (
      <BoundaryNote title="This referral has ended">
        <p>
          A referral that is completed, closed, returned or declined no longer accepts notes or
          status changes from the PNP side. Returning, declining and closing a referral is the
          barangay&apos;s decision, and the database will refuse it from this portal.
        </p>
      </BoundaryNote>
    );
  }

  return (
    <div className="space-y-5">
      {/* Status moves */}
      {transitions.length > 0 ? (
        <div>
          <p className="text-[13px] font-semibold text-navy">Move this referral on</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {transitions.map((status) => (
              <button
                key={status}
                type="button"
                disabled={busy !== null}
                onClick={() => {
                  if (statusNeedsReason(status)) {
                    setReasonFor(status);
                    return;
                  }
                  if (status === "needs_information") {
                    document
                      .getElementById("pnp-information-request")
                      ?.scrollIntoView({ behavior: "smooth", block: "center" });
                    return;
                  }
                  run(
                    status,
                    () =>
                      updateReferralStatus(
                        referral.id,
                        status,
                        null,
                        status === "acknowledged"
                          ? "Acknowledged by the assigned PNP officer."
                          : null
                      ),
                    `Referral moved to ${humanize(status)}.`
                  );
                }}
                className="min-h-[40px] rounded-xl bg-secondary px-4 text-[13px] font-semibold text-white transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary disabled:cursor-not-allowed disabled:opacity-60"
              >
                {status === "acknowledged"
                  ? "Acknowledge referral"
                  : status === "in_progress"
                    ? "Start work"
                    : status === "completed"
                      ? "Mark completed"
                      : humanize(status)}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[12px] leading-relaxed text-muted">
            {referral.status === "referred"
              ? "Acknowledging tells the barangay that you have taken this referral on."
              : null}
            {referral.status === "in_progress"
              ? "Marking it completed records that the PNP has finished its own handling. Closing it is the barangay's step."
              : null}
          </p>
        </div>
      ) : null}

      {/* Reason prompt, for a move that needs one */}
      {reasonFor ? (
        <div className="rounded-xl border border-line bg-alt/50 p-4">
          <p className="text-[13px] font-semibold text-navy">
            A reason is required to move this referral to {humanize(reasonFor)}
          </p>
          <div className="mt-3 space-y-3">
            <TextField
              label="Reason"
              hint="This is written to the referral timeline and is permanent."
              as="textarea"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Explain the decision so it can be understood later."
            />
            <div className="flex gap-2">
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => run(
                  reasonFor,
                  () => updateReferralStatus(referral.id, reasonFor, reason, null),
                  `Referral moved to ${humanize(reasonFor)}.`
                )}
                className="min-h-[40px] rounded-xl bg-secondary px-4 text-[13px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
              >
                Confirm
              </button>
              <SecondaryButton type="button" onClick={() => setReasonFor(null)}>
                Cancel
              </SecondaryButton>
            </div>
          </div>
        </div>
      ) : null}

      {/* Information request */}
      {["acknowledged", "in_progress", "information_submitted"].includes(referral.status) ? (
        <div id="pnp-information-request" className="rounded-xl border border-line p-4">
          <p className="text-[13px] font-semibold text-navy">Request information</p>
          <p className="mt-0.5 text-[12px] leading-relaxed text-muted">
            Your question goes to the Captain or OIC, not to the resident. Answering it moves the
            referral to &ldquo;needs information&rdquo; and it will leave your action list until they
            reply.
          </p>
          <div className="mt-3 space-y-3">
            <TextField
              label="What do you need?"
              as="textarea"
              rows={3}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="e.g. A copy of the incident report, and the exact time the respondent left the premises."
            />
            <button
              type="button"
              disabled={busy !== null}
              onClick={() =>
                run(
                  "question",
                  () => requestReferralInformation(referral.id, question),
                  "Your information request was sent to the barangay."
                )
              }
              className="min-h-[40px] rounded-xl border border-line bg-white px-4 text-[13px] font-semibold text-navy transition-colors hover:border-secondary/50 disabled:opacity-60"
            >
              {busy === "question" ? "Sending…" : "Send request"}
            </button>
          </div>
        </div>
      ) : null}

      {/* External reference */}
      <div className="rounded-xl border border-line p-4">
        <p className="text-[13px] font-semibold text-navy">External PNP reference</p>
        <p className="mt-0.5 text-[12px] leading-relaxed text-muted">
          Optional. Enter a reference only if you have been given a real one. This system does not
          generate, predict or invent PNP reference numbers, and the field is left empty otherwise.
        </p>
        <div className="mt-3 space-y-3">
          <TextField
            label="Reference"
            value={externalRef}
            onChange={(e) => setExternalRef(e.target.value)}
            placeholder="e.g. the case number issued to you by the station"
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy !== null || !externalRef.trim()}
              onClick={() =>
                run(
                  "external",
                  () => setReferralExternalReference(referral.id, externalRef),
                  "External reference recorded."
                )
              }
              className="min-h-[40px] rounded-xl border border-line bg-white px-4 text-[13px] font-semibold text-navy transition-colors hover:border-secondary/50 disabled:opacity-60"
            >
              {busy === "external" ? "Saving…" : "Save reference"}
            </button>
            {referral.external_reference ? (
              <span className="inline-flex items-center gap-1.5 text-[12px] text-muted">
                <ShieldCheck className="h-3.5 w-3.5 text-success" aria-hidden="true" />
                Recorded {formatDate(referral.external_reference_at)}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      {/* Note */}
      <div className="rounded-xl border border-line p-4">
        <p className="text-[13px] font-semibold text-navy">Add a note</p>
        <p className="mt-0.5 text-[12px] leading-relaxed text-muted">
          Notes are permanent and visible to the Captain and OIC. They cannot be edited or deleted
          afterwards.
        </p>
        <div className="mt-3 space-y-3">
          <TextField
            label="Note"
            as="textarea"
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Record a coordination step, a contact attempt, or an observation."
          />
          <button
            type="button"
            disabled={busy !== null}
            onClick={() =>
              run("note", () => addReferralNote(referral.id, note), "Note added to the timeline.")
            }
            className="min-h-[40px] rounded-xl border border-line bg-white px-4 text-[13px] font-semibold text-navy transition-colors hover:border-secondary/50 disabled:opacity-60"
          >
            {busy === "note" ? "Saving…" : "Add note"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Page ────────────────────────────────────────────────── */

export default function PnpReferralDetail({ referralId }) {
  const [referral, setReferral] = useState(null);
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [timelineLoading, setTimelineLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(async () => {
    const { referral: row } = await fetchMyReferral(referralId);
    if (!row) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    setReferral(row);
    setNotFound(false);
    setLoading(false);

    setTimelineLoading(true);
    const timeline = await fetchReferralTimeline(referralId);
    setEntries(timeline.entries);
    setTimelineLoading(false);
  }, [referralId]);

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

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl">
        <PnpPageHeader title="Referral" backHref={PNP_ROUTES.referrals} />
        <LoadingBlock label="Loading the referral…" />
      </div>
    );
  }

  /**
   * "Not found" is the answer for a referral that exists but is not
   * assigned to this officer. It is deliberately indistinguishable
   * from an id that does not exist, because telling the two apart
   * would let an officer confirm that a referral they were never
   * given exists.
   */
  if (notFound || !referral) {
    return (
      <div className="mx-auto max-w-5xl">
        <PnpPageHeader title="Referral" backHref={PNP_ROUTES.referrals} />
        <EmptyState
          icon={FileText}
          title="Referral not available"
          message="This referral is not assigned to you, or it no longer exists. Referrals become visible only while an active assignment names your account."
          action={
            <Link
              href={PNP_ROUTES.referrals}
              className="inline-flex min-h-[40px] items-center rounded-xl bg-secondary px-4 text-[13px] font-semibold text-white transition-opacity hover:opacity-90"
            >
              Back to Referred Cases
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PnpPageHeader
        backHref={PNP_ROUTES.referrals}
        backLabel="Referred Cases"
        title={referral.referral_reference}
        subtitle={referral.referral_reason}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <ReferralStatusBadge status={referral.status} />
            {referral.has_safety_concern ? <SafetyConcernFlag /> : null}
          </div>
        }
      />

      {/* Snapshot */}
      <section className="rounded-2xl border border-line bg-white p-5 shadow-sm">
        <h2 className="font-heading text-base font-semibold text-navy">Referral summary</h2>
        <p className="mt-2 text-sm leading-relaxed text-mirage">{referral.summary}</p>

        <dl className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <DetailField label="Reference" mono>
            {referral.referral_reference}
          </DetailField>
          {/* Snapshotted from the complaint at referral time so this
              portal never needs a SELECT policy on public.complaints
              (pnp-portal-04-referral-rls.sql §6). */}
          {referral.complaint_reference ? (
            <DetailField label="Barangay case" mono>
              {referral.complaint_reference}
            </DetailField>
          ) : null}
          <DetailField label="Referred on">{formatDate(referral.referred_at)}</DetailField>
          <DetailField label="Time since referral">{referralAge(referral.referred_at)}</DetailField>
          <DetailField label="Basis">{humanize(referral.referral_basis)}</DetailField>
          {referral.incident_date ? (
            <DetailField label="Incident date">
              <span className="inline-flex items-center gap-1.5">
                <CalendarClock className="h-3.5 w-3.5 text-muted" aria-hidden="true" />
                {formatDate(referral.incident_date)}
              </span>
            </DetailField>
          ) : null}
          {referral.incident_location ? (
            <DetailField label="Incident location">
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5 text-muted" aria-hidden="true" />
                {referral.incident_location}
              </span>
            </DetailField>
          ) : null}
          {referral.parties_involved ? (
            <DetailField label="Parties">
              <span className="inline-flex items-start gap-1.5">
                <Users className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted" aria-hidden="true" />
                {referral.parties_involved}
              </span>
            </DetailField>
          ) : null}
          {referral.external_reference ? (
            <DetailField label="External PNP reference" mono>
              <span className="inline-flex items-center gap-1.5">
                <Hash className="h-3.5 w-3.5 text-muted" aria-hidden="true" />
                {referral.external_reference}
              </span>
            </DetailField>
          ) : null}
          {referral.acknowledged_at ? (
            <DetailField label="Acknowledged">
              {formatDateTime(referral.acknowledged_at)}
            </DetailField>
          ) : null}
          {referral.due_at ? (
            <DetailField label="Target date">{formatDate(referral.due_at)}</DetailField>
          ) : null}
        </dl>

        {referral.resolution_reason ? (
          <div className="mt-5 rounded-xl border border-line bg-alt/50 p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
              Reason recorded with the final status
            </p>
            <p className="mt-1.5 text-sm leading-relaxed text-navy">
              {referral.resolution_reason}
            </p>
          </div>
        ) : null}
      </section>

      <div className="grid gap-6 lg:grid-cols-5">
        {/* Actions */}
        <div className="lg:col-span-2">
          <section className="rounded-2xl border border-line bg-white p-5 shadow-sm">
            <h2 className="font-heading text-base font-semibold text-navy">Your actions</h2>
            <p className="mt-0.5 text-[13px] leading-relaxed text-muted">
              Every change is validated in the database, written to the timeline, and recorded in the
              audit log.
            </p>
            <div className="mt-5">
              <ActionPanel referral={referral} onChanged={load} />
            </div>
          </section>
        </div>

        {/* Evidence + timeline */}
        <div className="space-y-6 lg:col-span-3">
          <section className="rounded-2xl border border-line bg-white p-5 shadow-sm">
            <h2 className="font-heading text-base font-semibold text-navy">Shared evidence</h2>
            <p className="mt-0.5 text-[13px] leading-relaxed text-muted">
              Only the files the Captain ticked when creating or updating this referral.
            </p>
            <div className="mt-4">
              <EvidenceList referralId={referralId} />
            </div>
          </section>

          <section className="rounded-2xl border border-line bg-white p-5 shadow-sm">
            <h2 className="font-heading text-base font-semibold text-navy">Timeline</h2>
            <p className="mt-0.5 text-[13px] leading-relaxed text-muted">
              Every step on this referral, in order. Entries cannot be edited or removed.
            </p>
            <div className="mt-5">
              <Timeline entries={entries} loading={timelineLoading} />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
