import { Suspense } from "react";
import HearingsNotices from "@/components/resident/HearingsNotices";

export const metadata = {
  title: { absolute: "Hearings & Notices | SCBMS Barangay Abuno" },
};

/**
 * The hearings page is the resident's hearing workspace and reads the
 * `?hearing=` / `?section=` deep links a notification pushes, so it has to
 * sit inside Suspense.
 */
export default function HearingsPage() {
  return (
    <Suspense
      fallback={
        <p className="py-10 text-center text-sm text-muted">Loading hearings…</p>
      }
    >
      <HearingsNotices />
    </Suspense>
  );
}
