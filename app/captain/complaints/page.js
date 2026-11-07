import { requireOfficialPage } from "@/lib/requireOfficialPage";
import Unauthorized from "@/components/official/Unauthorized";
import CaptainComplaintsPage from "@/components/captain/complaints/CaptainComplaintsPage";

export const metadata = { title: { absolute: "Complaints | SCBMS Barangay Abuno" } };

export default async function Page() {
  const guard = await requireOfficialPage("captain", "complaints");
  if (!guard.ok) return <Unauthorized role={guard.role} />;
  return <CaptainComplaintsPage />;
}
