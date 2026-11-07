import Link from "next/link";
import { ArrowLeft, ShieldAlert } from "lucide-react";
import { getDefaultRouteForRole } from "@/lib/permissions";

export default function Unauthorized({ role = "captain" }) {
  const dashboardHref = getDefaultRouteForRole(role);

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="w-full max-w-md rounded-2xl border border-line bg-white p-8 text-center shadow-sm">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-critical-soft">
          <ShieldAlert className="h-6 w-6 text-critical" aria-hidden="true" />
        </span>
        <h1 className="mt-4 font-heading text-xl font-bold tracking-tight text-navy">
          Access restricted
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Your account does not have permission to open this page.
        </p>
        <Link
          href={dashboardHref}
          className="mt-6 inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-secondary px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-navy focus-visible:outline-2 focus-visible:outline-secondary"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Return to Dashboard
        </Link>
      </div>
    </div>
  );
}
