"use client";

/**
 * Create a blotter record for this complaint, or link an existing one.
 *
 * A complaint can hold at most ONE open blotter record
 * (uq_blotter_active_per_complaint + the create RPC enforce this), so
 * this modal exists for the case where the record has not been made
 * yet. Creating here does not touch the Blotter Records page — it
 * writes through captain_create_blotter_record(), which assigns the
 * number, never fabricates a respondent name, and notifies the
 * complainant.
 */

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { FileText, Link2 } from "lucide-react";
import ResidentModal from "@/components/shared/ResidentModal";
import LoadingButton from "@/components/shared/LoadingButton";
import ConfirmDialog from "@/components/shared/ConfirmDialog";
import {
  createBlotterRecord,
  linkBlotterRecord,
} from "@/lib/captainComplaintRouting";

export default function BlotterModal({
  open,
  onClose,
  onSaved,
  complaint,
  supabase,
}) {
  const [mode, setMode] = useState("create");
  const [summary, setSummary] = useState(() => complaint?.description || "");
  const [date, setDate] = useState(
    () => complaint?.incident_date || ""
  );
  const [location, setLocation] = useState(
    () => complaint?.incident_location || ""
  );
  const [available, setAvailable] = useState([]);
  const [linkId, setLinkId] = useState("");
  const [linkReason, setLinkReason] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    if (!open || mode !== "link") return;

    supabase
      .from("blotter_records")
      .select("id, blotter_number, incident_summary, incident_date, recorded_at")
      .is("complaint_id", null)
      .eq("current_status", "open")
      .order("recorded_at", { ascending: false })
      .limit(50)
      .then(({ data }) => {
        setAvailable(data || []);
        if (data?.length) setLinkId(data[0].id);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode]);

  const reset = () => {
    setSummary("");
    setDate("");
    setLocation("");
    setMessage("");
    setError(null);
  };

  const attemptSave = () => {
    if (mode === "create") {
      if (!summary.trim()) {
        setError("Write an incident summary for the blotter record.");
        return;
      }
    } else {
      if (!linkId) {
        setError("Choose a blotter record to link.");
        return;
      }
      if (!linkReason.trim()) {
        setError("Record why this blotter entry belongs to this complaint.");
        return;
      }
    }
    if (message.trim().length > 500) {
      setError("Keep the resident message under 500 characters.");
      return;
    }
    setError(null);
    setConfirmOpen(true);
  };

  const save = async () => {
    setBusy(true);
    try {
      const result =
        mode === "create"
          ? await createBlotterRecord(supabase, {
              complaintId: complaint.id,
              incidentSummary: summary,
              incidentDate: date || null,
              incidentLocation: location,
              residentMessage: message,
            })
          : await linkBlotterRecord(supabase, {
              complaintId: complaint.id,
              blotterId: linkId,
              reason: linkReason,
            });

      if (!result.success) {
        setError(result.error);
        setConfirmOpen(false);
        return;
      }

      toast.success(
        mode === "create"
          ? `Blotter record ${result.data?.blotter_number || ""} created.`
          : "Blotter record linked to this complaint."
      );
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
        labelledBy="blotter-title"
        title="Digital Blotter Linkage"
        maxWidthClass="max-w-xl"
      >
        <div className="space-y-4 text-sm">
          <p className="rounded-xl bg-alt px-4 py-3 text-xs leading-relaxed text-mirage">
            A complaint can carry at most one open blotter record. At most one of these actions can
            apply — creating a new record, or linking an existing one that is not attached to any
            complaint yet.
          </p>

          {/* ── Mode switch ─────────────────────────────────────── */}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => {
                setMode("create");
                setError(null);
              }}
              className={`inline-flex h-11 items-center justify-center gap-2 rounded-full border text-xs font-semibold transition-colors ${
                mode === "create"
                  ? "border-secondary bg-info-soft text-secondary"
                  : "border-line bg-white text-mirage hover:bg-alt"
              }`}
            >
              <FileText className="h-4 w-4" aria-hidden="true" />
              Create new record
            </button>
            <button
              type="button"
              onClick={() => {
                setMode("link");
                setError(null);
              }}
              className={`inline-flex h-11 items-center justify-center gap-2 rounded-full border text-xs font-semibold transition-colors ${
                mode === "link"
                  ? "border-secondary bg-info-soft text-secondary"
                  : "border-line bg-white text-mirage hover:bg-alt"
              }`}
            >
              <Link2 className="h-4 w-4" aria-hidden="true" />
              Link existing record
            </button>
          </div>

          {mode === "create" ? (
            <>
              <div>
                <label htmlFor="blotter-summary" className="mb-1 block text-xs font-semibold text-muted">
                  Incident summary
                  <span className="ml-1 font-normal text-critical">(required)</span>
                </label>
                <textarea
                  id="blotter-summary"
                  value={summary}
                  onChange={(e) => {
                    setSummary(e.target.value);
                    setError(null);
                  }}
                  rows={3}
                  aria-invalid={Boolean(error) && !summary.trim()}
                  placeholder="What happened, when, and where in brief terms for the ledger."
                  className="w-full rounded-xl border border-line bg-white px-4 py-3 text-sm text-mirage outline-none focus:border-secondary focus:ring-2 focus:ring-secondary/20 aria-[invalid=true]:border-critical"
                />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="blotter-date" className="mb-1 block text-xs font-semibold text-muted">
                    Incident date
                    <span className="ml-1 font-normal text-muted">(optional)</span>
                  </label>
                  <input
                    id="blotter-date"
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="h-11 w-full rounded-full border border-line bg-white px-4 text-sm text-mirage outline-none focus:border-secondary focus:ring-2 focus:ring-secondary/20"
                  />
                </div>
                <div>
                  <label htmlFor="blotter-location" className="mb-1 block text-xs font-semibold text-muted">
                    Location
                    <span className="ml-1 font-normal text-muted">(optional)</span>
                  </label>
                  <input
                    id="blotter-location"
                    type="text"
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    placeholder="Barangay center, street corner..."
                    className="h-11 w-full rounded-full border border-line bg-white px-4 text-sm text-mirage outline-none focus:border-secondary focus:ring-2 focus:ring-secondary/20"
                  />
                </div>
              </div>

              <p className="rounded-xl bg-info-soft px-4 py-3 text-xs leading-relaxed text-mirage">
                The respondent on the ledger is never invented. If the other party is not
                identified, the record is opened without a respondent name — exactly as the case
                file states.
              </p>
            </>
          ) : (
            <>
              {available.length === 0 ? (
                <p className="rounded-xl bg-warning-soft px-4 py-3 text-xs font-semibold leading-relaxed text-warning">
                  No open blotter records are available to link. Create a new record instead, or
                  first record the blotter entry from the Blotter Records page.
                </p>
              ) : (
                <fieldset>
                  <legend className="mb-2 text-xs font-semibold text-muted">
                    Open blotter records not yet linked to a complaint
                  </legend>
                  <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
                    {available.map((record) => (
                      <label
                        key={record.id}
                        className={`flex items-start gap-2.5 rounded-2xl border px-4 py-3 transition-colors ${
                          linkId === record.id
                            ? "cursor-pointer border-secondary bg-info-soft"
                            : "cursor-pointer border-line bg-white hover:bg-alt"
                        }`}
                      >
                        <input
                          type="radio"
                          name="blotter-link"
                          value={record.id}
                          checked={linkId === record.id}
                          onChange={() => {
                            setLinkId(record.id);
                            setError(null);
                          }}
                          className="mt-1 h-4 w-4 shrink-0 border-line accent-[#1b4c8c]"
                        />
                        <span className="min-w-0">
                          <span className="text-sm font-semibold text-navy">
                            {record.blotter_number}
                          </span>
                          <span className="mt-0.5 block text-xs leading-relaxed text-muted">
                            {record.incident_summary}
                            {record.incident_date ? ` · ${record.incident_date}` : ""}
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              )}

              <FieldInput
                id="blotter-link-reason"
                label="Why this entry belongs to this complaint"
                required
                value={linkReason}
                onChange={(v) => {
                  setLinkReason(v);
                  setError(null);
                }}
                invalid={Boolean(error) && !linkReason.trim()}
                placeholder="Matches the incident already described in the case file; recorded for the same matter."
              />
            </>
          )}

          <div>
            <label htmlFor="blotter-message" className="mb-1 block text-xs font-semibold text-muted">
              Message to the complainant
              <span className="ml-1 font-normal text-muted">(optional)</span>
            </label>
            <textarea
              id="blotter-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={2}
              maxLength={500}
              placeholder="Leave blank to use the standard wording."
              className="w-full rounded-xl border border-line bg-white px-4 py-3 text-sm text-mirage outline-none focus:border-secondary focus:ring-2 focus:ring-secondary/20"
            />
          </div>

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
              {mode === "create" ? "Create Blotter Record" : "Link Blotter Record"}
            </LoadingButton>
          </div>
        </div>
      </ResidentModal>

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={save}
        title={mode === "create" ? "Open this blotter record?" : "Link this blotter record?"}
        message={
          mode === "create"
            ? "A new record will be opened for this complaint. It is added permanently to the routing history and notifies the complainant."
            : "This links the existing entry to the complaint. The link is recorded in the routing history."
        }
        confirmLabel={mode === "create" ? "Create Record" : "Link Record"}
        busy={busy}
      >
        {mode === "link" ? (
          <p className="mt-3 rounded-xl bg-alt px-4 py-3 text-xs leading-relaxed text-muted">
            Record:{" "}
            {available.find((r) => r.id === linkId)?.blotter_number || linkId}
          </p>
        ) : null}
      </ConfirmDialog>
    </>
  );
}

function FieldInput({
  id,
  label,
  value,
  onChange,
  required = false,
  invalid = false,
  placeholder,
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
        rows={2}
        aria-invalid={invalid}
        placeholder={placeholder}
        className="w-full rounded-xl border border-line bg-white px-4 py-3 text-sm text-mirage outline-none focus:border-secondary focus:ring-2 focus:ring-secondary/20 aria-[invalid=true]:border-critical"
      />
    </div>
  );
}