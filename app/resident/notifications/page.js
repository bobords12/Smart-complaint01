import { Suspense } from "react";
import NotificationsPage from "@/components/resident/NotificationsPage";

export const metadata = {
  title: { absolute: "Notifications | SCBMS Barangay Abuno" },
};

export default function NotificationsRoute() {
  return (
    <Suspense
      fallback={
        <p className="py-10 text-center text-sm text-muted">
          Loading notifications…
        </p>
      }
    >
      <NotificationsPage />
    </Suspense>
  );
}