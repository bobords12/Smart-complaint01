import { CheckCircle2 } from "lucide-react";

/**
 * Screen 12 — "Got it, reviewing your complaint".
 *
 * A brief acknowledgement between the evidence choice and the review
 * screen. It exists in the reference design as a distinct state, and it
 * earns its place by confirming out loud that everything was captured
 * before the citizen is asked to read it all back.
 *
 * Purely presentational: it holds no state and is shown for a fixed beat
 * by the orchestrator, which then moves on by itself. Nothing here can
 * fail or block.
 */
export default function KioskReviewing({ t }) {
  return (
    <div className="flex min-h-[calc(100dvh-64px)] items-center justify-center px-5 py-10">
      <div className="w-full max-w-[420px] text-center">
        <CheckCircle2
          className="mx-auto h-16 w-16 text-success"
          aria-hidden="true"
          strokeWidth={1.75}
        />

        <h1 className="mt-5 text-[21px] font-bold leading-snug text-navy sm:text-[24px]">
          {t("reviewing.title")}
        </h1>
        <p className="mt-2 text-[15px] font-semibold leading-snug text-muted">
          {t("reviewing.subtitle")}
        </p>

        {/* Announced as a live region so a screen-reader user is told the
            kiosk has moved on, rather than the change being silent. */}
        <p className="mt-6 flex items-center justify-center gap-2.5 text-[13.5px] font-semibold text-secondary">
          <span
            className="h-2 w-2 animate-pulse rounded-full bg-secondary"
            aria-hidden="true"
          />
          {t("common.loading")}
          <span className="sr-only" role="status">
            {t("common.loading")}
          </span>
        </p>
      </div>
    </div>
  );
}