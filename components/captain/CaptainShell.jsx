"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import CaptainSidebar from "./CaptainSidebar";
import CaptainMobileHeader from "./CaptainMobileHeader";
import CaptainHeader from "./CaptainHeader";
import ConfirmDialog from "@/components/shared/ConfirmDialog";
import { NotificationsProvider } from "@/components/resident/NotificationsProvider";
import { useAuth } from "@/context/AuthContext";

export default function CaptainShell({ children, fontClass }) {
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
        {/* Desktop sidebar (visible lg+) */}
        <CaptainSidebar
          variant="desktop"
          onLogout={() => setLogoutOpen(true)}
        />

        {/* Mobile drawer backdrop */}
        <div
          aria-hidden="true"
          onClick={() => setDrawerOpen(false)}
          className={`fixed inset-0 z-[65] bg-slate-950/55 transition-opacity duration-300 lg:hidden ${
            drawerOpen ? "opacity-100" : "pointer-events-none opacity-0"
          }`}
        />

        {/* Mobile slide-in drawer */}
        <CaptainSidebar
          variant="mobile"
          open={drawerOpen}
          onNavigate={() => setDrawerOpen(false)}
          onLogout={() => {
            setDrawerOpen(false);
            setLogoutOpen(true);
          }}
        />

        <div className="min-h-dvh lg:pl-[254px]">
          <CaptainMobileHeader
            open={drawerOpen}
            onOpenDrawer={() => setDrawerOpen(true)}
          />
          <CaptainHeader onLogout={() => setLogoutOpen(true)} />

          <main id="captain-main" className="px-4 pb-16 pt-5 sm:px-6 lg:px-8 lg:pt-6">
            {children}
          </main>

          {/* Footer */}
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
