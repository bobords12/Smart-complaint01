"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { Bell, Menu } from "lucide-react";
import DashboardLogo from "@/components/resident/DashboardLogo";
import { useOfficialRoutes } from "@/components/official/OfficialPortalProvider";
import { useNotifications } from "@/components/resident/NotificationsProvider";
import { useAuth } from "@/context/AuthContext";
import { getRoleProfileDisplay } from "@/lib/roleProfileDisplay";

export default function CaptainMobileHeader({ onOpenDrawer, open = false }) {
  const { unreadCount } = useNotifications();
  const { user } = useAuth();
  const profile = getRoleProfileDisplay(user?.role);
  const routes = useOfficialRoutes();
  const triggerRef = useRef(null);
  const wasOpenRef = useRef(open);

  useEffect(() => {
    if (wasOpenRef.current && !open) {
      triggerRef.current?.focus();
    }
    wasOpenRef.current = open;
  }, [open]);

  return (
    <header className="sticky top-0 z-40 bg-navy lg:hidden">
      <div className="flex h-[56px] items-center gap-3 px-3">
        <button
          ref={triggerRef}
          type="button"
          onClick={onOpenDrawer}
          aria-expanded={open}
          aria-controls="captain-drawer"
          aria-label={
            open ? "Close officials navigation menu" : "Open officials navigation menu"
          }
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-white transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-jordy"
        >
          <Menu className="h-5 w-5" aria-hidden="true" />
        </button>

        <div className="flex min-w-0 flex-1 items-center justify-center gap-2">
          <DashboardLogo compact />
          {profile ? (
            <span className="min-w-0 text-left text-white">
              <span className="block truncate text-[13px] font-semibold leading-tight">{profile.primary}</span>
              <span className="block truncate text-[11px] leading-tight text-white/70">{profile.secondary}</span>
            </span>
          ) : null}
        </div>

        <Link
          href={routes.notifications}
          aria-label={
            unreadCount > 0
              ? `Notifications — ${unreadCount} unread`
              : "Notifications"
          }
          className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-white transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-jordy"
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
    </header>
  );
}
