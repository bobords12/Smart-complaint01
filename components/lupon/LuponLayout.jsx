"use client";

import { useEffect, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import toast from "react-hot-toast";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { getPostLoginRoute } from "@/lib/roleRoutes";
import {
  canAccessLuponPage,
  getLuponPermissionForPath,
} from "@/lib/permissions";
import LuponShell from "./LuponShell";
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
 * Client guard for the Lupon Member Portal.
 *
 * The authoritative checks are server side: middleware refuses a
 * non-lupon user before the route renders, and every page calls
 * requireLuponPage() in its own server component. This component
 * only handles the in-session case (a role change, an expired
 * session) without a full reload, and prevents a flash of portal
 * chrome for the wrong role.
 */
export default function LuponLayout({ fontClass, children }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, isLoading } = useAuth();
  const sessionToastRef = useRef(false);
  const deniedToastRef = useRef(false);

  const permission = getLuponPermissionForPath(pathname);
  const roleMatches = Boolean(user) && user.role === "lupon";
  const allowed = roleMatches && (permission === null || canAccessLuponPage(user?.role, permission));

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
    if (user.role !== "lupon") {
      router.replace(getPostLoginRoute(user.role));
    }
  }, [isLoading, user, router]);

  useEffect(() => {
    if (isLoading || !user || user.role !== "lupon") {
      deniedToastRef.current = false;
      return;
    }
    if (permission !== null && !canAccessLuponPage(user.role, permission)) {
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
  if (user.role !== "lupon") return <Spinner />;

  return (
    <LuponShell fontClass={fontClass}>
      {allowed ? children : <Unauthorized role="lupon" />}
    </LuponShell>
  );
}
