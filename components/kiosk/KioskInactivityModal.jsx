"use client";

import { useEffect, useRef } from "react";
import { Clock } from "lucide-react";

/**
 * Screen 17 — Inactivity warning.
 *
 * A modal dialog with a live countdown, and the component that has the
 * most to get wrong in the whole kiosk.
 *
 *  - Focus moves into the dialog when it opens and returns to the page
 *    when it closes, so keyboard users are not stranded behind an
 *    overlay.
 *  - Escape does NOT dismiss it. Letting Escape close a privacy timeout
 *    would let somebody wave the countdown away without answering, which
 *    defeats the entire mechanism.
 *  - The countdown is announced politely, once per second. It is not
 *    assertive: an assertive live region would interrupt whatever the
 *    citizen was doing every second for thirty seconds.
 *  - The remaining time is taken from the timer that already owns the
 *    countdown, never from a second clock started here. Two clocks is how
 *    a dialog ends up promising thirty seconds and delivering twenty.
 */
export default function KioskInactivityModal({ t, remaining, onStay }) {
  const dialogRef = useRef(null);
  const buttonRef = useRef(null);
  const previousFocus = useRef(null);

  useEffect(() => {
    previousFocus.current = document.activeElement;
    buttonRef.current?.focus();

    return () => {
      // Return focus to whatever the citizen was using before the
      // overlay appeared.
      const target = previousFocus.current;
      if (target && typeof target.focus === "function") target.focus();
    };
  }, []);

  return (
    <div
      className="kiosk-modal-backdrop"
      role="presentation"
      onPointerDown={(event) => {
        // A tap on the backdrop counts as activity, but it must not
        // dismiss: the only way out is the button. Pointer events are
        // stopped so the inertness below is not decorative.
        event.stopPropagation();
      }}
    >
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="kiosk-inactivity-title"
        aria-describedby="kiosk-inactivity-body"
        className="kiosk-modal-panel"
      >
        <Clock className="mx-auto h-12 w-12 text-warning" aria-hidden="true" strokeWidth={1.75} />

        <h2
          id="kiosk-inactivity-title"
          className="mt-4 text-center text-[21px] font-bold leading-snug text-navy"
        >
          {t("inactivity.title")}
        </h2>
        <p className="mt-1 text-center text-[14px] font-semibold text-muted">
          {t("inactivity.subtitle")}
        </p>

        <p
          id="kiosk-inactivity-body"
          className="mt-5 text-center text-[14px] leading-relaxed text-mirage"
        >
          {t("review.privacyLabel")}
        </p>

        {/* Large, tabular countdown so the digits do not jitter. */}
        <p className="mt-5 text-center" aria-live="polite" aria-atomic="true">
          <span className="text-[42px] font-bold leading-none text-navy tabular-nums">
            {remaining}
          </span>
          <span className="ml-1.5 text-[15px] font-semibold text-muted">
            {t("inactivity.seconds")}
          </span>
        </p>

        <button
          ref={buttonRef}
          type="button"
          onClick={onStay}
          className="kiosk-btn kiosk-btn-primary kiosk-btn-block mt-6 min-h-[52px] text-[16px]"
        >
          {t("inactivity.stillHere")}
        </button>
        <p className="mt-2 text-center text-[13px] font-semibold text-muted">
          {t("inactivity.stillHerePil")}
        </p>
      </div>
    </div>
  );
}
