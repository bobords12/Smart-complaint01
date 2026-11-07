import { useState } from "react";
import { CheckCircle2, ShieldQuestion, UserRound } from "lucide-react";
import { ChoiceCard, Field, TextInput, Note } from "./KioskField";
import { isValidPhMobile, normalizeMobile } from "@/lib/kiosk/validation";

/**
 * Screen 3 — Account or guest.
 *
 * The important decision in this screen is what "Yes — mobile lookup"
 * does when no real verification provider exists.
 *
 * The project has no SMS/OTP provider: there is no Twilio, no
 * MessageBird, no custom SMS RPC in supabase/manual. Shipping a fake
 * one-time-code box would be the worst outcome available, because a
 * citizen would type a code that validates against nothing and then
 * believe their identity was confirmed. So this screen detects that the
 * mechanism is unavailable and says so, in plain words, and keeps the
 * guest path one tap away. No dead button, no simulated verification,
 * and profile data is never revealed by phone number alone.
 */
export default function KioskAccountChoice({ t, onGuest, onAccountLookup }) {
  const [mode, setMode] = useState(null);
  const [mobile, setMobile] = useState("");

  // The one honest statement of capability. Replace the constant with a
  // real check against the configured provider when one is added; the UI
  // already handles both answers.
  const secureLookupAvailable = false;

  if (mode === "account" && secureLookupAvailable) {
    return (
      <LookupPanel
        t={t}
        mobile={mobile}
        onMobileChange={setMobile}
        onSubmit={() => onAccountLookup(normalizeMobile(mobile))}
        onBack={() => setMode(null)}
      />
    );
  }

  return (
    <div className="kiosk-card kiosk-card-pad">
      <div className="text-center">
        <UserRound className="mx-auto h-9 w-9 text-navy" aria-hidden="true" />
        <h1 className="mt-2.5 text-[19px] font-bold leading-snug text-navy">
          {t("account.title")}
        </h1>
        <p className="mt-1 text-[15px] font-semibold text-muted">
          {t("account.subtitle")}
        </p>
      </div>

      <div className="mt-5 space-y-3">
        <ChoiceCard
          name="filingMode"
          value="account"
          checked={false}
          disabled={!secureLookupAvailable}
          onChange={() => setMode("account")}
          title={t("account.yes")}
          description={
            secureLookupAvailable ? t("account.yesHint") : t("account.lookupUnavailable")
          }
        />

        <ChoiceCard
          name="filingMode"
          value="guest"
          checked
          onChange={onGuest}
          title={t("account.no")}
          description={t("account.noHint")}
        />
      </div>

      {/* Account-less filing is the normal path, so the reassurance is
          stated as a fact rather than left for the citizen to assume. */}
      <Note tone="success" className="mt-5">
        <span className="flex items-start gap-2">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            {t("brand.noAccount")} &middot; {t("brand.noAccountPil")}
          </span>
        </span>
      </Note>
    </div>
  );
}

/**
 * Mobile lookup.
 *
 * Only reachable once a real provider is wired up. The number alone
 * never returns anything: the flow requires an OTP round trip that
 * proves the handset in the citizen's hand owns the number. Field
 * validation here is a convenience; the authoritative check is
 * server-side and rate limited.
 */
function LookupPanel({ t, mobile, onMobileChange, onSubmit, onBack }) {
  const [errorState, setErrorState] = useState(null);

  function submit(event) {
    event.preventDefault();
    if (!isValidPhMobile(mobile)) {
      setErrorState(t("err.mobile"));
      return;
    }
    setErrorState(null);
    onSubmit();
  }

  return (
    <div className="kiosk-card kiosk-card-pad">
      <div className="text-center">
        <ShieldQuestion className="mx-auto h-9 w-9 text-navy" aria-hidden="true" />
        <h1 className="mt-2.5 text-[19px] font-bold leading-snug text-navy">
          {t("account.lookupTitle")}
        </h1>
      </div>

      <p className="mt-3 text-[13px] leading-relaxed text-muted">
        {t("account.lookupHelp")}
      </p>

      <form onSubmit={submit} className="mt-5" noValidate>
        <Field
          id="kiosk-lookup-mobile"
          label={t("identity.mobile")}
          error={errorState}
          hint={t("identity.mobileHelp")}
          required
        >
          {({ id, describedBy }) => (
            <TextInput
              id={id}
              type="tel"
              inputMode="tel"
              autoComplete="tel-national"
              placeholder="09XXXXXXXXX"
              maxLength={13}
              value={mobile}
              onChange={(event) => onMobileChange(event.target.value)}
              error={errorState}
              aria-describedby={describedBy}
            />
          )}
        </Field>

        <div className="mt-5 space-y-3">
          <button type="submit" className="kiosk-btn kiosk-btn-primary kiosk-btn-block">
            {t("nav.continue")}
          </button>
          <button
            type="button"
            onClick={onBack}
            className="kiosk-btn kiosk-btn-quiet kiosk-btn-block"
          >
            {t("account.lookupContinue")}
          </button>
        </div>
      </form>
    </div>
  );
}