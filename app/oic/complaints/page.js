import { requireOfficialPage } from "@/lib/requireOfficialPage";
import Unauthorized from "@/components/official/Unauthorized";
import OfficialComplaints from "@/components/official/OfficialComplaints";

export default async function Page() {
  const guard = await requireOfficialPage("oic", "complaints");
  if (!guard.ok) return <Unauthorized role={guard.role} />;
  return <OfficialComplaints />;
}
