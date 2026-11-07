"use client";

/**
 * Record a referral to the PNP or another government office.
 *
 * WHAT THIS FORM DELIBERATELY DOES NOT HAVE
 *   There is no "status" dropdown, no "police case number" field, and
 *   no "outcome" choice with values like Accepted / Under
 *   Investigation. The barangay cannot know any of those things, and a
 *   form that offers them invites an official to select one and create
 *   a record the system cannot support.
 *
 *   What the official can honestly record is: which office, when, what
 *   the barangay did, what they were told — in their own words — and
 *   whether a follow-up is expected. `recorded_outcome` is free text
 *   precisely so "pending" and "no response received" are valid
 *   answers.
 *
 *   No police account is created, no agency is contacted, and no
 *   reference number is invented. A blank reference number is a normal,
 *   valid state.
 */

import { useState } from "react";
import toast from "react-hot-toast";
import { Info } from "lucide-react";
import ResidentModal from "@/components/shared/ResidentModal";
import LoadingButton from "@/components/shared/LoadingButton";
import ConfirmDialog from "@/components/shared/ConfirmDialog";
import {
  ASSISTANCE_TYPES,
  recordAssistance,
  routingStatusMeta,
} from "@/lib/captainComplaintRouting";
import { formatDateTime } from "./complaintMeta";

const OUTCOME_SUGGESTIONS = [
  "Pending — no response received",
  "Acknowledged by the office",
  "Complainant was advised to follow up directly",
];

export default function AssistanceRecordModal({
  open,
  onClose,
  onSaved,
  complaint,
  supabase,
  assistanceType,
}) {
  const [type, setType] = useState(
    () =>
      assistanceType ||
      ASSISTANCE_TYPES[0]?.value ||
      "advised_to_report"
  );
  const [agency, setAgency] = useState("");
  const [reference, setReference] = useState("");
  const [given, setGiven] = useState("");
  const [summary, setSummary] = useState("");
  const [followUp, setFollowUp] = useState(false);
  const [followUpOn, setFollowUpOn] = useState("");
  const [outcome, setOutcome] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const routeLabel = routingStatusMeta(complaint?.routing_status).label;
  const typeMeta = ASSISTANCE_TYPES.find((o) => o.value === type) || null;

  const reset = () => {
    setAgency("");
    setReference("");
    setGiven("");
    setSummary("");
    setFollowUp(false);
    setFollowUpOn("");
    setOutcome("");
    setMessage("");
    setError(null);
  };

  const attemptSave = () => {
    if (!type) {
      setError("Choose the type of assistance that was given.");
      return;
    }
    if (!agency.trim() && !given.trim() && !summary.trim()) {
      setError(
        "Name the receiving office if known, describe the assistance given, or add a short summary."
      );
      return;
    }
    if (followUp && !followUpOn) {
      setError("Give a date for the follow-up, or turn follow-up off.");
      return;
    }
    if (message.trim().length > 500) {
      setError("Keep the resident message under 500 characters.");
      return;
    }
    setError(null);
    setConfirmOpen(true);
  };

  const save = async () => {
    setBusy(true);
    try {
      const result = await recordAssistance(supabase, {
        complaintId: complaint.id,
        assistanceType: type,
        agencyName: agency,
        referenceNumber: reference,
        assistanceGiven: given,
        assistanceSummary: summary,
        followUpRequired: followUp,
        followUpDueOn: followUpOn || null,
        recordedOutcome: outcome,
        residentMessage: message,
      });

      if (!result.success) {
        setError(result.error);
        setConfirmOpen(false);
        return;
      }

      toast.success("Referral recorded.");
      reset();
      setConfirmOpen(false);
      onSaved();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <ResidentModal
        open={open}
        onClose={() => {
          if (busy) return;
          reset();
          onClose();
        }}
        labelledBy="assistance-title"
        title="Record a Referral"
        maxWidthClass="max-w-lg"
      >
        <div className="space-y-4 text-sm">
          <p className="flex items-start gap-2 rounded-xl bg-info-soft px-4 py-3 text-xs leading-relaxed text-mirage">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-secondary" aria-hidden="true" />
            <span>
              This record states only that you, as a barangay official, recorded a referral at this
              time. It does not mean any agency received, accepted, or acted on the complaint. The
              barangay does not create a police account or a police case.
            </span>
          </p>

          <div className="rounded-xl bg-alt px-4 py-3">
            <p className="text-[11px] uppercase tracking-wide text-muted">Route on this case</p>
            <p className="mt-0.5 text-sm font-semibold text-mirage">{routeLabel}</p>
          </div>

          {/* ── Assistance type ────────────────────────────────── */}
          <fieldset>
            <legend className="mb-2 text-xs font-semibold text-muted">
              What the barangay did
            </legend>
            <div className="space-y-2">
              {ASSISTANCE_TYPES.filter((o) => !o.value.startsWith("police_reporting_assistance") && !o.value.startsWith("external_agency_assistance")).map((option) => {
                const selectedOption = option.value === type;
                return (
                  <label
                    key={option.value}
                    className={`flex items-start gap-2.5 rounded-2xl border px-4 py-3 transition-colors ${
                      selectedOption
                        ? "cursor-pointer border-secondary bg-info-soft"
                        : "cursor-pointer border-line bg-white hover:bg-alt"
                    }`}
                  >
                    <input
                      type="radio"
                      name="assistance-type"
                      value={option.value}
                      checked={selectedOption}
                      onChange={() => {
                        setType(option.value);
                        setError(null);
                      }}
                      className="mt-1 h-4 w-4 shrink-0 border-line accent-[#1b4c8c]"
                    />
                    <span className="min-w-0">
                      <span className="text-sm font-semibold text-navy">{option.label}</span>
                      <span className="mt-0.5 block text-xs leading-relaxed text-muted">
                        {option.hint}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <div>
            <label
              htmlFor="assistance-agency"
              className="mb-1 block text-xs font-semibold text-muted"
            >
              Receiving office, if known
              <span className="ml-1 font-normal text-muted">(optional)</span>
            </label>
            <input
              id="assistance-agency"
              type="text"
              value={agency}
              onChange={(e) => {
                setAgency(e.target.value);
                setError(null);
              }}
              placeholder="Philippine National Police — Station 1"
              className="h-11 w-full rounded-full border border-line bg-white px-4 text-sm text-mirage outline-none focus:border-secondary focus:ring-2 focus:ring-secondary/20"
            />
            <p className="mt-1 text-[11px] text-muted">
              Leave blank when no office can be named yet (e.g. the resident was only advised to report).
            </p>
          </div>

          <div>
            <label
              htmlFor="assistance-reference"
              className="mb-1 block text-xs font-semibold text-muted"
            >
              Reference number
              <span className="ml-1 font-normal text-muted">(optional)</span>
            </label>
            <input
              id="assistance-reference"
              type="text"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="Only if the office actually gave you one"
              className="h-11 w-full rounded-full border border-line bg-white px-4 text-sm text-mirage outline-none focus:border-secondary focus:ring-2 focus:ring-secondary/20"
            />
            <p className="mt-1 text-[11px] text-muted">
              Leave blank if none was issued. Do not create a number to fill this field.
            </p>
          </div>

          <div>
            <label
              htmlFor="assistance-given"
              className="mb-1 block text-xs font-semibold text-muted"
            >
              What the barangay did
            </label>
            <textarea
              id="assistance-given"
              value={given}
              onChange={(e) => setGiven(e.target.value)}
              rows={2}
              placeholder="Accompanied the complainant to the station and assisted in the report write-up."
              className="w-full rounded-xl border border-line bg-white px-4 py-3 text-sm text-mirage outline-none focus:border-secondary focus:ring-2 focus:ring-secondary/20"
            />
          </div>

          <div>
            <label
              htmlFor="assistance-summary"
              className="mb-1 block text-xs font-semibold text-muted"
            >
              Internal summary
            </label>
            <textarea
              id="assistance-summary"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              rows={2}
              placeholder="Optional. Not shown to the complainant."
              className="w-full rounded-xl border border-line bg-white px-4 py-3 text-sm text-mirage outline-none focus:border-secondary focus:ring-2 focus:ring-secondary/20"
            />
          </div>

          <div>
            <label htmlFor="assistance-outcome" className="mb-1 block text-xs font-semibold text-muted">
              What has been reported back
              <span className="ml-1 font-normal text-muted">(optional)</span>
            </label>
            <input
              id="assistance-outcome"
              type="text"
              value={outcome}
              onChange={(e) => setOutcome(e.target.value)}
              list="assistance-outcome-suggestions"
              placeholder="Pending — no response received"
              className="h-11 w-full rounded-full border border-line bg-white px-4 text-sm text-mirage outline-none focus:border-secondary focus:ring-2 focus:ring-secondary/20"
            />
            <datalist id="assistance-outcome-suggestions">
              {OUTCOME_SUGGESTIONS.map((suggestion) => (
                <option key={suggestion} value={suggestion} />
              ))}
            </datalist>
          </div>

          <div className="rounded-xl border border-line px-4 py-3">
            <label htmlFor="assistance-followup" className="flex items-start gap-2.5 text-mirage">
              <input
                id="assistance-followup"
                type="checkbox"
                checked={followUp}
                onChange={(e) => {
                  setFollowUp(e.target.checked);
                  if (!e.target.checked) setFollowUpOn("");
                }}
                className="mt-0.5 h-4 w-4 rounded border-line accent-[#1b4c8c]"
              />
              A follow-up with this office is expected.
            </label>
            {followUp ? (
              <div className="mt-3">
                <label
                  htmlFor="assistance-followup-date"
                  className="mb-1 block text-xs font-semibold text-muted"
                >
                  Follow up on
                </label>
                <input
                  id="assistance-followup-date"
                  type="date"
                  value={followUpOn}
                  onChange={(e) => setFollowUpOn(e.target.value)}
                  aria-invalid={Boolean(error) && followUp && !followUpOn}
                  className="h-11 w-full rounded-full border border-line bg-white px-4 text-sm text-mirage outline-none focus:border-secondary focus:ring-2 focus:ring-secondary/20"
                />
              </div>
            ) : null}
          </div>

          <div>
            <label
              htmlFor="assistance-message"
              className="mb-1 block text-xs font-semibold text-muted"
            >
              Message to the complainant
              <span className="ml-1 font-normal text-muted">(optional)</span>
            </label>
            <textarea
              id="assistance-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={2}
              maxLength={500}
              placeholder="Leave blank to use the standard wording."
              className="w-full rounded-xl border border-line bg-white px-4 py-3 text-sm text-mirage outline-none focus:border-secondary focus:ring-2 focus:ring-secondary/20"
            />
          </div>

          {error ? (
            <p
              role="alert"
              className="rounded-xl bg-critical-soft px-4 py-3 text-xs font-semibold text-critical"
            >
              {error}
            </p>
          ) : null}

          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={() => {
                reset();
                onClose();
              }}
              disabled={busy}
              className="inline-flex h-11 items-center justify-center rounded-full border border-line px-5 text-sm font-semibold text-mirage transition-colors hover:bg-alt disabled:opacity-60"
            >
              Cancel
            </button>
            <LoadingButton isLoading={busy} onClick={attemptSave} disabled={busy || !type}>
              Record Referral
            </LoadingButton>
          </div>
        </div>
      </ResidentModal>

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={save}
        title="Record this referral?"
        message="This is added permanently to the routing history. It cannot be edited or deleted; a correction is a new entry."
        confirmLabel="Record Referral"
        busy={busy}
      >
        <p className="mt-3 rounded-xl bg-alt px-4 py-3 text-xs leading-relaxed text-mirage">
          <strong className="font-semibold text-navy">
            {typeMeta ? typeMeta.label : "Assistance"}
          </strong>
          {agency ? ` · ${agency}` : ""}
          <br />
          Recorded {formatDateTime(new Date().toISOString())}
        </p>
      </ConfirmDialog>
    </>
  );
}
