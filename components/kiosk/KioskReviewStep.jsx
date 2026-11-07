import { PencilLine, FileText, ImageIcon, Loader2 } from "lucide-react";
import { Checkbox, ErrorSummary, Note } from "./KioskField";
import { composeFullName, composeAddress, formatMobile } from "@/lib/kiosk/validation";
import { formatDate, formatTime, formatBytes } from "@/lib/kiosk/format";
import { summariseErrors } from "@/lib/kiosk/validation";

const OTHER_PARTY_KEY = {
  known: "otherParty.known",
  unknown: "otherParty.unknown",
  not_applicable: "otherParty.none",
};

/**
 * Step 7 — Review and submit.
 *
 * The citizen's last chance to see exactly what will be stored. Nothing
 * on this screen is editable inline; each section has an Edit link that
 * returns to the relevant step with everything else intact, which is
 * what makes this trustworthy rather than merely reassuring.
 *
 * Two consent boxes, both required, and both about something real:
 *
 *  - privacy: the citizen is told what happens to their details and that
 *    the screen clears itself.
 *  - accuracy: the citizen confirms the content is ready to submit.
 *
 * Neither one claims the complaint is already a case. The note under the
 * submit button says the opposite, in both languages, because a citizen
 * who believes a receipt makes a blotter entry has been misled.
 */
export default function KioskReviewStep({
  t,
  language,
  form,
  evidence,
  errors,
  attempted,
  onEdit,
  onConsent,
  onSubmit,
  submitting,
  isOffline,
  submitError,
}) {
  const c = form.complainant;
  const i = form.incident;
  const r = form.respondent;

  const otherPartyValue = form.otherPartyStatus;
  const otherPartyLabel = OTHER_PARTY_KEY[otherPartyValue]
    ? t(OTHER_PARTY_KEY[otherPartyValue])
    : "—";
  const otherPartyDetail =
    otherPartyValue === "known"
      ? [r.name, r.relationship].filter(Boolean).join(" · ")
      : "";

  const hasConsentErrors = Boolean(errors["consent.privacy"] || errors["consent.accuracy"]);

  return (
    <div>
      <header className="mb-5 text-center">
        <h1 className="text-[21px] font-bold leading-tight tracking-tight text-navy sm:text-[24px]">
          {t("review.title")}
        </h1>
        <p className="mt-1.5 text-[15px] font-semibold text-muted">
          {t("review.subtitle")}
        </p>
      </header>

      {attempted && hasConsentErrors ? (
        <div className="mb-5">
          <ErrorSummary
            messages={summariseErrors(errors, t)}
            title={t("identity.errorSummary")}
          />
        </div>
      ) : null}

      <div className="space-y-3">
        <ReviewSection title={t("review.complainant")} onEdit={() => onEdit("identity")} editLabel={t("nav.edit")}>
          <Row label={t("confirm.name")} value={composeFullName(c)} />
          <Row label={t("review.contact")} value={formatMobile(c.mobile)} />
          <Row label={t("review.address")} value={composeAddress(c)} />
        </ReviewSection>

        <ReviewSection title={t("review.otherParty")} onEdit={() => onEdit("otherParty")} editLabel={t("nav.edit")}>
          <Row label={t("review.otherParty")} value={otherPartyLabel} />
          {otherPartyDetail ? (
            <Row label={t("otherParty.name")} value={otherPartyDetail} />
          ) : null}
        </ReviewSection>

        <ReviewSection title={t("review.incident")} onEdit={() => onEdit("incident")} editLabel={t("nav.edit")}>
          <Row label={t("incident.date")} value={formatDate(i.date, language)} />
          <Row label={t("incident.time")} value={formatTime(i.time)} />
          <Row label={t("incident.location")} value={i.location} />
          <Row label={t("incident.purok")} value={i.purok} />
          <Row label={t("incident.ongoing")} value={t(i.ongoing === "yes" ? "common.yes" : "common.no")} />
          <Row
            label={t("incident.immediate")}
            value={t(i.immediateSafety === "yes" ? "common.yes" : "common.no")}
          />
        </ReviewSection>

        <ReviewSection title={t("review.narrative")} onEdit={() => onEdit("narrative")} editLabel={t("nav.edit")}>
          {/* whitespace-pre-wrap keeps the complainant's own line breaks.
              Without it a three-paragraph statement collapses into one
              unreadable wall. */}
          <p className="whitespace-pre-wrap break-words text-[13.5px] leading-relaxed text-mirage">
            {form.narrative}
          </p>
        </ReviewSection>

        <ReviewSection
          title={t("review.evidence")}
          onEdit={() => onEdit("evidence")}
          editLabel={t("nav.edit")}
        >
          {evidence.length === 0 ? (
            <p className="text-[13.5px] text-muted">{t("review.noEvidence")}</p>
          ) : (
            <ul className="space-y-1.5">
              {evidence.map((file) => {
                const isPdf = String(file.mime_type || "").includes("pdf");
                const Icon = isPdf ? FileText : ImageIcon;
                return (
                  <li key={file.id} className="flex items-center gap-2 text-[13px] text-mirage">
                    <Icon className="h-4 w-4 shrink-0 text-secondary" aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate">{file.name}</span>
                    <span className="shrink-0 text-[12px] text-muted">
                      {formatBytes(file.size)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </ReviewSection>
      </div>

      <div className="mt-5 space-y-3">
        <Checkbox
          id="kiosk-consent-privacy"
          checked={form.consent.privacy}
          onChange={(value) => onConsent("privacy", value)}
          label={t("review.privacyLabel")}
          error={errors["consent.privacy"] ? t(errors["consent.privacy"]) : undefined}
        />

        <Checkbox
          id="kiosk-consent-accuracy"
          checked={form.consent.accuracy}
          onChange={(value) => onConsent("accuracy", value)}
          label={t("review.confirmLabel")}
          error={errors["consent.accuracy"] ? t(errors["consent.accuracy"]) : undefined}
        />
      </div>

      <Note tone="info" className="mt-5">
        {t("review.submitNote")}
      </Note>

      {/* Offline is stated before the button, not discovered after it.
          The citizen still presses the same button; they just know in
          advance what will happen. */}
      {isOffline ? (
        <Note tone="warn" className="mt-3">
          {t("offline.banner")} &middot; {t("offline.bannerPil")}
        </Note>
      ) : null}

      {submitError ? (
        <div
          role="alert"
          className="mt-3 rounded-[12px] border border-critical bg-critical-soft/60 p-3.5 text-[13px] font-medium leading-relaxed text-critical"
        >
          {t(submitError)}
        </div>
      ) : null}

      <div className="mt-5">
        <button
          type="button"
          onClick={onSubmit}
          disabled={submitting}
          aria-busy={submitting}
          className="kiosk-btn kiosk-btn-primary kiosk-btn-block min-h-[56px] text-[16px] shadow-button"
        >
          {submitting ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
              {t("err.submitting")}
            </>
          ) : (
            t("nav.submit")
          )}
        </button>
      </div>
    </div>
  );
}

function ReviewSection({ title, onEdit, editLabel, children }) {
  return (
    <section className="kiosk-card kiosk-card-pad">
      <div className="mb-2 flex items-start justify-between gap-3">
        <h2 className="text-[13px] font-bold uppercase tracking-[0.08em] text-navy">
          {title}
        </h2>
        <button
          type="button"
          onClick={onEdit}
          aria-label={`${editLabel} ${title}`}
          className="kiosk-btn kiosk-btn-ghost min-h-[36px] shrink-0 px-2.5 text-[12.5px]"
        >
          <PencilLine className="h-3.5 w-3.5" aria-hidden="true" />
          {editLabel}
        </button>
      </div>
      <div className="space-y-1.5">{children}</div>
    </section>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
      <span className="text-[12px] text-muted">{label}</span>
      <span className="min-w-0 text-right text-[13px] font-semibold text-mirage">
        {value || "—"}
      </span>
    </div>
  );
}