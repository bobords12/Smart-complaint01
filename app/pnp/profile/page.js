import { requirePnpPage } from "@/lib/requirePnpPage";
import Unauthorized from "@/components/official/Unauthorized";
import PnpProfile from "@/components/pnp/PnpProfile";

export const metadata = { title: "Profile" };

export default async function Page() {
  const guard = await requirePnpPage("pnp_profile");
  if (!guard.ok) return <Unauthorized role={guard.role} />;
  return <PnpProfile />;
}
