import LuponLayout from "@/components/lupon/LuponLayout";
import { officialInter } from "@/components/official/officialFont";

export const metadata = {
  title: {
    default: "Lupon Member Portal | SCBMS Barangay Abuno",
    template: "%s | Lupon Portal | SCBMS Barangay Abuno",
  },
  description:
    "Lupon Member Portal of Barangay Abuno — the case assignments, hearings, minutes and outcomes for the current Pangkat.",
};

export default function luponLayout({ children }) {
  return (
    <LuponLayout fontClass={officialInter.variable}>
      {children}
    </LuponLayout>
  );
}
