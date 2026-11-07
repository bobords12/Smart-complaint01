import { requirePnpPage } from "@/lib/requirePnpPage";
import Unauthorized from "@/components/official/Unauthorized";
import PnpSettings from "@/components/pnp/PnpSettings";

export const metadata = { title: "Settings" };

export default async function Page() {
  const guard = await requirePnpPage("pnp_settings");
  if (!guard.ok) return <Unauthorized role={guard.role} />;
  return <PnpSettings />;
}
