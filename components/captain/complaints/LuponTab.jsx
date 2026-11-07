"use client";

import { useState, useEffect } from "react";
import toast from "react-hot-toast";
import { UserPlus, Users, Clock3 } from "lucide-react";
import Panel from "./Panel";
import ResidentModal from "@/components/shared/ResidentModal";
import ConfirmDialog from "@/components/shared/ConfirmDialog";
import LoadingButton from "@/components/shared/LoadingButton";
import { logComplaintActivity } from "@/lib/complaintQueries";
import { routingGate, GATE_EXPLANATION } from "@/lib/captainComplaintRouting";
import { STAGE_KEYS, formatDateShort, resolveComplainantName } from "./complaintMeta";
import {
  PANGKAT_PERIOD_DAYS,
  PANGKAT_EXTENSION_MAX_DAYS,
  pangkatWindowFor,
  isPangkatConstituted,
} from "@/lib/captainComplaintWorkflow";

/**
 * Who chose a Pangkat member, and the office the third one holds.
 *
 * Under the Katarungang Pambarangay the Pangkat is three members
 * drawn from the Lupon: each party names one, and those two name the
 * third, who chairs. "Jointly" is the fallback for a panel recorded
 * before `selected_by` existed — a panel already on file was formed
 * jointly by definition.
 */
const SELECTION = {
  COMPLAINANT: "complainant",
  RESPONDENT: "respondent",
  JOINTLY: "jointly",
};

const SELECTION_META = {
  [SELECTION.COMPLAINANT]: {
    slot: "Chosen by the Complainant",
    holder: "Complainant's member",
    short: "Complainant's pick",
  },
  [SELECTION.RESPONDENT]: {
    slot: "Chosen by the Respondent",
    holder: "Respondent's member",
    short: "Respondent's pick",
  },
  [SELECTION.JOINTLY]: {
    slot: "Third Member — Chairperson",
    holder: "Chairperson",
    short: "Third member",
  },
};

/** Roles that may sit on a Pangkat. */
const ELIGIBLE_ROLES = ["lupon", "secretary", "oic", "captain"];

export default function LuponTab({
  supabase,
  user,
  complaint,
  luponPanels = [],
  pangkatTracker = null,
  stage,
  onChanged,
  onStartPangkat,
}) {
  const canManagePanel = user?.role === "captain" || user?.role === "oic";
  const gate = routingGate(complaint);
  const active = stage === STAGE_KEYS.CONCILIATION;

  const activePanels = (luponPanels || []).filter((row) => row?.status === "active");
  const hasPanel = isPangkatConstituted(activePanels);
  const partiallySelected = activePanels.length > 0 && !hasPanel;

  const pangkatWindow = pangkatWindowFor({ pangkatTracker });

  const [showForm, setShowForm] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  // null means "not fetched yet", which is different from "there are
  // none" — the form can then say it is loading rather than claiming
  // there are no eligible members.
  const [candidates, setCandidates] = useState(null);
  const [byParty, setByParty] = useState({
    [SELECTION.COMPLAINANT]: "",
    [SELECTION.RESPONDENT]: "",
    [SELECTION.JOINTLY]: "",
  });
  const [saving, setSaving] = useState(false);
  const [seeded, setSeeded] = useState(false);

  useEffect(() => {
    if (!showForm) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("id, display_name, role")
        .in("role", ELIGIBLE_ROLES)
        .order("display_name", { ascending: true });
      if (cancelled) return;
      setCandidates(data || []);
    })();
    return () => {
      cancelled = true;
    };
  }, [showForm, supabase]);

  /**
   * Reopening the form shows what is already on file, so the officer
   * is never asked to pick three names again to change one of them.
   *
   * Adjusted during render rather than in an effect: the state belongs
   * to the moment the dialog opens, and seeding it in an effect would
   * paint an empty form first and fill it a frame later.
   */
  if (showForm !== seeded) {
    setSeeded(showForm);
    if (showForm) {
      const next = {
        [SELECTION.COMPLAINANT]: "",
        [SELECTION.RESPONDENT]: "",
        [SELECTION.JOINTLY]: "",
      };
      for (const row of activePanels) {
        const key = SELECTION[row.selected_by] || SELECTION.JOINTLY;
        if (row.role === "chairperson") next[SELECTION.JOINTLY] = row.member_id;
        else if (!next[key] || key === SELECTION.JOINTLY) next[key] = row.member_id;
      }
      setByParty(next);
    }
  }

  const candidateList = candidates || [];
  const loadingCandidates = showForm && candidates === null;

  /**
   * The section is open as soon as the case is a two-party dispute in
   * mediation or later, because recording who each party chose is the
   * step that *makes* the second stage possible. It is only
   * actionable once routing is settled, for the same reason every
   * other party-facing action is.
   */
  const canForm =
    canManagePanel && gate.open && !hasPanel && (active || stage === STAGE_KEYS.MEDIATION);

  const handleRecordSelection = async () => {
    const picks = [
      { selectedBy: SELECTION.COMPLAINANT, memberId: byParty[SELECTION.COMPLAINANT], role: "member" },
      { selectedBy: SELECTION.RESPONDENT, memberId: byParty[SELECTION.RESPONDENT], role: "member" },
      { selectedBy: SELECTION.JOINTLY, memberId: byParty[SELECTION.JOINTLY], role: "chairperson" },
    ];

    const ids = picks.map((p) => p.memberId).filter(Boolean);
    if (ids.length !== 3) {
      toast.error("Fill all three slots. Each party chooses one member, and those two choose the third.");
      return;
    }
    if (new Set(ids).size !== 3) {
      toast.error("The three slots must be three different people.");
      return;
    }

    setSaving(true);
    try {
      // Replace rather than append: this is a correction of the
      // same selection, not a second panel. Removing the previous
      // active rows first also keeps the one-member-per-complaint
      // index satisfied.
      const { error: clearError } = await supabase
        .from("lupon_panels")
        .delete()
        .eq("complaint_id", complaint.id)
        .eq("status", "active");
      if (clearError) throw clearError;

      const rows = picks.map((pick) => ({
        complaint_id: complaint.id,
        member_id: pick.memberId,
        role: pick.role,
        selected_by: pick.selectedBy,
        assigned_by: user?.id || null,
        status: "active",
      }));
      const { error } = await supabase.from("lupon_panels").insert(rows);
      if (error) throw error;

      await logComplaintActivity(supabase, {
        action: "pangkat_panel_formed",
        complaintId: complaint.id,
        ref: complaint.reference_number || undefined,
        details: {
          complainant_choice: byParty[SELECTION.COMPLAINANT],
          respondent_choice: byParty[SELECTION.RESPONDENT],
          chairperson: byParty[SELECTION.JOINTLY],
        },
      });

      toast.success(
        "Pangkat recorded: one member chosen by each party, and the third — who chairs — by those two."
      );
      setShowForm(false);
      setShowConfirm(false);
      onChanged();
    } catch (error) {
      // Name the cause. "Could not record the Pangkat selection." on
      // its own cannot be acted on: an RLS refusal, a broken one-panel
      // index and a dropped connection all look identical to the
      // officer, and the real reason never reaches anyone — including
      // whoever has to work out what happened.
      const reason =
        typeof error?.message === "string" && error.message.trim()
          ? error.message.trim()
          : "no reason returned";
      toast.error(`Could not record the Pangkat selection (${reason}).`);
    } finally {
      setSaving(false);
    }
  };

  const candidateOptions = candidateList
    .filter((c) => c.id !== user?.id)
    .map((c) => (
      <option key={c.id} value={c.id}>
        {c.display_name || c.role} ({c.role})
      </option>
    ));

  const nameOf = (id) => candidateList.find((c) => c.id === id)?.display_name || null;

  const memberFor = (selectedBy) =>
    activePanels.find((row) =>
      selectedBy === SELECTION.JOINTLY
        ? row.role === "chairperson"
        : row.selected_by === selectedBy && row.role !== "chairperson"
    );

  const respondentLabel = complaint?.respondent_display_name || complaint?.respondent_name;

  return (
    <div className="space-y-4">
      <p className="rounded-xl border border-gold-soft bg-paledgold px-4 py-3 text-xs leading-relaxed text-mirage">
        <strong className="font-semibold text-warning">Second stage.</strong> If Captain mediation
        does not settle this case within 15 days, it moves to the Pangkat Tagapagkasundo — a panel of
        three members drawn from the Lupon. Each party chooses one member; those two then choose the
        third, who chairs. One party cannot appoint the panel alone.
      </p>

      <Panel
        title="Pangkat Panel Record"
        tag={
          hasPanel
            ? `${activePanels.length} members`
            : partiallySelected
              ? `${activePanels.length} of 3 selected`
              : "Not constituted"
        }
        tagClass={hasPanel ? "bg-success-soft text-success" : "bg-alt text-muted"}
      >
        {activePanels.length ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {[SELECTION.COMPLAINANT, SELECTION.RESPONDENT, SELECTION.JOINTLY].map((key) => {
              const row = memberFor(key);
              const meta = SELECTION_META[key];
              return (
                <div
                  key={key}
                  className="flex items-center gap-3 rounded-xl border border-line px-4 py-3"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#714bd8]/10 text-xs font-bold text-[#714bd8]">
                    {row?.profiles?.display_name
                      ? row.profiles.display_name
                          .split(/\s+/)
                          .filter(Boolean)
                          .slice(0, 2)
                          .map((part) => part[0])
                          .join("")
                          .toUpperCase()
                      : "?"}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-navy">
                      {row?.profiles?.display_name || "Not yet selected"}
                    </p>
                    <p className="text-xs text-muted">{meta.slot}</p>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-muted">
            No Pangkat members have been recorded for this complaint yet.
          </p>
        )}
      </Panel>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel title="Selection Requirements">
          <ul className="space-y-2 text-sm leading-relaxed text-muted">
            <li>
              <strong className="font-semibold text-mirage">1.</strong>{" "}
              <strong className="font-semibold text-mirage">{resolveComplainantName(complaint)}</strong>{" "}
              names one member from the Lupon list.
            </li>
            <li>
              <strong className="font-semibold text-mirage">2.</strong>{" "}
              <strong className="font-semibold text-mirage">
                {respondentLabel || "The respondent"}
              </strong>{" "}
              names one member from the same list.
            </li>
            <li>
              <strong className="font-semibold text-mirage">3.</strong> Those two members choose the
              third, who chairs the panel.
            </li>
            <li>
              Three distinct people are required. The selection must have been jointly agreed — one
              party cannot appoint the panel alone.
            </li>
          </ul>
        </Panel>

        <Panel title="Panel Actions">
          <div className="flex flex-col gap-3">
            <button
              type="button"
              disabled={!canForm || saving}
              onClick={() => setShowForm(true)}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-jordy px-5 text-sm font-semibold text-white shadow-button transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
            >
              <UserPlus className="h-4 w-4" aria-hidden="true" />
              {hasPanel || partiallySelected ? "Correct the Selection" : "Record the Selection"}
            </button>
            <button
              type="button"
              disabled={!hasPanel || active || !gate.open}
              onClick={onStartPangkat}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-full border border-line px-5 text-sm font-semibold text-mirage transition-colors hover:bg-alt disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Users className="h-4 w-4" aria-hidden="true" />
              {pangkatWindow.convened ? "Pangkat Convened" : "Convene the Pangkat"}
            </button>
            <p className="text-xs text-muted">
              {!gate.open
                ? GATE_EXPLANATION
                : !canManagePanel
                  ? "Only the Barangay Captain or OIC can record a Pangkat selection."
                  : !hasPanel
                    ? "Record all three members before convening the panel."
                    : pangkatWindow.convened
                      ? `The Pangkat is running: day ${Math.min(pangkatWindow.elapsed, pangkatWindow.totalDays)} of ${pangkatWindow.totalDays}.`
                      : "The 15-day period starts only when the panel officially convenes."}
            </p>
          </div>
        </Panel>
      </div>

      <Panel
        title="15-Day Conciliation Period"
        tag={pangkatWindow.convened ? `Day ${Math.min(pangkatWindow.elapsed, pangkatWindow.totalDays)} of ${pangkatWindow.totalDays}` : "Not started"}
        tagClass={pangkatWindow.convened ? "bg-info-soft text-info" : "bg-alt text-muted"}
      >
        {pangkatWindow.convened ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted">Convened</p>
              <p className="mt-1 text-sm font-semibold text-mirage">
                {formatDateShort(pangkatWindow.convenedAt)}
              </p>
            </div>
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted">
                Must finish by
              </p>
              <p className="mt-1 text-sm font-semibold text-mirage">
                {formatDateShort(pangkatWindow.deadline)}
              </p>
            </div>
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted">
                Time remaining
              </p>
              <p className="mt-1 text-sm font-semibold text-mirage">
                {pangkatWindow.concluded
                  ? "Result recorded"
                  : `${pangkatWindow.remaining} day${pangkatWindow.remaining === 1 ? "" : "s"}`}
              </p>
            </div>
            {pangkatWindow.extensionDays ? (
              <p className="text-xs text-muted sm:col-span-3">
                Extended by {pangkatWindow.extensionDays} day
                {pangkatWindow.extensionDays === 1 ? "" : "s"} in a meritorious case. The total may
                not exceed {PANGKAT_PERIOD_DAYS + PANGKAT_EXTENSION_MAX_DAYS} days.
              </p>
            ) : null}
            {!pangkatWindow.concluded && pangkatWindow.lapsed ? (
              <p className="rounded-xl bg-warning-soft px-4 py-3 text-xs font-semibold text-warning sm:col-span-3">
                The 15-day period has elapsed. Record the result of the conciliation.
              </p>
            ) : null}
          </div>
        ) : (
          <p className="flex items-start gap-2 text-sm text-muted">
            <Clock3 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
              The Pangkat must convene and hear the case within 15 days from its constitution. That
              clock starts when the panel officially convenes — recording who the members are does
              not start it.
            </span>
          </p>
        )}
      </Panel>

      <ResidentModal
        open={showForm}
        onClose={() => setShowForm(false)}
        labelledBy="form-panel-title"
        title="Record the Pangkat Selection"
        maxWidthClass="max-w-md"
      >
        <div className="space-y-4 text-sm">
          <p className="text-xs leading-relaxed text-muted">
            Record the three members of the Pangkat for{" "}
            <strong>{resolveComplainantName(complaint)}</strong> vs.{" "}
            <strong>{respondentLabel || "the respondent"}</strong>. You will confirm before saving.
          </p>
          {loadingCandidates ? (
            <p className="text-xs text-muted">Loading eligible Lupon members…</p>
          ) : candidateList.length < 3 ? (
            <p className="rounded-xl bg-warning-soft px-4 py-3 text-xs font-semibold text-warning">
              Not enough eligible Lupon members exist yet. Create Lupon accounts first.
            </p>
          ) : (
            <>
              {([SELECTION.COMPLAINANT, SELECTION.RESPONDENT, SELECTION.JOINTLY]).map((key) => (
                <Field
                  key={key}
                  label={SELECTION_META[key].slot}
                  hint={
                    key === SELECTION.JOINTLY
                      ? "Chosen by the two members above; this member chairs the panel."
                      : "Chosen by that party from the Lupon list."
                  }
                  value={byParty[key]}
                  onChange={(value) => setByParty((prev) => ({ ...prev, [key]: value }))}
                  options={candidateOptions}
                />
              ))}
              <p className="text-xs text-muted">
                {byParty[SELECTION.JOINTLY]
                  ? `Chairperson: ${nameOf(byParty[SELECTION.JOINTLY]) || "selected"}.`
                  : "Pick the chairperson last — that slot is the third member."}
              </p>
              <div className="flex justify-end pt-2">
                <LoadingButton
                  isLoading={saving}
                  disabled={saving}
                  onClick={() => setShowConfirm(true)}
                >
                  Next
                </LoadingButton>
              </div>
            </>
          )}
        </div>
      </ResidentModal>

      <ConfirmDialog
        open={showConfirm}
        onClose={() => setShowConfirm(false)}
        onConfirm={handleRecordSelection}
        title="Confirm the Pangkat selection"
        message="Confirm that the complainant and the respondent each chose one member, and that those two chose the third, who chairs. One party cannot appoint the panel alone. This is recorded in the audit log."
        confirmLabel="Record the Panel"
        busy={saving}
      />
    </div>
  );
}

function Field({ label, value, onChange, options, hint }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-semibold text-muted">{label}</label>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-xl border border-line bg-white px-3 py-2.5 text-sm text-mirage outline-none focus:border-jordy"
      >
        <option value="">— select a Lupon member —</option>
        {options}
      </select>
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}
