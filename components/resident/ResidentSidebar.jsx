"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarDays,
  FileText,
  LayoutDashboard,
  LogOut,
} from "lucide-react";
import DashboardLogo from "./DashboardLogo";
import KioskInformationCard from "./KioskInformationCard";
import { RESIDENT_ROUTES } from "@/lib/constants";
import useAutoHideScrollbar from "@/components/shared/useAutoHideScrollbar";

const NAV_ITEMS = [
  { label: "Dashboard", href: RESIDENT_ROUTES.dashboard, icon: LayoutDashboard, exact: true },
  { label: "My Complaints", href: RESIDENT_ROUTES.complaints, icon: FileText },
  { label: "Hearings", href: RESIDENT_ROUTES.hearings, icon: CalendarDays },
];

function isRouteActive(pathname, item) {
  if (item.exact) return pathname === item.href;
  if (item.href === RESIDENT_ROUTES.complaints) {
    return pathname === item.href || pathname.startsWith(`${item.href}/`);
  }
  return pathname.startsWith(item.href);
}

export default function ResidentSidebar({
  variant = "desktop",
  open = false,
  onNavigate,
  onOpenKiosk,
  onLogout,
}) {
  const pathname = usePathname();
  const navScrollRef = useAutoHideScrollbar();

  return (
    <aside
      id={variant === "mobile" ? "resident-drawer" : undefined}
      aria-label="Resident sidebar"
      className={`${
        variant === "desktop"
          ? "fixed inset-y-0 left-0 z-40 hidden w-[254px] lg:flex"
          : `fixed inset-y-0 left-0 z-[70] flex w-[280px] max-w-[85vw] lg:hidden ${
              open ? "translate-x-0" : "-translate-x-full"
            }`
      } flex-col bg-navy shadow-[4px_0_24px_rgba(7,20,44,0.35)] transition-transform duration-300`}
    >
      {/* Logo */}
      <div className="border-b border-white/10 px-5 py-5">
        <DashboardLogo />
        <p className="mt-2 text-center text-[11px] font-medium text-white/60">
          Resident Portal
        </p>
      </div>

      {/* Navigation */}
      <nav
        aria-label="Resident"
        ref={navScrollRef}
        className="sidebar-scrollbar min-h-0 flex-1 overflow-y-auto px-3 py-4"
      >
        <ul className="flex flex-col gap-1">
          {NAV_ITEMS.map((item) => {
            const active = isRouteActive(pathname, item);
            const Icon = item.icon;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  onClick={onNavigate}
                  className={`relative flex min-h-[44px] items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-jordy ${
                    active
                      ? "bg-secondary text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]"
                      : "text-white/80 hover:bg-white/10 hover:text-white"
                  }`}
                >
                  {active ? (
                    <span
                      aria-hidden="true"
                      className="absolute left-0 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r-full bg-gold"
                    />
                  ) : null}
                  <span className="flex shrink-0">
                    <Icon className="h-[19px] w-[19px]" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>

        {/* Kiosk card */}
        <div className="mt-6 px-1">
          <KioskInformationCard onLearnMore={onOpenKiosk} />
        </div>
      </nav>

      {/* Logout */}
      <div className="border-t border-white/10 p-3">
        <button
          type="button"
          onClick={onLogout}
          className="flex min-h-[44px] w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium text-white/80 transition-colors duration-200 hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-jordy"
        >
          <LogOut className="h-[19px] w-[19px]" aria-hidden="true" />
          Logout
        </button>
      </div>
    </aside>
  );
}