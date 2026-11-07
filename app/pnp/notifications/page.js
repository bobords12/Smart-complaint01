import { requirePnpPage } from "@/lib/requirePnpPage";
import Unauthorized from "@/components/official/Unauthorized";
import PnpNotifications from "@/components/pnp/PnpNotifications";

export const metadata = { title: "Notifications" };

export default async function Page() {
  const guard = await requirePnpPage("pnp_notifications");
  if (!guard.ok) return <Unauthorized role={guard.role} />;
  return <PnpNotifications />;
}
