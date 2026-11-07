"use client";

/**
 * Decide KP applicability and the case route together.
 *
 * They are one decision, so they are one form. Applicability without
 * a route records nothing actionable, and a route without applicability
 * is precisely the mistake this workflow exists to prevent — so the
 * form makes the second impossible to express.
 *
 * The party-facing options (KP mediation, Pangkat) are visibly
 * unavailable until the respondent is identified, and the option is
 * disabled rather than hidden: an official who cannot see why a route
 * is unavailable will eventually look for a way around it.
 */

import { useState } from "react";
import toast from "react-hot-toast";
import { AlertTriangle, Lock } from "lucide-react";
import ResidentModal from "@/components/shared/ResidentModal";
import LoadingButton from "@/components/shared/LoadingButton";
import ConfirmDialog from "@/components/shared/ConfirmDialog";
import {
  AI_DISCLAIMER,
  GATE_EXPLANATION,
  KP_APPLICABILITIES,
  PARTY_FACING_ROUTES,
  ROUTING_STATUSES,
  kpApplicabilityNeedsReason,
  routingStatusMeta,
  setRouting,
} from "@/lib/captainComplaintRouting";

export default function RoutingDecisionModal({
  open,
  onClose,
  onSaved,
  complaint,
  supabase,
}) {
  const respondentStatus = complaint?.respondent_status || "pending";
  const respondentKnown = respondentStatus === "identified";

  const [route, setRoute] = useState(
    () => complaint?.routing_status || "pending_assessment"
  );
  const [kp, setKp] = useState(() => complaint?.kp_applicability || "pending");
  const [kpReason, setKpReason] = useState("");
  const [reason, setReason] = useState("");
  const [remarks, setRemarks] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const needsKpReason = kpApplicabilityNeedsReason(kp);
  // Every route except "still assessing" needs a written basis: KP
  // mediation / Pangkat, a referral, a service action, an administrative
  // review, a duplicate review, an "other" route, or a closing route.
  const needsReason = route !== "pending_assessment";
  const selectedRoute = routingStatusMeta(route);

  const reset = () => {
    setKpReason("");
    setReason("");
    setRemarks("");
    setMessage("");
    setError(null);
  };

  const attemptSave = () => {
    if (needsKpReason && !kpReason.trim()) {
      setError("A written reason is required for this KP applicability.");
      return;
    }
    if (needsReason && !reason.trim()) {
      setError(
        "A written reason is required. Record why the case is being routed this way."
      );
      return;
    }
    if (kp === "applicable" && route === "pending_assessment") {
      setError("Record the basis for finding this complaint within KP jurisdiction.");
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
    // Guard against a double submit: the confirm button and the form
    // button share `busy`, and a second record of the same decision would
    // add a duplicate routing-history entry.
    if (busy) return;
    setBusy(true);
    try {
      const result = await setRouting(supabase, {
        complaintId: complaint.id,
        routingStatus: route,
        kpApplicability: kp,
        kpReason,
        reason,
        remarks,
        residentMessage: message,
      });

      if (!result.success) {
        setError(result.error);
        setConfirmOpen(false);
        return;
      }

      const opened = Boolean(result.data?.workflow_gate_open);
      toast.success(
        opened
          ? "Route recorded. Summons, hearings, and mediation may now be scheduled."
          : "Route recorded. Party-facing steps remain unavailable."
      );
      reset();
      setConfirmOpen(false);
      // Wait for the case file to reload before closing. Closing first
      // left the dialogs gone while every tab still showed the
      // pre-decision state, which read as the page hanging.
      await onSaved?.();
      onClose();
    } catch {
      setError(
        "The decision could not be recorded. Check your connection and try again."
      );
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
        labelledBy="routing-title"
        title="KP Applicability and Case Route"
        maxWidthClass="max-w-lg"
      >
        <div className="space-y-4 text-sm">
          <p className="rounded-xl border border-gold-soft bg-paledgold px-4 py-3 text-xs leading-relaxed text-mirage">
            {AI_DISCLAIMER}
          </p>

          {!respondentKnown ? (
            <p className="rounded-xl border border-[#b45309]/25 bg-warning-soft px-4 py-3 text-xs font-semibold leading-relaxed text-warning">
              {GATE_EXPLANATION} Record the respondent assessment first.
            </p>
          ) : null}

          {/* ── KP applicability ───────────────────────────────── */}
          <fieldset>
            <legend className="mb-2 text-xs font-semibold text-muted">
              Is this within Katarungang Pambarangay jurisdiction?
            </legend>
            <div className="space-y-2">
              {KP_APPLICABILITIES.map((option) => {
                const selectedOption = option.value === kp;
                // KP may only be found applicable once there is a real
                // respondent to mediate with. The option stays visible
                // with its reason attached.
                const unavailable = option.value === "applicable" && !respondentKnown;
                return (
                  <label
                    key={option.value}
                    className={`flex items-start gap-2.5 rounded-2xl border px-4 py-3 transition-colors ${
                      unavailable
                        ? "cursor-not-allowed border-line bg-alt opacity-70"
                        : selectedOption
                          ? "cursor-pointer border-secondary bg-info-soft"
                          : "cursor-pointer border-line bg-white hover:bg-alt"
                    }`}
                  >
                    <input
                      type="radio"
                      name="kp-applicability"
                      value={option.value}
                      checked={selectedOption}
                      disabled={unavailable}
                      onChange={() => {
                        setKp(option.value);
                        setError(null);
                      }}
                      className="mt-1 h-4 w-4 shrink-0 border-line accent-[#1b4c8c]"
                    />
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5 text-sm font-semibold text-navy">
                        {option.label}
                        {unavailable ? (
                          <Lock className="h-3.5 w-3.5 text-muted" aria-hidden="true" />
                        ) : null}
                      </span>
                      <span className="mt-0.5 block text-xs leading-relaxed text-muted">
                        {unavailable ? `${option.hint} Requires an identified respondent.` : option.hint}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          {needsKpReason ? (
            <Field
              id="routing-kp-reason"
              label="Reason for this determination"
              required
              value={kpReason}
              onChange={(v) => {
                setKpReason(v);
                setError(null);
              }}
              rows={2}
              invalid={Boolean(error) && needsKpReason && !kpReason.trim()}
              placeholder="Which part of the matter falls outside KP jurisdiction, or what is missing until the respondent is known."
            />
          ) : null}

          {/* ── Route ──────────────────────────────────────────── */}
          <fieldset>
            <legend className="mb-2 text-xs font-semibold text-muted">Case route</legend>
            <div className="space-y-2">
              {ROUTING_STATUSES.map((option) => {
                const selectedOption = option.value === route;
                const unavailable =
                  PARTY_FACING_ROUTES.includes(option.value) &&
                  !(respondentKnown && kp === "applicable");
                return (
                  <label
                    key={option.value}
                    className={`flex items-start gap-2.5 rounded-2xl border px-4 py-3 transition-colors ${
                      unavailable
                        ? "cursor-not-allowed border-line bg-alt opacity-70"
                        : selectedOption
                          ? "cursor-pointer border-secondary bg-info-soft"
                          : "cursor-pointer border-line bg-white hover:bg-alt"
                    }`}
                  >
                    <input
                      type="radio"
                      name="routing-status"
                      value={option.value}
                      checked={selectedOption}
                      disabled={unavailable}
                      onChange={() => {
                        setRoute(option.value);
                        setError(null);
                      }}
                      className="mt-1 h-4 w-4 shrink-0 border-line accent-[#1b4c8c]"
                    />
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5 text-sm font-semibold text-navy">
                        {option.label}
                        {unavailable ? (
                          <Lock className="h-3.5 w-3.5 text-muted" aria-hidden="true" />
                        ) : null}
                      </span>
                      <span className="mt-0.5 block text-xs leading-relaxed text-muted">
                        {option.hint}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <Field
            id="routing-reason"
            label="Basis for the route"
            required={needsReason}
            value={reason}
            onChange={(v) => {
              setReason(v);
              setError(null);
            }}
            rows={3}
            invalid={Boolean(error) && needsReason && !reason.trim()}
            placeholder="Both parties are residents of this barangay, the dispute is local, and no criminal act is alleged."
          />

          <Field
            id="routing-remarks"
            label="Internal remarks"
            value={remarks}
            onChange={setRemarks}
            rows={2}
            placeholder="Optional. Not shown to the complainant."
          />

          <Field
            id="routing-message"
            label="Message to the complainant"
            value={message}
            onChange={setMessage}
            rows={2}
            maxLength={500}
            placeholder="Leave blank to use the standard wording."
            hint={`${500 - message.length} characters remaining. Neutral wording only: it must not state or imply that the allegation is true.`}
          />

          {/* A live preview of what the decision will do, so the
              consequence is visible before it is committed. */}
          <p className="flex items-start gap-2 rounded-xl bg-alt px-4 py-3 text-xs leading-relaxed text-mirage">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-secondary" aria-hidden="true" />
            <span>
              {PARTY_FACING_ROUTES.includes(route) && respondentKnown && kp === "applicable"
                ? "This opens the workflow gate. A summons, hearing, or 15-day period may be recorded. The KP tracker is updated to match."
                : "The workflow gate stays shut. Summons, hearings, Lupon formation, and both 15-day periods remain unavailable."}
            </span>
          </p>

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
            <LoadingButton isLoading={busy} onClick={attemptSave} disabled={busy}>
              Record Decision
            </LoadingButton>
          </div>
        </div>
      </ResidentModal>

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={save}
        title="Record this routing decision?"
        message="This adds a permanent entry to the routing history, updates the KP tracker, and notifies the complainant."
        confirmLabel="Record Decision"
        busy={busy}
      >
        <p className="mt-3 rounded-xl bg-alt px-4 py-3 text-xs leading-relaxed text-mirage">
          <strong className="font-semibold text-navy">Route:</strong> {selectedRoute.label}
          <br />
          <strong className="font-semibold text-navy">KP applicability:</strong>{" "}
          {KP_APPLICABILITIES.find((o) => o.value === kp)?.label}
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
