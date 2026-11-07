import { requireOfficialPage } from "@/lib/requireOfficialPage";
import Unauthorized from "@/components/official/Unauthorized";
import OfficialDocuments from "@/components/official/OfficialDocuments";

export default async function Page() {
  const guard = await requireOfficialPage("oic", "documents");
  if (!guard.ok) return <Unauthorized role={guard.role} />;
  return <OfficialDocuments />;
}
