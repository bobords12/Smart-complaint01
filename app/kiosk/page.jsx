import KioskClient from "./KioskClient";
import { getKioskLanOrigin } from "@/lib/kiosk/lan-origin";

// Resolve at request time so a restarted server uses the new hotspot address.
export const dynamic = "force-dynamic";

export default function KioskPage() {
  return <KioskClient lanOrigin={getKioskLanOrigin()} />;
}
