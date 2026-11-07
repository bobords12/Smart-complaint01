"use client";

import { useState } from "react";
import toast from "react-hot-toast";
import { ArrowRight, Gavel, UserCheck, CheckCircle2, XCircle, Archive, Sparkles } from "lucide-react";
import ResidentModal from "@/components/shared/ResidentModal";
import ConfirmDialog from "@/components/shared/ConfirmDialog";
import LoadingButton from "@/components/shared/LoadingButton";
import {
  logComplaintActivity,
  notifyResident,
  confirmOfficialCategorization,
  advancePastCategorization,
  NO_CATEGORY_CONFIRMED,
} from "@/lib/complaintQueries";
import { routingGate, GATE_EXPLANATION } from "@/lib/captainComplaintRouting";
import {
  stageOf,
  STAGE_ACTIONS,
  STAGE_META,
  canDecide,
  CATEGORY_OPTIONS,
  URGENCY_OPTIONS,
  resolvePredictedCategory,
  resolveConfirmedCategory,
  resolveConfirmedUrgency,
  formatDateLong,
} from "./complaintMeta";

function localDateOffset(input, days) {
  const d = new Date(`${input}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Presentation and required-input metadata only. Which actions a stage may
 * offer is defined once in STAGE_ACTIONS (complaintMeta.js), so the stage
 * gate and the action list cannot drift apart.
 */
const ACTIONS = [
  {
    key: "receive",
    label: "Receive & Docket Complaint",
    hint:
      "Issue the Barangay Case Number and the official receipt, stamp official_received_at, and move the complaint to official categorization. KP applicability itself is decided in Case Routing.",
    icon: UserCheck,
    needsDate: false,
    needsReason: false,
    needsTracker: false,
  },
  {
    key: "confirmCategory",
    label: "Review & Confirm Categorization",
    hint: "Verify the suggested category and urgency, or override them. The suggestion never decides the case.",
    icon: Sparkles,
    needsDate: false,
    needsReason: false,
    view: "category",
    decision: true,
    selfLogging: true,
  },
  {
    key: "startMediation",
    label: "Start Mediation",
    hint: "Start the 15-day Captain mediation period from the first meeting of both parties.",
    icon: Gavel,
    needsDate: true,
    needsReason: false,
    needsTracker: true,
  },
  {
    key: "startPangkat",
    label: "Schedule Pangkat Conciliation",
    hint: "Captain mediation ended without settlement. Record when the Pangkat convenes.",
    icon: Gavel,
    needsDate: true,
    needsReason: false,
    needsTracker: true,
  },
  {
    key: "settled",
    label: "Mark Settled (With Agreement)",
    hint: "Both parties reached an amicable settlement.",
    icon: CheckCircle2,
    needsDate: false,
    needsReason: false,
    terminal: true,
  },
  {
    key: "completed",
    label: "Mark Completed (Without Settlement)",
    hint: "Proceedings ended without a settlement.",
    icon: CheckCircle2,
    needsDate: false,
    needsReason: false,
    terminal: true,
  },
  {
    key: "reject",
    label: "Reject Complaint",
    hint: "Record that this complaint was not accepted. A reason is required.",
    icon: XCircle,
    needsDate: false,
    needsReason: true,
    terminal: true,
    decision: true,
  },
  {
    key: "archive",
    label: "Archive Record",
    hint: "Close the case file after disposition.",
    icon: Archive,
    needsDate: false,
    needsReason: false,
    terminal: true,
  },
];

/** Actions the current stage is allowed to offer, in registry order. */
function actionsForStage(stage) {
  const allowed = STAGE_ACTIONS[stage] || [];
  return ACTIONS.filter((a) => allowed.includes(a.key));
}

export default function WorkflowActions({
  open,
  onClose,
  supabase,
  user,
  complaint,
  bundle = {},
  onChanged,
  defaultAction = null,
  intentTitle = null,
}) {
  const stage = stageOf(complaint, bundle.kpTracker);
  const gate = routingGate(complaint);
  const decisionAllowed = canDecide(user?.role);
  const suggestedCategory = resolvePredictedCategory(complaint);
  const suggestedUrgency = complaint?.predicted_urgency || null;
  const confidence = complaint?.prediction_confidence
    ? Math.round((Number(complaint.prediction_confidence) || 0) * 100)
    : null;

  const stageAllowed = actionsForStage(stage).filter(
    (a) => a.key !== "archive" || complaint?.current_status === "Resolved"
  );

  // What the whole stage may legitimately do, with the party-facing phases
  // refused while routing is incomplete. The filter mirrors the database
  // trigger on kp_phases, so the UI and the database give the same answer,
  // but the filter can also explain itself in plain words.
  const list = stageAllowed.filter((a) => {
    if (gate.open) return true;
    return a.key !== "startMediation" && a.key !== "startPangkat";
  });

  /**
   * What the case file opened this modal on — one key ("receive"), or a few
   * named as a comma list ("settled,completed"). Anything the stage does not
   * already allow is dropped, so the modal can never be forced open on an
   * action it could not perform. It is taken from the stage filter rather
   * than the gate filter on purpose: an officer who pressed "Start Pangkat
   * Conciliation" still gets that action, with the gate's own explanation
   * above it, instead of a list that quietly left it out.
   *
   * Opened on that intent, this is not a picker: it shows those actions and
   * nothing else, so an officer who pressed "Receive & Docket Complaint" is
   * never asked again to choose from everything the stage happens to allow.
   * Opened with no intent (the Pangkat entry point, the OIC "Official
   * Action" button) it still lists what this stage may legitimately do.
   */
  const requestedKeys = defaultAction
    ? String(defaultAction)
        .split(",")
        .map((key) => key.trim())
        .filter(Boolean)
    : [];
  const requested = stageAllowed.filter((a) => requestedKeys.includes(a.key));
  const initialAction = requested.length === 1 ? requested[0] : null;

  const visibleActions = requested.length ? requested : list;

  const [view, setView] = useState(initialAction?.needsDate ? "date" : "list");
  const [chosen, setChosen] = useState(initialAction);
  const [dateValue, setDateValue] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [categoryForm, setCategoryForm] = useState(() => ({
    category: resolveConfirmedCategory(complaint) || suggestedCategory || "",
    urgency: resolveConfirmedUrgency(complaint) || suggestedUrgency || "",
    remarks: "",
    reviewed: false,
  }));
  const [categoryError, setCategoryError] = useState(null);
  const [receivedCaseNumber, setReceivedCaseNumber] = useState("");

  const pick = (action) => {
    setChosen(action);
    if (action.view === "category") {
      setCategoryError(null);
      setView("category");
    } else if (action.needsDate) {
      setView("date");
    } else if (action.terminal || action.needsReason) {
      setConfirmOpen(true);
    } else {
      run(action);
    }
  };

  const run = async (action, { date, reason } = {}) => {
    setBusy(true);
    const now = new Date().toISOString();
    try {
      const trackerId = action.needsTracker
        ? await ensureTracker(bundle.kpTracker)
        : bundle.kpTracker?.id || null;
      const outcome = await applyTransition(action, {
        date,
        reason,
        now,
        trackerId,
        category: categoryForm,
      });
      const advanced = outcome?.advanced !== false;
      // confirmOfficialCategorization writes its own detailed audit entry.
      if (!action.selfLogging) {
        await logComplaintActivity(supabase, {
          action: actionFor(auditKey(action)),
          complaintId: complaint.id,
          ref: complaint.reference_number || undefined,
          details: {
            date: date || null,
            note: reason || null,
          },
        });
      }
      // receive_complaint_official() already notified the resident and wrote the
      // case_status row, so the client skips both here to avoid duplicates.
      if (advanced && action.key !== "receive" && complaint?.resident_id) {
        await notifyResident(supabase, complaint.id, complaint.resident_id, {
          type: "complaint",
          title: notifyTitle(action),
          message: notifyMessage(action, complaint),
        });
      }

      if (advanced && action.key === "receive" && receivedCaseNumber) {
        toast.success(
          `${complaint.reference_number || "Complaint"} officially received. Barangay Case No. ${receivedCaseNumber}. Generate the Reklamo Form under Documents.`
        );
      } else {
        toast.success(notifyTitle(action, advanced));
      }
      onChanged();
      if (advanced) {
        setView("list");
        setChosen(null);
        setDateValue("");
        setNote("");
        setReceivedCaseNumber("");
        onClose();
      } else {
        // The decision was recorded but did not clear the gate, so stay on
        // this stage instead of implying the case moved on.
        setCategoryForm({ ...categoryForm, remarks: "", reviewed: false });
        setCategoryError(null);
        setView("list");
        setChosen(null);
      }
    } catch {
      toast.error("Could not record this action. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const ensureTracker = async (current) => {
    if (current?.id) return current.id;
    const { data, error } = await supabase
      .from("kp_trackers")
      .insert({
        complaint_id: complaint.id,
        applicability_confirmed_by: user?.id || null,
        applicability_confirmed_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (error) throw error;
    return data.id;
  };

  const applyTransition = async (action, { date, reason, now, trackerId, category }) => {
    const commonCaseStatus = {
      complaint_id: complaint.id,
      changed_by: user?.id || null,
      created_at: now,
    };
    let advanced = true;

    switch (action.key) {
      case "receive": {
        // Stage 2 only. Official receipt. The RPC assigns the Barangay
        // Case Number server-side and inserts the case_status / review
        // / activity rows, so the client must not write any of those
        // itself.
        //
        // KP applicability is NOT decided here. It is a routing
        // decision recorded in Routing Assessment via
        // captain_set_routing(). Receiving a complaint only issues the
        // case number and opens official review.
        const { data: receipt, error: receiptError } = await supabase.rpc(
          "receive_complaint_official",
          { p_complaint_id: complaint.id, p_review_notes: reason || null }
        );
        if (receiptError) throw new Error(receiptError.message);

        setReceivedCaseNumber(
          receipt?.barangay_case_number || complaint.barangay_case_number || ""
        );
        break;
      }
      case "confirmCategory": {
        const result = await confirmOfficialCategorization(supabase, {
          complaint,
          category: category.category,
          urgency: category.urgency,
          remarks: category.remarks,
          reviewed: category.reviewed,
          reviewedBy: user?.id || null,
          now,
        });
        if (!result.success) throw new Error(result.error || "category-save-failed");

        // A recorded-but-unconfirmed review is a valid outcome, but it must
        // not advance the case: the categorization gate stays closed.
        if (!result.confirmed) {
          advanced = false;
          break;
        }

        // Same advance as the Review & Classification tab, so both entry
        // points move the recorded stage on — and a case whose stage was
        // left behind by an older save is repaired rather than re-parked.
        await advancePastCategorization(supabase, {
          complaint,
          category: category.category,
          urgency: category.urgency,
          changedBy: user?.id || null,
          now,
        });
        break;
      }
      case "startMediation": {
        if (!date) throw new Error("no-date");
        await sup.updateTrackers(trackerId, "Mediation", user?.id || null, now);
        await insertPhase(trackerId, "Mediation", date);
        await Promise.all([
          supabase
            .from("complaints")
            .update({
              current_status: "In Progress",
              current_stage: "Mediation",
              updated_at: now,
            })
            .eq("id", complaint.id),
          supabase.from("case_statuses").insert({
            ...commonCaseStatus,
            status: "In Progress",
            stage: "Mediation",
            resident_visible_message: `The 15-day mediation period began on ${formatDateLong(date)}.`,
          }),
        ]);
        break;
      }
      case "startPangkat": {
        if (!date) throw new Error("no-date");
        await completeActivePhase(bundle.kpTracker, now);
        // kp_trackers.current_phase and kp_phases.phase_type are both
        // kp_phase_type, whose members are Assessment / Mediation /
        // Conciliation / Conciliation Extension / Completed / Not
        // Applicable. The panel's stage is named "Pangkat Conciliation"
        // on the complaint, but the phase it belongs to is "Conciliation"
        // — writing the free-text stage name into the enum made the whole
        // action fail at the database.
        await sup.updateTrackers(trackerId, "Conciliation", user?.id || null, now);
        await insertPhase(trackerId, "Conciliation", date);
        await convenePangkat(date, now);
        await Promise.all([
          supabase
            .from("complaints")
            .update({ current_stage: "Pangkat Conciliation", updated_at: now })
            .eq("id", complaint.id),
          supabase.from("case_statuses").insert({
            ...commonCaseStatus,
            status: "In Progress",
            stage: "Pangkat Conciliation",
            resident_visible_message: `The Pangkat convened; its 15-day period began on ${formatDateLong(date)}.`,
          }),
        ]);
        break;
      }
      case "settled": {
        await completeActivePhase(bundle.kpTracker, now);
        await Promise.all([
          supabase
            .from("complaints")
            .update({
              current_status: "Resolved",
              current_stage: "Resolved — Amicable Settlement",
              resolved_at: now,
              updated_at: now,
            })
            .eq("id", complaint.id),
          supabase.from("case_statuses").insert({
            ...commonCaseStatus,
            status: "Settled",
            stage: "Settled — Amicable Settlement",
            resident_visible_message: "Your case was settled through an amicable agreement.",
          }),
        ]);
        break;
      }
      case "completed": {
        await completeActivePhase(bundle.kpTracker, now);
        await Promise.all([
          supabase
            .from("complaints")
            .update({
              current_status: "Resolved",
              current_stage: "Completed — Without Settlement",
              resolved_at: now,
              updated_at: now,
            })
            .eq("id", complaint.id),
          supabase.from("case_statuses").insert({
            ...commonCaseStatus,
            status: "Completed Without Settlement",
            stage: "Completed — Without Settlement",
            resident_visible_message: "Your case has been completed without a settlement.",
          }),
        ]);
        break;
      }
      case "reject": {
        if (!reason?.trim()) throw new Error("no-reason");
        await Promise.all([
          supabase
            .from("complaints")
            .update({ current_status: "Rejected", current_stage: "Rejected", updated_at: now })
            .eq("id", complaint.id),
          supabase.from("case_statuses").insert({
            ...commonCaseStatus,
            status: "Rejected",
            stage: "Rejected",
            resident_visible_message: `Your complaint was not accepted. Reason: ${reason.trim()}`,
          }),
        ]);
        break;
      }
      case "archive": {
        await Promise.all([
          supabase
            .from("complaints")
            .update({ current_status: "Closed", current_stage: "Archived", updated_at: now })
            .eq("id", complaint.id),
          supabase.from("case_statuses").insert({
            ...commonCaseStatus,
            status: "Closed",
            stage: "Archived",
            resident_visible_message: "This case has been archived.",
          }),
        ]);
        break;
      }
      default:
        break;
    }

    return { advanced };
  };

  const sup = {
    updateTrackers: async (id, phase, actor, ts) => {
      const { error } = await supabase
        .from("kp_trackers")
        .update({
          kp_applicable: true,
          current_phase: phase,
          applicability_confirmed_by: actor,
          applicability_confirmed_at: ts,
          updated_at: ts,
        })
        .eq("id", id);
      if (error) throw error;
    },
  };

  const insertPhase = async (trackerId, phaseType, startDate) => {
    const { error } = await supabase.from("kp_phases").insert({
      tracker_id: trackerId,
      phase_type: phaseType,
      start_date: startDate,
      deadline_date: localDateOffset(startDate, 15),
      duration_days: 15,
      // kp_phases.status is the kp_phase_status enum, which has no
      // 'In Progress' value. 'Active' is the in-period value.
      status: "Active",
    });
    if (error) throw error;
  };

  const completeActivePhase = async (tracker, ts) => {
    if (!tracker?.id) return;
    const { error } = await supabase
      .from("kp_phases")
      .update({ status: "Completed", completed_at: ts })
      .eq("tracker_id", tracker.id)
      .is("completed_at", null);
    if (error) throw error;
  };

  /**
   * Start the Pangkat's own 15-day clock.
   *
   * The panel's period is counted from when it officially convenes —
   * never from when the members were selected, and never from when
   * the case entered conciliation — so this is what actually starts
   * it. `pangkat_trackers` holds exactly one row per complaint and
   * the clock only ever starts once; a repeat run of this action
   * reports the original convening rather than restarting it.
   *
   * `captain_convene_pangkat()` does the work server-side where it
   * has been applied. When it has not, the same two writes are made
   * here so the officer is not blocked by a pending migration.
   */
  const convenePangkat = async (date, ts) => {
    const convenedAt = new Date(`${date}T00:00:00+08:00`).toISOString();
    const { error } = await supabase.rpc("captain_convene_pangkat", {
      p_complaint_id: complaint.id,
      p_convenes_at: convenedAt,
    });
    if (!error) return;

    const { data: trackerRow } = await supabase
      .from("pangkat_trackers")
      .select("id, convenes_at")
      .eq("complaint_id", complaint.id)
      .maybeSingle();

    if (!trackerRow) {
      await supabase.from("pangkat_trackers").insert({
        complaint_id: complaint.id,
        convenes_at: convenedAt,
        convened_by: user?.id || null,
        status: "Active",
        updated_at: ts,
      });
      return;
    }
    if (trackerRow.convenes_at) return;

    await supabase
      .from("pangkat_trackers")
      .update({
        convenes_at: convenedAt,
        convened_by: user?.id || null,
        status: "Active",
        updated_at: ts,
      })
      .eq("id", trackerRow.id);
  };

  const handleConfirm = () => {
    const action = chosen;
    if (!action) return;
    setConfirmOpen(false);
    run(action, {
      date: action.needsDate ? dateValue : undefined,
      reason: action.needsReason ? note : undefined,
    });
  };

  const submitCategory = () => {
    setCategoryError(null);
    if (!categoryForm.reviewed) {
      setCategoryError("Confirm that the complaint and its available evidence were reviewed.");
      return;
    }
    if (!categoryForm.remarks.trim()) {
      setCategoryError("Verification remarks are required.");
      return;
    }
    run(ACTIONS.find((a) => a.key === "confirmCategory"));
  };

  const blockedDecisions = list.filter((a) => a.decision);
  const deniedReason =
    blockedDecisions.length > 0 && !decisionAllowed
      ? "Only the Barangay Captain or OIC can record this stage's official decision."
      : null;

  return (
    <>
      <ResidentModal
        open={open}
        onClose={onClose}
        labelledBy="workflow-title"
        title={chosen?.label || intentTitle || "Continue Case Processing"}
        maxWidthClass="max-w-lg"
      >
        {view === "list" && (
          <div className="space-y-4">
            {/* Where the case is, in one line. The seven-step order is not
                repeated here: it is already drawn once, above this section,
                by the main Case Progress component, and a second copy inside
                the action modal could disagree with the first. */}
            <p className="rounded-xl bg-alt px-4 py-2.5 text-xs font-semibold text-muted">
              {STAGE_META[stage]?.label}
            </p>

            {deniedReason ? (
              <p className="rounded-xl bg-warning-soft px-4 py-3 text-xs font-semibold text-warning">
                {deniedReason}
              </p>
            ) : null}

            {!gate.open ? (
              <p className="rounded-xl bg-warning-soft px-4 py-3 text-xs font-semibold leading-relaxed text-warning">
                {gate.reason || GATE_EXPLANATION}
              </p>
            ) : null}

            <div className="space-y-2.5">
              {visibleActions.length === 0 ? (
                <p className="rounded-xl bg-alt px-4 py-3 text-sm text-muted">
                  No processing action is valid at this stage.
                </p>
              ) : (
                visibleActions.map((action) => {
                  const Icon = action.icon;
                  const blocked = Boolean(deniedReason) && action.decision;
                  return (
                    <button
                      key={action.key}
                      type="button"
                      disabled={blocked || busy}
                      onClick={() => pick(action)}
                      className="group flex w-full items-start gap-3 rounded-2xl border border-line bg-white p-4 text-left transition-colors hover:border-jordy hover:bg-info-soft disabled:opacity-50"
                    >
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-info-soft text-secondary transition-colors group-hover:bg-jordy group-hover:text-white">
                        <Icon className="h-5 w-5" aria-hidden="true" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold text-navy">{action.label}</span>
                        <span className="mt-0.5 block text-xs text-muted">{action.hint}</span>
                      </span>
                      <ArrowRight
                        className="mt-3 h-4 w-4 shrink-0 text-muted transition-colors group-hover:text-secondary"
                        aria-hidden="true"
                      />
                    </button>
                  );
                })
              )}
            </div>
          </div>
        )}

        {view === "category" && (
          <div className="space-y-4 text-sm">
            <div className="rounded-2xl border border-line bg-white p-4">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-[#714bd8]" aria-hidden="true" />
                <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                  AI Suggestion — Advisory Only
                </p>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-alt px-3 py-2.5">
                  <dt className="text-[11px] uppercase tracking-wide text-muted">Suggested type</dt>
                  <dd className="mt-0.5 text-sm font-semibold text-mirage">
                    {suggestedCategory || "No suggestion"}
                  </dd>
                </div>
                <div className="rounded-xl bg-alt px-3 py-2.5">
                  <dt className="text-[11px] uppercase tracking-wide text-muted">Suggested urgency</dt>
                  <dd className="mt-0.5 text-sm font-semibold text-mirage">
                    {suggestedUrgency || "No suggestion"}
                    {confidence != null ? ` · ${confidence}%` : ""}
                  </dd>
                </div>
              </dl>
              <p className="mt-3 text-xs leading-relaxed text-muted">
                This recommendation does not decide the case. The official decision below is what is
                recorded as the complaint&apos;s category.
              </p>
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-muted" htmlFor="wf-category">
                Official complaint type
              </label>
              <select
                id="wf-category"
                value={categoryForm.category}
                onChange={(e) =>
                  setCategoryForm({
                    ...categoryForm,
                    category: e.target.value,
                    urgency:
                      e.target.value === NO_CATEGORY_CONFIRMED ? "" : categoryForm.urgency,
                  })
                }
                className="h-11 w-full rounded-full border border-line bg-white px-4 text-sm text-mirage outline-none focus:border-secondary focus:ring-2 focus:ring-secondary/20"
              >
                <option value="">Select type…</option>
                {CATEGORY_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
                <option value={NO_CATEGORY_CONFIRMED}>{NO_CATEGORY_CONFIRMED}</option>
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-muted" htmlFor="wf-urgency">
                Official urgency
              </label>
              <select
                id="wf-urgency"
                value={categoryForm.urgency}
                onChange={(e) => setCategoryForm({ ...categoryForm, urgency: e.target.value })}
                disabled={!categoryForm.category || categoryForm.category === NO_CATEGORY_CONFIRMED}
                className="h-11 w-full rounded-full border border-line bg-white px-4 text-sm text-mirage outline-none focus:border-secondary focus:ring-2 focus:ring-secondary/20 disabled:opacity-60"
              >
                <option value="">Select urgency…</option>
                {URGENCY_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-muted" htmlFor="wf-remarks">
                Verification remarks
              </label>
              <textarea
                id="wf-remarks"
                value={categoryForm.remarks}
                onChange={(e) => setCategoryForm({ ...categoryForm, remarks: e.target.value })}
                rows={3}
                aria-invalid={Boolean(categoryError)}
                placeholder="Reviewed against the complaint narrative and attachments."
                className="w-full rounded-xl border border-line bg-white px-4 py-3 text-sm text-mirage outline-none focus:border-secondary focus:ring-2 focus:ring-secondary/20"
              />
            </div>

            <label className="flex items-start gap-2.5 text-sm text-mirage">
              <input
                type="checkbox"
                checked={categoryForm.reviewed}
                onChange={(e) => setCategoryForm({ ...categoryForm, reviewed: e.target.checked })}
                className="mt-0.5 h-4 w-4 rounded border-line accent-[#17774e]"
              />
              Complaint and available evidence were reviewed.
            </label>

            <p className="rounded-xl bg-paledgold px-4 py-3 text-xs leading-relaxed text-mirage">
              Choosing &ldquo;{NO_CATEGORY_CONFIRMED}&rdquo; records the review and keeps the case
              at this stage. No category is fabricated.
            </p>

            {categoryError ? (
              <p
                role="alert"
                className="rounded-xl bg-critical-soft px-4 py-3 text-xs font-semibold text-critical"
              >
                {categoryError}
              </p>
            ) : null}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setView("list")}
                disabled={busy}
                className="h-11 rounded-full border border-line px-5 text-sm font-semibold text-mirage transition-colors hover:bg-alt"
              >
                Back
              </button>
              <LoadingButton isLoading={busy} onClick={submitCategory}>
                Confirm &amp; Continue
              </LoadingButton>
            </div>
          </div>
        )}

        {view === "date" && (
          <div className="space-y-4 text-sm">
            <p className="rounded-xl bg-paledgold px-4 py-3 text-xs leading-relaxed text-mirage">
              {chosen?.key === "startMediation"
                ? "The 15-day mediation period begins on the day both parties first meet before the Punong Barangay — not from summons delivery."
                : "The Pangkat 15-day period begins when the Pangkat convenes, not from any earlier scheduling."}
            </p>
            <div>
              <label className="mb-1 block text-xs font-semibold text-muted">
                Date of {chosen?.key === "startPangkat" ? "the Pangkat convening" : "the first meeting of the parties"}
              </label>
              <input
                type="date"
                value={dateValue}
                onChange={(e) => setDateValue(e.target.value)}
                className="h-11 w-full rounded-full border border-line bg-white px-4 text-sm text-mirage outline-none focus:border-secondary focus:ring-2 focus:ring-secondary/20"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-muted">Note (optional)</label>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                className="w-full rounded-xl border border-line bg-white px-4 py-3 text-sm text-mirage outline-none focus:border-secondary"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setView("list")}
                className="h-11 rounded-full border border-line px-5 text-sm font-semibold text-mirage transition-colors hover:bg-alt"
              >
                Back
              </button>
              <LoadingButton
                isLoading={busy}
                disabled={busy || !dateValue}
                onClick={() => run(chosen, { date: dateValue, note })}
              >
                Record & Start
              </LoadingButton>
            </div>
          </div>
        )}
      </ResidentModal>

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={handleConfirm}
        title={`${chosen?.label || "Confirm action"}?`}
        message={
          chosen?.key === "reject"
            ? "Enter the reason for rejecting this complaint. The reason is recorded and shared with the complainant."
            : "This action updates the case record, the audit log, and the complainant's notification."
        }
        confirmLabel={chosen?.key === "archive" ? "Archive Record" : "Confirm Action"}
        busy={busy}
      >
        {chosen?.needsReason ? (
          <div className="mt-3">
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              autoFocus
              placeholder="Reason for rejection"
              className="w-full rounded-xl border border-line bg-white px-4 py-3 text-sm text-mirage outline-none focus:border-secondary"
            />
          </div>
        ) : null}
      </ConfirmDialog>
    </>
  );
}

function auditKey(action) {
  switch (action.key) {
    case "receive": return "case_received";
    case "startMediation": return "mediation_started";
    case "startPangkat": return "pangkat_scheduled";
    case "settled": return "case_settled";
    case "completed": return "case_completed";
    case "reject": return "case_rejected";
    case "archive": return "case_archived";
    default: return "case_updated";
  }
}

function actionFor(key) {
  return key;
}

function notifyTitle(action, advanced = true) {
  switch (action.key) {
    case "receive": return "Complaint received";
    case "confirmCategory":
      return advanced
        ? "Categorization confirmed"
        : "Review recorded — further review required";
    case "startMediation": return "Mediation started";
    case "startPangkat": return "Pangkat conciliation started";
    case "settled": return "Case settled";
    case "completed": return "Case completed";
    case "reject": return "Complaint not accepted";
    case "archive": return "Case archived";
    default: return "Case updated";
  }
}

function notifyMessage(action, complaint) {
  const ref = complaint?.reference_number || "your complaint";
  switch (action.key) {
    case "receive": return `${ref} passed the information check and is awaiting official categorization.`;
    case "confirmCategory": return `An official confirmed the category of ${ref}. Summons scheduling follows.`;
    case "startMediation": return `A mediation period has started for ${ref}.`;
    case "startPangkat": return `The Pangkat conciliation period has started for ${ref}.`;
    case "settled": return `${ref} was settled through an amicable agreement.`;
    case "completed": return `${ref} has been completed without a settlement.`;
    case "reject": return `${ref} was not accepted. Your notice includes the reason.`;
    case "archive": return `${ref} has been archived.`;
    default: return `${ref} was updated.`;
  }
}
