import "server-only";
import { selectKioskOrigin } from "./origin.mjs";

// Only the public LAN origin crosses the server/client boundary; interface
// metadata and all Supabase credentials remain on the server.
export function getKioskLanOrigin() {
  const origin = selectKioskOrigin(process.env);
  if (!origin) console.error("[kiosk] QR origin unavailable. Configure KIOSK_PUBLIC_ORIGIN for production or start the local hotspot with npm run dev.");
  return origin;
}
