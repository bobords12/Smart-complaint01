import { requireOfficialPage } from "@/lib/requireOfficialPage";
import Unauthorized from "@/components/official/Unauthorized";
import OfficialSummonsHearings from "@/components/official/OfficialSummonsHearings";

export default async function Page() {
  const guard = await requireOfficialPage("secretary", "summons_hearings");
  if (!guard.ok) return <Unauthorized role={guard.role} />;
  return <OfficialSummonsHearings />;
}
