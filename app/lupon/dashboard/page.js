import { requireLuponPage } from "@/lib/requireLuponPage";
import Unauthorized from "@/components/official/Unauthorized";
import LuponDashboard from "@/components/lupon/LuponDashboard";

export const metadata = { title: "Dashboard" };

export default async function Page() {
  const guard = await requireLuponPage("lupon_dashboard");
  if (!guard.ok) return <Unauthorized role={guard.role} />;
  return <LuponDashboard />;
}
