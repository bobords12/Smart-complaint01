"use client";

import { useState } from "react";
import toast from "react-hot-toast";
import ResidentModal from "@/components/shared/ResidentModal";
import LoadingButton from "@/components/shared/LoadingButton";
import { logComplaintActivity } from "@/lib/complaintQueries";

const MAX_NOTE_LENGTH = 2000;

export default function InternalNoteModal({ open, onClose, onSaved, complaint, supabase, user }) {
  const [message, setMessage] = useState("");
  const [visible, setVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const close = () => {
    if (saving) return;
    setMessage("");
    setVisible(false);
    setError(null);
    onClose();
  };

  const handleSave = async () => {
    const note = message.trim();
    if (!note) {
      setError("Write the note before saving.");
      return;
    }
    if (note.length > MAX_NOTE_LENGTH) {
      setError(`Keep the note under ${MAX_NOTE_LENGTH} characters.`);
      return;
    }

    setError(null);
    setSaving(true);
    try {
      // internal_notes columns (see supabase/manual/20_complaints_case_viewer.sql):
      // note / is_resident_visible / author_id, with note_type constrained to
      // ('general','external_coordination','risk_flag','critical_advisory').
      const { data: inserted, error: insertError } = await supabase
        .from("internal_notes")
        .insert({
          complaint_id: complaint.id,
          note,
          note_type: "general",
          is_resident_visible: visible,
          author_id: user?.id || null,
        })
        .select("id, is_resident_visible")
        .single();
      if (insertError) {
        toast.error(
          "Notes are not available yet. Confirm the case-viewer schema migration is applied."
        );
        return;
      }
      if (!inserted?.id) {
        toast.error("Could not save the note.");
        return;
      }

      await logComplaintActivity(supabase, {
        action: "note_added",
        complaintId: complaint.id,
        ref: complaint.reference_number || undefined,
        details: { is_resident_visible: visible, note_length: note.length },
      });

      toast.success(
        visible
          ? "Notice added. Residents can see it."
          : "Internal note saved. Not visible to residents."
      );
      setMessage("");
      setVisible(false);
      onSaved(inserted);
    } catch {
      toast.error("Could not save the note.");
    } finally {
      setSaving(false);
    }
  };

  const remaining = MAX_NOTE_LENGTH - message.length;

  return (
    <ResidentModal
      open={open}
      onClose={close}
      labelledBy="note-title"
      title="Add a note to this case"
      maxWidthClass="max-w-md"
    >
      <div className="space-y-4 text-sm">
        <div>
          <label htmlFor="internal-note" className="mb-1 block text-xs font-semibold text-muted">
            Note
          </label>
          <textarea
            id="internal-note"
            value={message}
            onChange={(e) => setMessage(e.target.value.slice(0, MAX_NOTE_LENGTH))}
            rows={4}
            autoFocus
            aria-invalid={Boolean(error)}
            aria-describedby={error ? "internal-note-error" : "internal-note-hint"}
            placeholder="Findings, reminders, or next steps…"
            className="w-full rounded-xl border border-line bg-white px-4 py-3 text-sm text-mirage outline-none focus:border-secondary focus:ring-2 focus:ring-secondary/20 aria-[invalid=true]:border-critical"
          />
          <p id="internal-note-hint" className="mt-1 text-[11px] text-muted">
            {remaining.toLocaleString()} characters remaining
          </p>
        </div>

        <label htmlFor="internal-note-visible" className="flex items-start gap-2.5 text-mirage">
          <input
            id="internal-note-visible"
            type="checkbox"
            checked={visible}
            onChange={(e) => setVisible(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-line accent-[#1b4c8c]"
          />
          Share with the parties (shows as a notice to residents).
        </label>

        {error ? (
          <p
            id="internal-note-error"
            role="alert"
            className="rounded-xl bg-critical-soft px-4 py-3 text-xs font-semibold text-critical"
          >
            {error}
          </p>
        ) : null}

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={close}
            disabled={saving}
            className="inline-flex h-11 items-center justify-center rounded-full border border-line px-5 text-sm font-semibold text-mirage transition-colors hover:bg-alt disabled:opacity-60"
          >
            Cancel
          </button>
          <LoadingButton
            isLoading={saving}
            onClick={handleSave}
            disabled={saving || !message.trim()}
          >
            Save Note
          </LoadingButton>
        </div>
      </div>
    </ResidentModal>
  );
}
