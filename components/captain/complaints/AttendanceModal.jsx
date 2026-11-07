"use client";

import { useMemo, useState } from "react";
import toast from "react-hot-toast";
import { Plus, Trash2 } from "lucide-react";
import ResidentModal from "@/components/shared/ResidentModal";
import LoadingButton from "@/components/shared/LoadingButton";
import { logComplaintActivity } from "@/lib/complaintQueries";
import { ATTENDANCE_STATUS_OPTIONS, recordHearingAttendance } from "@/lib/captainComplaintWorkflow";

const ROLES = ["complainant", "respondent", "witness", "lupon_member", "barangay_official", "other"];
const ROLE_LABELS = {
  complainant: "Complainant",
  respondent: "Respondent",
  witness: "Witness",
  lupon_member: "Lupon member",
  barangay_official: "Barangay official",
  other: "Other",
};

/**
 * Nothing is assumed. An empty row is "Not recorded", not "Present",
 * because a checkbox that starts ticked produces a record of an
 * appearance nobody witnessed.
 */
function blankRow() {
  return { label: "", role: "complainant", status: "Not recorded", excuseReason: "" };
}

function rowsFromExisting(existing) {
  if (!existing.length) return [blankRow(), blankRow()];
  return existing.map((row) => ({
    label: row.attendee_label || "",
    role: row.party_role || "other",
    status: row.attendance_status || "Not recorded",
    excuseReason: row.excuse_reason || "",
  }));
}

/**
 * Attendance only.
 *
 * This dialog records who was in the room and nothing else. It does not
 * mark the hearing held, does not write minutes, and does not treat
 * absence as failure: those are recorded separately in the Meeting
 * Record so that "no one came" and "the meeting never happened" stay
 * distinguishable.
 */
export default function AttendanceModal({
  open,
  onClose,
  supabase,
  complaint,
  hearing,
  // Changing this key rebuilds the party list for the hearing being
  // edited, so one hearing's rows are never carried into another.
  formKey = "",
  attendances = [],
  onSaved,
}) {
  const [rows, setRows] = useState(() => rowsFromExisting(attendances));
  const [saving, setSaving] = useState(false);

  const canSave = useMemo(() => open && Boolean(hearing), [open, hearing]);

  if (!canSave) return null;

  const update = (index, patch) =>
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  const handleSave = async () => {
    const named = rows.filter((row) => row.label.trim());
    if (named.length === 0) {
      toast.error("Name at least one party before saving.");
      return;
    }

    const labels = named.map((row) => row.label.trim().toLowerCase());
    if (new Set(labels).size !== labels.length) {
      toast.error("Each party can only appear once for this hearing.");
      return;
    }

    const excusedWithoutReason = named.find(
      (row) => row.status === "Excused" && !row.excuseReason.trim()
    );
    if (excusedWithoutReason) {
      toast.error(`${excusedWithoutReason.label.trim()} is excused but has no reason given.`);
      return;
    }

    setSaving(true);
    try {
      for (const row of named) {
        const result = await recordHearingAttendance(supabase, {
          complaintId: complaint.id,
          hearingId: hearing.id,
          partyRole: row.role,
          attendeeLabel: row.label,
          attendanceStatus: row.status,
          excuseReason: row.excuseReason,
        });
        if (!result.success) {
          toast.error(result.error);
          setSaving(false);
          return;
        }
      }

      await logComplaintActivity(supabase, {
        action: "hearing_attendance_recorded",
        complaintId: complaint.id,
        ref: complaint.reference_number || undefined,
        details: {
          hearing_id: hearing.id,
          recorded: named.length,
          // Never "attended: N". The old payload implied every saved
          // row was a person who showed up.
          statuses: named.map((row) => ({ party: row.label.trim(), status: row.status })),
        },
      });

      toast.success("Attendance recorded. The hearing status is unchanged.");
      setRows([blankRow(), blankRow()]);
      onSaved?.();
    } catch {
      toast.error("Could not save attendance. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ResidentModal
      open={open}
      onClose={onClose}
      labelledBy="attendance-title"
      title={`Record Attendance — ${hearing.title || "Hearing"}`}
      maxWidthClass="max-w-2xl"
    >
      <div className="space-y-4 text-sm">
        <p className="rounded-xl bg-info-soft px-4 py-3 text-xs text-mirage">
          This records attendance only. Whether the meeting was conducted, and what was decided,
          is saved separately in the Meeting Record. Anyone left as &ldquo;Not recorded&rdquo; stays
          unknown rather than being counted as present or absent.
        </p>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold text-muted">Parties</span>
            <button
              type="button"
              onClick={() => setRows((prev) => [...prev, blankRow()])}
              disabled={rows.length >= 8}
              className="inline-flex items-center gap-1 rounded-full border border-line px-3 py-1 text-xs font-semibold text-secondary transition-colors hover:bg-info-soft disabled:opacity-50"
            >
              <Plus className="h-3 w-3" aria-hidden="true" />
              Add party
            </button>
          </div>

          <div className="space-y-2">
            {rows.map((row, index) => (
              <div
                key={index}
                className="flex flex-wrap items-center gap-2 rounded-xl border border-line px-3 py-2"
              >
                <input
                  value={row.label}
                  onChange={(e) => update(index, { label: e.target.value })}
                  placeholder="Full name or title"
                  className="h-10 min-w-[160px] flex-1 rounded-full border border-line bg-white px-4 text-sm text-mirage outline-none focus:border-secondary focus:ring-2 focus:ring-secondary/20"
                />

                <select
                  value={row.role}
                  onChange={(e) => update(index, { role: e.target.value })}
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
                  onChange={(e) => update(index, { status: e.target.value, excuseReason: "" })}
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
                    onChange={(e) => update(index, { excuseReason: e.target.value })}
                    placeholder="Reason for excusal"
                    className="h-10 min-w-[180px] flex-1 rounded-full border border-line bg-white px-4 text-sm text-mirage outline-none focus:border-secondary focus:ring-2 focus:ring-secondary/20"
                  />
                )}

                <button
                  type="button"
                  onClick={() => setRows((prev) => prev.filter((_, i) => i !== index))}
                  disabled={rows.length <= 1}
                  aria-label="Remove party"
                  className="inline-flex h-10 w-10 items-center justify-center rounded-full text-muted transition-colors hover:bg-critical-soft hover:text-critical disabled:opacity-50"
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <LoadingButton isLoading={saving} onClick={handleSave}>
            Save Attendance
          </LoadingButton>
        </div>
      </div>
    </ResidentModal>
  );
}