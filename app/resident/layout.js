import { Inter } from "next/font/google";
import AuthGuard from "@/components/auth/AuthGuard";
import ResidentShell from "@/components/resident/ResidentShell";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--resident-inter",
});

export const metadata = {
  title: {
    default: "Resident Dashboard | SCBMS Barangay Abuno",
    template: "%s | SCBMS Barangay Abuno",
  },
  description:
    "Your resident portal for the Smart Complaint and Blotter Management System of Barangay Abuno — file complaints, track cases, and view hearings.",
};

export default function ResidentLayout({ children }) {
  return (
    <AuthGuard>
      <ResidentShell fontClass={inter.variable}>{children}</ResidentShell>
    </AuthGuard>
  );
}
