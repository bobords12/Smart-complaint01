"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import toast from "react-hot-toast";

import KioskStatusShell from "@/components/kiosk/KioskStatusShell";
import KioskStatusResult, {
  KioskStatusHeading,
  KioskStatusPendingSync,
} from "@/components/kiosk/KioskStatusResult";
import { useKioskLanguage } from "@/hooks/useKioskSession";
import { fetchStatusByToken } from "@/lib/kiosk/api";
import { STATUS_TOKEN_PATTERN } from "@/lib/kiosk/config";
import { getFingerprint } from "@/lib/kiosk/device";

/**
 * Screen 18 — the status page a receipt's QR code opens.
 *
 * The token in the URL is the only credential. It is 64 hex characters of
 * CSPRNG output, the database stores just its SHA-256 digest alongside the
 * reference number, and the RPC is rate limited per device. Nothing about
 * the complainant is in the link and nothing is enumerable: the token is
 * not sequential and carries no record id.
 *
 * Two response shapes, and the difference between them is deliberate:
 *
 *  - `found`        the complaint exists; render the timeline.
 *  - `pending_sync` either an offline receipt that has not synced yet, or
 *                   a token that is unknown, expired or revoked. The
 *                   database collapses all four into one answer so this
 *                   endpoint cannot be used to discover which complaints
 *                   exist. This screen therefore never says "no such
 *                   complaint".
 *
 * A malformed token is rejected locally, before any request, so an
 * obviously wrong link produces an immediate message instead of consuming
 * a rate-limit slot.
 *
 * Loading is derived rather than set from the effect body: `attempt`
 * counts how many times the citizen asked, `settled` records which attempt
 * actually answered, and anything in between is showing the spinner. That
 * keeps the effect to a single subscription with no synchronous setState,
 * which is also why a retry cannot flash the previous error first.
 */
export default function KioskStatusTokenPage() {
  const params = useParams();
  const { t, language } = useKioskLanguage();

  const token = typeof params?.secure_token === "string" ? params.secure_token : "";
  const tokenValid = STATUS_TOKEN_PATTERN.test(token);

  const [attempt, setAttempt] = useState(0);
  const [settled, setSettled] = useState(null);
  const [payload, setPayload] = useState(null);
  const [errorKey, setErrorKey] = useState(null);

  useEffect(() => {
    if (!tokenValid) return undefined;

    let cancelled = false;

    (async () => {
      try {
        // The fingerprint is the kiosk's stable, non-secret device id. It
        // is used only for rate limiting; it is not an authorisation and
        // grants nothing on its own.
        const fingerprint = await getFingerprint();
        if (cancelled) return;

        const response = await fetchStatusByToken({ token, fingerprint });
        if (cancelled) return;

        const status = response.status || response;
        setPayload(status);
        setErrorKey(null);
        setSettled({ attempt, kind: status?.state === "found" ? "found" : "pending" });
      } catch (error) {
        if (cancelled) return;
        const offline = error?.code === "network" || error?.code === "unavailable";
        setErrorKey(offline ? "err.network" : "err.lookupUnavailable");
        setSettled({ attempt, kind: "error" });
        // Toasts cover the asynchronous outcome of a lookup the citizen
        // initiated. The inline alert below is the accessible copy.
        toast.error(t(offline ? "err.network" : "err.lookupUnavailable"));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [attempt, t, token, tokenValid]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  let view;
  if (!tokenValid) {
    view = <StatusError message={t("status.invalidLink")} onRetry={null} t={t} />;
  } else if (!settled || settled.attempt !== attempt) {
    view = <Loading t={t} />;
  } else if (settled.kind === "error") {
    view = <StatusError message={t(errorKey || "err.lookupUnavailable")} onRetry={retry} t={t} />;
  } else if (settled.kind === "pending") {
    view = <KioskStatusPendingSync t={t} />;
  } else {
    view = (
      <KioskStatusResult
        payload={payload}
        t={t}
        language={language}
        statusToken={token}
      />
    );
  }

  return (
    <KioskStatusShell>
      <KioskStatusHeading t={t} />
      {view}
    </KioskStatusShell>
  );
}

function StatusError({ message, onRetry, t }) {
  return (
    <div className="space-y-4">
      <div role="alert" className="kiosk-card kiosk-card-pad text-center">
        <p className="text-[15px] leading-relaxed font-semibold text-critical">{message}</p>
      </div>
      {onRetry ? (
        <button type="button" onClick={onRetry} className="kiosk-btn kiosk-btn-ghost kiosk-btn-block">
          {t("common.retry")}
        </button>
      ) : null}
    </div>
  );
}

function Loading({ t }) {
  return (
    <div className="flex flex-col items-center py-10 text-center">
      <span
        aria-hidden="true"
        className="kiosk-spin h-8 w-8 rounded-full border-[3px] border-alt border-t-navy"
      />
      <p className="mt-4 text-[14px] font-medium text-muted" aria-live="polite">
        {t("common.loading")}
      </p>
    </div>
  );
}
