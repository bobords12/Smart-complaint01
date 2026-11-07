"use client";

/**
 * Submission completeness review — Step 2 of routing assessment.
 *
 * What is recorded here is NOT the route. This form answers only
 * "is the submission complete, and what kind of complaint is it?".
 * A "Complete" finding still requires the route decision (Routing
 *DecisionModal) to actually move the case. A "Needs additional
 * information" finding can immediately route the case to
 * request_additional_information so the stage the complainant sees
 * honestly says what the barangay is waiting for.
 */

import { useState } from "react";
import toast from "react-hot-toast";
import { ClipboardCheck, Lock } from "lucide-react";
import ResidentModal from "@/components/shared/ResidentModal";
import LoadingButton from "@/components/shared/LoadingButton";
import ConfirmDialog from "@/components/shared/ConfirmDialog";
import {
  COMPLETENESS_ITEMS,
  COMPLETENESS_STATUSES,
  COMPLAINT_NATURES,
  recordCompleteness,
  setRouting,
} from "@/lib/captainComplaintRouting";

const RECORDABLE_STATUSES = COMPLETENESS_STATUSES.filter(
  (s) => s.value !== "pending_review"
);

export default function CompletenessModal({
  open,
  onClose,
  onSaved,
  complaint,
  supabase,
}) {
  const [status, setStatus] = useState(() =>
    complaint?.completeness_status && complaint.completeness_status !== "pending_review"
      ? complaint.completeness_status
      : "complete"
  );
  const [nature, setNature] = useState(() => complaint?.complaint_nature || "");
  const [checklist, setChecklist] = useState(() => {
    const current = {};
    for (const item of COMPLETENESS_ITEMS) {
      current[item.key] = Boolean(complaint?.[item.key]);
    }
    return current;
  });
  const [remarks, setRemarks] = useState(() => complaint?.completeness_remarks || "");
  const [requested, setRequested] = useState(
    () => complaint?.requested_information || ""
  );
  const [message, setMessage] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const needsInfo =
    status === "needs_information" || checklist.completeness_extra_info_required;

  const reset = () => {
    setStatus("complete");
    setNature(() => complaint?.complaint_nature || "");
    setRemarks(complaint?.completeness_remarks || "");
    setRequested(complaint?.requested_information || "");
    setMessage("");
    setError(null);
  };

  const toggle = (key) => {
    setChecklist((current) => ({ ...current, [key]: !current[key] }));
    setError(null);
  };

  const attemptSave = () => {
    const errorText = validate();
    if (errorText) {
      setError(errorText);
      return;
    }
    setError(null);
    setConfirmOpen(true);
  };

  const validate = () => {
    if (!status) return "Choose a completeness outcome.";
    if (needsInfo && !requested.trim()) {
      return "Say what information the complainant must provide.";
    }
    if (status === "complete") {
      if (!nature) return "Choose the nature of the complaint before marking it complete.";
      if (!checklist.completeness_complainant_verified) {
        return "Confirm the complainant's identity before marking the submission complete.";
      }
      if (!checklist.completeness_contact_verified) {
        return "Confirm you can reach the complainant before marking the submission complete.";
      }
    }
    if (message.trim().length > 500) {
      return "Keep the resident message under 500 characters.";
    }
    return null;
  };

  const save = async () => {
    setBusy(true);
    try {
      const result = await recordCompleteness(supabase, {
        complaintId: complaint.id,
        completenessStatus: status,
        complaintNature: nature || null,
        checklist,
        remarks,
        requestedInformation: requested,
        residentMessage: message,
      });

      if (!result.success) {
        setError(result.error);
        setConfirmOpen(false);
        return;
      }

      // Needs-information review moves the case to the matching stage so
      // the complainant's status line and the Captain's CTA both say
      // "request additional information" — but only if the route is
      // still undecided. Never override an already-recorded route.
      if (
        status === "needs_information" &&
        (!complaint?.routing_status ||
          complaint.routing_status === "pending_assessment")
      ) {
        const routeResult = await setRouting(supabase, {
          complaintId: complaint.id,
          routingStatus: "request_additional_information",
          kpApplicability: complaint?.kp_applicability || "pending",
          kpReason: "",
          reason: `Submission incomplete. Requested: ${requested.trim()}`,
          remarks: remarks || null,
          residentMessage: "",
        });

        if (!routeResult.success) {
          toast.success("Completeness review recorded.");
          toast.error(
            `Could not set the case stage to "Request additional information": ${routeResult.error}`
          );
          confirmCloseAndReset();
          return;
        }
      }

      toast.success("Completeness review recorded.");
      confirmCloseAndReset();
    } finally {
      setBusy(false);
    }
  };

  const confirmCloseAndReset = () => {
    setConfirmOpen(false);
    reset();
    onSaved();
    onClose();
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
        labelledBy="completeness-title"
        title="Submission Completeness Review"
        maxWidthClass="max-w-2xl"
      >
        <div className="space-y-4 text-sm">
          <p className="rounded-xl bg-alt px-4 py-3 text-xs leading-relaxed text-mirage">
            This is the information check, separate from the route decision. Marking the
            submission complete does not open the gate by itself — the route is decided after this.
          </p>

          {/* ── Outcome ────────────────────────────────────────── */}
          <fieldset>
            <legend className="mb-2 text-xs font-semibold text-muted">
              Completeness outcome
            </legend>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {RECORDABLE_STATUSES.filter((s) => s.value === "complete" || s.value === "needs_information")
                .concat(RECORDABLE_STATUSES.filter((s) => s.value !== "complete" && s.value !== "needs_information"))
                .map((option) => {
                  const selectedOption = option.value === status;
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
                        name="completeness-status"
                        value={option.value}
                        checked={selectedOption}
                        onChange={() => {
                          setStatus(option.value);
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

          {/* ── Checklist ───────────────────────────────────────── */}
          {status === "complete" ? (
            <fieldset>
              <legend className="mb-2 text-xs font-semibold text-muted">
                Information check
              </legend>
              <div className="space-y-2">
                {COMPLETENESS_ITEMS.map((item) => (
                  <label
                    key={item.key}
                    className="flex items-start gap-2.5 rounded-2xl border border-line bg-white px-4 py-3 transition-colors hover:bg-alt"
                  >
                    <input
                      type="checkbox"
                      checked={Boolean(checklist[item.key])}
                      onChange={() => toggle(item.key)}
                      className="mt-0.5 h-4 w-4 rounded border-line accent-[#1b4c8c]"
                    />
                    <span className="min-w-0">
                      <span className="text-sm font-semibold text-navy">{item.label}</span>
                      <span className="mt-0.5 block text-xs leading-relaxed text-muted">
                        {item.detail}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}

          {/* ── Nature ──────────────────────────────────────────── */}
          {status === "complete" ? (
            <fieldset>
              <legend className="mb-2 flex items-center gap-1 text-xs font-semibold text-muted">
                What kind of complaint is this?{" "}
                <Lock className="h-3 w-3" aria-hidden="true" />
                <span className="font-normal text-muted">— the automatic suggestion must be confirmed by an official</span>
              </legend>
              <div className="space-y-2">
                {COMPLAINT_NATURES.map((option) => {
                  const selectedOption = option.value === nature;
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
                        name="complaint-nature"
                        value={option.value}
                        checked={selectedOption}
                        onChange={() => {
                          setNature(option.value);
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
          ) : null}

          {/* ── Requested information ───────────────────────────── */}
          {needsInfo ? (
            <Field
              id="completeness-requested"
              label="What the complainant must provide"
              required
              value={requested}
              onChange={(v) => {
                setRequested(v);
                setError(null);
              }}
              rows={3}
              invalid={Boolean(error) && !requested.trim()}
              placeholder="Copy of the police report, the other party's full name and address, the serial number of the item..."
            />
          ) : null}

          <Field
            id="completeness-remarks"
            label="Internal remarks"
            value={remarks}
            onChange={setRemarks}
            rows={2}
            placeholder="Optional. Not shown to the complainant."
          />

          <Field
            id="completeness-message"
            label="Message to the complainant"
            value={message}
            onChange={setMessage}
            rows={2}
            maxLength={500}
            placeholder="Leave blank to use the standard wording."
            hint={`${500 - message.length} characters remaining.`}
          />

          {status === "needs_information" && (
            <p className="rounded-xl bg-info-soft px-4 py-3 text-xs leading-relaxed text-mirage">
              A needs-information review also routes the case to&nbsp;&ldquo;Request additional information&rdquo; so
              the stage the complainant sees says exactly what is being asked for. The gate stays
              shut until the information arrives and the assessable details are recorded.
            </p>
          )}

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
                if (busy) return;
                reset();
                onClose();
              }}
              disabled={busy}
              className="inline-flex h-11 items-center justify-center rounded-full border border-line px-5 text-sm font-semibold text-mirage transition-colors hover:bg-alt disabled:opacity-60"
            >
              Cancel
            </button>
            <LoadingButton isLoading={busy} onClick={attemptSave} disabled={busy}>
              Record Review
            </LoadingButton>
          </div>
        </div>
      </ResidentModal>

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={save}
        title="Record this completeness review?"
        message="This is added permanently to the routing history and notifies the complainant."
        confirmLabel="Record Review"
        busy={busy}
      >
        <p className="mt-3 rounded-xl bg-alt px-4 py-3 text-xs leading-relaxed text-mirage">
          <strong className="font-semibold text-navy">
            {COMPLETENESS_STATUSES.find((o) => o.value === status)?.label || status}
          </strong>
          {nature ? (
            <>
              {" "}
              · <ClipboardCheck className="inline h-3.5 w-3.5 text-secondary" aria-hidden="true" />{" "}
              {COMPLAINT_NATURES.find((o) => o.value === nature)?.label || nature}
            </>
          ) : null}
        </p>
      </ConfirmDialog>
    </>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  rows = 3,
  required = false,
  invalid = false,
  placeholder,
  hint,
  maxLength,
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-semibold text-muted">
        {label}
        {required ? (
          <span className="ml-1 font-normal text-critical">(required)</span>
        ) : (
          <span className="ml-1 font-normal text-muted">(optional)</span>
        )}
      </label>
      <textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        maxLength={maxLength}
        aria-invalid={invalid}
        placeholder={placeholder}
        className="w-full rounded-xl border border-line bg-white px-4 py-3 text-sm text-mirage outline-none focus:border-secondary focus:ring-2 focus:ring-secondary/20 aria-[invalid=true]:border-critical"
      />
      {hint ? <p className="mt-1 text-[11px] leading-relaxed text-muted">{hint}</p> : null}
    </div>
  );
}