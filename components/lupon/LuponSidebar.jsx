"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import {
  CalendarClock,
  ClipboardList,
  FileText,
  LayoutDashboard,
  LogOut,
  ScrollText,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { createClient } from "@/lib/supabase/client";
import { getRoleProfileDisplay } from "@/lib/roleProfileDisplay";
import { LUPON_ROUTES } from "@/lib/constants";
import useAutoHideScrollbar from "@/components/shared/useAutoHideScrollbar";

/* ── Navigation ─────────────────────────────────────────────
 *
 * Fixed list, not permission-derived. There is no "all cases",
 * no user management, no audit log and no analytics: a Lupon
 * member works on the cases they are assigned to and nothing
 * else. Adding a link here does not grant access to any data;
 * RLS still decides which rows come back.
 */

const NAV_ITEMS = [
  { key: "dashboard", label: "Dashboard", href: LUPON_ROUTES.dashboard, icon: LayoutDashboard, exact: true },
  { key: "cases", label: "My Cases", href: LUPON_ROUTES.cases, icon: FileText },
  { key: "schedule", label: "Schedule", href: LUPON_ROUTES.schedule, icon: CalendarClock },
  { key: "minutes", label: "Minutes", href: LUPON_ROUTES.minutes, icon: ScrollText },
];

function isActive(pathname, item) {
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

/* ── System status ───────────────────────────────────────── */

function SystemStatusCard() {
  const [status, setStatus] = useState("checking");

  useEffect(() => {
    let cancelled = false;
    async function check() {
      try {
        const supabase = createClient();
        const { error } = await supabase
          .from("profiles")
          .select("id", { count: "exact", head: true });
        if (!cancelled) setStatus(error ? "unavailable" : "online");
      } catch {
        if (!cancelled) setStatus("unavailable");
      }
    }
    check();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="mx-3 mb-3 rounded-xl border border-white/10 bg-white/5 p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-white/50">
        System Status
      </p>
      <div className="mt-1.5 flex items-center gap-2">
        {status === "checking" ? (
          <span className="h-2 w-2 animate-pulse rounded-full bg-white/40" />
        ) : status === "online" ? (
          <Wifi className="h-3.5 w-3.5 text-success" aria-hidden="true" />
        ) : (
          <WifiOff className="h-3.5 w-3.5 text-warning" aria-hidden="true" />
        )}
        <span
          className={`text-sm font-semibold ${
            status === "online" ? "text-success" : "text-white/60"
          }`}
        >
          {status === "checking"
            ? "Checking…"
            : status === "online"
              ? "Online"
              : "Status unavailable"}
        </span>
      </div>
    </div>
  );
}

/* ── Profile card ────────────────────────────────────────── */

function LuponProfileCard() {
  const { user } = useAuth();
  const profile = user?.role === "lupon" ? getRoleProfileDisplay(user.role) : null;
  if (!profile) return null;

  return (
    <div className="mx-3 mb-3 flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 p-3">
      <span
        aria-hidden="true"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-secondary text-[12px] font-bold text-white"
      >
        {profile.initials}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-semibold text-white">{profile.primary}</p>
        <p className="truncate text-[11px] text-white/50">{profile.secondary}</p>
      </div>
    </div>
  );
}

/* ── Sidebar ─────────────────────────────────────────────── */

export default function LuponSidebar({
  variant = "desktop",
  open = false,
  onNavigate,
  onLogout,
}) {
  const pathname = usePathname();
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
      id={isMobile ? "lupon-drawer" : undefined}
      aria-label={isMobile ? "Lupon navigation menu" : "Lupon sidebar"}
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
      <div className="border-b border-white/10 px-5 py-5">
        {isMobile ? (
          <div className="mb-1 flex justify-end">
            <button
              ref={closeRef}
              type="button"
              onClick={onNavigate}
              aria-label="Close navigation menu"
              className="flex h-10 w-10 items-center justify-center rounded-lg text-white/80 transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-jordy"
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
            Lupong Tagapamayapa
          </p>
        </div>
        <p className="mt-3 text-center text-[11px] font-semibold uppercase tracking-wider text-gold">
          Lupon Member Portal
        </p>
      </div>

      <nav
        aria-label="Lupon member"
        ref={navScrollRef}
        className="sidebar-scrollbar min-h-0 flex-1 overflow-y-auto px-3 py-4"
      >
        <p className="mb-2 px-3 text-[10px] font-bold uppercase tracking-[0.15em] text-white/40">
          Pangkat
        </p>
        <ul className="flex flex-col gap-0.5">
          {NAV_ITEMS.map((item) => {
            const active = isActive(pathname, item);
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
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="border-t border-white/10 pt-3">
        <SystemStatusCard />
        <LuponProfileCard />
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
