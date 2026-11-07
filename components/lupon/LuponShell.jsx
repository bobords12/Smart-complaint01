"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { Bell, Menu } from "lucide-react";
import LuponSidebar from "./LuponSidebar";
import { NotificationsProvider } from "@/components/resident/NotificationsProvider";
import { useNotifications } from "@/components/resident/NotificationsProvider";
import DashboardLogo from "@/components/resident/DashboardLogo";
import ConfirmDialog from "@/components/shared/ConfirmDialog";
import { useAuth } from "@/context/AuthContext";
import { LUPON_ROUTES } from "@/lib/constants";
import { getRoleProfileDisplay } from "@/lib/roleProfileDisplay";

/* ── Desktop header ──────────────────────────────────────── */

function LuponHeader() {
  const { unreadCount } = useNotifications();
  const { user } = useAuth();
  const profile = user?.role === "lupon" ? getRoleProfileDisplay(user.role) : null;
  return (
    <header className="sticky top-0 z-30 hidden border-b border-line bg-canvas/85 backdrop-blur lg:block">
      <div className="flex h-[68px] items-center justify-end gap-4 px-6 lg:px-8">
        <Link
          href={LUPON_ROUTES.notifications}
          aria-label={
            unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"
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
        {profile ? (
          <div className="flex items-center gap-2.5 rounded-full border border-line bg-white py-1 pl-1 pr-3">
            <span aria-hidden="true" className="flex h-9 w-9 items-center justify-center rounded-full bg-navy text-[12px] font-bold text-jordy">
              {profile.initials}
            </span>
            <span className="text-left">
              <span className="block text-[13px] font-semibold leading-tight text-mirage">{profile.primary}</span>
              <span className="block text-[11px] text-muted">{profile.secondary}</span>
            </span>
          </div>
        ) : null}
      </div>
    </header>
  );
}

/* ── Mobile header ───────────────────────────────────────── */

function LuponMobileHeader({ open, onOpenDrawer }) {
  const { unreadCount } = useNotifications();
  const { user } = useAuth();
  const profile = user?.role === "lupon" ? getRoleProfileDisplay(user.role) : null;
  return (
    <header className="sticky top-0 z-40 bg-navy lg:hidden">
      <div className="flex h-[56px] items-center gap-3 px-3">
        <button
          type="button"
          onClick={onOpenDrawer}
          aria-expanded={open}
          aria-controls="lupon-drawer"
          aria-label={open ? "Close navigation menu" : "Open navigation menu"}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-white transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-jordy"
        >
          <Menu className="h-5 w-5" aria-hidden="true" />
        </button>
        <div className="flex min-w-0 flex-1 items-center justify-center gap-2">
          <DashboardLogo className="h-7 w-7" />
          <span className="min-w-0 text-left text-white">
            <span className="block truncate text-[13px] font-semibold leading-tight">{profile?.primary}</span>
            <span className="block truncate text-[11px] leading-tight text-white/70">{profile?.secondary}</span>
          </span>
        </div>
        <Link
          href={LUPON_ROUTES.notifications}
          aria-label={
            unreadCount > 0
              ? `Notifications, ${unreadCount} unread`
              : "Notifications"
          }
          className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-white transition-colors hover:bg-white/10"
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

/* ── Shell ───────────────────────────────────────────────── */

export default function LuponShell({ children, fontClass }) {
  const router = useRouter();
  const { logout } = useAuth();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [logoutBusy, setLogoutBusy] = useState(false);

  useEffect(() => {
    if (!drawerOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event) => {
      if (event.key === "Escape") setDrawerOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [drawerOpen]);

  const handleLogoutConfirm = () => {
    setLogoutBusy(true);
    const toastId = toast.loading("Logging out…");
    window.setTimeout(() => {
      logout();
      toast.dismiss(toastId);
      toast.success("You have been logged out. See you soon!");
      setLogoutBusy(false);
      setLogoutOpen(false);
      router.replace("/");
    }, 700);
  };

  return (
    <NotificationsProvider>
      <div className={`min-h-dvh bg-canvas font-sans text-mirage ${fontClass ?? ""}`}>
        <LuponSidebar variant="desktop" onLogout={() => setLogoutOpen(true)} />

        <div
          aria-hidden="true"
          onClick={() => setDrawerOpen(false)}
          className={`fixed inset-0 z-[65] bg-slate-950/55 transition-opacity duration-300 lg:hidden ${
            drawerOpen ? "opacity-100" : "pointer-events-none opacity-0"
          }`}
        />

        <LuponSidebar
          variant="mobile"
          open={drawerOpen}
          onNavigate={() => setDrawerOpen(false)}
          onLogout={() => {
            setDrawerOpen(false);
            setLogoutOpen(true);
          }}
        />

        <div className="min-h-dvh lg:pl-[254px]">
          <LuponMobileHeader
            open={drawerOpen}
            onOpenDrawer={() => setDrawerOpen(true)}
          />
          <LuponHeader />

          <main id="lupon-main" className="px-4 pb-16 pt-5 sm:px-6 lg:px-8 lg:pt-6">
            {children}
          </main>

          <footer className="border-t border-line px-4 py-6 text-center sm:px-6 lg:px-8">
            <p className="text-[12px] text-muted">
              &copy; 2026 Barangay Abuno, Iligan City
            </p>
            <p className="text-[11px] text-muted/70">
              Smart Complaint &amp; Blotter Management System
            </p>
          </footer>
        </div>

        <ConfirmDialog
          open={logoutOpen}
          onClose={() => setLogoutOpen(false)}
          onConfirm={handleLogoutConfirm}
          busy={logoutBusy}
          title="Log out?"
          message="You'll return to the home page."
          confirmLabel="Log Out"
        />
      </div>
    </NotificationsProvider>
  );
}
