import { redirect } from "next/navigation";

/**
 * The kiosk no longer scans a resident's complaint QR code.
 *
 * Scanning a receipt on a shared hall terminal would mean the kiosk
 * reading somebody else's complaint token, which is exactly the privacy
 * boundary this portal is built to keep. Tracking is done by the resident
 * on their own phone, so this old route simply forwards to the guidance
 * page instead of presenting a camera.
 */
export default function KioskStatusScanRetired() {
  redirect("/kiosk/track");
}
