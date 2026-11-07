"use client";

import { useState } from "react";
import toast from "react-hot-toast";
import ResidentModal from "@/components/shared/ResidentModal";
import LoadingButton from "@/components/shared/LoadingButton";
import { logComplaintActivity } from "@/lib/complaintQueries";

const MODES = ["Personal", "Substituted", "By authorized person", "Refused", "Not found"];

const PARTY_LABELS = {
  complainant: "Complainant",
  respondent: "Respondent",
};

const initialForm = {
  party_role: "complainant",
  party_label: "",
  served_on: "",
  mode_of_service: "Personal",
  served_to: "",
  acknowledged: false,
  acknowledged_on: "",
  acknowledged_by: "",
  notes: "",
};

/**
 * Proof-of-service recorder for the Notice of Hearing.
 *
 * Shared by the Hearings & Notice section and the Hearings section, so every
 * prop beyond the original set is optional and the existing hearings call
 * site keeps working unchanged:
 *
 *   user              the recording official, written to served_by so the
 *                     case file can show who recorded the service
 *   initialPartyRole  preselects the party, for when each party has its own
 *                     button instead of one combined dialog. Callers that
 *                     switch the party from outside should mount this with
 *                     `key={partyRole}` so it starts on a clean form.
 *   lockParty         hides the party selector when the opening button has
 *                     already fixed the party
 *   title             heading override
 *   submitLabel       button label override
 */
export default function ServiceModal({
  open,
  onClose,
  supabase,
  complaint,
  summons,
  onSaved,
  user,
  initialPartyRole = "complainant",
  lockParty = false,
  title,
  submitLabel,
}) {
  const blankForm = { ...initialForm, party_role: initialPartyRole };
  const [form, setForm] = useState(blankForm);
  const [saving, setSaving] = useState(false);

  const update = (patch) => setForm((prev) => ({ ...prev, ...patch }));

  const partyLabel = PARTY_LABELS[form.party_role] || form.party_role;

  const handleSave = async () => {
    if (!form.served_on) {
      toast.error("Select the service date.");
      return;
    }
    if (!form.served_to.trim() && !form.party_label.trim()) {
      toast.error("Identify who was served.");
      return;
    }
    // Acknowledgment is a recorded event with its own date and its own
    // person. It is never inferred from the wording of the notes, which is
    // what the case file used to do: a note containing "received" was read
    // as an acknowledgment, and a real acknowledgment phrased differently
    // was missed.
    if (form.acknowledged && !form.acknowledged_on) {
      toast.error("Enter the date the party acknowledged the Notice of Hearing.");
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.from("summons_service_records").insert({
        complaint_id: complaint.id,
        summons_id: summons?.id || null,
        party_role: form.party_role,
        party_label: form.party_label.trim() || partyLabel,
        mode_of_service: form.mode_of_service,
        served_on: form.served_on,
        served_to: form.served_to.trim() || null,
        // Null, never a guess. An unchecked box means the party has not
        // acknowledged, which is different from not having been asked.
        acknowledged_on: form.acknowledged ? form.acknowledged_on : null,
        acknowledged_by: form.acknowledged ? form.acknowledged_by.trim() || null : null,
        notes: form.notes.trim() || null,
        served_by: user?.id || null,
      });
      if (error) {
        toast.error("Service could not be recorded. Confirm the case-viewer schema migration is applied.");
        return;
      }

      await logComplaintActivity(supabase, {
        action: "summons_service_recorded",
        complaintId: complaint.id,
        ref: complaint.reference_number || undefined,
        details: {
          party_role: form.party_role,
          mode: form.mode_of_service,
          served_on: form.served_on,
          served_to: form.served_to.trim() || null,
          acknowledged_on: form.acknowledged ? form.acknowledged_on : null,
          acknowledged_by: form.acknowledged ? form.acknowledged_by.trim() || null : null,
          recorded_by: user?.id || null,
        },
      });

      toast.success(
        form.acknowledged
          ? `Service recorded and acknowledgment dated ${form.acknowledged_on} for the ${partyLabel.toLowerCase()}.`
          : `Proof of service recorded for the ${partyLabel.toLowerCase()}. No acknowledgment has been recorded.`
      );
      setForm(blankForm);
      onSaved();
    } catch {
      toast.error("Could not record service.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ResidentModal
      open={open}
      onClose={onClose}
      labelledBy="service-title"
      title={title || "Record Proof of Service"}
      maxWidthClass="max-w-md"
    >
      <div className="space-y-4 text-sm">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className={lockParty ? "hidden" : undefined}>
            <label className="mb-1 block text-xs font-semibold text-muted">Party served</label>
            <select
              value={form.party_role}
              onChange={(e) => update({ party_role: e.target.value })}
              className="h-11 w-full rounded-full border border-line bg-white px-4 text-sm text-mirage outline-none focus:border-secondary"
            >
              <option value="complainant">Complainant</option>
              <option value="respondent">Respondent</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-muted">Mode of service</label>
            <select
              value={form.mode_of_service}
              onChange={(e) => update({ mode_of_service: e.target.value })}
              className="h-11 w-full rounded-full border border-line bg-white px-4 text-sm text-mirage outline-none focus:border-secondary"
            >
              {MODES.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-semibold text-muted">Service date</label>
            <input
              type="date"
              value={form.served_on}
              onChange={(e) => update({ served_on: e.target.value })}
              className="h-11 w-full rounded-full border border-line bg-white px-4 text-sm text-mirage outline-none focus:border-secondary"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-muted">Served to</label>
            <input
              value={form.served_to}
              onChange={(e) => update({ served_to: e.target.value })}
              placeholder="Name / relationship"
              className="h-11 w-full rounded-full border border-line bg-white px-4 text-sm text-mirage outline-none focus:border-secondary"
            />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-muted">Party label (optional)</label>
          <input
            value={form.party_label}
            onChange={(e) => update({ party_label: e.target.value })}
            placeholder={`e.g., ${partyLabel} (Maria Dela Cruz)`}
            className="h-11 w-full rounded-full border border-line bg-white px-4 text-sm text-mirage outline-none focus:border-secondary"
          />
        </div>
        {/* Acknowledgment, recorded explicitly. */}
        <div className="rounded-xl border border-line px-3 py-3">
          <label className="flex items-start gap-2.5 text-sm text-mirage">
            <input
              type="checkbox"
              checked={form.acknowledged}
              onChange={(e) => update({ acknowledged: e.target.checked })}
              className="mt-0.5 h-4 w-4 rounded border-line accent-[#17774e]"
            />
            The {partyLabel.toLowerCase()} has acknowledged receiving the Notice of Hearing.
          </label>

          {form.acknowledged ? (
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="acknowledged-on"
                  className="mb-1 block text-xs font-semibold text-muted"
                >
                  Acknowledged on
                </label>
                <input
                  id="acknowledged-on"
                  type="date"
                  value={form.acknowledged_on}
                  onChange={(e) => update({ acknowledged_on: e.target.value })}
                  className="h-11 w-full rounded-full border border-line bg-white px-4 text-sm text-mirage outline-none focus:border-secondary"
                />
              </div>
              <div>
                <label
                  htmlFor="acknowledged-by"
                  className="mb-1 block text-xs font-semibold text-muted"
                >
                  Acknowledged by
                </label>
                <input
                  id="acknowledged-by"
                  value={form.acknowledged_by}
                  onChange={(e) => update({ acknowledged_by: e.target.value })}
                  placeholder="Name of the person who acknowledged"
                  className="h-11 w-full rounded-full border border-line bg-white px-4 text-sm text-mirage outline-none focus:border-secondary"
                />
              </div>
            </div>
          ) : null}

          <p className="mt-2 text-[11px] leading-relaxed text-muted">
            Leave this unticked if the party has not acknowledged. Nothing is inferred from the
            notes below.
          </p>
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold text-muted">Notes</label>
          <textarea
            value={form.notes}
            onChange={(e) => update({ notes: e.target.value })}
            rows={2}
            className="w-full rounded-xl border border-line bg-white px-4 py-3 text-sm text-mirage outline-none focus:border-secondary"
          />
        </div>
        <p className="text-xs text-muted">
          Recording service does not start the 15-day period. That period starts at the first
          mediation meeting recorded as conducted.
        </p>
        <div className="flex justify-end pt-2">
          <LoadingButton isLoading={saving} onClick={handleSave}>
            {submitLabel || "Record Service"}
          </LoadingButton>
        </div>
      </div>
    </ResidentModal>
  );
}