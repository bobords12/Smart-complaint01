import { UserRound, FileText, ClipboardCheck } from "lucide-react";

/**
 * Screen 2 — Three-phase introduction.
 *
 * These three cards are deliberately NOT the seven steps. They are the
 * citizen-facing summary of the same process, and the header stays
 * hidden on this screen so nobody reads "Step 1 of 7" over a screen
 * that promises three things. The mapping is:
 *
 *   1 Tell us who you are  → steps 1-3 (identity, confirm, other party)
 *   2 Describe the incident → steps 4-5 (incident details, narrative)
 *   3 Review and submit    → steps 6-7 (evidence, review)
 */
const PHASES = [
  {
    icon: UserRound,
    ring: "bg-info-soft",
    ink: "text-secondary",
    number: "1",
  },
  {
    icon: FileText,
    ring: "bg-warning-soft",
    ink: "text-warning",
    number: "2",
  },
  {
    icon: ClipboardCheck,
    ring: "bg-success-soft",
    ink: "text-success",
    number: "3",
  },
];

export default function KioskIntro({ t, onStart, onCheckStatus }) {
  return (
    <div className="kiosk-page">
      <main className="kiosk-main">
        <h1 className="text-center text-[22px] font-bold leading-tight tracking-tight text-navy sm:text-[26px]">
          {t("intro.title")}
        </h1>
        <p className="mt-2 text-center text-[16px] font-semibold leading-snug text-muted sm:text-[18px]">
          {t("intro.subtitle")}
        </p>

        <ol className="mt-7 space-y-4">
          {PHASES.map((phase, index) => {
            const Icon = phase.icon;
            const title = t(`intro.phase${index + 1}`);
            const pil = t(`intro.phase${index + 1}Pil`);
            return (
              <li key={phase.number} className="kiosk-card kiosk-card-pad flex items-start gap-4">
                {/* Numbered circle. The digit is real text, not a
                    background image, so it stays legible when zoomed. */}
                <span
                  className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full ${phase.ring}`}
                >
                  <Icon className={`h-6 w-6 ${phase.ink}`} aria-hidden="true" />
                  <span className="sr-only">{phase.number}</span>
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className="text-[15.5px] font-bold leading-snug text-mirage">
                    <span className="text-navy">{phase.number}.</span> {title}
                  </h2>
                  <p className="mt-0.5 text-[13.5px] leading-snug text-muted">{pil}</p>
                </div>
              </li>
            );
          })}
        </ol>

        <div className="kiosk-card mt-6 kiosk-card-pad">
          <p className="text-[12px] font-bold uppercase tracking-[0.1em] text-muted">
            {t("intro.nextAction")}
          </p>
          <p className="mt-1 text-[14.5px] font-semibold leading-snug text-mirage">
            {t("intro.nextActionPil")}
          </p>
        </div>

        <div className="mt-7 space-y-3">
          <button
            type="button"
            onClick={onStart}
            className="kiosk-btn kiosk-btn-primary kiosk-btn-block min-h-[52px] text-[16px]"
          >
            {t("nav.start")}
          </button>
          <button
            type="button"
            onClick={onCheckStatus}
            className="kiosk-btn kiosk-btn-ghost kiosk-btn-block"
          >
            {t("welcome.status")}
          </button>
        </div>
      </main>
    </div>
  );
}