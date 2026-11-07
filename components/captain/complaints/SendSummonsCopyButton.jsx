"use client";

/**
 * Captain Portal -> Complaints: send the Notice of Hearing to the
 * complainant.
 *
 * SECTION 14 OF THE REQUEST, implemented against what already exists.
 * There is no separate document-delivery system in this application and
 * none was added. The delivery mechanism used here is the existing
 * `notifications` table, which the RLS policy "Officials insert
 * notifications" already permits for the captain role, so the
 * complainant receives the copy through the account workflow they
 * already have.
 *
 * What is sent is the one Notice of Hearing that names both parties, so
 * the complainant's copy and the barangay's copy are the same file.
 *
 * The button is only offered when that document actually exists — either
 * an issued `summons` row (the issuance ledger it points at now holds the
 * notice) or an active `hearing_notice` document — so the Captain is never
 * asked to send a document the barangay has not produced. The `sendSummonsCopyToComplainant`
 * action and its stored `summons_copy_sent_to_complainant` audit key keep
 * their historical names: they are read back to derive this state.
 * No Resident Portal page is modified by this component.
 */

import { useState } from "react";
import toast from "react-hot-toast";
import { Send } from "lucide-react";
import { sendSummonsCopyToComplainant } from "@/lib/captainComplaintWorkflow";
import { PrimaryAction, WorkflowNote } from "./captainWorkflowUi";

export default function SendSummonsCopyButton({
  supabase,
  complaint,
  summonsRow,
  documentRow,
  hearingId,
  onSent,
  alreadySent = false,
}) {
  const [sending, setSending] = useState(false);
  // Seeded from the case file so a copy that was sent on an earlier visit
  // reads as sent after a reload instead of offering to send it again.
  const [sent, setSent] = useState(alreadySent);
  const [error, setError] = useState(null);

  const copyExists = Boolean(summonsRow || documentRow);

  if (!copyExists) {
    return (
      <WorkflowNote tone="neutral">
        No copy is available to send yet. The action becomes available once the Notice of Hearing
        has been generated or issued for this complaint.
      </WorkflowNote>
    );
  }

  const handleSend = async () => {
    if (sending) return;
    setSending(true);
    setError(null);
    const result = await sendSummonsCopyToComplainant(supabase, {
      complaint,
      summonsRow,
      documentRow,
      hearingId,
    });
    setSending(false);

    if (!result.success) {
      setError(result.error);
      toast.error(result.error);
      return;
    }
    setSent(true);
    toast.success("Notice of Hearing sent to complainant.");
    onSent?.();
  };

  return (
    <div className="space-y-2">
      <PrimaryAction
        onClick={handleSend}
        disabled={sending || sent}
        title={sent ? "A copy notification has already been sent." : undefined}
      >
        <Send className="h-4 w-4" aria-hidden="true" />
        {sent
          ? "Notice of Hearing Sent"
          : sending
            ? "Sending…"
            : "Send Notice of Hearing to Complainant"}
      </PrimaryAction>

      {sent ? (
        <WorkflowNote tone="ok">
          Notice of Hearing sent to complainant. The notification appears in the
          complainant&rsquo;s account alongside the complaint record.
        </WorkflowNote>
      ) : null}

      {error ? <WorkflowNote tone="critical">{error}</WorkflowNote> : null}
    </div>
  );
}