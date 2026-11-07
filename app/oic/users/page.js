import { requireOfficialPage } from "@/lib/requireOfficialPage";
import Unauthorized from "@/components/official/Unauthorized";
import OfficialUsersRoles from "@/components/official/OfficialUsersRoles";

export default async function Page() {
  const guard = await requireOfficialPage("oic", "users_roles");
  if (!guard.ok) return <Unauthorized role={guard.role} />;
  return <OfficialUsersRoles />;
}
