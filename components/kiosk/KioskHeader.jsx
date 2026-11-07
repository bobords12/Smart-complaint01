import Image from "next/image";
import { Languages, Wifi, WifiOff, RefreshCw } from "lucide-react";
import { LANGUAGES } from "@/lib/kiosk/i18n";
import { TOTAL_STEPS } from "@/lib/kiosk/config";

/**
 * Kiosk header.
 *
 * The single most important job here is that the two progress labels
 * cannot disagree. Both are rendered from the SAME two numbers:
 * `header.number` and `TOTAL_STEPS`. There is no second literal "7"
 * anywhere in this file, so "Step 4 of 7" / "Hakbang 4 ng 7" is
 * structural rather than a thing to remember.
 *
 * `header` is optional. The status and upload screens sit outside the
 * wizard entirely and have no step to report, so they pass nothing at
 * all and get the brand bar with the progress row omitted. Reading
 * `header.visible` unguarded would crash the whole page on those
 * routes, which is a far worse outcome than a missing progress bar.
 */
export default function KioskHeader({ t, header, progressPercent, connection, language, onToggleLanguage }) {
  const step = header?.visible ? header : null;

  return (
    <header className="kiosk-header kiosk-no-print">
      <div className="kiosk-header-bar">
        {/* The seal keeps its intrinsic aspect ratio at every size.
            `object-contain` inside a fixed square prevents the stretch
            that a plain <img> would get at unusual kiosk resolutions. */}
        <span className="relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white/10">
          <Image
            src="/Abunoi.jpg"
            alt=""
            width={44}
            height={44}
            className="h-11 w-11 object-contain"
            priority
          />
        </span>

        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-bold leading-tight tracking-wide">
            {t("brand.barangay")}
          </p>
          <p className="truncate text-[10.5px] font-semibold uppercase leading-tight tracking-[0.14em] text-white/70">
            {t("brand.kiosk")}
          </p>
        </div>

        <ConnectionPill connection={connection} t={t} />

        <LanguageToggle
          language={language}
          onToggle={onToggleLanguage}
          t={t}
        />
      </div>

      {step ? (
        <div className="border-t border-white/10">
          <div className="max-w-[720px] mx-auto px-4 pt-2 pb-2 flex items-baseline justify-between gap-3">
            {/* English and Filipino progress labels, both from
                header.number / TOTAL_STEPS. */}
            <p className="text-[12px] font-semibold text-white">
              {t("common.step")} {step.number} {t("common.of")} {step.total}
            </p>
            <p className="truncate text-[11px] font-medium text-white/65 text-right">
              {t("common.hakbang")} {step.number} {t("common.of")} {step.total}
            </p>
          </div>
          <div
            className="kiosk-progress-track"
            role="progressbar"
            aria-valuemin={1}
            aria-valuemax={TOTAL_STEPS}
            aria-valuenow={step.number}
            aria-valuetext={t("a11y.stepOf", {
              n: step.number,
              total: TOTAL_STEPS,
            })}
            aria-label={t("a11y.progress")}
          >
            <div
              className="kiosk-progress-fill"
              style={{ width: `${(step.number / TOTAL_STEPS) * 100}%` }}
            />
          </div>
        </div>
      ) : null}

      {/* Polite, because it changes on every step and interrupting a
          screen reader mid-sentence helps nobody. */}
      <p className="sr-only" aria-live="polite">
        {step
          ? t("a11y.stepOf", { n: step.number, total: TOTAL_STEPS })
          : ""}
      </p>
    </header>
  );
}

/**
 * Online / Offline / Reconnecting.
 *
 * Icons differ per state and so does the text, so the state is never
 * conveyed by colour alone.
 */
function ConnectionPill({ connection, t }) {
  if (connection === "offline") {
    return (
      <span className="kiosk-badge kiosk-badge-pending kiosk-no-print">
        <WifiOff className="h-3.5 w-3.5" aria-hidden="true" />
        {t("net.offline")}
      </span>
    );
  }
  if (connection === "reconnecting") {
    return (
      <span className="kiosk-badge kiosk-badge-active kiosk-no-print">
        <RefreshCw className="h-3.5 w-3.5 kiosk-spin" aria-hidden="true" />
        {t("net.reconnecting")}
      </span>
    );
  }
  return (
    <span className="kiosk-badge kiosk-badge-done kiosk-no-print">
      <Wifi className="h-3.5 w-3.5" aria-hidden="true" />
      {t("net.online")}
    </span>
  );
}

/** EN / PIL. A real pair of buttons, not a select, for touch targets. */
function LanguageToggle({ language, onToggle, t }) {
  return (
    <div
      className="flex shrink-0 items-center gap-1 rounded-full bg-white/12 p-1"
      role="group"
      aria-label={t("a11y.languageSwitch")}
    >
      {LANGUAGES.map((item) => {
        const selected = item.code === language;
        return (
          <button
            key={item.code}
            type="button"
            onClick={() => {
              if (item.code !== language) onToggle();
            }}
            aria-pressed={selected}
            className={`min-h-[34px] rounded-full px-3 text-[12px] font-bold tracking-wide transition-colors ${
              selected
                ? "bg-gold-soft text-navy"
                : "text-white/75 hover:text-white"
            }`}
          >
            {item.label}
          </button>
        );
      })}
      {/* aria-pressed already conveys the state; this live region only
          confirms the change after the fact, which is what a screen
          reader user needs mid-form. */}
      <span className="sr-only" aria-live="polite">
        {t("a11y.languageSwitch")}
      </span>
    </div>
  );
}