"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  Paperclip,
  ShieldAlert,
  UserCheck,
  UserMinus,
} from "lucide-react";

import Panel from "./Panel";
import ResidentModal from "@/components/shared/ResidentModal";
import LoadingButton from "@/components/shared/LoadingButton";
import ConfirmDialog from "@/components/shared/ConfirmDialog";
import {
  OFFICIAL_OFFERED_TRANSITIONS,
  OPEN_REFERRAL_REQUEST_STATUSES,
  REFERRAL_REQUEST_LABELS,
  displayReference,
  formatDate,
  formatDateTime,
  humanize,
  isTerminalStatus,
  referralCta,
  referralStatusMeta,
  statusNeedsReason,
} from "@/lib/pnpReferral";
import {
  assignReferral,
  createReferral,
  fetchComplaintReferralRequests,
  fetchOfficerDirectory,
  fetchReferralForComplaint,
  fetchReferralTimeline,
  fetchSharedReferralEvidenceIds,
  releaseReferral,
  respondToReferralInformation,
  reviewReferralRequest,
  shareReferralEvidence,
  updateReferralStatus,
} from "@/repositories/pnpReferralRepository";

/**
 * The Captain / OIC's PNP referral tab.
 *
 * Scope decisions worth stating, because they are the whole point of
 * the referral feature:
 *
 *   - This tab lives inside the complaint, not in the sidebar. A
 *     referral is a fact about one complaint, so it is read where
 *     the complaint is read.
 *   - There is no permission key on the tab, the same as Routing
 *     Assessment. A secretary needs to see that a case was referred
 *     and what the PNP has asked for, as much as the Captain does.
 *     Only the Captain and OIC get the action buttons, and the RPCs
 *     re-check the role anyway.
 *   - The PNP never reads this page. It reads the referral snapshot,
 *     not the case file: no narrative, no internal notes, no resident
 *     request history, and only the evidence files ticked below.
 */

const REQUEST_STATUS_LABELS = REFERRAL_REQUEST_LABELS;

function StatusPill({ status }) {
  const meta = referralStatusMeta(status);
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${meta.className}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} aria-hidden="true" />
      {meta.label}
    </span>
  );
}

function Field({ label, children }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</p>
      <div className="mt-1 text-sm text-navy">{children}</div>
    </div>
  );
}

const inputClass =
  "w-full rounded-xl border border-line bg-white px-3 py-2.5 text-[13px] text-navy placeholder:text-muted focus:border-secondary focus:outline-none focus:ring-2 focus:ring-secondary/20";
const labelClass = "mb-1.5 block text-[13px] font-semibold text-mirage";

export default function PnpReferralTab({ supabase, user, complaint, evidence = [] }) {
  const canManage = user?.role === "captain" || user?.role === "oic";

  const [referral, setReferral] = useState(null);
  const [timeline, setTimeline] = useState([]);
  const [requests, setRequests] = useState([]);
  const [shared, setShared] = useState([]);
  const [officers, setOfficers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [busy, setBusy] = useState(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [releaseOpen, setReleaseOpen] = useState(false);
  const [answerOpen, setAnswerOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewDecision, setReviewDecision] = useState("approved");
  const [pendingStatus, setPendingStatus] = useState(null);
  const [form, setForm] = useState({});
  const [formError, setFormError] = useState("");

  const load = useCallback(async () => {
    const [{ referral: row, unavailable }, requestRes] = await Promise.all([
      fetchReferralForComplaint(complaint.id),
      fetchComplaintReferralRequests(complaint.id),
    ]);

    setReferral(row);
    setRequests(requestRes.requests);
    setLoadError(unavailable ? "referral-tables" : null);

    if (row) {
      const [timelineRes, sharedRes] = await Promise.all([
        fetchReferralTimeline(row.id),
        fetchSharedReferralEvidenceIds(row.id),
      ]);
      setTimeline(timelineRes.entries);
      setShared(sharedRes.shared);
    } else {
      setTimeline([]);
      setShared([]);
    }
    setLoading(false);
  }, [complaint.id]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await load();
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  // Loaded when a referral exists as well as when the assign dialog
  // opens, so the "Assigned officer" row can show a name before
  // anyone touches the dialog. Read-only officials never trigger it:
  // pnp_officer_directory() is Captain/OIC-only, and asking for it
  // just to render a name is not worth an error.
  useEffect(() => {
    if (!assignOpen && !(referral && canManage)) return;
    let cancelled = false;
    (async () => {
      const res = await fetchOfficerDirectory();
      if (cancelled) return;
      setOfficers(res.officers);
    })();
    return () => {
      cancelled = true;
    };
  }, [assignOpen, referral, canManage]);

  /**
   * A request the Captain still owes the resident an answer on.
   *
   * Both 'pending_review' and 'more_information_required' count. The
   * unique index in pnp-referral-requests.sql treats either as active,
   * so a complaint with a request waiting on the resident is just as
   * blocked as one waiting on the Captain.
   */
  const pendingRequest = useMemo(
    () => requests.find((r) => OPEN_REFERRAL_REQUEST_STATUSES.includes(r.status)) || null,
    [requests]
  );

  /**
   * A request already approved but not yet turned into a referral.
   *
   * This is the state the approve-then-refer flow leaves behind, and
   * it is what the create dialog defaults to, so the Captain does not
   * have to pick the request a second time.
   */
  const approvedRequest = useMemo(
    () => requests.find((r) => r.status === "approved") || null,
    [requests]
  );

  const respondentIdentified = complaint?.respondent_status === "identified";
  const kpApplicability = complaint?.kp_applicability || null;

  const cta = useMemo(
    () =>
      referralCta({
        hasOpenReferral: Boolean(referral) && !isTerminalStatus(referral.status),
        hasPendingRequest: Boolean(pendingRequest),
        respondentIdentified,
        kpApplicability,
        complaintNature: complaint?.complaint_nature,
      }),
    [referral, pendingRequest, respondentIdentified, kpApplicability, complaint]
  );

  const assignedOfficer = useMemo(
    () => officers.find((o) => o.officer_id === referral?.assigned_officer_id) || null,
    [officers, referral]
  );

  const sharedIds = useMemo(() => new Set(shared.map((s) => s.evidenceId)), [shared]);
  const shareableEvidence = useMemo(
    () => evidence.filter((f) => !sharedIds.has(f.id)),
    [evidence, sharedIds]
  );

  /**
   * pnp_officer_directory() returns one row per unit membership, so an
   * officer belonging to two units comes back twice. Collapse to one
   * row per officer here, otherwise the <option> keys collide and the
   * same person appears as two assignable entries.
   */
  const officerChoices = useMemo(() => {
    const byId = new Map();
    officers.forEach((officer) => {
      if (!byId.has(officer.officer_id)) byId.set(officer.officer_id, officer);
    });
    return [...byId.values()].sort((a, b) =>
      (a.display_name || "").localeCompare(b.display_name || "")
    );
  }, [officers]);

  const officialTransitions = referral ? OFFICIAL_OFFERED_TRANSITIONS[referral.status] || [] : [];

  /* ── Actions ──────────────────────────────────────────────── */

  const runCreate = async () => {
    const basis = form.basis || "barangay_initiated";
    if (basis === "resident_request" && !form.requestId) {
      setFormError("Choose which resident request this referral approves.");
      return;
    }

    setBusy("create");
    setFormError("");
    const result = await createReferral({
      complaintId: complaint.id,
      summary: form.summary || "",
      referralReason: form.reason || "",
      basis,
      requestId: form.requestId || null,
      hasSafetyConcern: Boolean(form.safety),
      evidenceIds: form.evidenceIds || [],
      incidentDate: form.incidentDate || null,
      incidentLocation: form.incidentLocation || null,
      partiesInvolved: form.partiesInvolved || null,
      dueAt: form.dueAt || null,
    });
    setBusy(null);

    if (!result.success) {
      setFormError(result.error || "The referral could not be created.");
      return;
    }
    toast.success("Referral created. Assign a PNP officer next.");
    setCreateOpen(false);
    setForm({});
    await load();
  };

  /**
   * Record the barangay's decision on a resident's request.
   *
   * Approving does not create the referral. It is deliberately a
   * separate step, because pnp_create_referral() refuses a request
   * that is not already 'approved', and because the resident should be
   * told their request was approved before they are told the case was
   * referred. After approving, the request row turns into the
   * "Create referral from this request" button.
   */
  const runReview = async () => {
    setBusy("review");
    setFormError("");
    const result = await reviewReferralRequest(
      form.requestId,
      reviewDecision,
      form.decisionNote || null
    );
    setBusy(null);

    if (!result.success) {
      setFormError(result.error || "The request could not be reviewed.");
      return;
    }
    toast.success(
      reviewDecision === "approved"
        ? "Request approved. You can now create the referral from it."
        : "The resident has been told your decision."
    );
    setReviewOpen(false);
    setForm({});
    await load();
  };

  const runAssign = async () => {
    if (!form.officerId) {
      setFormError("Choose a PNP officer.");
      return;
    }
    setBusy("assign");
    setFormError("");
    const result = await assignReferral(
      referral.id,
      form.officerId,
      form.unitId || null,
      form.assignMessage || null
    );
    setBusy(null);
    if (!result.success) {
      setFormError(result.error || "The assignment could not be saved.");
      return;
    }
    toast.success(referral.assigned_officer_id ? "Officer reassigned." : "Referral assigned.");
    setAssignOpen(false);
    setForm({});
    await load();
  };

  const runRelease = async () => {
    setBusy("release");
    const result = await releaseReferral(referral.id, form.releaseReason || "");
    setBusy(null);
    if (!result.success) {
      setFormError(result.error || "The officer could not be released.");
      return;
    }
    toast.success("Officer released. Their access ends immediately.");
    setReleaseOpen(false);
    setForm({});
    await load();
  };

  const runAnswer = async () => {
    setBusy("answer");
    const result = await respondToReferralInformation(referral.id, form.answer || "");
    setBusy(null);
    if (!result.success) {
      setFormError(result.error || "The response could not be sent.");
      return;
    }
    toast.success("Response sent to the assigned PNP officer.");
    setAnswerOpen(false);
    setForm({});
    await load();
  };

  const runShare = async () => {
    if (!form.evidenceId) {
      setFormError("Choose a file to share.");
      return;
    }
    setBusy("share");
    setFormError("");
    const result = await shareReferralEvidence(referral.id, form.evidenceId, form.shareNote || null);
    setBusy(null);
    if (!result.success) {
      setFormError(result.error || "The file could not be shared.");
      return;
    }
    toast.success("File shared with the PNP.");
    setShareOpen(false);
    setForm({});
    await load();
  };

  const runStatus = async (status) => {
    setBusy(`status:${status}`);
    const result = await updateReferralStatus(
      referral.id,
      status,
      statusNeedsReason(status) ? form.statusReason || "" : null,
      null
    );
    setBusy(null);
    if (!result.success) {
      toast.error(result.error || "The status could not be changed.");
      return;
    }
    toast.success(`Referral marked ${humanize(status).toLowerCase()}.`);
    setPendingStatus(null);
    setForm({});
    await load();
  };

  /* ── Render ───────────────────────────────────────────────── */

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-24 animate-pulse rounded-2xl bg-alt/60" />
        <div className="h-64 animate-pulse rounded-2xl bg-alt/60" />
      </div>
    );
  }

  if (loadError === "referral-tables") {
    return (
      <Panel title="PNP Referral" tag="Unavailable" tagClass="bg-warning-soft text-warning">
        <p className="text-sm leading-relaxed text-muted">
          The referral tables are not present in this database. Apply the PNP referral migrations
          in order, then reload this page. Nothing about this complaint is affected.
        </p>
      </Panel>
    );
  }

  return (
    <div className="space-y-4">
      {/* What the PNP can and cannot see. Always first, because it is
          the part an official is most likely to get wrong. */}
      <p className="rounded-xl border border-info-soft bg-info-soft/40 px-4 py-3 text-xs leading-relaxed text-mirage">
        <strong className="font-semibold text-secondary">What the PNP sees:</strong> the referral
        summary, the incident facts you record here, the status of this referral, and only the
        evidence files you tick. The PNP never sees the complainant&rsquo;s narrative, your internal
        notes, the resident&rsquo;s request history, or this case file.{" "}
        <strong className="font-semibold text-secondary">A referral reference is not a police
        blotter number</strong> and is not an official police record.
      </p>

      {/* ── Resident requests ─────────────────────────────────── */}
      <Panel
        title="Resident Referral Requests"
        tag={pendingRequest ? "Decision needed" : requests.length ? "Reviewed" : "None"}
        tagClass={pendingRequest ? "bg-warning-soft text-warning" : "bg-alt text-muted"}
      >
        {requests.length === 0 ? (
          <p className="text-sm text-muted">
            No resident has asked for a PNP referral on this complaint. A referral may still be
            created on the barangay&rsquo;s own initiative.
          </p>
        ) : (
          <ul className="space-y-3">
            {requests.map((request) => (
              <li
                key={request.id}
                className="rounded-xl border border-line px-4 py-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-navy">
                    {REQUEST_STATUS_LABELS[request.status] || humanize(request.status)}
                  </p>
                  <p className="text-[11px] text-muted">
                    {formatDateTime(request.requested_at)}
                  </p>
                </div>
                <p className="mt-1.5 text-[13px] leading-relaxed text-mirage">{request.reason}</p>
                {request.has_immediate_safety_concern ? (
                  <p className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-critical-soft px-2.5 py-1 text-[11px] font-semibold text-critical">
                    <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
                    Resident reports an immediate safety concern
                  </p>
                ) : null}
                {request.decision_note ? (
                  <p className="mt-2 text-[12px] text-muted">
                    Decision: {request.decision_note}
                  </p>
                ) : null}
                {canManage && !referral ? (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {OPEN_REFERRAL_REQUEST_STATUSES.includes(request.status) ? (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            setForm({ requestId: request.id, summary: request.reason });
                            setReviewOpen(true);
                          }}
                          className="inline-flex h-9 items-center gap-2 rounded-full bg-jordy px-4 text-[13px] font-semibold text-white transition-colors hover:bg-secondary"
                        >
                          <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                          Approve request
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setForm({ requestId: request.id, summary: request.reason });
                            setReviewDecision("declined");
                            setReviewOpen(true);
                          }}
                          className="inline-flex h-9 items-center gap-2 rounded-full border border-line bg-white px-4 text-[13px] font-semibold text-mirage transition-colors hover:bg-alt"
                        >
                          Decline
                        </button>
                      </>
                    ) : null}

                    {request.status === "approved" ? (
                      // Gated on cta.enabled like every other referral
                      // action. pnp_create_referral() re-checks
                      // eligibility and refuses a KP-applicable case, so
                      // offering this button unconditionally put an
                      // action that can never succeed directly beside the
                      // disabled "Not Eligible for Referral" button that
                      // says the same thing in the other direction.
                      // referralCta() exists to be asked first.
                      cta.enabled ? (
                        <button
                          type="button"
                          onClick={() => {
                            setForm({
                              basis: "resident_request",
                              requestId: request.id,
                              summary: request.reason,
                              evidenceIds: [],
                              // Seed the flag from the resident's request. Left
                              // out, `hasSafetyConcern` falls through to false
                              // and the one thing the resident asked the PNP to
                              // know is dropped by the very form that carries
                              // their words forward. The Captain can still
                              // untick it; they should not have to re-declare it.
                              safety: Boolean(request.has_immediate_safety_concern),
                            });
                            setCreateOpen(true);
                          }}
                          className="inline-flex h-9 items-center gap-2 rounded-full bg-jordy px-4 text-[13px] font-semibold text-white transition-colors hover:bg-secondary"
                        >
                          <FileText className="h-4 w-4" aria-hidden="true" />
                          Create referral from this request
                        </button>
                      ) : (
                        <p className="mt-3 max-w-xl text-[12px] leading-relaxed text-muted">
                          {cta.hint} The request is approved, but a referral
                          cannot be raised on this case.
                        </p>
                      )
                    ) : null}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {/* ── No referral yet ──────────────────────────────────── */}
      {!referral ? (
        <Panel title="PNP Referral" tag="Not referred" tagClass="bg-alt text-muted">
          <p className="text-sm leading-relaxed text-muted">{cta.hint}</p>
          {canManage ? (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <LoadingButton
                onClick={() => {
                  if (cta.kind === "create" || cta.enabled) {
                    // Only an APPROVED request can back a referral.
                    // Offering a pending one here would produce an RPC
                    // rejection, so the basis falls back to the
                    // barangay when nothing has been approved yet.
                    const basisFor = approvedRequest ? "resident_request" : "barangay_initiated";
                    setForm({
                      basis: basisFor,
                      requestId: approvedRequest?.id || "",
                      summary:
                        approvedRequest?.summary || approvedRequest?.reason || "",
                      evidenceIds: [],
                      safety: Boolean(
                        approvedRequest?.has_immediate_safety_concern
                      ),
                    });
                    setCreateOpen(true);
                  }
                }}
                isLoading={false}
                disabled={!cta.enabled}
                className="h-11 px-6 py-0"
              >
                {cta.label}
              </LoadingButton>
              {pendingRequest ? (
                <button
                  type="button"
                  onClick={() => {
                    setForm({
                      requestId: pendingRequest.id,
                      summary: pendingRequest.reason,
                    });
                    setReviewDecision("approved");
                    setReviewOpen(true);
                  }}
                  className="inline-flex h-11 items-center gap-2 rounded-full border border-line bg-white px-5 text-sm font-semibold text-mirage transition-colors hover:bg-alt"
                >
                  Review Resident Request
                </button>
              ) : null}
            </div>
          ) : null}
        </Panel>
      ) : (
        <>
          {/* ── The referral ──────────────────────────────────── */}
          <Panel
            title="PNP Referral"
            tag={isTerminalStatus(referral.status) ? "Finished" : "Active"}
            tagClass={
              isTerminalStatus(referral.status)
                ? "bg-alt text-muted"
                : "bg-success-soft text-success"
            }
            actions={<StatusPill status={referral.status} />}
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Reference">{displayReference(referral)}</Field>
              <Field label="Referred">{formatDateTime(referral.referred_at)}</Field>
              <Field label="Basis">{humanize(referral.referral_basis)}</Field>
              <Field label="Assigned officer">
                {assignedOfficer
                  ? `${assignedOfficer.display_name}${
                      assignedOfficer.rank ? ` · ${assignedOfficer.rank}` : ""
                    }${
                      assignedOfficer.unit_name ? ` · ${assignedOfficer.unit_name}` : ""
                    }`
                  : referral.assigned_officer_id
                    ? "Assigned officer (name unavailable)"
                    : "Unassigned"}
              </Field>
              <Field label="PNP reference">
                {referral.external_reference || "Not provided"}
              </Field>
              <Field label="Response due">{formatDate(referral.due_at)}</Field>
            </div>

            <div className="mt-4 rounded-xl bg-canvas px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                Summary the PNP reads
              </p>
              <p className="mt-1 text-sm leading-relaxed text-navy">{referral.summary}</p>
              {referral.parties_involved || referral.incident_location ? (
                <p className="mt-2 text-[12px] text-muted">
                  {[
                    referral.incident_location ? `Location: ${referral.incident_location}` : null,
                    referral.parties_involved ? `Parties: ${referral.parties_involved}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              ) : null}
            </div>

            {referral.has_safety_concern ? (
              <p className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-critical-soft px-2.5 py-1.5 text-[11px] font-semibold text-critical">
                <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                Flagged as an immediate safety concern
              </p>
            ) : null}

            {referral.resolution_reason ? (
              <p className="mt-3 text-[12px] text-muted">
                Closing reason: {referral.resolution_reason}
              </p>
            ) : null}

            {canManage ? (
              <div className="mt-5 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setForm({ unitId: referral.assigned_unit_id || "" });
                    setAssignOpen(true);
                  }}
                  className="inline-flex h-10 items-center gap-2 rounded-full bg-jordy px-4 text-[13px] font-semibold text-white transition-colors hover:bg-secondary"
                >
                  <UserCheck className="h-4 w-4" aria-hidden="true" />
                  {referral.assigned_officer_id ? "Reassign" : "Assign officer"}
                </button>

                {referral.assigned_officer_id ? (
                  <button
                    type="button"
                    onClick={() => setReleaseOpen(true)}
                    className="inline-flex h-10 items-center gap-2 rounded-full border border-line bg-white px-4 text-[13px] font-semibold text-mirage transition-colors hover:bg-alt"
                  >
                    <UserMinus className="h-4 w-4" aria-hidden="true" />
                    Release officer
                  </button>
                ) : null}

                {shareableEvidence.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => setShareOpen(true)}
                    className="inline-flex h-10 items-center gap-2 rounded-full border border-line bg-white px-4 text-[13px] font-semibold text-mirage transition-colors hover:bg-alt"
                  >
                    <Paperclip className="h-4 w-4" aria-hidden="true" />
                    Share evidence
                  </button>
                ) : null}

                {referral.status === "needs_information" ? (
                  <button
                    type="button"
                    onClick={() => setAnswerOpen(true)}
                    className="inline-flex h-10 items-center gap-2 rounded-full bg-jordy px-4 text-[13px] font-semibold text-white transition-colors hover:bg-secondary"
                  >
                    <FileText className="h-4 w-4" aria-hidden="true" />
                    Answer information request
                  </button>
                ) : null}

                {officialTransitions.map((status) => (
                  <button
                    key={status}
                    type="button"
                    disabled={busy !== null}
                    onClick={() => {
                      if (statusNeedsReason(status)) {
                        setPendingStatus(status);
                        return;
                      }
                      runStatus(status);
                    }}
                    className="inline-flex h-10 items-center gap-2 rounded-full border border-line bg-white px-4 text-[13px] font-semibold text-mirage transition-colors hover:bg-alt disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {humanize(status)}
                  </button>
                ))}
              </div>
            ) : (
              <p className="mt-5 text-[12px] text-muted">
                Only the Barangay Captain or the Officer-in-Charge can assign this referral, share
                evidence, or change its status.
              </p>
            )}
          </Panel>

          {/* ── Shared evidence ────────────────────────────────── */}
          <Panel title="Evidence Shared With PNP" tag={`${shared.length} of ${evidence.length}`}>
            {shared.length === 0 ? (
              <p className="text-sm text-muted">
                No evidence has been shared. The PNP sees the summary only.
              </p>
            ) : (
              <ul className="space-y-2">
                {shared.map((file) => (
                  <li
                    key={file.evidenceId}
                    className="flex items-center gap-2.5 rounded-xl border border-line px-3.5 py-2.5"
                  >
                    <Paperclip className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
                    <span className="truncate text-[13px] text-navy">
                      {file.filename || "File"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {/* ── Timeline ───────────────────────────────────────── */}
          <Panel title="Referral Timeline" tag={`${timeline.length} entries`}>
            {timeline.length === 0 ? (
              <p className="text-sm text-muted">No entries yet.</p>
            ) : (
              <ol className="space-y-3">
                {[...timeline].reverse().map((entry) => (
                  <li key={entry.id} className="border-l-2 border-line pl-4">
                    <p className="text-[13px] font-semibold text-navy">
                      {humanize(entry.update_type)}
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted">
                      {formatDateTime(entry.created_at)} ·{" "}
                      {humanize(entry.author_role || "system")}
                    </p>
                    {entry.message ? (
                      <p className="mt-1 text-[13px] leading-relaxed text-mirage">
                        {entry.message}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ol>
            )}
          </Panel>
        </>
      )}

      {/* ── Review request dialog ──────────────────────────── */}
      <ResidentModal
        open={reviewOpen}
        onClose={() => setReviewOpen(false)}
        labelledBy="review-request-title"
        title="Decide on the resident's referral request"
        maxWidthClass="max-w-lg"
      >
        <p className="text-[13px] leading-relaxed text-muted">
          {reviewDecision === "approved"
            ? "Approving records the barangay's agreement to refer this case. It does not create the referral yet: you still write the summary and choose the evidence, and the referral is created from the approved request on the next step."
            : "The resident is told your decision and the note you write here. Write it for them, not for the file."}
        </p>

        <div className="mt-4 space-y-4">
          <div>
            <span className={labelClass}>Decision</span>
            <div className="space-y-2">
              {[
                { value: "approved", label: "Approve — the barangay agrees to refer this case" },
                { value: "declined", label: "Decline — this case will not be referred" },
                {
                  value: "more_information_required",
                  label: "Ask the resident for more information first",
                },
              ].map((option) => (
                <label
                  key={option.value}
                  className="flex items-start gap-2.5 text-[13px] text-navy"
                >
                  <input
                    type="radio"
                    name="review-decision"
                    className="mt-0.5"
                    checked={reviewDecision === option.value}
                    onChange={() => setReviewDecision(option.value)}
                  />
                  <span>{option.label}</span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <label htmlFor="review-note" className={labelClass}>
              Note to the resident{" "}
              {reviewDecision === "approved" ? "(optional)" : (
                <>
                  <span className="text-critical">*</span>
                </>
              )}
            </label>
            <textarea
              id="review-note"
              rows={4}
              value={form.decisionNote || ""}
              onChange={(e) => setForm((prev) => ({ ...prev, decisionNote: e.target.value }))}
              className={inputClass}
            />
          </div>

          {formError ? (
            <p className="rounded-lg bg-critical-soft px-3 py-2 text-[12px] font-medium text-critical">
              {formError}
            </p>
          ) : null}
        </div>

        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={() => setReviewOpen(false)}
            disabled={busy === "review"}
            className="inline-flex h-11 items-center justify-center rounded-full border border-line px-5 text-sm font-semibold text-mirage transition-colors hover:bg-alt disabled:opacity-60"
          >
            Cancel
          </button>
          <LoadingButton onClick={runReview} isLoading={busy === "review"}>
            Save decision
          </LoadingButton>
        </div>
      </ResidentModal>

      {/* ── Create dialog ────────────────────────────────────── */}
      <ResidentModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        labelledBy="create-referral-title"
        title="Refer this complaint to the PNP"
        maxWidthClass="max-w-2xl"
      >
        <div className="space-y-4">
          {approvedRequest ? (
            <div className="rounded-xl border border-info-soft bg-info-soft/40 px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-secondary">
                Referral basis
              </p>
              <div className="mt-2 space-y-2">
                <label className="flex items-start gap-2.5 text-[13px] text-navy">
                  <input
                    type="radio"
                    name="referral-basis"
                    className="mt-0.5"
                    checked={form.basis === "resident_request"}
                    onChange={() =>
                      setForm((prev) => ({
                        ...prev,
                        basis: "resident_request",
                        requestId: approvedRequest.id,
                      }))
                    }
                  />
                  <span>
                    This referral answers the resident&rsquo;s approved request
                    <span className="block text-[12px] text-muted">
                      {approvedRequest.reason}
                    </span>
                  </span>
                </label>
                <label className="flex items-start gap-2.5 text-[13px] text-navy">
                  <input
                    type="radio"
                    name="referral-basis"
                    className="mt-0.5"
                    checked={form.basis === "barangay_initiated"}
                    onChange={() =>
                      setForm((prev) => ({ ...prev, basis: "barangay_initiated", requestId: "" }))
                    }
                  />
                  <span>Barangay-initiated, unrelated to the request</span>
                </label>
              </div>
            </div>
          ) : null}

          {pendingRequest ? (
            <p className="rounded-xl border border-warning-soft bg-paledgold px-4 py-3 text-[12px] leading-relaxed text-mirage">
              <strong className="font-semibold text-warning">Decide the request first.</strong>{" "}
              The resident&rsquo;s request is still {humanize(pendingRequest.status).toLowerCase()},
              so this referral is being created on the barangay&rsquo;s own initiative. Review and
              approve the request above if it should be the basis for the referral instead.
            </p>
          ) : null}

          <div>
            <label htmlFor="ref-summary" className={labelClass}>
              Referral summary <span className="text-critical">*</span>
            </label>
            <p className="mb-1.5 text-[12px] text-muted">
              This is the only case narrative the PNP will read. Write it as if the PNP knows
              nothing about this complaint.
            </p>
            <textarea
              id="ref-summary"
              rows={4}
              value={form.summary || ""}
              onChange={(e) => setForm((prev) => ({ ...prev, summary: e.target.value }))}
              className={inputClass}
              placeholder="What happened, who is involved, and what help is being requested."
            />
          </div>

          <div>
            <label htmlFor="ref-reason" className={labelClass}>
              Why this is being referred <span className="text-critical">*</span>
            </label>
            <input
              id="ref-reason"
              value={form.reason || ""}
              onChange={(e) => setForm((prev) => ({ ...prev, reason: e.target.value }))}
              className={inputClass}
              placeholder="e.g. Beyond barangay mediation, criminal act"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="ref-incident-date" className={labelClass}>
                Incident date
              </label>
              <input
                id="ref-incident-date"
                type="date"
                value={form.incidentDate || ""}
                onChange={(e) => setForm((prev) => ({ ...prev, incidentDate: e.target.value }))}
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="ref-due" className={labelClass}>
                Response requested by
              </label>
              <input
                id="ref-due"
                type="date"
                value={form.dueAt || ""}
                onChange={(e) => setForm((prev) => ({ ...prev, dueAt: e.target.value }))}
                className={inputClass}
              />
            </div>
          </div>

          <div>
            <label htmlFor="ref-location" className={labelClass}>
              Incident location
            </label>
            <input
              id="ref-location"
              value={form.incidentLocation || ""}
              onChange={(e) => setForm((prev) => ({ ...prev, incidentLocation: e.target.value }))}
              className={inputClass}
            />
          </div>

          <div>
            <label htmlFor="ref-parties" className={labelClass}>
              Parties involved
            </label>
            <input
              id="ref-parties"
              value={form.partiesInvolved || ""}
              onChange={(e) => setForm((prev) => ({ ...prev, partiesInvolved: e.target.value }))}
              className={inputClass}
            />
          </div>

          <div>
            <p className={labelClass}>Evidence to share</p>
            {evidence.length === 0 ? (
              <p className="text-[13px] text-muted">
                This complaint has no evidence files. The referral will carry the summary only.
              </p>
            ) : (
              <div className="max-h-40 space-y-1.5 overflow-y-auto rounded-xl border border-line px-3.5 py-2.5">
                {evidence.map((file) => {
                  const checked = (form.evidenceIds || []).includes(file.id);
                  return (
                    <label
                      key={file.id}
                      className="flex items-center gap-2.5 text-[13px] text-navy"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          setForm((prev) => ({
                            ...prev,
                            evidenceIds: checked
                              ? (prev.evidenceIds || []).filter((id) => id !== file.id)
                              : [...(prev.evidenceIds || []), file.id],
                          }))
                        }
                      />
                      <span className="truncate">
                        {file.original_filename || file.file_name || "File"}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          <label className="flex items-start gap-2.5 text-[13px] text-navy">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={Boolean(form.safety)}
              onChange={(e) => setForm((prev) => ({ ...prev, safety: e.target.checked }))}
            />
            <span>Flag as an immediate safety concern</span>
          </label>

          {formError ? (
            <p className="rounded-lg bg-critical-soft px-3 py-2 text-[12px] font-medium text-critical">
              {formError}
            </p>
          ) : null}
        </div>

        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={() => setCreateOpen(false)}
            disabled={busy === "create"}
            className="inline-flex h-11 items-center justify-center rounded-full border border-line px-5 text-sm font-semibold text-mirage transition-colors hover:bg-alt disabled:opacity-60"
          >
            Cancel
          </button>
          <LoadingButton onClick={runCreate} isLoading={busy === "create"}>
            Create referral
          </LoadingButton>
        </div>
      </ResidentModal>

      {/* ── Assign dialog ────────────────────────────────────── */}
      <ResidentModal
        open={assignOpen}
        onClose={() => setAssignOpen(false)}
        labelledBy="assign-referral-title"
        title={referral?.assigned_officer_id ? "Reassign this referral" : "Assign a PNP officer"}
        maxWidthClass="max-w-lg"
      >
        <div className="space-y-4">
          <div>
            <label htmlFor="assign-officer" className={labelClass}>
              Officer <span className="text-critical">*</span>
            </label>
            <select
              id="assign-officer"
              value={form.officerId || ""}
              onChange={(e) =>
                setForm((prev) => {
                  const officer = officers.find((o) => o.officer_id === e.target.value);
                  return {
                    ...prev,
                    officerId: e.target.value,
                    unitId: officer?.unit_id || prev.unitId || "",
                  };
                })
              }
              className={inputClass}
            >
              <option value="">Choose an officer…</option>
              {officerChoices.map((officer) => (
                <option key={officer.officer_id} value={officer.officer_id}>
                  {officer.display_name}
                  {officer.rank ? ` · ${officer.rank}` : ""}
                  {officer.unit_name ? ` · ${officer.unit_name}` : ""}
                  {officer.open_referrals ? ` · ${officer.open_referrals} open` : ""}
                </option>
              ))}
            </select>
            <p className="mt-1.5 text-[12px] text-muted">
              Only active PNP officers are listed. Reassigning releases the previous officer
              immediately, so choose deliberately.
            </p>
          </div>

          <div>
            <label htmlFor="assign-message" className={labelClass}>
              Message to the officer
            </label>
            <textarea
              id="assign-message"
              rows={3}
              value={form.assignMessage || ""}
              onChange={(e) => setForm((prev) => ({ ...prev, assignMessage: e.target.value }))}
              className={inputClass}
            />
          </div>

          {formError ? (
            <p className="rounded-lg bg-critical-soft px-3 py-2 text-[12px] font-medium text-critical">
              {formError}
            </p>
          ) : null}
        </div>

        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={() => setAssignOpen(false)}
            disabled={busy === "assign"}
            className="inline-flex h-11 items-center justify-center rounded-full border border-line px-5 text-sm font-semibold text-mirage transition-colors hover:bg-alt disabled:opacity-60"
          >
            Cancel
          </button>
          <LoadingButton onClick={runAssign} isLoading={busy === "assign"}>
            Save assignment
          </LoadingButton>
        </div>
      </ResidentModal>

      {/* ── Release dialog ───────────────────────────────────── */}
      <ConfirmDialog
        open={releaseOpen}
        onClose={() => setReleaseOpen(false)}
        onConfirm={runRelease}
        title="Release the assigned officer"
        confirmLabel="Release officer"
        busy={busy === "release"}
        message="Their access to this referral ends the moment this is saved. The assignment history is kept."
      >
        <div className="mt-4">
          <label htmlFor="release-reason" className={labelClass}>
            Reason <span className="text-critical">*</span>
          </label>
          <input
            id="release-reason"
            value={form.releaseReason || ""}
            onChange={(e) => setForm((prev) => ({ ...prev, releaseReason: e.target.value }))}
            className={inputClass}
            placeholder="e.g. Reassigned to another station"
          />
          {formError ? (
            <p className="mt-1.5 text-[12px] font-medium text-critical">{formError}</p>
          ) : null}
        </div>
      </ConfirmDialog>

      {/* ── Answer information request dialog ────────────────── */}
      <ResidentModal
        open={answerOpen}
        onClose={() => setAnswerOpen(false)}
        labelledBy="answer-referral-title"
        title="Answer the PNP's information request"
        maxWidthClass="max-w-lg"
      >
        <p className="text-[13px] leading-relaxed text-muted">
          Your answer is written to the referral timeline and shown to the assigned PNP officer. It
          does not change the complaint record, and it is not visible to the resident.
        </p>
        <div className="mt-4">
          <label htmlFor="referral-answer" className={labelClass}>
            Response <span className="text-critical">*</span>
          </label>
          <textarea
            id="referral-answer"
            rows={5}
            value={form.answer || ""}
            onChange={(e) => setForm((prev) => ({ ...prev, answer: e.target.value }))}
            className={inputClass}
          />
        </div>
        {formError ? (
          <p className="mt-2 rounded-lg bg-critical-soft px-3 py-2 text-[12px] font-medium text-critical">
            {formError}
          </p>
        ) : null}
        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={() => setAnswerOpen(false)}
            disabled={busy === "answer"}
            className="inline-flex h-11 items-center justify-center rounded-full border border-line px-5 text-sm font-semibold text-mirage transition-colors hover:bg-alt disabled:opacity-60"
          >
            Cancel
          </button>
          <LoadingButton onClick={runAnswer} isLoading={busy === "answer"}>
            Send response
          </LoadingButton>
        </div>
      </ResidentModal>

      {/* ── Share evidence dialog ────────────────────────────── */}
      <ResidentModal
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        labelledBy="share-evidence-title"
        title="Share an evidence file with the PNP"
        maxWidthClass="max-w-lg"
      >
        <p className="text-[13px] leading-relaxed text-muted">
          Sharing is per file and cannot be undone. A shared file is readable by the assigned PNP
          officer for as long as they hold the assignment, and by nobody else.
        </p>
        <div className="mt-4 space-y-4">
          <div>
            <label htmlFor="share-evidence" className={labelClass}>
              File <span className="text-critical">*</span>
            </label>
            <select
              id="share-evidence"
              value={form.evidenceId || ""}
              onChange={(e) => setForm((prev) => ({ ...prev, evidenceId: e.target.value }))}
              className={inputClass}
            >
              <option value="">Choose a file…</option>
              {shareableEvidence.map((file) => (
                <option key={file.id} value={file.id}>
                  {file.original_filename || file.file_name || "File"}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="share-note" className={labelClass}>
              Note for the PNP
            </label>
            <input
              id="share-note"
              value={form.shareNote || ""}
              onChange={(e) => setForm((prev) => ({ ...prev, shareNote: e.target.value }))}
              className={inputClass}
            />
          </div>
          {formError ? (
            <p className="rounded-lg bg-critical-soft px-3 py-2 text-[12px] font-medium text-critical">
              {formError}
            </p>
          ) : null}
        </div>
        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={() => setShareOpen(false)}
            disabled={busy === "share"}
            className="inline-flex h-11 items-center justify-center rounded-full border border-line px-5 text-sm font-semibold text-mirage transition-colors hover:bg-alt disabled:opacity-60"
          >
            Cancel
          </button>
          <LoadingButton onClick={runShare} isLoading={busy === "share"}>
            Share file
          </LoadingButton>
        </div>
      </ResidentModal>

      {/* ── Reason dialog for returned / declined / closed ────── */}
      <ConfirmDialog
        open={Boolean(pendingStatus)}
        onClose={() => {
          setPendingStatus(null);
          setFormError("");
        }}
        onConfirm={() => runStatus(pendingStatus)}
        title={pendingStatus ? humanize(pendingStatus) : ""}
        confirmLabel={pendingStatus ? humanize(pendingStatus) : "Confirm"}
        busy={busy === `status:${pendingStatus}`}
        message="This decision is recorded on the referral timeline, the audit log, and the resident's notifications. It cannot be edited afterwards."
      >
        <div className="mt-4">
          <label htmlFor="status-reason" className={labelClass}>
            Reason <span className="text-critical">*</span>
          </label>
          <textarea
            id="status-reason"
            rows={3}
            value={form.statusReason || ""}
            onChange={(e) => setForm((prev) => ({ ...prev, statusReason: e.target.value }))}
            className={inputClass}
          />
        </div>
      </ConfirmDialog>
    </div>
  );
}
