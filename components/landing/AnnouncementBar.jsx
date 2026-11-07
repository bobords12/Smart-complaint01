import { Bell } from "lucide-react";
import { SITE } from "@/lib/constants";

export default function AnnouncementBar() {
  return (
    <div className="w-full bg-navy py-2.5">
      <p className="flex items-center justify-center gap-2 px-4 text-center text-[13px] leading-none text-white">
        <Bell className="h-3.5 w-3.5 shrink-0 text-gold-soft" aria-hidden="true" />
        <span>{SITE.announcement}</span>
        <span className="hidden text-gold-soft sm:inline">→</span>
      </p>
    </div>
  );
}