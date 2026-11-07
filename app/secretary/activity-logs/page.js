import { requireOfficialPage } from "@/lib/requireOfficialPage";
import Unauthorized from "@/components/official/Unauthorized";
import OfficialAuditLog from "@/components/official/OfficialAuditLog";

export default async function Page() {
  const guard = await requireOfficialPage("secretary", "audit_log");
  if (!guard.ok) return <Unauthorized role={guard.role} />;
  return <OfficialAuditLog />;
}
