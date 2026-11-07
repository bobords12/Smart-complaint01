import { requireOfficialPage } from "@/lib/requireOfficialPage";
import Unauthorized from "@/components/official/Unauthorized";
import OfficialAnalytics from "@/components/official/OfficialAnalytics";

export default async function Page() {
  const guard = await requireOfficialPage("captain", "analytics");
  if (!guard.ok) return <Unauthorized role={guard.role} />;
  return <OfficialAnalytics />;
}
