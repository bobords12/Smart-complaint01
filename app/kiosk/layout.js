import KioskServiceWorker from "@/components/kiosk/KioskServiceWorker";

import "./kiosk.css";

/**
 * The kiosk is deliberately OUTSIDE every portal's protection.
 *
 * middleware.ts matches this path but findPortal() returns undefined
 * for it, so no session is required and none is created. A walk-in
 * filing a complaint must never inherit a staff account that happens to
 * be signed in on the hall's machine, which is why the kiosk API also
 * builds its Supabase client without cookies.
 *
 * Two things are intentionally NOT here:
 *
 *  - Providers. The root layout already mounts AuthProvider and the
 *    single react-hot-toast <Toaster />, and a second Toaster would
 *    double every toast. Mounting it again would also re-trigger the
 *    session lookup the root has already done.
 *  - Any portal navigation. A citizen at the kiosk has no role, so
 *    there is no sidebar, top bar, or role menu to render.
 *
 * `kiosk.css` is imported here rather than in globals.css so the kiosk's
 * print rules and its fixed bottom bar cannot leak into the staff
 * portals, which have their own print and layout styles.
 *
 * KioskServiceWorker IS here, and only here, so the worker is registered
 * once for the whole kiosk subtree — the wizard, the two status routes and
 * the phone upload page — and for no portal at all. The staff layouts do
 * not import this file, so nothing under /resident, /captain, /oic,
 * /secretary, /lupon or /pnp is ever in the worker's scope.
 */
export const metadata = {
  title: "Public Kiosk Portal",
  description:
    "File a barangay complaint at the Barangay Abuno Hall without an account.",
  // A walk-in has no business in a search index, and the status pages
  // behind the QR codes must never be cached by a proxy.
  robots: { index: false, follow: false, nocache: true },
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Abuno Kiosk",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [
      { url: "/kiosk-icon.svg", type: "image/svg+xml" },
      { url: "/Abunoi.jpg", type: "image/jpeg", sizes: "612x612" },
    ],
    apple: [{ url: "/Abunoi.jpg", sizes: "612x612", type: "image/jpeg" }],
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  // The kiosk runs on shared touch hardware; pinch zoom must stay
  // available so a resident who cannot read the default size is not stuck.
  maximumScale: 5,
  userScalable: true,
  themeColor: "#0E2F5C",
};

export default function KioskLayout({ children }) {
  return (
    <div className="kiosk-root">
      {/* Registers /sw.js for the /kiosk/ scope and drains the offline
          outbox on arrival. Renders nothing. */}
      <KioskServiceWorker />
      {children}
    </div>
  );
}