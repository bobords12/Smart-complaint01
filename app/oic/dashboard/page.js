import { requireOfficialPage } from "@/lib/requireOfficialPage";
import Unauthorized from "@/components/official/Unauthorized";
import OfficialDashboard from "@/components/official/OfficialDashboard";

export default async function Page() {
  const guard = await requireOfficialPage("oic", "dashboard");
  if (!guard.ok) return <Unauthorized role={guard.role} />;
  return <OfficialDashboard />;
}
