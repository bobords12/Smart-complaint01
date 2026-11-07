"use client";

import CaptainSettingsPage from "@/components/official/OfficialSettings";
import { PnpPageHeader, BoundaryNote } from "./PnpPrimitives";

/**
 * The PNP settings page.
 *
 * Account settings — password, display name, accessibility — are the
 * same surface every portal needs, so the existing component is reused
 * rather than forked. Only the notification labels differ, because a
 * PNP officer is notified about referral assignments and information
 * replies and never about hearings or complaint updates.
 *
 * The PNP_ROLES map uses the same preference keys as the official
 * page, so the toggles read and store the same way.
 */
const PNP_NOTIFICATION_OPTIONS = [
  { key: "complaintUpdates", label: "Referral status updates" },
  { key: "caseAssignments", label: "New referrals assigned to me" },
  { key: "hearingReminders", label: "Information requests and replies" },
  { key: "generalNotices", label: "General notices" },
];

export default function PnpSettings() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PnpPageHeader
        title="Settings"
        subtitle="Your account settings, password, and notification preferences."
      />

      <CaptainSettingsPage notificationOptions={PNP_NOTIFICATION_OPTIONS} />

      <BoundaryNote title="There is no account creation here">
        <p>
          PNP accounts are created by a barangay administrator from the Supabase Dashboard and
          activated by them. No one can register as a PNP officer from this application, and a
          PNP officer cannot create another one. If your account is pending or suspended, contact
          the barangay rather than trying to re-activate it.
        </p>
      </BoundaryNote>
    </div>
  );
}
