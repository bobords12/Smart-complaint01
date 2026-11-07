import Link from "next/link";
import {
  CheckCircle2,
  Copy,
  ExternalLink,
  Info,
  Printer,
  TriangleAlert,
} from "lucide-react";
import toast from "react-hot-toast";
import KioskQrCode from "./KioskQrCode";
import { Note } from "./KioskField";
import { formatDateTime } from "@/lib/kiosk/format";
import { buildKioskStatusUrl } from "@/lib/kiosk/urls";

/**
 * Screen 14 — Complaint filed successfully.
 *
 * The tracking number is the whole point of this screen, so it is the
 * largest thing on it, set in a monospaced font so it cannot be
 * misread, and repeated for printing.
 *
 * Two disclaimers are both shown, never one of them:
 *
 *  - "not yet an official case" — prevents a citizen from treating a
 *    receipt as a case number or a PNP blotter entry.
 *  - the actual next-steps chain, because a complaint that is filed and
 *    then apparently ignored is the most common way a barangay loses a
 *    complainant's trust.
 *
 * The QR code points at the resident-safe status page and carries only
 * the opaque status token. It is generated here and not returned by the
 * server, which is the point: the token lives with the citizen.
 */
export default function KioskSuccess({ t, language, receipt, lanOrigin, onDone }) {
  const reference = receipt?.referenceNumber || "";
  // The LAN origin is selected at startup, even when this browser uses localhost.
  const statusUrl = receipt?.statusToken
    ? buildKioskStatusUrl(lanOrigin, receipt.statusToken)
    : "";

  const copyStatusLink = async () => {
    try {
      await navigator.clipboard.writeText(statusUrl);
      toast.success(t("qr.linkCopied"));
    } catch {
      toast.error(t("qr.copyFailed"));
    }
  };

  return (
    <div className="kiosk-page">
      <main className="kiosk-main">
        <div className="text-center">
          <CheckCircle2
            className="mx-auto h-16 w-16 text-success"
            aria-hidden="true"
            strokeWidth={1.75}
          />
          <h1 className="mt-4 text-[22px] font-bold leading-tight tracking-tight text-navy sm:text-[26px]">
            {t("success.title")}
          </h1>
        </div>

        {/* The tracking number gets its own bordered block so it reads as
            a value to copy rather than as another line of body text. */}
        <div className="kiosk-card mt-6 kiosk-card-pad text-center">
          <p className="text-[11.5px] font-bold uppercase tracking-[0.1em] text-muted">
            {t("success.tracking")}
          </p>
          <p className="mt-2 font-mono text-[26px] font-bold tracking-[0.06em] text-navy sm:text-[30px]">
            {reference}
          </p>
          <p className="mt-2 text-[13px] text-muted">
            {t("status.filed")}: {formatDateTime(receipt?.submittedAt, language)}
          </p>
        </div>

        {/* The SMS confirmation is a QUEUED job, not a delivered
            message. The receipt says the SMS is being processed and
            stops there: claiming a delivery nobody has verified would
            be a lie the citizen finds out about later. It is hidden
            from the printed receipt so the printout stays exactly what
            it was. */}
        {receipt?.smsQueued ? (
          <Note tone="info" className="mt-4 kiosk-no-print">
            {t("success.smsQueued")}
          </Note>
        ) : null}

        {/* Shown ONLY when the server linked fewer files than the
            citizen sent — typically an upload session that expired
            between upload and submit. The complaint itself IS filed
            (the tracking number above is real), so this is a partial
            failure stated plainly, never a silent fold into the
            generic success message. role="alert" because a citizen
            who uploaded evidence must be told the attachments did
            not all make it. */}
        {receipt?.evidencePartial ? (
          <div
            role="alert"
            className="mt-4 flex items-start gap-2.5 rounded-[12px] border border-warning/35 bg-warning-soft p-3.5 text-[12.5px] font-medium leading-relaxed text-warning"
          >
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
              {t("success.evidencePartial", {
                linked: receipt.evidencePartial.linked,
                expected: receipt.evidencePartial.expected,
              })}
            </span>
          </div>
        ) : null}

        {receipt?.statusToken && !statusUrl ? (
          <div role="alert" className="kiosk-card mt-4 kiosk-card-pad text-center text-critical">
            Local QR address unavailable. Ask staff to restart the kiosk with a valid LAN address.
          </div>
        ) : null}

        {statusUrl ? (
          <div className="kiosk-card mt-4 kiosk-card-pad text-center">
            <p className="text-[13.5px] font-semibold text-mirage">
              {t("success.statusQr")}
            </p>
            <p className="mt-1 text-[12.5px] text-muted">
              {t("success.statusQrHint")}
            </p>
            <div className="mt-3 flex justify-center">
              <KioskQrCode
                value={statusUrl}
                size={232}
                label={t("success.tracking")}
              />
            </div>

            {/* Fallbacks for scanners (e.g. Smart Scanner) that only show
                the recognised URL as plain, non-clickable text. Both use
                the exact string encoded in the QR above, so the fallback
                can never disagree with the code. */}
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={copyStatusLink}
                className="kiosk-btn kiosk-btn-ghost"
              >
                <Copy className="h-4 w-4" aria-hidden="true" />
                {t("qr.copyLink")}
              </button>
              <a
                href={statusUrl}
                target="_blank"
                rel="noreferrer"
                className="kiosk-btn kiosk-btn-ghost"
              >
                <ExternalLink className="h-4 w-4" aria-hidden="true" />
                {t("qr.openLink")}
              </a>
            </div>

            {/* Shown in small type so it reads as a copy target, not as
                body copy. */}
            <p className="mt-2 break-all rounded-[8px] border border-line bg-alt/70 p-2 text-[11.5px] leading-relaxed text-muted">
              {statusUrl}
            </p>

            <p className="mt-3 text-[12.5px] text-muted">{t("qr.privacyNote")}</p>

            {/* Keeping the resident on the same screen that owns the
                token means nobody has to photograph the code. It is a
                plain link, so the printed receipt and the kiosk offer
                the identical two routes into the same status page. */}
            <Link
              href={`/kiosk/status/${encodeURIComponent(receipt.statusToken)}`}
              className="kiosk-btn kiosk-btn-ghost kiosk-btn-block mt-4"
            >
              {t("success.statusQrAction")}
            </Link>

            {/* The kiosk never scans this code for the resident; this
                quiet link explains how to track with their own phone. */}
            <Link
              href="/kiosk/track"
              className="mt-3 inline-block text-[13px] font-semibold text-secondary underline underline-offset-2"
            >
              {t("track.title")}
            </Link>
          </div>
        ) : null}

        <div className="mt-4 space-y-3">
          <button
            type="button"
            onClick={() => window.print()}
            className="kiosk-btn kiosk-btn-primary kiosk-btn-block min-h-[52px] text-[16px]"
          >
            <Printer className="h-5 w-5" aria-hidden="true" />
            {t("success.print")}
          </button>

          <button
            type="button"
            onClick={onDone}
            className="kiosk-btn kiosk-btn-ghost kiosk-btn-block"
          >
            {t("success.done")}
          </button>
        </div>

        {/* The "not an official case" line is the important one, so it
            is styled as a caution rather than a footnote. */}
        <div
          role="note"
          className="mt-5 flex items-start gap-2.5 rounded-[12px] border border-warning/35 bg-warning-soft p-3.5 text-[12.5px] font-medium leading-relaxed text-warning"
        >
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{t("success.disclaimer")}</span>
        </div>

        <Note tone="info" className="mt-4">
          <span className="flex items-start gap-2">
            <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{t("success.nextSteps")}</span>
          </span>
        </Note>

        <p className="mt-4 text-center text-[12.5px] text-muted">{t("success.notice")}</p>
      </main>
    </div>
  );
}
