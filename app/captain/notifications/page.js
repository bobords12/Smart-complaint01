import { requireOfficialPage } from "@/lib/requireOfficialPage";
import Unauthorized from "@/components/official/Unauthorized";
import OfficialNotifications from "@/components/official/OfficialNotifications";

export default async function Page() {
  const guard = await requireOfficialPage("captain", "notifications");
  if (!guard.ok) return <Unauthorized role={guard.role} />;
  return <OfficialNotifications />;
}
