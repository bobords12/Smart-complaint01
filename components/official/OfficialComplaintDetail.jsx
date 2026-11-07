"use client";

import { useParams, useSearchParams } from "next/navigation";
import CaseViewer from "@/components/captain/complaints/CaseViewer";

export default function ComplaintDetailPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const complaintId = params?.id;
  const initialTab = searchParams?.get("tab") || undefined;

  if (!complaintId) {
    return (
      <div className="mx-auto max-w-[1200px] py-10 text-sm text-muted">
        No complaint reference was provided.
      </div>
    );
  }

  return <CaseViewer complaintId={complaintId} initialTab={initialTab} />;
}
