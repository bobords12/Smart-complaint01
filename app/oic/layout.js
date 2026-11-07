import OfficialLayout from "@/components/official/OfficialLayout";
import { officialInter } from "@/components/official/officialFont";

export const metadata = {
  title: {
    default: "Officials Dashboard | SCBMS Barangay Abuno",
    template: "%s | SCBMS Barangay Abuno",
  },
  description:
    "Barangay officials portal for the Smart Complaint and Blotter Management System of Barangay Abuno — manage complaints, hearings, and case records.",
};

export default function oicLayout({ children }) {
  return (
    <OfficialLayout role="oic" fontClass={officialInter.variable}>
      {children}
    </OfficialLayout>
  );
}
