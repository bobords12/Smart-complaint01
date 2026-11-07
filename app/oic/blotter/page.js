import { requireOfficialPage } from "@/lib/requireOfficialPage";
import Unauthorized from "@/components/official/Unauthorized";
import OfficialBlotterRecords from "@/components/official/OfficialBlotterRecords";

export default async function Page() {
  const guard = await requireOfficialPage("oic", "blotter_records");
  if (!guard.ok) return <Unauthorized role={guard.role} />;
  return <OfficialBlotterRecords />;
}
