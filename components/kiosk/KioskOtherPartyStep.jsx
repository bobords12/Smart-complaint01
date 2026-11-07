import { OTHER_PARTY_STATUSES } from "@/lib/kiosk/config";
import { ChoiceCard, Field, TextInput, Note, ErrorSummary } from "./KioskField";
import { summariseErrors } from "@/lib/kiosk/validation";

/** The option value is stored in English; the label is translated. */
const OPTION_LABEL_KEY = {
  known: "otherParty.known",
  unknown: "otherParty.unknown",
  not_applicable: "otherParty.none",
};

/**
 * Step 3 — Other party.
 *
 * Three states, and the difference between them is legal, not cosmetic:
 *
 *  known           A named respondent is recorded. Summons and
 *                  mediation are possible later, but only if staff
 *                  decide to start them.
 *  unknown         No respondent is invented. Name and address stay
 *                  null and the case cannot be served by summons,
 *                  which is precisely why the kiosk asks the question.
 *  not_applicable  Some complaints are about a service, a facility, or
 *                  the barangay's own process. There is no opposing
 *                  party at all.
 *
 * Nothing on this screen decides jurisdictional routing. The kiosk
 * records what the complainant observed; the Captain, OIC or Secretary
 * decides where the case goes.
 */
export default function KioskOtherPartyStep({ t, form, errors, attempted, onChange }) {
  const status = form.otherPartyStatus;
  const showRespondent = status === "known";
  const showSkip = !status;

  return (
    <div>
      <header className="mb-5 text-center">
        <h1 className="text-[21px] font-bold leading-tight tracking-tight text-navy sm:text-[24px]">
          {t("otherParty.title")}
        </h1>
        <p className="mt-1.5 text-[15px] font-semibold text-muted">
          {t("otherParty.subtitle")}
        </p>
      </header>

      {attempted && errors.otherPartyStatus ? (
        <div className="mb-5">
          <ErrorSummary
            messages={summariseErrors(errors, t)}
            title={t("otherParty.title")}
          />
        </div>
      ) : null}

      <div
        role="radiogroup"
        aria-label={t("otherParty.title")}
        aria-invalid={errors.otherPartyStatus ? "true" : undefined}
        className="space-y-3"
      >
        {OTHER_PARTY_STATUSES.map((option) => (
          <ChoiceCard
            key={option.value}
            name="otherPartyStatus"
            value={option.value}
            checked={status === option.value}
            onChange={(value) => onChange("otherPartyStatus", value)}
            title={t(OPTION_LABEL_KEY[option.value])}
            error={option.value === status ? errors.otherPartyStatus : undefined}
          />
        ))}
      </div>

      {/* Each state explains what will actually be recorded, so the
          citizen is never guessing at the consequence. */}
      {status === "unknown" ? (
        <Note tone="info" className="mt-4">
          {t("otherParty.unknownNote")}
        </Note>
      ) : null}

      {status === "not_applicable" ? (
        <Note tone="info" className="mt-4">
          {t("otherParty.noneNote")}
        </Note>
      ) : null}

      {showRespondent ? (
        <fieldset className="kiosk-card mt-4 kiosk-card-pad">
          <legend className="px-1 text-[13.5px] font-bold text-navy">
            {t("otherParty.known")}
          </legend>

          <Field
            id="kiosk-respondent-name"
            label={t("otherParty.name")}
            error={errors["respondent.name"]}
            required
          >
            {({ id, describedBy }) => (
              <TextInput
                id={id}
                name="respondent-name"
                autoComplete="off"
                value={form.respondent.name}
                maxLength={160}
                onChange={(event) => onChange("respondent.name", event.target.value)}
                error={errors["respondent.name"]}
                aria-describedby={describedBy}
              />
            )}
          </Field>

          <div className="mt-4">
            <Field id="kiosk-respondent-address" label={t("otherParty.address")} optional>
              {({ id }) => (
                <TextInput
                  id={id}
                  autoComplete="off"
                  value={form.respondent.address}
                  maxLength={250}
                  onChange={(event) => onChange("respondent.address", event.target.value)}
                />
              )}
            </Field>
          </div>

          <div className="mt-4 kiosk-grid kiosk-grid-2">
            <Field id="kiosk-respondent-purok" label={t("otherParty.purok")} optional>
              {({ id }) => (
                <TextInput
                  id={id}
                  value={form.respondent.purok}
                  maxLength={60}
                  onChange={(event) => onChange("respondent.purok", event.target.value)}
                />
              )}
            </Field>

            <Field id="kiosk-respondent-relationship" label={t("otherParty.relationship")} optional>
              {({ id }) => (
                <TextInput
                  id={id}
                  autoComplete="off"
                  value={form.respondent.relationship}
                  maxLength={80}
                  onChange={(event) => onChange("respondent.relationship", event.target.value)}
                />
              )}
            </Field>
          </div>

          <div className="mt-4">
            <Field id="kiosk-respondent-contact" label={t("otherParty.contact")} optional>
              {({ id }) => (
                <TextInput
                  id={id}
                  type="tel"
                  inputMode="tel"
                  autoComplete="off"
                  maxLength={40}
                  value={form.respondent.contact}
                  onChange={(event) => onChange("respondent.contact", event.target.value)}
                />
              )}
            </Field>
          </div>
        </fieldset>
      ) : null}

      {/* Skip is only meaningful before a choice is made. Once a state is
          chosen, Back is the way to change it. */}
      {showSkip ? (
        <p className="mt-4 text-center text-[13px] text-muted">
          {t("nav.skip")}: {t("otherParty.unknown")}
        </p>
      ) : null}
    </div>
  );
}