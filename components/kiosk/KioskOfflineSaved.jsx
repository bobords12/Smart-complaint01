import { CloudOff, Loader2, CheckCircle2, TriangleAlert, Clock } from "lucide-react";
import { Note } from "./KioskField";
import { formatDateTime } from "@/lib/kiosk/format";

/**
 * Screen 16 — Complaint saved, pending sync.
 *
 * The offline receipt. This is the most delicate screen in the kiosk,
 * because it has to be honest about something that has NOT happened.
 *
 * What actually happened: the complaint is encrypted in this device's
 * IndexedDB under a non-extractable key, and it will be sent when the
 * connection returns. What has NOT happened: the barangay has not
 * received it, no reference number exists, and no staff member has seen
 * it.
 *
 * So this screen never shows an official-looking tracking number. It
 * shows a local offline reference and says, in bold, that it is not an
 * official complaint number and that synchronisation is still pending.
 *
 * The same screen covers the whole life of the entry, so the citizen can
 * leave the kiosk and still come back to it:
 *
 *   pending   saved, waiting for a connection
 *   syncing   bytes are moving right now
 *   synced    the barangay has it, and the real reference number is now
 *             authoritative
 *   failed    it will be retried, and the citizen is told to ask staff
 *             rather than to sit and wait
 */
export default function KioskOfflineSaved({ t, language, receipt, state, onDone, onRetry }) {
  const reference = receipt?.referenceNumber || "";
  const isSyncing = state === "syncing";
  const isSynced = state === "synced";
  const isFailed = state === "failed";

  return (
    <div className="kiosk-page">
      <main className="kiosk-main">
        <div className="text-center">
          {isSynced ? (
            <CheckCircle2
              className="mx-auto h-16 w-16 text-success"
              aria-hidden="true"
              strokeWidth={1.75}
            />
          ) : (
            <CloudOff
              className="mx-auto h-16 w-16 text-warning"
              aria-hidden="true"
              strokeWidth={1.75}
            />
          )}

          <h1 className="mt-4 text-[22px] font-bold leading-tight tracking-tight text-navy sm:text-[26px]">
            {isSynced ? t("offline.synced") : t("offline.savedTitle")}
          </h1>
          <p className="mt-1.5 text-[15px] font-semibold text-muted">
            {t("offline.banner")} &middot; {t("offline.bannerPil")}
          </p>
        </div>

        {/* Sync state, announced. A citizen who walks away and comes back
            gets told where the entry actually got to. */}
        <div
          className="kiosk-card mt-6 kiosk-card-pad text-center"
          aria-live="polite"
          aria-atomic="true"
        >
          <span
            className={`kiosk-badge ${
              isSynced ? "kiosk-badge-done" : isFailed ? "kiosk-badge-critical" : "kiosk-badge-warning"
            }`}
          >
            {isSynced ? (
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <Clock className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            {isSynced ? t("offline.synced") : t("offline.pendingStatus")}
          </span>

          <p className="mt-4 text-[11.5px] font-bold uppercase tracking-[0.1em] text-muted">
            {t("offline.reference")}
          </p>
          <p className="mt-1.5 font-mono text-[22px] font-bold tracking-[0.05em] text-navy">
            {reference}
          </p>

          {receipt?.queuedAt ? (
            <p className="mt-2 text-[12.5px] text-muted">
              {t("offline.savedAt")} {formatDateTime(receipt.queuedAt, language)}
            </p>
          ) : null}
        </div>

        {isSyncing ? (
          <p className="mt-4 flex items-center justify-center gap-2.5 text-[13.5px] font-semibold text-secondary">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            {t("offline.syncing")}
          </p>
        ) : null}

        {isFailed ? (
          <div
            role="alert"
            className="mt-4 flex items-start gap-2.5 rounded-[12px] border border-critical bg-critical-soft/60 p-3.5 text-[13px] font-medium leading-relaxed text-critical"
          >
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{t("offline.syncFailed")}</span>
          </div>
        ) : null}

        {/* Shown in every not-yet-synced state. This sentence is the
            reason the screen is trustworthy. */}
        {isSynced ? null : (
          <div
            role="note"
            className="mt-4 flex items-start gap-2.5 rounded-[12px] border border-warning/35 bg-warning-soft p-3.5 text-[12.5px] font-medium leading-relaxed text-warning"
          >
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{t("offline.pendingNotice")}</span>
          </div>
        )}

        {isSynced ? null : (
          <Note tone="info" className="mt-4">
            {t("offline.instructions")}
          </Note>
        )}

        <div className="mt-6 space-y-3">
          {isFailed ? (
            <button
              type="button"
              onClick={onRetry}
              className="kiosk-btn kiosk-btn-primary kiosk-btn-block min-h-[52px] text-[16px]"
            >
              {t("common.retry")}
            </button>
          ) : null}

          <button
            type="button"
            onClick={onDone}
            className="kiosk-btn kiosk-btn-ghost kiosk-btn-block"
          >
            {t("nav.done")}
          </button>
        </div>

        <p className="mt-4 text-center text-[12px] text-muted">{t("offline.queuedHidden")}</p>
      </main>
    </div>
  );
}