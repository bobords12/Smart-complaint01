"use client";

import Link from "next/link";
import { Bell } from "lucide-react";
import SearchBox from "./SearchBox";
import ResidentProfileMenu from "./ResidentProfileMenu";
import { RESIDENT_ROUTES } from "@/lib/constants";
import { useNotifications } from "./NotificationsProvider";

export default function ResidentTopbar({ onLogout }) {
  const { unreadCount } = useNotifications();

  return (
    <header className="sticky top-0 z-30 hidden border-b border-line bg-canvas/85 backdrop-blur lg:block">
      <div className="flex h-[72px] items-center gap-4 px-6 xl:px-8">
        <div className="flex-1">
          <SearchBox id="resident-search-desktop" />
        </div>

        <Link
          href={RESIDENT_ROUTES.notifications}
          aria-label={
            unreadCount > 0
              ? `Notifications — ${unreadCount} unread`
              : "Notifications"
          }
          className="relative flex h-11 w-11 items-center justify-center rounded-full border border-line bg-white dark:bg-alt text-muted transition-colors hover:border-secondary/50 hover:text-navy dark:hover:text-secondary focus-visible:outline-2 focus-visible:outline-secondary"
        >
          <Bell className="h-5 w-5" aria-hidden="true" />
          {unreadCount > 0 ? (
            <span
              aria-hidden="true"
              className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-critical px-1 text-[10px] font-bold text-white"
            >
              {unreadCount}
            </span>
          ) : null}
        </Link>

        <ResidentProfileMenu onLogout={onLogout} />
      </div>
    </header>
  );
}