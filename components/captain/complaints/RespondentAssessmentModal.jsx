"use client";

/**
 * Record who the verified respondent is.
 *
 * This step answers one question only: who is the other party? It does
 * not decide KP applicability, the route, summons, mediation, or a
 * hearing — those are separate decisions made elsewhere in the workflow.
 *
 * The complainant named a respondent at filing time. That values is
 * shown as "Respondent as filed" and is never overwritten. This form
 * records the verified answer in its own confirmed column, so the
 * original filing and the official confirmation can always be compared.
 *
 * Three answers, no more:
 *   1. Confirm Respondent             — as filed is correct.
 *   2. Correct Respondent Information — fix the name and/or address.
 *   3. Unable to Confirm Respondent   — the other party cannot be
 *      verified; record why in a single required note.
 *
 * The underlying status vocabulary is unchanged: "Confirm" and
 * "Correct" record `identified`, "Unable to confirm" records
 * `unknown`. Only the choices a Captain sees are condensed; routing,
 * KP assessment, summons and mediation behaviour is untouched.
 */

import { useState } from "react";
import toast from "react-hot-toast";
import ResidentModal from "@/components/shared/ResidentModal";
import LoadingButton from "@/components/shared/LoadingButton";
import ConfirmDialog from "@/components/shared/ConfirmDialog";
import { recordRespondentStatus } from "@/lib/captainComplaintRouting";
import { formatDateTime } from "./complaintMeta";

const OPTIONS = [
  {
    value: "confirm",
    label: "Confirm Respondent",
    hint: "The other party named in the complaint is correct.",
  },
  {
    value: "correct",
    label: "Correct Respondent Information",
    hint: "Fix the name or address of the other party before it is recorded.",
  },
  {
    value: "unable",
    label: "Unable to Confirm Respondent",
    hint: "Another party is involved, but the available information is not enough to verify them.",
  },
  {
    value: "none",
    label: "No Respondent Applicable",
    hint: "This complaint does not involve an opposing party that requires respondent verification.",
  },
];

function asFiledNameOf(complaint) {
  return (complaint?.respondent_name || complaint?.persons_involved || "").trim();
}

export default function RespondentAssessmentModal({
  open,
  onClose,
  onSaved,
  complaint,
  supabase,
}) {
  const asFiledName = asFiledNameOf(complaint);
  const asFiledAddress = (complaint?.respondent_address || "").trim();
  const confirmedName = (complaint?.respondent_display_name || "").trim();
  const canConfirm = Boolean(confirmedName || asFiledName);

  const [mode, setMode] = useState(() => {
    const current = complaint?.respondent_status;
    if (current === "identified") return "confirm";
    if (["unknown", "insufficient_information", "not_applicable"].includes(current)) {
      return "unable";
    }
    return asFiledNameOf(complaint) ? "confirm" : "unable";
  });
  const [name, setName] = useState(() => confirmedName || asFiledNameOf(complaint));
  const [address, setAddress] = useState(() => complaint?.respondent_address || "");
  const [reason, setReason] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const targetStatus =
    mode === "unable" ? "unknown" : mode === "none" ? "not_applicable" : "identified";
  const previous =
    complaint?.respondent_status && complaint.respondent_status !== targetStatus
      ? `${complaint.respondent_status} → ${targetStatus}`
      : null;

  const reset = () => {
    setReason("");
    setError(null);
  };

  const validate = () => {
    if (mode === "confirm" && !canConfirm) {
      return "There is no respondent as filed to confirm. Correct the respondent information instead.";
    }
    if (mode === "correct" && !name.trim()) {
      return "Enter the correct name of the other party.";
    }
    if (mode === "unable" && !reason.trim()) {
      return "Record why the other party could not be confirmed.";
    }
    if (mode === "none" && !reason.trim()) {
      return "Record why no respondent applies to this complaint.";
    }
    return null;
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      let respondentStatus;
      let respondentName;
      let reasonToRecord;
      if (mode === "unable") {
        respondentStatus = "unknown";
        respondentName = null;
        reasonToRecord = reason.trim();
      } else if (mode === "none") {
        respondentStatus = "not_applicable";
        respondentName = null;
        reasonToRecord = reason.trim();
      } else if (mode === "confirm") {
        respondentStatus = "identified";
        respondentName = confirmedName || asFiledName;
        reasonToRecord = null;
      } else {
        respondentStatus = "identified";
        respondentName = name.trim();
        // The corrected address is not its own confirmed column, so it
        // rides inside the reason text and survives in the routing
        // history without changing the schema or the as-filed value.
        const parts = [];
        if (address.trim() && address.trim() !== asFiledAddress) {
          parts.push(`Corrected respondent address: ${address.trim()}`);
        }
        if (reason.trim()) parts.push(reason.trim());
        reasonToRecord = parts.length ? parts.join(" — ") : null;
      }

      const result = await recordRespondentStatus(supabase, {
        complaintId: complaint.id,
        respondentStatus,
        respondentName,
        reason: reasonToRecord,
      });

      if (!result.success) {
        setError(result.error);
        setConfirmOpen(false);
        return;
      }

      toast.success("Respondent assessment recorded.");
      reset();
      setConfirmOpen(false);
      onSaved();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const attemptSave = () => {
    const problem = validate();
    if (problem) {
      setError(problem);
      setConfirmOpen(false);
      return;
    }
    setError(null);
    setConfirmOpen(true);
  };

  const selected = OPTIONS.find((option) => option.value === mode);

  return (
    <>
      <ResidentModal
        open={open}
        onClose={() => {
          if (busy) return;
          reset();
          onClose();
        }}
        labelledBy="respondent-title"
        title="Respondent Assessment"
        maxWidthClass="max-w-lg"
      >
        <div className="space-y-4 text-sm">
          <div className="rounded-xl bg-alt px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
              Respondent as filed
            </p>
            <p className="mt-1 text-sm font-semibold text-navy">{asFiledName || "No respondent information was provided with this complaint."}</p>
            {asFiledAddress ? (
              <p className="mt-0.5 text-xs leading-relaxed text-muted">{asFiledAddress}</p>
            ) : null}
          </div>

          <p className="text-xs leading-relaxed text-muted">
            Please verify the respondent information before continuing. Recording an answer does not
            decide where the case goes.
          </p>

          {!canConfirm ? (
            <div
              role="alert"
              className="space-y-2 rounded-xl bg-critical-soft px-4 py-3 text-xs"
            >
              <p className="font-semibold text-critical">
                No respondent information was provided with this complaint.
              </p>
              <p className="leading-relaxed text-critical">
                Choose the applicable situation: (1) Another party exists but is not yet identified,
                (2) No respondent applies to this complaint, or (3) Add Respondent Information (use
                &quot;Correct Respondent Information&quot; to add it).
              </p>
            </div>
          ) : null}

          <fieldset>
            <legend className="mb-2 text-xs font-semibold text-muted">
              Who is the verified respondent?
            </legend>
            <div className="space-y-2">
              {OPTIONS.map((option) => {
                const selectedOption = option.value === mode;
                const confirmBlocked = option.value === "confirm" && !canConfirm;
                return (
                  <label
                    key={option.value}
                    className={`flex cursor-pointer items-start gap-2.5 rounded-2xl border px-4 py-3 transition-colors ${
                      selectedOption
                        ? "border-secondary bg-info-soft"
                        : "border-line bg-white hover:bg-alt"
                    } ${confirmBlocked ? "cursor-not-allowed opacity-60" : ""}`}
                  >
                    <input
                      type="radio"
                      name="respondent-status"
                      value={option.value}
                      checked={selectedOption}
                      disabled={option.value === "confirm" && !canConfirm}
                      onChange={() => {
                        setMode(option.value);
                        setError(null);
                      }}
                      className="mt-1 h-4 w-4 shrink-0 border-line accent-[#1b4c8c] disabled:cursor-not-allowed"
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-navy">{option.label}</span>
                      <span className="mt-0.5 block text-xs leading-relaxed text-muted">
                        {option.hint}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          {mode === "correct" ? (
            <>
              <div>
                <label
                  htmlFor="respondent-name"
                  className="mb-1 block text-xs font-semibold text-muted"
                >
                  Respondent name required
                </label>
                <input
                  id="respondent-name"
                  type="text"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    setError(null);
                  }}
                  placeholder="As shown on the ID presented"
                  aria-invalid={Boolean(error) && mode === "correct" && !name.trim()}
                  className="h-11 w-full rounded-full border border-line bg-white px-4 text-sm text-mirage outline-none focus:border-secondary focus:ring-2 focus:ring-secondary/20"
                />
              </div>

              <div>
                <label
                  htmlFor="respondent-address"
                  className="mb-1 block text-xs font-semibold text-muted"
                >
                  Respondent address
                  <span className="ml-1 font-normal">(optional)</span>
                </label>
                <input
                  id="respondent-address"
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="House no., street, purok, barangay"
                  className="h-11 w-full rounded-full border border-line bg-white px-4 text-sm text-mirage outline-none focus:border-secondary focus:ring-2 focus:ring-secondary/20"
                />
                <p className="mt-1 text-[11px] text-muted">
                  A changed address is recorded in the routing history; the address as filed is
                  never overwritten.
                </p>
              </div>
            </>
          ) : null}

          {mode === "correct" || mode === "unable" || mode === "none" ? (
            <div>
              <label
                htmlFor="respondent-reason"
                className="mb-1 block text-xs font-semibold text-muted"
              >
                {mode === "unable"
                  ? "Reason / what was checked"
                  : mode === "none"
                    ? "Reason"
                    : "Notes"}
                {mode === "unable" || mode === "none" ? (
                  <span className="ml-1 font-normal text-critical">(required)</span>
                ) : (
                  <span className="ml-1 font-normal">(optional)</span>
                )}
              </label>
              <textarea
                id="respondent-reason"
                value={reason}
                onChange={(e) => {
                  setReason(e.target.value);
                  setError(null);
                }}
                rows={mode === "unable" || mode === "none" ? 3 : 2}
                aria-invalid={
                  Boolean(error) &&
                  (mode === "unable" || mode === "none") &&
                  !reason.trim()
                }
                placeholder={
                  mode === "unable"
                    ? "What was checked, who was asked, and why the other party could not be confirmed."
                    : mode === "none"
                      ? "Why no respondent applies to this complaint."
                      : "Anything worth noting about the corrected respondent."
                }
                className="w-full rounded-xl border border-line bg-white px-4 py-3 text-sm text-mirage outline-none focus:border-secondary focus:ring-2 focus:ring-secondary/20"
              />
            </div>
          ) : null}

          {error ? (
            <p
              role="alert"
              className="rounded-xl bg-critical-soft px-4 py-3 text-xs font-semibold text-critical"
            >
              {error}
            </p>
          ) : null}

          <p className="text-[11px] leading-relaxed text-muted">
            Recorded by you on {formatDateTime(new Date().toISOString())}. What was filed is kept
            next to the verified answer; nothing is overwritten silently.
          </p>

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
            <LoadingButton isLoading={busy} onClick={attemptSave} disabled={busy}>
              Save Assessment
            </LoadingButton>
          </div>
        </div>
      </ResidentModal>

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={save}
        title="Record this respondent assessment?"
        message={
          previous
            ? `This changes the respondent status (${previous}). The change is added to the routing history and the complainant is notified.`
            : "This is added to the routing history and the complainant is notified."
        }
        confirmLabel="Record Assessment"
        busy={busy}
      >
        {selected ? (
          <p className="mt-3 rounded-xl bg-alt px-4 py-3 text-xs leading-relaxed text-mirage">
            <strong className="font-semibold text-navy">{selected.label}</strong>
            {mode === "confirm" && (confirmedName || asFiledName)
              ? `: ${confirmedName || asFiledName}`
              : mode === "correct" && name.trim()
                ? `: ${name.trim()}`
                : ""}
          </p>
        ) : null}
      </ConfirmDialog>
    </>
  );
}