import { useEffect, useState } from "react";
import {
  CheckCircle2,
  Copy,
  ExternalLink,
  Loader2,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";
import toast from "react-hot-toast";
import KioskQrCode from "./KioskQrCode";
import { Note } from "./KioskField";
import { formatRemaining } from "@/lib/kiosk/format";

/**
 * Screen 10 — Scan to upload evidence.
 *
 * The kiosk is the receiving end and the citizen's phone is the sending
 * end. That direction matters: it means no file dialog is ever opened on
 * the shared machine, so the previous walk-in's Downloads folder is never
 * exposed, and it means the kiosk can accept a photo taken on the phone
 * that took it.
 *
 * The QR payload is a signed, single-purpose upload token with a
 * ten-minute lifetime. It carries no name, no address and no complaint
 * text, which is what the privacy note on this screen claims, so the
 * claim is kept true by construction rather than by policy.
 *
 * The countdown is derived from the server's expiry, not from a local
 * timer started when the screen opened, so a kiosk with a wrong clock
 * cannot tell a citizen their code is still good after it has expired.
 */
export default function KioskQrEvidence({
  t,
  session,
  files = [],
  uploading = false,
  error,
  onRefresh,
  onContinue,
  onSkip,
}) {
  const [remaining, setRemaining] = useState(() => formatRemaining(session?.expiresAt));

  // The countdown only ever moves from the interval callback, never from
  // the effect body: a synchronous setState on mount would be a second
  // render for a value the lazy initialiser already got right. A change
  // of session remounts this component (the parent keys it by token), so
  // the initialiser always matches the current code.
  useEffect(() => {
    if (!session?.expiresAt) return undefined;
    const timer = setInterval(
      () => setRemaining(formatRemaining(session.expiresAt)),
      1000
    );
    return () => clearInterval(timer);
  }, [session?.expiresAt]);

  const expired = remaining === "0:00" || remaining === "0s";
  const uploadUrl = session?.uploadUrl || "";

  const copyUploadLink = async () => {
    try {
      await navigator.clipboard.writeText(uploadUrl);
      toast.success(t("qr.linkCopied"));
    } catch {
      toast.error(t("qr.copyFailed"));
    }
  };

  return (
    <div>
      <header className="mb-5 text-center">
        <h1 className="text-[21px] font-bold leading-tight tracking-tight text-navy sm:text-[24px]">
          {t("qr.title")}
        </h1>
        <p className="mx-auto mt-1.5 max-w-[440px] text-[15px] font-semibold leading-snug text-muted">
          {t("qr.instructions")}
        </p>
      </header>

      <div className="kiosk-card kiosk-card-pad">
        <div className="flex flex-col items-center">
          {uploadUrl ? (
            <KioskQrCode
              value={uploadUrl}
              size={224}
              label={t("qr.title")}
            />
          ) : (
            <div className="flex h-[224px] w-[224px] items-center justify-center rounded-[12px] border border-line bg-alt">
              <span role="alert" className="p-3 text-center text-sm text-critical">
                Local QR address unavailable. Ask staff to restart the kiosk with a valid LAN address.
              </span>
            </div>
          )}

          {/* Fallbacks for scanners that only show the recognised URL as
              plain, non-clickable text. Both use the exact string encoded
              in the QR above, so a fallback can never disagree with the
              code, and they are hidden while the code is still loading. */}
          {uploadUrl ? (
            <>
              <div className="mt-3 grid w-full max-w-[320px] grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={copyUploadLink}
                  className="kiosk-btn kiosk-btn-ghost"
                >
                  <Copy className="h-4 w-4" aria-hidden="true" />
                  {t("qr.copyLink")}
                </button>
                <a
                  href={uploadUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="kiosk-btn kiosk-btn-ghost"
                >
                  <ExternalLink className="h-4 w-4" aria-hidden="true" />
                  {t("qr.openLink")}
                </a>
              </div>
              <p className="mt-2 w-full max-w-[320px] break-all rounded-[8px] border border-line bg-alt/70 p-2 text-center text-[11.5px] leading-relaxed text-muted">
                {uploadUrl}
              </p>
            </>
          ) : null}

          {/* Expiry. Announced politely, not assertively: a per-second
              countdown read out loud would drown out everything else. */}
          <p
            className="mt-4 text-[13.5px] font-semibold text-mirage"
            aria-live="polite"
          >
            {expired ? (
              <span className="text-critical">{t("qr.expired")}</span>
            ) : (
              <>
                {t("qr.expiresIn")}{" "}
                <span className="font-bold text-navy tabular-nums">{remaining}</span>
              </>
            )}
          </p>
        </div>

        {/* Received count. This is the only feedback the citizen gets
            that the phone->kiosk hop actually worked, so it is
            prominent rather than a quiet line of grey text. */}
        <div className="mt-5 rounded-[12px] border border-line bg-alt/70 p-4 text-center">
          <p className="text-[13px] font-bold uppercase tracking-[0.08em] text-muted">
            {t("qr.waiting")}
          </p>
          <p className="mt-1.5 flex items-center justify-center gap-2 text-[19px] font-bold text-navy">
            {files.length > 0 ? (
              <CheckCircle2 className="h-5 w-5 text-success" aria-hidden="true" />
            ) : (
              <span
                className="h-2.5 w-2.5 animate-pulse rounded-full bg-gold"
                aria-hidden="true"
              />
            )}
            <span className="tabular-nums">{files.length}</span>
            <span className="text-[14px] font-semibold text-muted">
              {files.length === 1 ? t("qr.received") : t("qr.filesReceived")}
            </span>
          </p>
          <p className="sr-only" role="status" aria-live="polite">
            {files.length} {t("qr.filesReceived")}
          </p>
        </div>

        {error ? (
          <div
            role="alert"
            className="mt-4 flex items-start gap-2.5 rounded-[12px] border border-critical bg-critical-soft/60 p-3.5 text-[13px] font-medium leading-relaxed text-critical"
          >
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{t(error)}</span>
          </div>
        ) : null}

        <div className="mt-5 space-y-3">
          <button
            type="button"
            onClick={onContinue}
            disabled={expired}
            className="kiosk-btn kiosk-btn-primary kiosk-btn-block min-h-[52px] text-[16px]"
          >
            {t("received.review")}
          </button>

          <button
            type="button"
            onClick={onRefresh}
            disabled={expired || uploading}
            className="kiosk-btn kiosk-btn-ghost kiosk-btn-block"
          >
            {uploading ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
            )}
            {t("common.retry")}
          </button>

          <button
            type="button"
            onClick={onSkip}
            className="kiosk-btn kiosk-btn-quiet kiosk-btn-block"
          >
            {t("evidence.skip")}
          </button>
        </div>
      </div>

      <Note tone="info" className="mt-4">
        {t("qr.privacyNote")}
      </Note>
      <p className="mt-2 text-center text-[12.5px] text-muted">{t("qr.help")}</p>
    </div>
  );
}
