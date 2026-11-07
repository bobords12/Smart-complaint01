import { requirePnpPage } from "@/lib/requirePnpPage";
import Unauthorized from "@/components/official/Unauthorized";
import PnpActivityLogs from "@/components/pnp/PnpActivityLogs";

export const metadata = { title: "Activity Logs" };

export default async function Page() {
  const guard = await requirePnpPage("pnp_activity_logs");
  if (!guard.ok) return <Unauthorized role={guard.role} />;
  return <PnpActivityLogs />;
}
