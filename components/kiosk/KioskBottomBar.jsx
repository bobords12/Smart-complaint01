import Link from "next/link";
import { ArrowLeft, ArrowRight, Check, Home } from "lucide-react";

/**
 * The kiosk's persistent bottom navigation.
 *
 * Fixed to the bottom, so `.kiosk-main` reserves the same height in its
 * padding. Without that reservation the last field on a step is covered
 * by this bar, which is the classic way a kiosk form becomes unfinishable
 * on a phone.
 *
 * Actions are disabled rather than hidden while a request is in flight,
 * so the layout never jumps and a double tap has nowhere to go.
 */
export default function KioskBottomBar({
  t,
  onBack,
  onNext,
  backLabel,
  nextLabel,
  nextVariant = "primary",
  nextIcon = "arrow",
  disabled = false,
  busy = false,
  nextDisabled = false,
  extra = null,
  showHome = false,
}) {
  const Icon = nextIcon === "check" ? Check : ArrowRight;

  return (
    <div className="kiosk-bottom kiosk-no-print">
      <div className="kiosk-bottom-inner">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            disabled={disabled || busy}
            className="kiosk-btn kiosk-btn-ghost kiosk-btn-block"
          >
            <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="truncate">{backLabel || t("nav.back")}</span>
          </button>
        ) : null}

        {extra}

        {onNext ? (
          <button
            type="button"
            onClick={onNext}
            disabled={disabled || busy || nextDisabled}
            aria-busy={busy || undefined}
            className={`kiosk-btn kiosk-btn-block kiosk-btn-${nextVariant}`}
          >
            {busy ? (
              <span
                className="kiosk-spin h-4 w-4 rounded-full border-2 border-current border-t-transparent"
                aria-hidden="true"
              />
            ) : (
              <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
            )}
            <span className="truncate">{nextLabel || t("nav.continue")}</span>
          </button>
        ) : null}

        {showHome ? (
          <Link
            href="/kiosk"
            className="kiosk-btn kiosk-btn-quiet shrink-0 px-4"
            aria-label={t("nav.main")}
          >
            <Home className="h-4 w-4" aria-hidden="true" />
          </Link>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Screen-reader announcements for state changes that are otherwise
 * purely visual, e.g. "3 files received".
 *
 * Kept to one small polite region per page rather than a live region per
 * component; several competing regions make a screen reader unusable.
 */
export function KioskLiveRegion({ message }) {
  return (
    <p className="sr-only" aria-live="polite" aria-atomic="true">
      {message}
    </p>
  );
}