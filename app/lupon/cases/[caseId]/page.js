import { requireLuponCasePage } from "@/lib/requireLuponPage";
import Unauthorized from "@/components/official/Unauthorized";
import LuponCaseDetail from "@/components/lupon/LuponCaseDetail";

export async function generateMetadata({ params }) {
  const { caseId } = await params;
  return { title: caseId ? "Case" : "Case not found" };
}

export default async function Page({ params }) {
  const { caseId } = await params;
  const guard = await requireLuponCasePage(caseId, "lupon_cases");
  if (!guard.ok) return <Unauthorized role={guard.role} />;
  return <LuponCaseDetail caseId={guard.caseId} />;
}
