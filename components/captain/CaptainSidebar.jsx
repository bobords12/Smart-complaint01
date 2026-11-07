"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Bell,
  ClipboardList,
  FileBarChart,
  FileText,
  LayoutDashboard,
  LogOut,
  ScrollText,
  ShieldCheck,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useNotifications } from "@/components/resident/NotificationsProvider";
import { createClient } from "@/lib/supabase/client";
import { getAvatarUrl, getOfficialIdentity } from "@/repositories/profileRepository";
import { getRoleProfileDisplay } from "@/lib/roleProfileDisplay";
import { useOfficialPortal } from "@/components/official/OfficialPortalProvider";
import {
  getSidebarItemsForRole,
  OFFICIAL_PORTAL_LABELS,
} from "@/lib/permissions";
import useAutoHideScrollbar from "@/components/shared/useAutoHideScrollbar";

/* ── Navigation groups (role-filtered) ────────────────────── */

const NAV_ICONS = {
  dashboard: LayoutDashboard,
  complaints: FileText,
  notifications: Bell,
  blotter: ClipboardList,
  analytics: BarChart3,
  reports: FileBarChart,
  users: ShieldCheck,
  "activity-logs": ScrollText,
};

function buildNavGroups(role) {
  return getSidebarItemsForRole(role).map((group) => ({
    label: group.label,
    items: group.items.map((item) => ({
      label: item.label,
      href: item.href,
      alsoActivePaths: item.alsoActivePaths,
      icon: NAV_ICONS[item.key] || FileText,
      exact: item.key === "dashboard",
      badge: item.key === "notifications",
    })),
  }));
}

function isRouteActive(pathname, item) {
  if (item.exact) return pathname === item.href;
  if (pathname === item.href || pathname.startsWith(`${item.href}/`)) return true;
  return (item.alsoActivePaths || []).some(
    (path) => pathname === path || pathname.startsWith(`${path}/`)
  );
}

/* ── System Status Card ────────────────────────────────────── */

function SystemStatusCard() {
  const [status, setStatus] = useState("checking");

  useEffect(() => {
    let cancelled = false;
    async function check() {
      try {
        const supabase = createClient();
        const { error } = await supabase.from("profiles").select("id", { count: "exact", head: true });
        if (!cancelled) setStatus(error ? "unavailable" : "online");
      } catch {
        if (!cancelled) setStatus("unavailable");
      }
    }
    check();
    return () => { cancelled = true; };
  }, []);

  const isOnline = status === "online";
  const isChecking = status === "checking";

  return (
    <div className="mx-3 mb-3 rounded-xl border border-white/10 bg-white/5 p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-white/50">
        System Status
      </p>
      <div className="mt-1.5 flex items-center gap-2">
        {isChecking ? (
          <span className="h-2 w-2 rounded-full bg-white/40 animate-pulse" />
        ) : isOnline ? (
          <Wifi className="h-3.5 w-3.5 text-success" />
        ) : (
          <WifiOff className="h-3.5 w-3.5 text-warning" />
        )}
        <span className={`text-sm font-semibold ${isOnline ? "text-success" : "text-white/60"}`}>
          {isChecking ? "Checking…" : isOnline ? "Online" : "Status unavailable"}
        </span>
      </div>
      <p className="mt-0.5 text-[11px] text-white/40">
        {isChecking ? "Verifying connection" : isOnline ? "Supabase service active" : "Could not verify service"}
      </p>
    </div>
  );
}

/* ── Official Profile Card ─────────────────────────────────── */

function OfficialProfileCard() {
  const { user } = useAuth();
  const [avatar, setAvatar] = useState(null);

  const profile = getRoleProfileDisplay(user?.role);
  const { displayName, roleLabel, initials } = profile
    ? { displayName: profile.primary, roleLabel: profile.secondary, initials: profile.initials }
    : getOfficialIdentity(user);
  const avatarUrl = !profile && avatar?.userId === user?.id ? avatar.url : null;

  useEffect(() => {
    if (!user?.id || user.role !== "captain") return;
    let cancelled = false;
    (async () => {
      try {
        const supabase = createClient();
        const { data } = await supabase
          .from("profiles")
          .select("avatar_path")
          .eq("id", user.id)
          .single();
        if (!cancelled && data?.avatar_path) {
          setAvatar({ userId: user.id, url: getAvatarUrl(data.avatar_path) });
        }
      } catch {
        // ignore — will show initials fallback
      }
    })();
    return () => { cancelled = true; };
  }, [user?.id, user?.role]);

  return (
    <div className="mx-3 mb-3 flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 p-3">
      {avatarUrl ? (
        <img
          src={avatarUrl}
          alt=""
          aria-hidden="true"
          className="h-9 w-9 shrink-0 rounded-full object-cover"
        />
      ) : (
        <span
          aria-hidden="true"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-secondary text-[12px] font-bold text-white"
        >
          {initials}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-semibold text-white">{displayName}</p>
        <p className="truncate text-[11px] text-white/50">{roleLabel}</p>
      </div>
    </div>
  );
}

/* ── Main Sidebar ──────────────────────────────────────────── */

export default function CaptainSidebar({
  variant = "desktop",
  open = false,
  onNavigate,
  onLogout,
}) {
  const pathname = usePathname();
  const { unreadCount } = useNotifications();
  const { role } = useOfficialPortal();
  const navGroups = buildNavGroups(role);
  const portalLabel = OFFICIAL_PORTAL_LABELS[role] || "Official Portal";
  const asideRef = useRef(null);
  const closeRef = useRef(null);
  const navScrollRef = useAutoHideScrollbar();
  const isMobile = variant === "mobile";

  useEffect(() => {
    if (!isMobile || !open) return undefined;

    const frame = requestAnimationFrame(() => closeRef.current?.focus());

    const onKeyDown = (event) => {
      if (event.key !== "Tab") return;
      const aside = asideRef.current;
      if (!aside) return;
      const focusables = aside.querySelectorAll(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isMobile, open]);

  return (
    <aside
      ref={asideRef}
      id={isMobile ? "captain-drawer" : undefined}
      aria-label={
        isMobile ? "Officials navigation menu" : "Officials sidebar"
      }
      {...(isMobile ? { role: "dialog", "aria-modal": "true" } : {})}
      inert={isMobile && !open ? true : undefined}
      className={`${
        variant === "desktop"
          ? "fixed inset-y-0 left-0 z-40 hidden w-[254px] lg:flex"
          : `fixed inset-y-0 left-0 z-[70] flex w-[280px] max-w-[85vw] lg:hidden ${
              open ? "translate-x-0" : "-translate-x-full"
            }`
      } flex-col bg-navy shadow-[4px_0_24px_rgba(7,20,44,0.35)] transition-transform duration-300`}
    >
      {/* Logo / Identity */}
      <div className="border-b border-white/10 px-5 py-5">
        {isMobile ? (
          <div className="mb-1 flex justify-end">
            <button
              ref={closeRef}
              type="button"
              onClick={onNavigate}
              aria-label="Close navigation menu"
              className="flex h-10 w-10 items-center justify-center rounded-lg text-white/80 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-jordy"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
        ) : null}
        <div className="flex flex-col items-center text-center">
          <Image
            src="/Abunoi.jpg"
            alt="Official seal of Barangay Abuno"
            width={96}
            height={96}
            className="h-20 w-20 rounded-full object-contain drop-shadow-lg"
          />
          <h1 className="mt-3 font-heading text-lg font-bold tracking-tight text-white">
            BARANGAY ABUNO
          </h1>
          <p className="text-sm text-white/90">ILIGAN CITY</p>
          <p className="mt-2 text-[11px] font-bold uppercase tracking-[0.18em] text-white/90">
            Smart Governance
          </p>
        </div>
        <p className="mt-3 text-center text-[11px] font-semibold uppercase tracking-wider text-gold">
          {portalLabel}
        </p>
      </div>

      {/* Navigation */}
      <nav
        aria-label="Officials"
        ref={navScrollRef}
        className="sidebar-scrollbar min-h-0 flex-1 overflow-y-auto px-3 py-4"
      >
        {navGroups.map((group, gi) => (
          <div key={group.label} className={gi > 0 ? "mt-5" : ""}>
            <p className="mb-2 px-3 text-[10px] font-bold uppercase tracking-[0.15em] text-white/40">
              {group.label}
            </p>
            <ul className="flex flex-col gap-0.5">
              {group.items.map((item) => {
                const active = isRouteActive(pathname, item);
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      onClick={onNavigate}
                      className={`relative flex min-h-[40px] items-center gap-3 rounded-xl px-3.5 py-2.5 text-[13px] font-medium transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-jordy ${
                        active
                          ? "bg-secondary text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]"
                          : "text-white/70 hover:bg-white/10 hover:text-white"
                      }`}
                    >
                      {active ? (
                        <span
                          aria-hidden="true"
                          className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-gold"
                        />
                      ) : null}
                      <span className="flex shrink-0">
                        <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
                      </span>
                      <span className="min-w-0 flex-1 truncate">{item.label}</span>
                      {item.badge && unreadCount > 0 ? (
                        <span
                          aria-label={`${unreadCount} unread notifications`}
                          className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-gold px-1.5 text-[10px] font-bold text-navy"
                        >
                          {unreadCount}
                        </span>
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* System status + Profile + Logout */}
      <div className="border-t border-white/10 pt-3">
        <SystemStatusCard />
        <OfficialProfileCard />
        <div className="px-3 pb-3">
          <button
            type="button"
            onClick={onLogout}
            className="flex min-h-[40px] w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-[13px] font-medium text-white/70 transition-colors duration-200 hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-jordy"
          >
            <LogOut className="h-[18px] w-[18px]" aria-hidden="true" />
            Logout
          </button>
        </div>
      </div>
    </aside>
  );
}
