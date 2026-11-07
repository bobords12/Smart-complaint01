import { requireOfficialPage } from "@/lib/requireOfficialPage";
import Unauthorized from "@/components/official/Unauthorized";
import OfficialReports from "@/components/official/OfficialReports";

export default async function Page() {
  const guard = await requireOfficialPage("captain", "reports");
  if (!guard.ok) return <Unauthorized role={guard.role} />;
  return <OfficialReports />;
}
