import KioskStatusShell from "@/components/kiosk/KioskStatusShell";
import KioskTrackInfo from "@/components/kiosk/KioskTrackInfo";

/**
 * /kiosk/track — the resident-facing "how to track my complaint" page.
 *
 * Reached from the home screen's "Track Your Complaint" action. It is a
 * plain informational route: it never reads a QR code and never exposes
 * another resident's data. The actual status page remains the token link
 * at /kiosk/status/<token>, which the resident opens with their own phone.
 */
export const metadata = {
  title: "Track Your Complaint",
};

export default function KioskTrackPage() {
  return (
    <KioskStatusShell>
      <KioskTrackInfo />
    </KioskStatusShell>
  );
}
