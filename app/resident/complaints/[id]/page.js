import { Suspense } from "react";
import ComplaintDetailView from "@/components/resident/ComplaintDetailView";

export const metadata = {
  title: { absolute: "Complaint Detail | SCBMS Barangay Abuno" },
};

export default async function ComplaintDetailPage({ params }) {
  const { id } = await params;
  return (
    <Suspense
      fallback={
        <p className="py-10 text-center text-sm text-muted">
          Loading complaint details…
        </p>
      }
    >
      <ComplaintDetailView complaintId={id} />
    </Suspense>
  );
}
