import { requirePnpPage } from "@/lib/requirePnpPage";
import Unauthorized from "@/components/official/Unauthorized";
import PnpReferralList from "@/components/pnp/PnpReferralList";

export const metadata = { title: "Referred Cases" };

export default async function Page() {
  const guard = await requirePnpPage("pnp_referrals");
  if (!guard.ok) return <Unauthorized role={guard.role} />;
  return <PnpReferralList />;
}
