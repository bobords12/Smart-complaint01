"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import toast from "react-hot-toast";
import { MapPin } from "lucide-react";
import ResidentSidebar from "./ResidentSidebar";
import ResidentMobileHeader from "./ResidentMobileHeader";
import ResidentTopbar from "./ResidentTopbar";
import ConfirmDialog from "@/components/shared/ConfirmDialog";
import ResidentModal from "@/components/shared/ResidentModal";
import { NotificationsProvider } from "./NotificationsProvider";
import { ResidentComplaintsProvider } from "@/hooks/useResidentComplaints";
import { SITE, RESIDENT_ROUTES } from "@/lib/constants";
import { KIOSK_INFO } from "@/data/residentDashboardData";
import { useAuth } from "@/context/AuthContext";

function KioskModal({ open, onClose }) {
  return (
    <ResidentModal
      open={open}
      onClose={onClose}
      labelledBy="kiosk-modal-title"
      title="Kiosk Information"
      maxWidthClass="max-w-md"
    >
      <p className="text-sm leading-relaxed text-muted">
        {KIOSK_INFO.description}
      </p>
      <ul className="mt-4 space-y-2.5">
        {KIOSK_INFO.details.map((detail) => (
          <li
            key={detail}
            className="flex items-start gap-2.5 text-sm text-mirage"
          >
            <MapPin
              className="mt-0.5 h-4 w-4 shrink-0 text-secondary"
              aria-hidden="true"
            />
            {detail}
          </li>
        ))}
      </ul>
      <p className="mt-5 rounded-xl bg-alt px-4 py-3 text-[13px] leading-relaxed text-secondary">
        Prototype information only — the official kiosk schedule will be
        published by {SITE.barangay}.
      </p>
    </ResidentModal>
  );
}

export default function ResidentShell({ children, fontClass }) {
  const router = useRouter();
  const pathname = usePathname();
  const { logout } = useAuth();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [kioskOpen, setKioskOpen] = useState(false);
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
        <ResidentSidebar
          variant="desktop"
          onOpenKiosk={() => setKioskOpen(true)}
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
        <ResidentSidebar
          variant="mobile"
          open={drawerOpen}
          onNavigate={() => setDrawerOpen(false)}
          onOpenKiosk={() => {
            setDrawerOpen(false);
            setKioskOpen(true);
          }}
          onLogout={() => {
            setDrawerOpen(false);
            setLogoutOpen(true);
          }}
        />

        <div className="lg:pl-[254px]">
          <ResidentMobileHeader onOpenDrawer={() => setDrawerOpen((v) => !v)} open={drawerOpen} />
          <ResidentTopbar onLogout={() => setLogoutOpen(true)} />

          <main id="resident-main" className="px-4 pb-12 pt-4 sm:px-6 lg:px-8 lg:pt-6">
            {/* One complaints/status/hearings/documents query set for the
                whole portal. Every resident page reads from here instead of
                running its own copy, so the dashboard, the list and the
                detail can never disagree about a count or a status, and
                there is exactly one realtime subscription per table rather
                than one per mounted component. */}
            <ResidentComplaintsProvider>{children}</ResidentComplaintsProvider>
          </main>
        </div>

        <KioskModal open={kioskOpen} onClose={() => setKioskOpen(false)} />

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