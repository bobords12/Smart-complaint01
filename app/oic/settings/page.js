import { requireOfficialPage } from "@/lib/requireOfficialPage";
import Unauthorized from "@/components/official/Unauthorized";
import OfficialSettings from "@/components/official/OfficialSettings";

export default async function Page() {
  const guard = await requireOfficialPage("oic", "settings");
  if (!guard.ok) return <Unauthorized role={guard.role} />;
  return <OfficialSettings />;
}
