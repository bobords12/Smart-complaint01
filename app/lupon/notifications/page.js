import { requireLuponPage } from "@/lib/requireLuponPage";
import Unauthorized from "@/components/official/Unauthorized";
import LuponNotifications from "@/components/lupon/LuponNotifications";

export const metadata = { title: "Notifications" };

export default async function Page() {
  const guard = await requireLuponPage("lupon_notifications");
  if (!guard.ok) return <Unauthorized role={guard.role} />;
  return <LuponNotifications />;
}
