import { requireLuponPage } from "@/lib/requireLuponPage";
import Unauthorized from "@/components/official/Unauthorized";
import LuponSchedule from "@/components/lupon/LuponSchedule";

export const metadata = { title: "Schedule" };

export default async function Page() {
  const guard = await requireLuponPage("lupon_schedule");
  if (!guard.ok) return <Unauthorized role={guard.role} />;
  return <LuponSchedule />;
}
