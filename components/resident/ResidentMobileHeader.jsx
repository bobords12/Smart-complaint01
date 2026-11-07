"use client";

import Link from "next/link";
import { Bell, Menu } from "lucide-react";
import SearchBox from "./SearchBox";
import DashboardLogo from "./DashboardLogo";
import { RESIDENT_ROUTES } from "@/lib/constants";
import { useNotifications } from "./NotificationsProvider";

export default function ResidentMobileHeader({ onOpenDrawer, open = false }) {
  const { unreadCount } = useNotifications();

  return (
    <header className="sticky top-0 z-40 bg-navy lg:hidden">
      <div className="flex h-[60px] items-center gap-3 px-3">
        <button
          type="button"
          onClick={onOpenDrawer}
          aria-expanded={open}
          aria-controls="resident-drawer"
          aria-label={open ? "Close resident navigation menu" : "Open resident navigation menu"}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-jordy"
        >
          <Menu className="h-6 w-6" aria-hidden="true" />
        </button>

        <div className="flex min-w-0 flex-1 items-center justify-center gap-2">
          <DashboardLogo compact />
        </div>

        <Link
          href={RESIDENT_ROUTES.notifications}
          aria-label={
            unreadCount > 0
              ? `Notifications — ${unreadCount} unread`
              : "Notifications"
          }
          className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-jordy"
        >
          <Bell className="h-5 w-5" aria-hidden="true" />
          {unreadCount > 0 ? (
            <span
              aria-hidden="true"
              className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-gold px-1 text-[10px] font-bold text-navy"
            >
              {unreadCount}
            </span>
          ) : null}
        </Link>
      </div>
      <div className="px-3 pb-3">
        <SearchBox id="resident-search-mobile" />
      </div>
    </header>
  );
}