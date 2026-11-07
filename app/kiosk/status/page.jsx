"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { Search } from "lucide-react";

import KioskStatusShell from "@/components/kiosk/KioskStatusShell";
import KioskStatusResult, {
  KioskStatusHeading,
} from "@/components/kiosk/KioskStatusResult";
import { Field, TextInput, Note } from "@/components/kiosk/KioskField";
import { useKioskLanguage } from "@/hooks/useKioskSession";
import { fetchStatusByLookup } from "@/lib/kiosk/api";
import { getFingerprint } from "@/lib/kiosk/device";
import { isValidPhMobile } from "@/lib/kiosk/validation";

/**
 * Screen 15 — manual status lookup.
 *
 * For the citizen who lost the printed slip. Two facts are required and
 * neither is sufficient alone:
 *
 *   tracking number (complaints.reference_number)
 * + the mobile number given at filing
 *
 * Both are compared inside kiosk_status_lookup(), which normalises the
 * mobile in SQL rather than trusting the browser, and which raises the
 * same message for "no such tracking number", "wrong mobile" and "that
 * combination does not exist". That is why this screen shows one generic
 * error and never says which half was wrong: telling a stranger that
 * AB-2026-00042 exists, before they have proved they own it, is exactly
 * the leak this design refuses.
 *
 * The endpoint is rate limited in the database to ten attempts per device
 * per fifteen minutes, so the shared kiosk cannot be used to grind
 * through tracking numbers. That limit is the real control; the disabled
 * button below is only a courtesy.
 *
 * There is no anonymous browsing. A wrong pair produces one message and
 * nothing else.
 */
export default function KioskStatusSearchPage() {
  const router = useRouter();
  const { t, language } = useKioskLanguage();

  const [reference, setReference] = useState("");
  const [mobile, setMobile] = useState("");
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [payload, setPayload] = useState(null);
  const [formError, setFormError] = useState(null);

  // Prevents a double tap producing two searches. `busy` disables the
  // button, but on a touchscreen two taps can land in the same tick
  // before React has re-rendered.
  const inFlight = useRef(false);

  const search = useCallback(
    async (event) => {
      event?.preventDefault();
      if (inFlight.current) return;

      const nextErrors = {};
      if (reference.trim().length < 4) nextErrors.reference = t("err.required");
      if (!isValidPhMobile(mobile)) nextErrors.mobile = t("err.mobile");

      setErrors(nextErrors);
      setFormError(null);
      if (Object.keys(nextErrors).length > 0) return;

      inFlight.current = true;
      setBusy(true);

      const toastId = toast.loading(t("status.search"));

      try {
        const fingerprint = await getFingerprint();
        const response = await fetchStatusByLookup({ reference, mobile, fingerprint });
        const status = response.status || response;

        if (status?.state !== "found") {
          // The database resolves every failure to the same shape.
          setFormError(t("status.notFound"));
          toast.error(t("status.notFound"), { id: toastId });
          return;
        }

        setPayload(status);
        toast.success(t("status.title"), { id: toastId });
      } catch (error) {
        const offline = error?.code === "network" || error?.code === "unavailable";
        const key = offline ? "err.network" : "status.notFound";
        setFormError(t(key));
        toast.error(t(key), { id: toastId });
      } finally {
        inFlight.current = false;
        setBusy(false);
      }
    },
    [mobile, reference, t]
  );

  const reset = useCallback(() => {
    setPayload(null);
    setReference("");
    setMobile("");
    setErrors({});
    setFormError(null);
  }, []);

  return (
    <KioskStatusShell>
      <KioskStatusHeading t={t} />

      {payload ? (
        <div className="space-y-4">
          <KioskStatusResult payload={payload} t={t} language={language} />

          <button
            type="button"
            onClick={reset}
            className="kiosk-btn kiosk-btn-ghost kiosk-btn-block kiosk-no-print"
          >
            {t("common.retry")}
          </button>
        </div>
      ) : (
        <form onSubmit={search} noValidate className="kiosk-card kiosk-card-pad">
          <Field
            id="kiosk-status-reference"
            label={t("status.tracking")}
            required
            error={errors.reference}
          >
            {({ id, describedBy }) => (
              <TextInput
                id={id}
                aria-describedby={describedBy}
                aria-invalid={errors.reference ? "true" : undefined}
                error={errors.reference}
                value={reference}
                onChange={(event) => setReference(event.target.value)}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                // The tracking number is letters and digits; a numeric
                // keypad on a phone would make it untypable.
                inputMode="text"
                placeholder="AB-2026-00001"
                className="font-mono"
              />
            )}
          </Field>

          <Field
            id="kiosk-status-mobile"
            label={t("status.mobile")}
            required
            className="mt-4"
            error={errors.mobile}
          >
            {({ id, describedBy }) => (
              <TextInput
                id={id}
                type="tel"
                inputMode="numeric"
                autoComplete="tel"
                aria-describedby={describedBy}
                aria-invalid={errors.mobile ? "true" : undefined}
                error={errors.mobile}
                value={mobile}
                onChange={(event) => setMobile(event.target.value)}
                placeholder="09XX XXX XXXX"
              />
            )}
          </Field>

          {formError ? (
            <div
              role="alert"
              className="mt-4 rounded-[12px] border border-critical bg-critical-soft/60 p-3.5 text-[13px] font-semibold text-critical"
            >
              {formError}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={busy}
            className="kiosk-btn kiosk-btn-primary kiosk-btn-block mt-5 min-h-[52px] text-[16px]"
          >
            {busy ? (
              <span
                aria-hidden="true"
                className="h-4 w-4 rounded-full border-2 border-white/40 border-t-white kiosk-spin"
              />
            ) : (
              <Search className="h-5 w-5" aria-hidden="true" />
            )}
            {t("status.search")}
          </button>

          <button
            type="button"
            onClick={() => router.push("/kiosk")}
            className="kiosk-btn kiosk-btn-quiet kiosk-btn-block mt-2"
          >
            {t("status.returnHome")}
          </button>

          <div className="mt-4">
            <Note tone="info">{t("qr.privacyNote")}</Note>
          </div>
        </form>
      )}
    </KioskStatusShell>
  );
}
