import { requirePnpReferralPage } from "@/lib/requirePnpPage";
import Unauthorized from "@/components/official/Unauthorized";
import PnpReferralDetail from "@/components/pnp/PnpReferralDetail";

export const metadata = { title: "Referral" };

/**
 * The referralId in params is attacker controlled. requirePnpReferralPage
 * refuses a malformed id before the page renders, and the id is only ever
 * used in queries that RLS already scopes to this officer's own active
 * assignments — so a guessed id belonging to another officer's referral
 * yields no rows and the page renders "not found" with no case data.
 */
export default async function Page({ params }) {
  const { referralId } = await params;
  const guard = await requirePnpReferralPage(referralId);
  if (!guard.ok) return <Unauthorized role={guard.role} />;
  return <PnpReferralDetail referralId={guard.referralId} />;
}
