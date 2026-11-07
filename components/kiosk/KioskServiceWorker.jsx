"use client";

import { useEffect } from "react";

import { prepareQueue, requestBackgroundSync, syncQueue } from "@/lib/kiosk/sync";

/**
 * Mounted once, in app/kiosk/layout.js.
 *
 * Three jobs, all of which have to happen before the citizen touches
 * anything:
 *
 *  1. Register the service worker, scoped to /kiosk/ so it cannot
 *     intercept a single request belonging to a staff portal.
 *  2. Drain the offline queue on arrival, because a queued complaint is
 *     worthless if nobody wakes it up.
 *  3. Register a Background Sync tag, so a complaint saved while the hall
 *     had no internet still sends itself after the tab is closed.
 *
 * Deliberately NOT done here:
 *
 *  - No update prompt. A kiosk should never interrupt a citizen
 *    mid-complaint to say a new version is available. `skipWaiting` is
 *    wired to a message but nothing sends it; an update is picked up on
 *    the next natural navigation, which is the correct behaviour for
 *    unattended shared hardware.
 *  - No claim on the staff portals. The layout that renders this is
 *    app/kiosk/layout.js, so resident/captain/oic/secretary/lupon/pnp
 *    pages never load this component at all.
 *
 * Every branch here is optional. A browser with no service worker, no
 * Background Sync, or no IndexedDB still files complaints online, and the
 * kiosk's own drain (a 30s interval plus the `online` event) covers
 * offline retries while the tab is open.
 */
export default function KioskServiceWorker() {
  // ── Registration ────────────────────────────────────────────
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    let cancelled = false;

    navigator.serviceWorker
      .register("/sw.js", { scope: "/kiosk/" })
      .then(() => {
        // Ask for the wake-up call as soon as the worker is live, so a
        // complaint queued on a previous visit is not left waiting for
        // the next page load.
        if (!cancelled) requestBackgroundSync().catch(() => {});
      })
      .catch(() => {
        // Registration fails on plain http on a LAN address, in a
        // private window on some platforms, and when the kiosk policy
        // blocks workers. None of that is fatal: the kiosk still files
        // online and still retries offline from the page.
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // ── Drain on arrival and on reconnect ───────────────────────
  useEffect(() => {
    const drain = () => {
      syncQueue()
        .then((summary) => {
          if (summary.synced > 0) requestBackgroundSync().catch(() => {});
        })
        .catch(() => {});
    };

    prepareQueue()
      .then(drain)
      .catch(() => {});

    window.addEventListener("online", drain);

    // A worker-driven sync posts back to the open tab; surfacing it is
    // what lets the offline receipt flip to "synced" without a reload.
    if ("serviceWorker" in navigator) {
      const onMessage = (event) => {
        if (event.data && event.data.type === "kiosk:synced") drain();
      };
      navigator.serviceWorker.addEventListener("message", onMessage);
      return () => {
        window.removeEventListener("online", drain);
        navigator.serviceWorker.removeEventListener("message", onMessage);
      };
    }

    return () => window.removeEventListener("online", drain);
  }, []);

  return null;
}
