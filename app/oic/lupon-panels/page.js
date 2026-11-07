import { requireOfficialPage } from "@/lib/requireOfficialPage";
import Unauthorized from "@/components/official/Unauthorized";
import OfficialLuponPanels from "@/components/official/OfficialLuponPanels";

export default async function Page() {
  const guard = await requireOfficialPage("oic", "lupon_panels");
  if (!guard.ok) return <Unauthorized role={guard.role} />;
  return <OfficialLuponPanels />;
}
