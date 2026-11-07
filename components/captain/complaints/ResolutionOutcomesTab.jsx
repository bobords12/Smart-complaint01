"use client";

import { useState } from "react";
import toast from "react-hot-toast";
import { Gavel, Handshake, Undo2, FileSpreadsheet, FileSignature, FileCheck2 } from "lucide-react";
import Panel from "./Panel";
import ConfirmDialog from "@/components/shared/ConfirmDialog";
import LoadingButton from "@/components/shared/LoadingButton";
import { logComplaintActivity } from "@/lib/complaintQueries";
import { routingGate, GATE_EXPLANATION } from "@/lib/captainComplaintRouting";
import { formatDateShort, resolveComplainantName } from "./complaintMeta";
import {
  REPUDIATION_WINDOW_DAYS,
  SETTLEMENT_EFFECTIVENESS_DAYS,
  isPangkatConstituted,
} from "@/lib/captainComplaintWorkflow";
import {
  generateAmicableSettlement,
  generateCertificateToFileAction,
} from "@/lib/resolution/resolutionDocuments";

/**
 * Resolution & Outcomes.
 *
 * The three ways the Katarungang Pambarangay process ends, on the one
 * case file that ran it:
 *
 *   1. Amicable Settlement — the written terms, the date the parties
 *      signed, and who attested (the Barangay Captain or the Pangkat
 *      Chairman). The agreement acquires the force and effect of a
 *      court judgment ten days later, which is shown rather than
 *      described, because the date is the thing the officer and the
 *      parties actually need.
 *
 *   2. Repudiation — either party may set that settlement aside
 *      within ten days, and only for fraud, violence or
 *      intimidation. The window and the grounds are enforced by the
 *      database as well as here, so a late or groundless entry is
 *      refused rather than accepted and regretted.
 *
 *   3. Certificate to File Action — when every conciliation effort
 *      has failed, the Lupon issues the certificate that lets the
 *      complainant go to court. Both this and the settlement are
 *      generated here as real documents (lib/resolution/
 *      resolutionDocuments.js), because these are the two outcomes
 *      the process exists to reach and neither one is finished until
 *      the parties can be handed something.
 *
 * Recording any of these never closes the complaint on its own. A
 * settled case is stamped Closed by the case file the moment its
 * Amicable Settlement is on file (settlementCloseDecisionFor in
 * lib/captainComplaintWorkflow.js, performed by CaptainCaseWorkspace),
 * and every other ending still closes through the "Mark Settled /
 * Mark Completed" decision — this tab says so rather than quietly
 * changing the status behind the officer's back.
 */

const GROUNDS = ["Fraud", "Violence", "Intimidation"];

const BARANGAY_CAPTAIN = "Barangay Captain";
const PANGKAT_CHAIRPERSON = "Pangkat Chairperson";

/** Today's date as Barangay Abuno keeps it (Asia/Manila). */
function manilaToday() {
  return new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
}

/** `iso` plus whole days, as a YYYY-MM-DD string. */
function plusDaysISO(iso, days) {
  if (!iso) return null;
  const parsed = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

/** Whole calendar days between two YYYY-MM-DD strings, floored at zero. */
function daysBetweenISO(from, to) {
  if (!from || !to) return null;
  const a = new Date(`${from}T00:00:00Z`).getTime();
  const b = new Date(`${to}T00:00:00Z`).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.max(0, Math.round((b - a) / 86400000));
}

export default function ResolutionOutcomesTab({
  supabase,
  user,
  complaint,
  luponPanels = [],
  resolution,
  documents = [],
  hearings = [],
  onChanged,
}) {
  const canRecord = user?.role === "captain" || user?.role === "oic";
  const gate = routingGate(complaint);

  const chair = (luponPanels || []).find(
    (row) => row?.status === "active" && row?.role === "chairperson"
  );

  const [form, setForm] = useState(() => blankForm(resolution));
  const [busy, setBusy] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [genBusy, setGenBusy] = useState(null);

  /**
   * Whether this case already holds a generated copy of each document.
   *
   * Read off the case's own documents rather than a separate query, so
   * what the button says and what Case Documents lists can never
   * disagree. Generation stays available afterwards: printing a second
   * copy adds a version and never overwrites the file a party holds.
   */
  const settlementDocs = (documents || []).filter((doc) => doc?.document_type === "settlement");
  const cfaDocs = (documents || []).filter(
    (doc) => doc?.document_type === "certificate_to_file_action",
  );
  const latestVersion = (rows) =>
    rows.length ? Math.max(...rows.map((doc) => Number(doc.version) || 1)) : 0;

  /**
   * A refresh from the server must not wipe what the officer is
   * typing, so the form is only re-seeded when the row id changes —
   * i.e. when this really is a different resolution, not a re-read of
   * the same one.
   *
   * Adjusted during render rather than in an effect: the seed belongs
   * to the arrival of the row, and seeding in an effect would paint
   * an empty form first and fill it a frame later.
   */
  const [seededId, setSeededId] = useState(resolution?.id ?? null);
  if ((resolution?.id ?? null) !== seededId) {
    setSeededId(resolution?.id ?? null);
    setForm(blankForm(resolution));
  }

  const settlementFiled = Boolean(resolution?.settlement_date);
  const repudiated = Boolean(resolution?.repudiated);
  const effectivenessDate = plusDaysISO(resolution?.settlement_date, SETTLEMENT_EFFECTIVENESS_DAYS);
  const repudiationDeadline = plusDaysISO(resolution?.settlement_date, REPUDIATION_WINDOW_DAYS);
  const today = manilaToday();
  const repudiationWindowOpen =
    settlementFiled && !repudiated && today <= (repudiationDeadline || "");
  const daysLeftToRepudiate = repudiationWindowOpen
    ? (daysBetweenISO(today, repudiationDeadline) ?? 0)
    : 0;

  const cfaOwed = Boolean(resolution?.cfa_required);
  const cfaIssued = Boolean(resolution?.cfa_issued_at);

  /**
   * The status line at the top of the tab. Derived from what is
   * actually stored, so it can never disagree with the forms below.
   */
  const bindingInDays = daysBetweenISO(today, effectivenessDate) ?? 0;
  const headline = cfaIssued
    ? "Certificate to File Action released"
    : repudiated
      ? "Settlement repudiated"
      : settlementFiled
        ? today >= (effectivenessDate || "")
          ? "Settled — the agreement is binding"
          : `Settled — the agreement becomes binding in ${bindingInDays} day${bindingInDays === 1 ? "" : "s"}`
        : cfaOwed
          ? "Certificate to File Action owed"
          : "No resolution recorded yet";

  const save = async (patch, { action, details, message }) => {
    if (!canRecord) return;
    setBusy(action);
    try {
      const payload = {
        ...form,
        ...patch,
        complaint_id: complaint.id,
        recorded_by: user?.id || null,
      };
      // Strip the derived column: Postgres computes it and rejects a
      // value supplied for it.
      delete payload.effectiveness_date;
      delete payload.updated_at;

      const { error } = await supabase
        .from("case_resolutions")
        .upsert(payload, { onConflict: "complaint_id" });
      if (error) throw error;

      await logComplaintActivity(supabase, {
        action,
        complaintId: complaint.id,
        ref: complaint.reference_number || undefined,
        details,
      });

      toast.success(message);
      setConfirm(null);
      onChanged();
    } catch (err) {
      // The database carries the two rules the form cannot: a
      // repudiation must fall inside its ten-day window, and a
      // settlement must be written and attested. Say what was
      // refused rather than "something went wrong".
      const text = String(err?.message || "");
      if (/case_resolutions_repudiation_window/.test(text)) {
        toast.error(
          `A settlement can only be repudiated within ${REPUDIATION_WINDOW_DAYS} days of the date it was signed.`
        );
      } else if (/case_resolutions_repudiation_shape/.test(text)) {
        toast.error("Repudiation needs the party, the ground and the date.");
      } else if (/case_resolutions_settlement_shape/.test(text)) {
        toast.error("A settlement needs its written terms, a date, and who attested it.");
      } else if (/case_resolutions_cfa_shape/.test(text)) {
        toast.error("Record that conciliation failed before releasing the certificate.");
      } else if (/duplicate key|uniq_lupon/.test(text)) {
        toast.error("That member is already on this case's panel.");
      } else {
        toast.error("Could not record this. Check the fields and try again.");
      }
    } finally {
      setBusy(null);
    }
  };

  /* ── Amicable Settlement ─────────────────────────────────── */
  const recordSettlement = () =>
    save(
      {
        settlement_terms: form.settlement_terms,
        settlement_date: form.settlement_date,
        attestation_role: form.attestation_role,
        attested_by:
          form.attestation_role === PANGKAT_CHAIRPERSON
            ? chair?.member_id || user?.id || null
            : user?.id || null,
      },
      {
        action: "case_settlement_recorded",
        details: {
          settlement_date: form.settlement_date,
          attestation_role: form.attestation_role,
          effective_from: plusDaysISO(form.settlement_date, SETTLEMENT_EFFECTIVENESS_DAYS),
        },
        message:
          "Settlement recorded. It becomes binding on " +
          `${formatDateShort(plusDaysISO(form.settlement_date, SETTLEMENT_EFFECTIVENESS_DAYS))} unless it is repudiated.`,
      }
    );

  /* ── Repudiation ─────────────────────────────────────────── */
  const recordRepudiation = () =>
    save(
      {
        repudiated: true,
        repudiating_party: form.repudiating_party,
        repudiation_grounds: form.repudiation_grounds,
        repudiation_particulars: form.repudiation_particulars || null,
        repudiated_on: form.repudiated_on,
      },
      {
        action: "case_settlement_repudiated",
        details: {
          party: form.repudiating_party,
          grounds: form.repudiation_grounds,
          repudiated_on: form.repudiated_on,
        },
        message: "Repudiation recorded. The settlement no longer binds.",
      }
    );

  /* ── Certificate to File Action ──────────────────────────── */
  const recordCfa = (issue) =>
    save(
      {
        cfa_required: true,
        cfa_reason: form.cfa_reason,
        ...(issue
          ? { cfa_issued_at: new Date().toISOString(), cfa_issued_by: user?.id || null }
          : {}),
      },
      {
        action: issue ? "certificate_to_file_action_released" : "certificate_to_file_action_owed",
        details: { reason: form.cfa_reason, issued: Boolean(issue) },
        message: issue
          ? "Certificate to File Action released to the complainant. Produce it under Case Documents."
          : "Recorded that a Certificate to File Action is owed.",
      }
    );

  /* ── Producing the paper ─────────────────────────────────── */
  /**
   * Generate the document this outcome owes the parties.
   *
   * The generator validates first — a settlement without terms, or a
   * certificate with no recorded reason for failure, is refused with the
   * field named rather than producing a sheet with blanks on it.
   */
  const generateDocument = async (kind) => {
    if (!canRecord) return;
    setGenBusy(kind);
    try {
      const result =
        kind === "settlement"
          ? await generateAmicableSettlement(supabase, {
              complaint,
              user,
              resolution,
              luponPanels,
              documents,
            })
          : await generateCertificateToFileAction(supabase, {
              complaint,
              user,
              resolution,
              luponPanels,
              documents,
              hearings,
            });

      if (!result.success) {
        toast.error(result.error || "The document could not be generated.");
        return;
      }

      toast.success(
        kind === "settlement"
          ? "Amicable Settlement generated. A copy is issued to both parties."
          : "Certificate to File Action generated for the complainant.",
      );
      onChanged();
    } catch (err) {
      console.error("ResolutionOutcomesTab: document generation failed", { kind, err });
      toast.error("The document could not be generated. Check the case and try again.");
    } finally {
      setGenBusy(null);
    }
  };

  const disabledNote = !canRecord
    ? "Only the Barangay Captain or OIC records a resolution."
    : !gate.open
      ? GATE_EXPLANATION
      : null;

  return (
    <div className="space-y-4">
      <p className="rounded-xl border border-gold-soft bg-paledgold px-4 py-3 text-xs leading-relaxed text-mirage">
        <strong className="font-semibold text-warning">{headline}.</strong> Recording an outcome here
        is evidence on the case file. It does not close the complaint on its own — a settled case
        closes itself once its Amicable Settlement is on file, and for any other ending use{" "}
        <em>Mark Settled</em> or <em>Mark Completed</em>.
      </p>

      {/* ── 1. Amicable Settlement ──────────────────────────── */}
      <Panel
        title="1 · Amicable Settlement"
        tag={
          settlementFiled
            ? repudiated
              ? "Repudiated"
              : today >= (effectivenessDate || "")
                ? "Binding"
                : "Pending — not yet binding"
            : "Not recorded"
        }
        tagClass={
          settlementFiled
            ? repudiated
              ? "bg-alt text-muted"
              : today >= (effectivenessDate || "")
                ? "bg-success-soft text-success"
                : "bg-info-soft text-info"
            : "bg-alt text-muted"
        }
      >
        <div className="space-y-4">
          {settlementFiled ? (
            <>
              <div className="grid grid-cols-1 gap-4 rounded-xl border border-line bg-canvas px-4 py-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="lg:col-span-2">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-muted">
                    Terms agreed
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-mirage">
                    {resolution.settlement_terms}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-wide text-muted">Signed</p>
                  <p className="mt-1 text-sm font-semibold text-mirage">
                    {formatDateShort(resolution.settlement_date)}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-wide text-muted">
                    Attested by
                  </p>
                  <p className="mt-1 text-sm font-semibold text-mirage">
                    {resolution.attestation_role || "—"}
                  </p>
                </div>
                <div className="sm:col-span-2 lg:col-span-4">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-muted">
                    Force and effect of a court judgment from
                  </p>
                  <p className="mt-1 text-sm font-semibold text-mirage">
                    {formatDateShort(effectivenessDate)}
                    <span className="ml-2 text-xs font-normal text-muted">
                      {SETTLEMENT_EFFECTIVENESS_DAYS} days after signing
                      {repudiated
                        ? " — no longer applies, the settlement was repudiated"
                        : today >= (effectivenessDate || "")
                          ? " — this date has passed"
                          : ""}
                    </span>
                  </p>
                </div>
              </div>

              {/* The instrument itself. One document signed by both parties,
                  stored resident-visible so the complainant's copy reaches the
                  Resident Portal, and printed for the respondent from here. */}
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#2563b0]/25 bg-info-soft px-4 py-3">
                <p className="min-w-0 text-xs leading-relaxed text-mirage">
                  <strong className="font-semibold text-navy">Amicable Settlement.</strong>{" "}
                  {settlementDocs.length
                    ? `On file as version ${latestVersion(settlementDocs)}. Regenerating adds a version; the copy already issued is never overwritten.`
                    : "Produces the written settlement — both parties, the terms, the attestation, and the date it becomes binding."}
                </p>
                <LoadingButton
                  isLoading={genBusy === "settlement"}
                  disabled={genBusy !== null || !canRecord}
                  onClick={() => generateDocument("settlement")}
                >
                  <FileSignature className="h-4 w-4" aria-hidden="true" />
                  {settlementDocs.length
                    ? "Print Another Copy"
                    : "Generate Amicable Settlement"}
                </LoadingButton>
              </div>
            </>
          ) : (
            <div className="space-y-3">
              <Field label="Terms agreed">
                <textarea
                  rows={4}
                  value={form.settlement_terms}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, settlement_terms: event.target.value }))
                  }
                  placeholder="What each party agreed to, in plain language both understand."
                  className="w-full rounded-xl border border-line bg-white px-3 py-2.5 text-sm text-mirage outline-none focus:border-jordy"
                />
              </Field>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Date signed by both parties">
                  <input
                    type="date"
                    max={today}
                    value={form.settlement_date}
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, settlement_date: event.target.value }))
                    }
                    className="w-full rounded-xl border border-line bg-white px-3 py-2.5 text-sm text-mirage outline-none focus:border-jordy"
                  />
                </Field>
                <Field label="Attested by">
                  <select
                    value={form.attestation_role}
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, attestation_role: event.target.value }))
                    }
                    className="w-full rounded-xl border border-line bg-white px-3 py-2.5 text-sm text-mirage outline-none focus:border-jordy"
                  >
                    <option value="">— select —</option>
                    <option value={BARANGAY_CAPTAIN}>{BARANGAY_CAPTAIN}</option>
                    <option
                      value={PANGKAT_CHAIRPERSON}
                      disabled={!chair}
                      title={chair ? undefined : "No Pangkat chairperson is recorded yet."}
                    >
                      {PANGKAT_CHAIRPERSON}
                      {!chair ? " (no panel chair recorded)" : ""}
                    </option>
                  </select>
                </Field>
              </div>
              {form.settlement_date ? (
                <p className="text-xs text-muted">
                  This agreement becomes binding on{" "}
                  <strong className="font-semibold text-mirage">
                    {formatDateShort(plusDaysISO(form.settlement_date, SETTLEMENT_EFFECTIVENESS_DAYS))}
                  </strong>
                  , unless either party repudiates it before then.
                </p>
              ) : null}
              {disabledNote ? (
                <p className="text-xs text-muted">{disabledNote}</p>
              ) : (
                <div className="flex justify-end">
                  <LoadingButton
                    isLoading={busy === "case_settlement_recorded"}
                    disabled={
                      busy !== null ||
                      !form.settlement_terms.trim() ||
                      !form.settlement_date ||
                      !form.attestation_role
                    }
                    onClick={() => setConfirm("settlement")}
                  >
                    <Handshake className="h-4 w-4" aria-hidden="true" />
                    Record the Settlement
                  </LoadingButton>
                </div>
              )}
            </div>
          )}
        </div>
      </Panel>

      {/* ── 2. Repudiation ──────────────────────────────────── */}
      <Panel
        title="2 · Repudiation"
        tag={
          repudiated
            ? "Recorded"
            : repudiationWindowOpen
              ? `${daysLeftToRepudiate} day${daysLeftToRepudiate === 1 ? "" : "s"} left`
              : "Window closed"
        }
        tagClass={repudiated ? "bg-alt text-muted" : repudiationWindowOpen ? "bg-warning-soft text-warning" : "bg-alt text-muted"}
      >
        {repudiated ? (
          <div className="grid grid-cols-1 gap-4 rounded-xl border border-line bg-canvas px-4 py-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted">By</p>
              <p className="mt-1 text-sm font-semibold text-mirage">
                {resolution.repudiating_party}
              </p>
            </div>
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted">Grounds</p>
              <p className="mt-1 text-sm font-semibold text-mirage">
                {resolution.repudiation_grounds}
              </p>
            </div>
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted">Filed on</p>
              <p className="mt-1 text-sm font-semibold text-mirage">
                {formatDateShort(resolution.repudiated_on)}
              </p>
            </div>
            {resolution.repudiation_particulars ? (
              <div className="sm:col-span-2 lg:col-span-4">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted">
                  Particulars
                </p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-mirage">
                  {resolution.repudiation_particulars}
                </p>
              </div>
            ) : null}
          </div>
        ) : !settlementFiled ? (
          <p className="text-sm text-muted">
            There is no settlement to repudiate. Either party may set a settlement aside within{" "}
            {REPUDIATION_WINDOW_DAYS} days of the date it was signed, when their consent was
            obtained through fraud, violence or intimidation.
          </p>
        ) : !repudiationWindowOpen ? (
          <p className="text-sm text-muted">
            The {REPUDIATION_WINDOW_DAYS}-day window closed on{" "}
            <strong className="font-semibold text-mirage">
              {formatDateShort(repudiationDeadline)}
            </strong>
            . A settlement can no longer be repudiated.
          </p>
        ) : (
          <div className="space-y-3">
            <p className="text-xs leading-relaxed text-muted">
              <strong className="font-semibold text-mirage">
                {resolveComplainantName(complaint)}
              </strong>{" "}
              or the respondent may repudiate the settlement signed on{" "}
              {formatDateShort(resolution.settlement_date)}, on the grounds of fraud, violence or
              intimidation. {daysLeftToRepudiate} day{daysLeftToRepudiate === 1 ? "" : "s"} remain.
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Field label="Repudiating party">
                <select
                  value={form.repudiating_party}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, repudiating_party: event.target.value }))
                  }
                  className="w-full rounded-xl border border-line bg-white px-3 py-2.5 text-sm text-mirage outline-none focus:border-jordy"
                >
                  <option value="">— select —</option>
                  <option value="Complainant">Complainant</option>
                  <option value="Respondent">Respondent</option>
                </select>
              </Field>
              <Field label="Grounds">
                <select
                  value={form.repudiation_grounds}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, repudiation_grounds: event.target.value }))
                  }
                  className="w-full rounded-xl border border-line bg-white px-3 py-2.5 text-sm text-mirage outline-none focus:border-jordy"
                >
                  <option value="">— select —</option>
                  {GROUNDS.map((ground) => (
                    <option key={ground} value={ground}>
                      {ground}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Filed on">
                <input
                  type="date"
                  min={resolution.settlement_date}
                  max={repudiationDeadline}
                  value={form.repudiated_on}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, repudiated_on: event.target.value }))
                  }
                  className="w-full rounded-xl border border-line bg-white px-3 py-2.5 text-sm text-mirage outline-none focus:border-jordy"
                />
              </Field>
            </div>
            <Field label="Particulars (optional)">
              <textarea
                rows={3}
                value={form.repudiation_particulars}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, repudiation_particulars: event.target.value }))
                }
                placeholder="What happened, and when."
                className="w-full rounded-xl border border-line bg-white px-3 py-2.5 text-sm text-mirage outline-none focus:border-jordy"
              />
            </Field>
            {disabledNote ? (
              <p className="text-xs text-muted">{disabledNote}</p>
            ) : (
              <div className="flex justify-end">
                <LoadingButton
                  isLoading={busy === "case_settlement_repudiated"}
                  disabled={
                    busy !== null ||
                    !form.repudiating_party ||
                    !form.repudiation_grounds ||
                    !form.repudiated_on
                  }
                  onClick={() => setConfirm("repudiation")}
                >
                  <Undo2 className="h-4 w-4" aria-hidden="true" />
                  Record the Repudiation
                </LoadingButton>
              </div>
            )}
          </div>
        )}
      </Panel>

      {/* ── 3. Certificate to File Action ───────────────────── */}
      <Panel
        title="3 · Certificate to File Action"
        tag={cfaIssued ? "Released" : cfaOwed ? "Owed" : "Not required"}
        tagClass={cfaIssued ? "bg-success-soft text-success" : cfaOwed ? "bg-warning-soft text-warning" : "bg-alt text-muted"}
      >
        {cfaIssued ? (
          <div className="grid grid-cols-1 gap-4 rounded-xl border border-line bg-canvas px-4 py-4 sm:grid-cols-2">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted">
                Released on
              </p>
              <p className="mt-1 text-sm font-semibold text-mirage">
                {formatDateShort(resolution.cfa_issued_at)}
              </p>
            </div>
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted">Reason</p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-mirage">
                {resolution.cfa_reason || "Not recorded"}
              </p>
            </div>
            <p className="text-xs text-muted sm:col-span-2">
              The certificate allows{" "}
              <strong className="font-semibold text-mirage">
                {resolveComplainantName(complaint)}
              </strong>{" "}
              to file the case in the proper court.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs leading-relaxed text-muted">
              Issued when every conciliation effort has failed. The certificate is what lets the
              complainant elevate the case to a regular court.
            </p>
            <Field label="Why conciliation failed">
              <textarea
                rows={3}
                value={form.cfa_reason}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, cfa_reason: event.target.value }))
                }
                placeholder="Neither party appeared; the parties could not agree; the Pangkat period elapsed without a settlement."
                className="w-full rounded-xl border border-line bg-white px-3 py-2.5 text-sm text-mirage outline-none focus:border-jordy"
              />
            </Field>
            {disabledNote ? (
              <p className="text-xs text-muted">{disabledNote}</p>
            ) : (
              <div className="flex flex-wrap justify-end gap-3">
                <button
                  type="button"
                  disabled={busy !== null || !form.cfa_reason.trim()}
                  onClick={() => setConfirm("cfa-owed")}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-full border border-line px-5 text-sm font-semibold text-mirage transition-colors hover:bg-alt disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <FileSpreadsheet className="h-4 w-4" aria-hidden="true" />
                  Record That a Certificate Is Owed
                </button>
                <LoadingButton
                  isLoading={busy === "certificate_to_file_action_released"}
                  disabled={busy !== null || !form.cfa_reason.trim()}
                  onClick={() => setConfirm("cfa")}
                >
                  <Gavel className="h-4 w-4" aria-hidden="true" />
                  Release the Certificate
                </LoadingButton>
              </div>
            )}
          </div>
        )}

        {/* The certificate is owed the moment conciliation failed, whether or
            not it has been marked released — so the paper is offered for both. */}
        {cfaOwed ? (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#2563b0]/25 bg-info-soft px-4 py-3">
            <p className="min-w-0 text-xs leading-relaxed text-mirage">
              <strong className="font-semibold text-navy">Certificate to File Action.</strong>{" "}
              {cfaDocs.length
                ? `On file as version ${latestVersion(cfaDocs)}. Regenerating adds a version; the copy already issued is never overwritten.`
                : "Produces the certificate — what was filed, that conciliation failed, the grounds, and what it lets the complainant do."}
            </p>
            <LoadingButton
              isLoading={genBusy === "cfa"}
              disabled={genBusy !== null || !canRecord}
              onClick={() => generateDocument("cfa")}
            >
              <FileCheck2 className="h-4 w-4" aria-hidden="true" />
              {cfaDocs.length ? "Print Another Copy" : "Generate Certificate to File Action"}
            </LoadingButton>
          </div>
        ) : null}
      </Panel>

      <ConfirmDialog
        open={confirm === "settlement"}
        onClose={() => setConfirm(null)}
        onConfirm={recordSettlement}
        title="Record the amicable settlement?"
        message={`Both parties signed on ${
          formatDateShort(form.settlement_date) || "the date given"
        }. The agreement becomes binding ${SETTLEMENT_EFFECTIVENESS_DAYS} days later unless it is repudiated. This is recorded in the audit log.`}
        confirmLabel="Record the Settlement"
        busy={busy === "case_settlement_recorded"}
      />

      <ConfirmDialog
        open={confirm === "repudiation"}
        onClose={() => setConfirm(null)}
        onConfirm={recordRepudiation}
        title="Record the repudiation?"
        message="The settlement will no longer bind the parties. The grounds you recorded must be fraud, violence or intimidation, and the filing must fall inside the ten-day window. This is recorded in the audit log."
        confirmLabel="Record the Repudiation"
        busy={busy === "case_settlement_repudiated"}
      />

      <ConfirmDialog
        open={confirm === "cfa" || confirm === "cfa-owed"}
        onClose={() => setConfirm(null)}
        onConfirm={() => recordCfa(confirm === "cfa")}
        title={confirm === "cfa" ? "Release the Certificate to File Action?" : "Record that a certificate is owed?"}
        message={
          confirm === "cfa"
            ? "The complainant will be told the certificate is available to claim, and the Certificate to File Action can be generated straight after. This is recorded in the audit log."
            : "Only that conciliation failed and a certificate is owed will be recorded. Nothing is released yet. This is recorded in the audit log."
        }
        confirmLabel={confirm === "cfa" ? "Release the Certificate" : "Record It"}
        busy={busy === "certificate_to_file_action_released" || busy === "certificate_to_file_action_owed"}
      />
    </div>
  );
}

function blankForm(resolution) {
  return {
    settlement_terms: resolution?.settlement_terms || "",
    settlement_date: resolution?.settlement_date || "",
    attestation_role: resolution?.attestation_role || "",
    repudiating_party: resolution?.repudiating_party || "",
    repudiation_grounds: resolution?.repudiation_grounds || "",
    repudiation_particulars: resolution?.repudiation_particulars || "",
    repudiated_on: resolution?.repudiated_on || manilaToday(),
    cfa_reason: resolution?.cfa_reason || "",
  };
}

function Field({ label, children }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-semibold text-muted">{label}</label>
      {children}
    </div>
  );
}
