import { requirePnpPage } from "@/lib/requirePnpPage";
import Unauthorized from "@/components/official/Unauthorized";
import PnpDashboard from "@/components/pnp/PnpDashboard";

export const metadata = { title: "Dashboard" };

export default async function Page() {
  const guard = await requirePnpPage("pnp_dashboard");
  if (!guard.ok) return <Unauthorized role={guard.role} />;
  return <PnpDashboard />;
}
