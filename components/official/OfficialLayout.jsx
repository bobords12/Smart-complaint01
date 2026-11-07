"use client";

import { useEffect, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import toast from "react-hot-toast";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { getPostLoginRoute } from "@/lib/roleRoutes";
import { canAccessPage, getPermissionForPath } from "@/lib/permissions";
import { OfficialPortalProvider } from "./OfficialPortalProvider";
import Unauthorized from "./Unauthorized";
import CaptainShell from "@/components/captain/CaptainShell";

function Spinner() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-dvh items-center justify-center bg-canvas"
    >
      <div className="flex flex-col items-center gap-4">
        <Loader2 className="h-9 w-9 animate-spin text-secondary" aria-hidden="true" />
        <p className="text-sm text-muted">Verifying your session…</p>
      </div>
      <span className="sr-only">Loading, please wait.</span>
    </div>
  );
}

export default function OfficialLayout({ role, fontClass, children }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, isLoading } = useAuth();
  const sessionToastRef = useRef(false);
  const deniedToastRef = useRef(false);

  const permission = getPermissionForPath(pathname);
  const roleMatches = Boolean(user) && user.role === role;
  const allowed =
    roleMatches && (permission === null || canAccessPage(role, permission));

  useEffect(() => {
    if (isLoading) return;
    if (!user) {
      if (!sessionToastRef.current) {
        sessionToastRef.current = true;
        toast.error("Your session has expired. Please sign in again.");
      }
      router.replace("/");
      return;
    }
    if (user.role !== role) {
      router.replace(getPostLoginRoute(user.role));
    }
  }, [isLoading, user, role, router]);

  useEffect(() => {
    if (isLoading || !user || user.role !== role) {
      deniedToastRef.current = false;
      return;
    }
    if (permission !== null && !canAccessPage(role, permission)) {
      if (!deniedToastRef.current) {
        deniedToastRef.current = true;
        toast.error("You do not have permission to access that page.");
      }
    } else {
      deniedToastRef.current = false;
    }
  }, [isLoading, user, role, permission]);

  if (isLoading) return <Spinner />;
  if (!user) return null;
  if (user.role !== role) return <Spinner />;

  return (
    <OfficialPortalProvider role={role}>
      <CaptainShell fontClass={fontClass}>
        {allowed ? children : <Unauthorized role={role} />}
      </CaptainShell>
    </OfficialPortalProvider>
  );
}
