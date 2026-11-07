"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";

export default function AuthGuard({ children }) {
  const router = useRouter();
  const { isAuthenticated, isLoading } = useAuth();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace("/");
    }
  }, [isLoading, isAuthenticated, router]);

  if (isLoading) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex min-h-dvh items-center justify-center bg-canvas"
      >
        <div className="flex flex-col items-center gap-4">
          <span
            aria-hidden="true"
            className="h-11 w-11 animate-spin rounded-full border-4 border-alt border-t-secondary"
          />
          <p className="text-sm text-muted">
            Verifying your session…
          </p>
        </div>
        <span className="sr-only">Loading, please wait.</span>
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  return children;
}
