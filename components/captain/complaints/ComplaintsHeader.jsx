"use client";

import { useRouter } from "next/navigation";
import { Download, FilePlus2 } from "lucide-react";
import { useOfficialRoutes } from "@/components/official/OfficialPortalProvider";

export default function ComplaintsHeader({ onExport, busy }) {
  const router = useRouter();
  const routes = useOfficialRoutes();

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div>
        <h1 className="font-heading text-2xl font-bold tracking-tight text-navy sm:text-3xl">
          Complaints
        </h1>
        <p className="mt-1 text-sm text-muted">
          Review and manage barangay complaints.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onExport}
          disabled={busy}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-full border border-line bg-white px-5 text-sm font-semibold text-navy transition-colors hover:bg-alt disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Download className="h-4 w-4" aria-hidden="true" />
          Export List
        </button>
        <button
          type="button"
          onClick={() => router.push(routes.encodeComplaint)}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-jordy px-5 text-sm font-semibold text-white shadow-button transition-colors hover:bg-secondary"
        >
          <FilePlus2 className="h-4 w-4" aria-hidden="true" />
          Encode Complaint
        </button>
      </div>
    </div>
  );
}