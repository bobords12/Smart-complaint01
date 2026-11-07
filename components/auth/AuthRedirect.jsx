"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { getPostLoginRoute } from "@/lib/roleRoutes";

export default function AuthRedirect({ children }) {
  const router = useRouter();
  const { isAuthenticated, isLoading, user } = useAuth();

  useEffect(() => {
    if (!isLoading && isAuthenticated && user) {
      const redirectRoute = getPostLoginRoute(user.role);
      router.replace(redirectRoute);
    }
  }, [isLoading, isAuthenticated, user, router]);

  if (isLoading) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex min-h-dvh items-center justify-center bg-navy"
      >
        <div className="flex flex-col items-center gap-4">
          <span
            aria-hidden="true"
            className="h-11 w-11 animate-spin rounded-full border-4 border-white/20 border-t-gold"
          />
          <p className="text-sm text-white/70">
            Checking your session…
          </p>
        </div>
      </div>
    );
  }

  if (isAuthenticated) {
    return null;
  }

  return children;
}
