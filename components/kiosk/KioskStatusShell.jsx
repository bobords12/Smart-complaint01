"use client";

import { useRouter } from "next/navigation";

import KioskHeader from "./KioskHeader";
import KioskInactivityModal from "./KioskInactivityModal";
import {
  useKioskConnection,
  useKioskInactivity,
  useKioskLanguage,
} from "@/hooks/useKioskSession";

/**
 * Shell for the two resident-facing status routes.
 *
 * These pages are NOT part of the filing wizard, so there are two
 * deliberate differences from app/kiosk/page.jsx:
 *
 *  1. The header is rendered with `header={null}`, which makes
 *     KioskHeader omit the progress bar entirely. There is no
 *     meaningful step here, and showing "Step 1 of 7" on a status
 *     lookup would misstate where the citizen is in the flow.
 *  2. The inactivity timer still runs, and is not suspended on the
 *     result. A status page can sit on an unattended hall screen holding
 *     a resident's tracking number, so it warns after the same four
 *     minutes and then returns to the welcome screen.
 *
 * There is no fixed bottom bar here, unlike the wizard. These pages are
 * read-only and scroll, and a fixed bar could only ever cover the result
 * the citizen had just scrolled down to.
 */
export default function KioskStatusShell({ children }) {
  const router = useRouter();
  const { t, language, toggle } = useKioskLanguage();
  const connection = useKioskConnection();

  // Nothing on a status page is a draft worth keeping, so the timeout
  // simply leaves: the page unmounts, the fetched payload is dropped with
  // it, and the shared screen goes back to the welcome page.
  const inactivity = useKioskInactivity({
    onTimeout: () => router.replace("/kiosk"),
  });

  return (
    <>
      <KioskHeader
        t={t}
        header={null}
        progressPercent={0}
        connection={connection.state}
        language={language}
        onToggleLanguage={toggle}
      />

      <main id="kiosk-main" className="kiosk-main">
        {children}
      </main>

      {inactivity.warning ? (
        <KioskInactivityModal
          t={t}
          remaining={inactivity.remaining}
          onStay={inactivity.dismiss}
        />
      ) : null}
    </>
  );
}
