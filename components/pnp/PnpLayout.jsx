"use client";

import { useEffect, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import toast from "react-hot-toast";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { getPostLoginRoute } from "@/lib/roleRoutes";
import { canAccessPnpPage, getPnpPermissionForPath } from "@/lib/permissions";
import PnpShell from "./PnpShell";
import Unauthorized from "@/components/official/Unauthorized";

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

/**
 * Client guard for the PNP Coordination Portal.
 *
 * The authoritative checks are server side and there are two of them:
 * middleware refuses a non-pnp_officer before the route renders, and
 * every page calls requirePnpPage() in its own server component.
 * This component only covers the in-session case (a role change, an
 * expired session) without a full reload, and stops the PNP chrome
 * flashing for the wrong role.
 *
 * It is a convenience, not a boundary. A user who bypasses this file
 * entirely still gets nothing: every read is filtered by an RLS
 * policy that names their own profile id.
 */
export default function PnpLayout({ fontClass, children }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, isLoading } = useAuth();
  const sessionToastRef = useRef(false);
  const deniedToastRef = useRef(false);

  const permission = getPnpPermissionForPath(pathname);
  const roleMatches = Boolean(user) && user.role === "pnp_officer";
  const allowed = roleMatches && (permission === null || canAccessPnpPage(user?.role, permission));

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
    if (user.role !== "pnp_officer") {
      router.replace(getPostLoginRoute(user.role));
    }
  }, [isLoading, user, router]);

  useEffect(() => {
    if (isLoading || !user || user.role !== "pnp_officer") {
      deniedToastRef.current = false;
      return;
    }
    if (permission !== null && !canAccessPnpPage(user.role, permission)) {
      if (!deniedToastRef.current) {
        deniedToastRef.current = true;
        toast.error("You do not have permission to access that page.");
      }
    } else {
      deniedToastRef.current = false;
    }
  }, [isLoading, user, permission]);

  if (isLoading) return <Spinner />;
  if (!user) return null;
  if (user.role !== "pnp_officer") return <Spinner />;

  return (
    <PnpShell fontClass={fontClass}>
      {allowed ? children : <Unauthorized role="pnp_officer" />}
    </PnpShell>
  );
}
