"use client";

import { useState } from "react";
import toast from "react-hot-toast";
import ResidentModal from "@/components/shared/ResidentModal";
import LoadingButton from "@/components/shared/LoadingButton";
import { logComplaintActivity, notifyResidentHearingEvent } from "@/lib/complaintQueries";
import { cancelHearing, rescheduleHearing } from "@/lib/captainComplaintWorkflow";

/**
 * Reschedule or cancel one scheduled hearing.
 *
 * Rescheduling does not overwrite the original. The original hearing is
 * marked Rescheduled and a new one is created, cross-linked both ways,
 * so the date that was originally set stays visible in the record.
 *
 * Cancelling requires a written reason. A hearing that silently
 * disappears from the case is indistinguishable from one that never
 * existed.
 */
export default function HearingLifecycleModal({
  open,
  mode = "reschedule",
  onClose,
  supabase,
  complaint,
  hearing,
  onSaved,
}) {
  const [date, setDate] = useState(hearing?.hearing_date || "");
  const [time, setTime] = useState(hearing?.hearing_time ? String(hearing.hearing_time).slice(0, 5) : "");
  const [venue, setVenue] = useState(hearing?.venue || "");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  if (!open || !hearing) return null;

  const cancelling = mode === "cancel";

  /**
   * A rescheduled session may not land before the complaint was filed —
   * the same guard the scheduling form applies, so a stray year cannot be
   * introduced through the reschedule path either.
   */
  const earliestDate = String(
    complaint?.submitted_at || complaint?.incident_date || ""
  ).slice(0, 10);

  const handleSave = async () => {
    if (!cancelling && earliestDate && date && date < earliestDate) {
      toast.error(
        `A hearing cannot be set before the complaint was filed (${earliestDate}).`
      );
      return;
    }
    setSaving(true);
    try {
      const result =
        mode === "cancel"
          ? await cancelHearing(supabase, { hearingId: hearing.id, reason })
          : await rescheduleHearing(supabase, {
              hearingId: hearing.id,
              date,
              time,
              venue,
            });

      if (!result.success) {
        toast.error(result.error);
        setSaving(false);
        return;
      }

      try {
        await logComplaintActivity(supabase, {
          action: mode === "cancel" ? "hearing_cancelled" : "hearing_rescheduled",
          complaintId: complaint.id,
          ref: complaint.reference_number || undefined,
          details: {
            hearing_id: hearing.id,
            from_date: hearing.hearing_date,
            from_time: hearing.hearing_time,
            to_date: mode === "cancel" ? null : date,
            to_time: mode === "cancel" ? null : time,
            reason: mode === "cancel" ? reason.trim() : null,
          },
        });
      } catch {
        // The change is already committed. Do not report failure for an
        // audit write that did not land.
      }

      /**
       * Tell the complainant. This runs after the commit and after the
       * audit write, and its own failure is swallowed, so a notification
       * that did not go out can never be mistaken for a failed schedule.
       *
       * A reschedule is announced against the NEW hearing, because that is
       * the row the resident's portal will open when they click through.
       */
      try {
        await notifyResidentHearingEvent(
          supabase,
          complaint.id,
          complaint.resident_id,
          cancelling
            ? hearing
            : {
                id: result.newHearingId || hearing.id,
                title: hearing.title,
                hearing_type: hearing.hearing_type,
                hearing_date: date,
                hearing_time: time,
                venue,
              },
          cancelling ? "cancelled" : "rescheduled"
        );
      } catch {
        // Non-fatal: the schedule itself is already saved.
      }

      toast.success(
        mode === "cancel"
          ? "Hearing cancelled. The original hearing and its reason stay on the record."
          : "Hearing rescheduled. The original date is preserved."
      );
      setReason("");
      onSaved?.();
      onClose?.();
    } finally {
      setSaving(false);
    }
  };

  return (
    <ResidentModal
      open={open}
      onClose={onClose}
      labelledBy={cancelling ? "cancel-hearing-title" : "reschedule-hearing-title"}
      title={
        cancelling
          ? `Cancel Hearing — ${hearing.title || "Hearing"}`
          : `Reschedule Hearing — ${hearing.title || "Hearing"}`
      }
      maxWidthClass="max-w-lg"
    >
      <div className="space-y-4 text-sm">
        <p className="rounded-xl bg-info-soft px-4 py-3 text-xs text-mirage">
          {cancelling
            ? "This hearing stays on the case as Cancelled with the reason you give. It is not deleted, and no record of it is overwritten."
            : "The original hearing is kept as Rescheduled and a new hearing is created for the new date. Both stay linked on the case."}
        </p>

        {cancelling ? (
          <div>
            <label htmlFor="cancel-reason" className="mb-1 block text-xs font-semibold text-muted">
              Reason for cancellation
            </label>
            <textarea
              id="cancel-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="Why is this hearing being cancelled?"
              className="w-full rounded-xl border border-line bg-white px-4 py-3 text-sm text-mirage outline-none focus:border-secondary focus:ring-2 focus:ring-secondary/20"
            />
          </div>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="reschedule-date"
                  className="mb-1 block text-xs font-semibold text-muted"
                >
                  New date
                </label>
                <input
                  id="reschedule-date"
                  type="date"
                  value={date || ""}
                  onChange={(e) => setDate(e.target.value)}
                  className="h-11 w-full rounded-xl border border-line bg-white px-3 text-sm text-mirage outline-none focus:border-secondary focus:ring-2 focus:ring-secondary/20"
                />
              </div>
              <div>
                <label
                  htmlFor="reschedule-time"
                  className="mb-1 block text-xs font-semibold text-muted"
                >
                  New time
                </label>
                <input
                  id="reschedule-time"
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  className="h-11 w-full rounded-xl border border-line bg-white px-3 text-sm text-mirage outline-none focus:border-secondary focus:ring-2 focus:ring-secondary/20"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="reschedule-venue"
                className="mb-1 block text-xs font-semibold text-muted"
              >
                Venue
              </label>
              <input
                id="reschedule-venue"
                value={venue}
                onChange={(e) => setVenue(e.target.value)}
                placeholder="Where will this hearing be held?"
                className="h-11 w-full rounded-xl border border-line bg-white px-4 text-sm text-mirage outline-none focus:border-secondary focus:ring-2 focus:ring-secondary/20"
              />
            </div>
          </>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="h-10 rounded-full border border-line px-4 text-sm font-semibold text-muted transition-colors hover:bg-canvas"
          >
            Close
          </button>
          <LoadingButton isLoading={saving} onClick={handleSave}>
            {cancelling ? "Cancel Hearing" : "Reschedule Hearing"}
          </LoadingButton>
        </div>
      </div>
    </ResidentModal>
  );
}