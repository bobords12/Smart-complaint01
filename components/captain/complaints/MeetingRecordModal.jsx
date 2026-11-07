"use client";

import { useMemo, useState } from "react";
import toast from "react-hot-toast";
import { Plus, Trash2 } from "lucide-react";
import ResidentModal from "@/components/shared/ResidentModal";
import LoadingButton from "@/components/shared/LoadingButton";
import { logComplaintActivity } from "@/lib/complaintQueries";
import {
  ATTENDANCE_STATUS_OPTIONS,
  MEETING_CONDUCTED_OPTIONS,
  MEETING_OUTCOME_OPTIONS,
  saveMeetingRecord,
} from "@/lib/captainComplaintWorkflow";

const ROLES = ["complainant", "respondent", "witness", "lupon_member", "barangay_official", "other"];
const ROLE_LABELS = {
  complainant: "Complainant",
  respondent: "Respondent",
  witness: "Witness",
  lupon_member: "Lupon member",
  barangay_official: "Barangay official",
  other: "Other",
};

function blankRow() {
  return { label: "", role: "complainant", status: "Not recorded", excuseReason: "" };
}

function initialForm({ hearing, attendances, meeting }) {
  return {
    conducted: meeting?.conducted || "Not recorded",
    outcome: meeting?.outcome || "",
    outcomeExplanation: meeting?.outcome_explanation || "",
    minutes: meeting?.narrative || "",
    agreements: meeting?.agreements || "",
    nextStep: meeting?.next_step || "",
    rows: (attendances || []).map((row) => ({
      label: row.attendee_label || "",
      role: row.party_role || "other",
      status: row.attendance_status || "Not recorded",
      excuseReason: row.excuse_reason || "",
    })),
  };
}

/**
 * The Meeting Record.
 *
 * One dialog for what actually happened at a hearing: whether the
 * meeting was conducted at all, who was there, what was said, and what
 * was decided. Conducted and attendance are separate fields on purpose,
 * because "the parties did not appear" is a different record from "the
 * meeting never happened", and collapsing them is what let attendance
 * entries quietly close out a hearing.
 *
 * Setting Conducted to Yes is the only thing in the Captain portal that
 * marks a hearing Held.
 */
export default function MeetingRecordModal({
  open,
  onClose,
  supabase,
  complaint,
  hearing,
  // Changing this key rebuilds the form for the hearing being edited, so
  // a previously entered record is never carried into another hearing.
  formKey = "",
  attendances = [],
  meeting = null,
  onSaved,
}) {
  const [form, setForm] = useState(() => initialForm({ attendances, meeting }));
  const [saving, setSaving] = useState(false);

  const conductedYes = form.conducted === "Yes";
  const conductedNo = form.conducted === "No";

  const named = useMemo(
    () => form.rows.filter((row) => row.label.trim()),
    [form.rows]
  );

  if (!open || !hearing) return null;

  const set = (patch) => setForm((prev) => ({ ...prev, ...patch }));

  const updateRow = (index, patch) =>
    setForm((prev) => ({
      ...prev,
      rows: prev.rows.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    }));

  const handleSave = async () => {
    const labels = named.map((row) => row.label.trim().toLowerCase());
    if (new Set(labels).size !== labels.length) {
      toast.error("Each party can only appear once for this hearing.");
      return;
    }

    const excused = named.find((row) => row.status === "Excused" && !row.excuseReason.trim());
    if (excused) {
      toast.error(`${excused.label.trim()} is excused but has no reason given.`);
      return;
    }

    setSaving(true);
    try {
      const result = await saveMeetingRecord(supabase, {
        hearingId: hearing.id,
        conducted: form.conducted,
        // A meeting that did not happen cannot have an outcome, so the
        // stale outcome is cleared rather than saved alongside "No".
        outcome: conductedYes ? form.outcome : null,
        outcomeExplanation: conductedYes ? form.outcomeExplanation : null,
        minutes: form.minutes,
        agreements: form.agreements,
        nextStep: form.nextStep,
        attendance: named.map((row) => ({
          partyRole: row.role,
          attendeeLabel: row.label.trim(),
          attendanceStatus: row.status,
          excuseReason: row.excuseReason,
        })),
      });

      if (!result.success) {
        toast.error(result.error);
        return;
      }

      try {
        await logComplaintActivity(supabase, {
          action: conductedYes ? "hearing_meeting_recorded" : "hearing_meeting_record_updated",
          complaintId: complaint.id,
          ref: complaint.reference_number || undefined,
          details: {
            hearing_id: hearing.id,
            conducted: form.conducted,
            outcome: conductedYes ? form.outcome : null,
            attendance_rows: named.length,
            hearing_status: result.result?.hearing_status || null,
          },
        });
      } catch {
        // The record is already saved. A failed audit write must not make
        // the officer think the meeting record failed.
      }

      toast.success(
        conductedYes
          ? `Meeting record saved. Hearing marked Held${
              form.outcome ? ` — ${form.outcome}` : ""
            }.`
          : conductedNo
            ? "Meeting record saved. The hearing is still scheduled."
            : "Meeting record saved."
      );
      // Handed back so the panel can keep any generated document in step
      // with what was just saved. The modal itself generates nothing.
      onSaved?.({
        hearingId: hearing.id,
        conducted: form.conducted,
        outcome: conductedYes ? form.outcome : null,
        agreements: form.agreements,
      });
      onClose?.();
    } catch {
      toast.error("Could not save the meeting record. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ResidentModal
      open={open}
      onClose={onClose}
      labelledBy="meeting-record-title"
      title={`Meeting Record — ${hearing.title || "Hearing"}`}
      maxWidthClass="max-w-3xl"
    >
      <div className="space-y-5 text-sm">
        <div>
          <span className="mb-1 block text-xs font-semibold text-muted">
            Was the meeting conducted?
          </span>
          <div className="grid gap-2 sm:grid-cols-3">
            {MEETING_CONDUCTED_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() =>
                  set({
                    conducted: option.value,
                    outcome: option.value === "Yes" ? form.outcome : "",
                  })
                }
                aria-pressed={form.conducted === option.value}
                className={`rounded-xl border px-3 py-2 text-left transition-colors ${
                  form.conducted === option.value
                    ? "border-secondary bg-info-soft"
                    : "border-line bg-white hover:bg-canvas"
                }`}
              >
                <span className="block text-sm font-semibold text-mirage">{option.label}</span>
                <span className="mt-0.5 block text-[11px] text-muted">{option.hint}</span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold text-muted">Attendance</span>
            <button
              type="button"
              onClick={() => setForm((prev) => ({ ...prev, rows: [...prev.rows, blankRow()] }))}
              disabled={form.rows.length >= 8}
              className="inline-flex items-center gap-1 rounded-full border border-line px-3 py-1 text-xs font-semibold text-secondary transition-colors hover:bg-info-soft disabled:opacity-50"
            >
              <Plus className="h-3 w-3" aria-hidden="true" />
              Add party
            </button>
          </div>

          <div className="space-y-2">
            {form.rows.length === 0 && (
              <p className="rounded-xl border border-dashed border-line px-3 py-3 text-xs text-muted">
                No party has been added. Leaving this empty records nothing about attendance; it
                does not record anyone as present or absent.
              </p>
            )}

            {form.rows.map((row, index) => (
              <div
                key={index}
                className="flex flex-wrap items-center gap-2 rounded-xl border border-line px-3 py-2"
              >
                <input
                  value={row.label}
                  onChange={(e) => updateRow(index, { label: e.target.value })}
                  placeholder="Full name or title"
                  className="h-10 min-w-[160px] flex-1 rounded-full border border-line bg-white px-4 text-sm text-mirage outline-none focus:border-secondary focus:ring-2 focus:ring-secondary/20"
                />

                <select
                  value={row.role}
                  onChange={(e) => updateRow(index, { role: e.target.value })}
                  aria-label="Party role"
                  className="h-10 rounded-full border border-line bg-white px-3 text-sm text-mirage outline-none focus:border-secondary"
                >
                  {ROLES.map((role) => (
                    <option key={role} value={role}>
                      {ROLE_LABELS[role]}
                    </option>
                  ))}
                </select>

                <select
                  value={row.status}
                  onChange={(e) => updateRow(index, { status: e.target.value, excuseReason: "" })}
                  aria-label="Attendance status"
                  className="h-10 rounded-full border border-line bg-white px-3 text-sm text-mirage outline-none focus:border-secondary"
                >
                  {ATTENDANCE_STATUS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>

                {row.status === "Excused" && (
                  <input
                    value={row.excuseReason}
                    onChange={(e) => updateRow(index, { excuseReason: e.target.value })}
                    placeholder="Reason for excusal"
                    className="h-10 min-w-[180px] flex-1 rounded-full border border-line bg-white px-4 text-sm text-mirage outline-none focus:border-secondary focus:ring-2 focus:ring-secondary/20"
                  />
                )}

                <button
                  type="button"
                  onClick={() =>
                    setForm((prev) => ({
                      ...prev,
                      rows: prev.rows.filter((_, i) => i !== index),
                    }))
                  }
                  disabled={form.rows.length <= 1}
                  aria-label="Remove party"
                  className="inline-flex h-10 w-10 items-center justify-center rounded-full text-muted transition-colors hover:bg-critical-soft hover:text-critical disabled:opacity-50"
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
        </div>

        {conductedYes && (
          <div>
            <label
              htmlFor="meeting-outcome"
              className="mb-1 block text-xs font-semibold text-muted"
            >
              Outcome
            </label>
            <select
              id="meeting-outcome"
              value={form.outcome}
              onChange={(e) => set({ outcome: e.target.value, outcomeExplanation: "" })}
              className="h-11 w-full rounded-xl border border-line bg-white px-3 text-sm text-mirage outline-none focus:border-secondary focus:ring-2 focus:ring-secondary/20"
            >
              <option value="">Select the recorded outcome</option>
              {MEETING_OUTCOME_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label} — {option.hint}
                </option>
              ))}
            </select>

            {form.outcome === "Other" && (
              <textarea
                value={form.outcomeExplanation}
                onChange={(e) => set({ outcomeExplanation: e.target.value })}
                rows={2}
                placeholder="Explain what the outcome actually was."
                className="mt-2 w-full rounded-xl border border-line bg-white px-4 py-3 text-sm text-mirage outline-none focus:border-secondary focus:ring-2 focus:ring-secondary/20"
              />
            )}

            {form.outcome === "Continued" && (
              <p className="mt-2 rounded-xl bg-info-soft px-3 py-2 text-xs text-mirage">
                A continued outcome does not schedule anything by itself. Schedule the next hearing
                as a separate recorded action so the original date is preserved.
              </p>
            )}

            {form.outcome === "Party failed to appear" && (
              <p className="mt-2 rounded-xl bg-info-soft px-3 py-2 text-xs text-mirage">
                This records what was observed. It does not count as a legal failure to appear, and
                it does not start any automatic consequence.
              </p>
            )}
          </div>
        )}

        {conductedNo && (
          <p className="rounded-xl bg-info-soft px-3 py-2 text-xs text-mirage">
            Recording the meeting as not conducted leaves the hearing scheduled. Use Reschedule or
            Cancel on the hearing itself if it will not go ahead.
          </p>
        )}

        <div>
          <label htmlFor="meeting-minutes" className="mb-1 block text-xs font-semibold text-muted">
            Minutes of the session
          </label>
          <textarea
            id="meeting-minutes"
            value={form.minutes}
            onChange={(e) => set({ minutes: e.target.value })}
            rows={4}
            placeholder="What was discussed, what was said by each party, and what was agreed."
            className="w-full rounded-xl border border-line bg-white px-4 py-3 text-sm text-mirage outline-none focus:border-secondary focus:ring-2 focus:ring-secondary/20"
          />
        </div>

        <div>
          <label
            htmlFor="meeting-agreements"
            className="mb-1 block text-xs font-semibold text-muted"
          >
            Agreements reached
          </label>
          <textarea
            id="meeting-agreements"
            value={form.agreements}
            onChange={(e) => set({ agreements: e.target.value })}
            rows={2}
            placeholder="Leave empty if nothing was agreed."
            className="w-full rounded-xl border border-line bg-white px-4 py-3 text-sm text-mirage outline-none focus:border-secondary focus:ring-2 focus:ring-secondary/20"
          />
        </div>

        <div>
          <label htmlFor="meeting-next-step" className="mb-1 block text-xs font-semibold text-muted">
            Next step agreed
          </label>
          <input
            id="meeting-next-step"
            value={form.nextStep}
            onChange={(e) => set({ nextStep: e.target.value })}
            placeholder="What happens next, as agreed at the meeting."
            className="h-11 w-full rounded-xl border border-line bg-white px-4 text-sm text-mirage outline-none focus:border-secondary focus:ring-2 focus:ring-secondary/20"
          />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="h-10 rounded-full border border-line px-4 text-sm font-semibold text-muted transition-colors hover:bg-canvas"
          >
            Cancel
          </button>
          <LoadingButton isLoading={saving} onClick={handleSave}>
            Save Meeting Record
          </LoadingButton>
        </div>
      </div>
    </ResidentModal>
  );
}