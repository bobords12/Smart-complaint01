import WelcomeSection from "@/components/resident/WelcomeSection";
import UpcomingHearingBanner from "@/components/resident/UpcomingHearingBanner";
import SummaryCards from "@/components/resident/SummaryCards";
import RecentComplaints from "@/components/resident/RecentComplaints";
import AICategorizationCard from "@/components/resident/AICategorizationCard";
import ComplaintStatusOverview from "@/components/resident/ComplaintStatusOverview";
import NotificationsPreview from "@/components/resident/NotificationsPreview";

export const metadata = {
  title: { absolute: "Resident Dashboard | SCBMS Barangay Abuno" },
};

export default function ResidentDashboardPage() {
  return (
    <div className="mx-auto max-w-[1280px] space-y-6">
      <WelcomeSection />
      <UpcomingHearingBanner />
      <SummaryCards />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <RecentComplaints />
          <AICategorizationCard />
        </div>
        <div className="space-y-6">
          <ComplaintStatusOverview />
          <NotificationsPreview />
        </div>
      </div>
    </div>
  );
}