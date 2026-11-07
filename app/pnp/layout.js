import PnpLayout from "@/components/pnp/PnpLayout";
import { officialInter } from "@/components/official/officialFont";

export const metadata = {
  title: {
    default: "PNP Coordination Portal | SCBMS Barangay Abuno",
    template: "%s | PNP Portal | SCBMS Barangay Abuno",
  },
  description:
    "PNP Coordination Portal of Barangay Abuno — the formal barangay-to-PNP referrals assigned to the signed-in officer, their shared evidence, and their coordination history.",
};

export default function pnpLayout({ children }) {
  return <PnpLayout fontClass={officialInter.variable}>{children}</PnpLayout>;
}
