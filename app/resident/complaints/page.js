import { Suspense } from "react";
import MyComplaints from "@/components/resident/MyComplaints";

export const metadata = {
  title: { absolute: "My Complaints | SCBMS Barangay Abuno" },
};

export default function MyComplaintsPage() {
  return (
    <Suspense
      fallback={
        <p className="py-10 text-center text-sm text-muted">
          Loading complaints…
        </p>
      }
    >
      <MyComplaints />
    </Suspense>
  );
}