import { requireLuponPage } from "@/lib/requireLuponPage";
import Unauthorized from "@/components/official/Unauthorized";
import LuponCases from "@/components/lupon/LuponCases";

export const metadata = { title: "My Cases" };

export default async function Page() {
  const guard = await requireLuponPage("lupon_cases");
  if (!guard.ok) return <Unauthorized role={guard.role} />;
  return <LuponCases />;
}
