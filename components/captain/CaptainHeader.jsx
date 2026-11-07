"use client";

import Link from "next/link";
import { Bell } from "lucide-react";
import CaptainSearchBox from "./CaptainSearchBox";
import CaptainProfileMenu from "./CaptainProfileMenu";
import { useOfficialRoutes } from "@/components/official/OfficialPortalProvider";
import { useNotifications } from "@/components/resident/NotificationsProvider";

export default function CaptainHeader({ onLogout }) {
  const { unreadCount } = useNotifications();
  const routes = useOfficialRoutes();

  return (
    <header className="sticky top-0 z-30 hidden border-b border-line bg-canvas/85 backdrop-blur lg:block">
      <div className="flex h-[68px] items-center gap-4 px-6 lg:px-8">
        <div className="flex-1">
          <CaptainSearchBox
            id="captain-search-desktop"
            label="Search anything"
            placeholder="Search anything..."
          />
        </div>

        <Link
          href={routes.notifications}
          aria-label={
            unreadCount > 0
              ? `Notifications — ${unreadCount} unread`
              : "Notifications"
          }
          className="relative flex h-10 w-10 items-center justify-center rounded-full border border-line bg-white text-muted transition-colors hover:border-secondary/50 hover:text-navy focus-visible:outline-2 focus-visible:outline-secondary"
        >
          <Bell className="h-[18px] w-[18px]" aria-hidden="true" />
          {unreadCount > 0 ? (
            <span
              aria-hidden="true"
              className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-critical px-1 text-[10px] font-bold text-white"
            >
              {unreadCount}
            </span>
          ) : null}
        </Link>

        <CaptainProfileMenu onLogout={onLogout} />
      </div>
    </header>
  );
}
