"use client";

/**
 * Incident specifics for a reported-incident complaint.
 *
 * Only reachable for cases whose complaint_nature is "reported
 * incident" or whose route is a referral/incident pathway. Captures
 * exactly what a police report would need: property, identifiers,
 * witnesses, CCTV, evidence, safety concerns, and whether the resident
 * already reported it elsewhere.
 *
 * Written only through captain_save_incident_details(); the record is
 * read by officials from the Routing tab.
 */

import { useState } from "react";
import toast from "react-hot-toast";
import { Camera, ShieldAlert } from "lucide-react";
import ResidentModal from "@/components/shared/ResidentModal";
import LoadingButton from "@/components/shared/LoadingButton";
import ConfirmDialog from "@/components/shared/ConfirmDialog";
import { saveIncidentDetails } from "@/lib/captainComplaintRouting";

function toLocalInput(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 16);
}

export default function IncidentDetailsModal({
  open,
  onClose,
  onSaved,
  complaint,
  supabase,
  incident,
}) {
  const [form, setForm] = useState(() => initialFormFrom(incident));
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const set = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }));
    setError(null);
  };

  const reset = () => setForm({});

  const attemptSave = () => {
    setError(null);
    setConfirmOpen(true);
  };

  const save = async () => {
    setBusy(true);
    try {
      const result = await saveIncidentDetails(supabase, complaint.id, form);
      if (!result.success) {
        setError(result.error);
        setConfirmOpen(false);
        return;
      }
      toast.success("Incident details recorded.");
      setConfirmOpen(false);
      reset();
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
        labelledBy="incident-title"
        title="Incident Details"
        maxWidthClass="max-w-2xl"
      >
        <div className="space-y-4 text-sm">
          <p className="rounded-xl bg-alt px-4 py-3 text-xs leading-relaxed text-mirage">
            For a reported incident there is no one to summon. These details are what the barangay
            records for the case file and for a possible blotter record. Nothing here is shared
            with a respondent — there is no respondent to share it with.
          </p>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <TextField label="Property / item involved" value={form.property_description} onChange={(v) => set("property_description", v)} placeholder="Bicycle, delivery vehicle, cash box..." />
            <TextField label="Estimated value (if known)" value={form.incident_value} onChange={(v) => set("incident_value", v)} placeholder="Optional" />
          </div>

          <Field label="Proof of ownership" value={form.proof_of_ownership} onChange={(v) => set("proof_of_ownership", v)} placeholder="OR/CR, receipt, warranty card, photo..." rows={2} />

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <TextField label="Plate number" value={form.plate_number} onChange={(v) => set("plate_number", v)} placeholder="If a vehicle" />
            <TextField label="Serial number" value={form.serial_number} onChange={(v) => set("serial_number", v)} placeholder="If known" />
            <TextField label="Engine / chassis number" value={form.engine_chassis_number} onChange={(v) => set("engine_chassis_number", v)} placeholder="If known" />
          </div>

          <Field label="Marks / distinguishing features" value={form.identifiable_marks} onChange={(v) => set("identifiable_marks", v)} placeholder="Dents, stickers, color, damage..." rows={2} />

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <TextField label="Last known location" value={form.last_known_location} onChange={(v) => set("last_known_location", v)} placeholder="Where the item was last seen" />
            <div>
              <label htmlFor="incident-last-known-at" className="mb-1 block text-xs font-semibold text-muted">
                Last seen when
                <span className="ml-1 font-normal text-muted">(optional)</span>
              </label>
              <input
                id="incident-last-known-at"
                type="datetime-local"
                value={toLocalInput(form.last_known_at)}
                onChange={(e) => set("last_known_at", e.target.value ? new Date(e.target.value).toISOString() : null)}
                className="h-11 w-full rounded-full border border-line bg-white px-4 text-sm text-mirage outline-none focus:border-secondary focus:ring-2 focus:ring-secondary/20"
              />
            </div>
          </div>

          <Field label="Persons present / witnesses" value={form.witnesses} onChange={(v) => set("witnesses", v)} placeholder="If known" rows={2} />

          <div className="rounded-2xl border border-line px-4 py-3">
            <label htmlFor="incident-cctv" className="flex items-start gap-2.5 text-mirage">
              <input
                id="incident-cctv"
                type="checkbox"
                checked={Boolean(form.cctv_available)}
                onChange={(e) => set("cctv_available", e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-line accent-[#1b4c8c]"
              />
              <Camera className="mt-0.5 h-4 w-4 text-secondary" aria-hidden="true" />
              <span className="font-semibold">CCTV footage may exist.</span>
            </label>
            {form.cctv_available ? (
              <div className="mt-3">
                <Field label="Where the CCTV might be" value={form.cctv_notes} onChange={(v) => set("cctv_notes", v)} placeholder="Nearest storefront cameras, barangay post, traffic cam..." rows={2} />
              </div>
            ) : null}
          </div>

          <Field label="Evidence notes" value={form.evidence_notes} onChange={(v) => set("evidence_notes", v)} placeholder="Receipts, damaged item, screenshots — anything retained" rows={2} />

          <div className="rounded-2xl border border-line px-4 py-3">
            <label htmlFor="incident-safety" className="flex items-start gap-2.5 text-mirage">
              <input
                id="incident-safety"
                type="checkbox"
                checked={Boolean(form.safety_concern)}
                onChange={(e) => set("safety_concern", e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-line accent-[#1b4c8c]"
              />
              <ShieldAlert className="mt-0.5 h-4 w-4 text-warning" aria-hidden="true" />
              <span className="font-semibold text-warning">The complainant raised a safety concern.</span>
            </label>
            {form.safety_concern ? (
              <div className="mt-3">
                <Field label="Safety concern" value={form.safety_notes} onChange={(v) => set("safety_notes", v)} placeholder="Threats, fear of the person involved, need for help — do not invent contact details" rows={2} />
              </div>
            ) : null}
          </div>

          <div className="rounded-2xl border border-line px-4 py-3">
            <label htmlFor="incident-reported" className="flex items-start gap-2.5 text-mirage">
              <input
                id="incident-reported"
                type="checkbox"
                checked={Boolean(form.already_reported_externally)}
                onChange={(e) => set("already_reported_externally", e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-line accent-[#1b4c8c]"
              />
              <span className="font-semibold">The complainant already reported this elsewhere.</span>
            </label>
            {form.already_reported_externally ? (
              <div className="mt-3 space-y-3">
                <TextField label="Where it was reported" value={form.externally_reported_where} onChange={(v) => set("externally_reported_where", v)} placeholder="PNP station, NBI, barangay, online..." />
                <TextField label="Their reference (if given)" value={form.external_reference} onChange={(v) => set("external_reference", v)} placeholder="Only if actually issued" />
              </div>
            ) : null}
          </div>

          <Field label="Any other incident details" value={form.incident_details_other} onChange={(v) => set("incident_details_other", v)} rows={2} placeholder="Optional" />

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
              Save Incident Details
            </LoadingButton>
          </div>
        </div>
      </ResidentModal>

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={save}
        title="Save these incident details?"
        message="This updates the incident record for this complaint. It is recorded in the routing history."
        confirmLabel="Save Details"
        busy={busy}
      >
        {complaint?.persons_involved ? (
          <p className="mt-3 rounded-xl bg-alt px-4 py-3 text-xs leading-relaxed text-muted">
            What was filed: {complaint.persons_involved}
          </p>
        ) : null}
      </ConfirmDialog>
    </>
  );
}

function initialFormFrom(base) {
  const inc = base || {};
  return {
    property_description: inc.property_description || "",
    incident_value: inc.incident_value || "",
    proof_of_ownership: inc.proof_of_ownership || "",
    plate_number: inc.plate_number || "",
    serial_number: inc.serial_number || "",
    engine_chassis_number: inc.engine_chassis_number || "",
    identifiable_marks: inc.identifiable_marks || "",
    last_known_location: inc.last_known_location || "",
    last_known_at: inc.last_known_at || "",
    witnesses: inc.witnesses || "",
    cctv_available: Boolean(inc.cctv_available),
    cctv_notes: inc.cctv_notes || "",
    evidence_notes: inc.evidence_notes || "",
    safety_concern: Boolean(inc.safety_concern),
    safety_notes: inc.safety_notes || "",
    already_reported_externally: Boolean(inc.already_reported_externally),
    externally_reported_where: inc.externally_reported_where || "",
    external_reference: inc.external_reference || "",
    incident_details_other: inc.incident_details_other || "",
  };
}

function Field({ label, value, onChange, placeholder, rows = 2 }) {
  return (
    <div>
      <label htmlFor={label} className="mb-1 block text-xs font-semibold text-muted">
        {label}
        <span className="ml-1 font-normal text-muted">(optional)</span>
      </label>
      <textarea
        id={label}
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        placeholder={placeholder}
        className="w-full rounded-xl border border-line bg-white px-4 py-3 text-sm text-mirage outline-none focus:border-secondary focus:ring-2 focus:ring-secondary/20"
      />
    </div>
  );
}

function TextField({ label, value, onChange, placeholder }) {
  return (
    <div>
      <label htmlFor={label} className="mb-1 block text-xs font-semibold text-muted">
        {label}
        <span className="ml-1 font-normal text-muted">(optional)</span>
      </label>
      <input
        id={label}
        type="text"
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-11 w-full rounded-full border border-line bg-white px-4 text-sm text-mirage outline-none focus:border-secondary focus:ring-2 focus:ring-secondary/20"
      />
    </div>
  );
}