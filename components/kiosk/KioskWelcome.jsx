import Image from "next/image";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";

/**
 * Screen 1 — Welcome.
 *
 * A full-bleed navy screen, because the very first job is to establish
 * that this is the barangay's official kiosk and not a form on a random
 * website. Everything that reduces hesitation for a walk-in is here:
 * no account, a clear single call to action, and a visible statement of
 * what the kiosk is NOT.
 *
 * The emergency advisory is deliberate and specific. This kiosk records
 * a complaint; it does not dispatch barangay responders, police, medical
 * personnel, or emergency services. Saying so plainly is what stops
 * somebody filing a report about an active assault and then waiting.
 */
export default function KioskWelcome({ t, onStart }) {
  return (
    <div className="flex min-h-[calc(100dvh-64px)] flex-col bg-navy text-white">
      <div className="flex flex-1 flex-col items-center px-5 py-8 text-center sm:px-8 sm:py-10">
        {/* Seal. Fixed square box with object-contain so it can never
            stretch, whatever the panel aspect ratio is. */}
        <div className="flex h-24 w-24 items-center justify-center rounded-full bg-white/10 p-2 sm:h-28 sm:w-28">
          <Image
            src="/Abunoi.jpg"
            alt={t("welcome.sealAlt")}
            width={112}
            height={112}
            className="h-full w-full rounded-full object-contain"
            priority
          />
        </div>

        <h1 className="mt-6 text-[19px] font-bold uppercase leading-tight tracking-[0.11em] text-gold-soft sm:text-[21px]">
          {t("brand.hall")}
        </h1>

        <h2 className="mt-3 max-w-[420px] text-[27px] font-bold leading-tight tracking-tight sm:text-[34px]">
          {t("welcome.title")}
        </h2>
        <p className="mt-2 text-[17px] font-semibold text-white/80 sm:text-[19px]">
          {t("welcome.subtitle")}
        </p>

        <p className="mt-5 max-w-[440px] text-[14px] leading-relaxed text-white/75 sm:text-[15px]">
          {t("welcome.description")}
        </p>

        {/* Primary call to action. min-height 56px here rather than the
            48px used elsewhere: this is the one button that must be
            impossible to miss on a standing touchscreen. */}
        <button
          type="button"
          onClick={onStart}
          className="kiosk-btn kiosk-btn-gold mt-8 min-h-[56px] w-full max-w-[360px] px-6 text-[16px] shadow-button"
        >
          {t("welcome.cta")}
        </button>
        <p className="mt-2 text-[14px] font-semibold text-white/80">
          {t("welcome.ctaPil")}
        </p>

        <p className="mt-5 text-[13px] font-semibold uppercase tracking-[0.1em] text-white/55">
          {t("brand.noAccount")}
        </p>
        <p className="mt-0.5 text-[13px] font-semibold uppercase tracking-[0.1em] text-white/40">
          {t("brand.noAccountPil")}
        </p>

        <div className="mt-auto pt-8">
          {/* One secondary action, kept visually distinct from the gold
              "Tap to Begin" above. Tracking a complaint must never be
              mistakable for starting a new complaint. It is a real link
              so it can be opened in a new tab and is reachable by
              keyboard without any custom key handling.

              There is deliberately no "scan the receipt here" action:
              the kiosk does not scan a resident's QR code. The tracking
              page explains that the resident scans the receipt with
              their own phone instead. */}
          <Link
            href="/kiosk/track"
            className="kiosk-btn kiosk-btn-ghost min-h-[48px] w-full max-w-[360px] border-white/40 bg-transparent px-6 text-white hover:border-white hover:text-white"
          >
            {t("welcome.status")}
          </Link>
          <p className="mt-2 text-[13px] font-semibold text-white/60">
            {t("welcome.statusPil")}
          </p>

          {/* Emergency advisory. Warning-styled rather than muted, since
              burying it would defeat the purpose. */}
          <p className="mx-auto mt-6 flex max-w-[460px] items-start gap-2.5 rounded-[12px] border border-gold-soft/35 bg-white/[0.07] p-3.5 text-left text-[12.5px] leading-relaxed text-white/85">
            <AlertTriangle
              className="mt-0.5 h-4 w-4 shrink-0 text-gold-soft"
              aria-hidden="true"
            />
            <span>{t("welcome.advisory")}</span>
          </p>

          <p className="mt-4 text-[12px] text-white/45">{t("brand.location")}</p>
        </div>
      </div>
    </div>
  );
}