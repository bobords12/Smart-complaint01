import { requireOfficialPage } from "@/lib/requireOfficialPage";
import Unauthorized from "@/components/official/Unauthorized";
import OfficialEncodeComplaint from "@/components/official/OfficialEncodeComplaint";

export const metadata = { title: { absolute: "Encode Complaint | SCBMS Barangay Abuno" } };

export default async function Page() {
  const guard = await requireOfficialPage("oic", "complaints");
  if (!guard.ok) return <Unauthorized role={guard.role} />;
  return <OfficialEncodeComplaint />;
}
