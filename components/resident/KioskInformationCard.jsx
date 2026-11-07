import { MonitorSmartphone } from "lucide-react";
import { KIOSK_INFO } from "@/data/residentDashboardData";

export default function KioskInformationCard({ onLearnMore }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-secondary/50 p-4">
      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10">
        <MonitorSmartphone className="h-5 w-5 text-white" aria-hidden="true" />
      </span>
      <h2 className="mt-3 text-sm font-semibold text-white">
        {KIOSK_INFO.heading}
      </h2>
      <p className="mt-1 text-[12.5px] text-white/75">
        {KIOSK_INFO.description}
      </p>
      <button
        type="button"
        onClick={onLearnMore}
        className="mt-3 inline-flex min-h-[40px] items-center rounded-full border border-white/30 px-4 text-[12.5px] font-semibold text-white transition-colors hover:bg-white hover:text-navy focus-visible:outline-2 focus-visible:outline-jordy"
      >
        Kiosk Info
      </button>
    </div>
  );
}