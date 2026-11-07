import { requireLuponPage } from "@/lib/requireLuponPage";
import Unauthorized from "@/components/official/Unauthorized";
import LuponMinutes from "@/components/lupon/LuponMinutes";

export const metadata = { title: "Minutes" };

export default async function Page() {
  const guard = await requireLuponPage("lupon_minutes");
  if (!guard.ok) return <Unauthorized role={guard.role} />;
  return <LuponMinutes />;
}
