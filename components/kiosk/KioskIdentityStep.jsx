import { useEffect, useRef } from "react";
import { LOCATION_DEFAULTS } from "@/lib/kiosk/config";
import { composeFullName, normalizeMobile } from "@/lib/kiosk/validation";
import { Field, TextInput, ErrorSummary } from "./KioskField";
import { summariseErrors, hasErrors } from "@/lib/kiosk/validation";

/**
 * Step 1 — Identity.
 *
 * The reference screen shows Full Name, Mobile Number and Complete
 * Address. The underlying schema wants the name and the address split
 * into components, so that is what the fields capture while the Confirm
 * step reads back as the three plain fields a citizen recognises. Two
 * consequences worth stating:
 *
 *  - Barangay and City are read-only and prefilled. The kiosk is inside
 *    Barangay Abuno, Iligan City, and asking a walk-in to type their own
 *    barangay invites exactly the wrong data. Country, region and
 *    province are never asked at all.
 *  - The mobile number is validated locally as a Philippine mobile, but
 *    it is NOT used to look anyone up. A number matching an existing
 *    resident profile must not silently attach the complaint to that
 *    person's account.
 */
export default function KioskIdentityStep({ t, form, errors, attempted, onChange }) {
  const summaryRef = useRef(null);
  const errorCount = Object.keys(errors).length;

  // Focus the summary when validation fails, so a keyboard or screen
  // reader user is told what is wrong without hunting for red borders.
  useEffect(() => {
    if (attempted && errorCount > 0) {
      summaryRef.current?.focus();
    }
  }, [attempted, errorCount]);

  const c = form.complainant;
  const nameTooShort = Boolean(errors["complainant.firstName"]);

  return (
    <div>
      <header className="mb-5 text-center">
        <h1 className="text-[21px] font-bold leading-tight tracking-tight text-navy sm:text-[24px]">
          {t("identity.title")}
        </h1>
        <p className="mt-1.5 text-[15px] font-semibold text-muted">
          {t("identity.subtitle")}
        </p>
      </header>

      {attempted && errorCount > 0 ? (
        <div className="mb-5" ref={summaryRef} tabIndex={-1}>
          <ErrorSummary
            messages={summariseErrors(errors, t)}
            title={t("identity.errorSummary")}
          />
        </div>
      ) : null}

      {/* Full name. Four inputs rather than one, because the complaint
          snapshot stores them separately and a single free-text box
          cannot be validated into that shape. The error is anchored to
          the first field so it is read before, not after, the group. */}
      <fieldset className="kiosk-card kiosk-card-pad">
        <legend className="px-1 text-[13.5px] font-bold text-navy">
          {t("confirm.name")}
        </legend>

        <div className="kiosk-grid kiosk-grid-2">
          <Field
            id="kiosk-first-name"
            label={t("identity.firstName")}
            error={errors["complainant.firstName"]}
            required
          >
            {({ id, errorId, hintId, describedBy }) => (
              <TextInput
                id={id}
                name="given-name"
                autoComplete="given-name"
                value={c.firstName}
                maxLength={80}
                onChange={(event) => onChange("complainant.firstName", event.target.value)}
                error={nameTooShort}
                aria-describedby={[hintId, errorId].filter(Boolean).join(" ") || undefined}
              />
            )}
          </Field>

          <Field id="kiosk-middle-name" label={t("identity.middleName")} optional>
            {({ id }) => (
              <TextInput
                id={id}
                name="additional-name"
                autoComplete="additional-name"
                value={c.middleName}
                maxLength={80}
                onChange={(event) => onChange("complainant.middleName", event.target.value)}
              />
            )}
          </Field>

          <Field
            id="kiosk-last-name"
            label={t("identity.lastName")}
            error={errors["complainant.lastName"]}
            required
          >
            {({ id, describedBy }) => (
              <TextInput
                id={id}
                name="family-name"
                autoComplete="family-name"
                value={c.lastName}
                maxLength={80}
                onChange={(event) => onChange("complainant.lastName", event.target.value)}
                error={errors["complainant.lastName"]}
                aria-describedby={describedBy}
              />
            )}
          </Field>

          <Field id="kiosk-suffix" label={t("identity.suffix")} optional>
            {({ id }) => (
              <TextInput
                id={id}
                autoComplete="honorific-suffix"
                value={c.suffix}
                maxLength={20}
                onChange={(event) => onChange("complainant.suffix", event.target.value)}
              />
            )}
          </Field>
        </div>

        {/* Single-line preview of the assembled name, so the citizen can
            see that a middle name or suffix lands where they expect. */}
        {composeFullName(c) ? (
          <p className="mt-3 text-[13px] text-muted">
            {t("confirm.name")}:{" "}
            <span className="font-semibold text-mirage">{composeFullName(c)}</span>
          </p>
        ) : null}
      </fieldset>

      <fieldset className="kiosk-card mt-4 kiosk-card-pad">
        <legend className="px-1 text-[13.5px] font-bold text-navy">
          {t("identity.mobile")}
        </legend>

        <Field
          id="kiosk-mobile"
          label={t("identity.mobile")}
          error={errors["complainant.mobile"]}
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
              value={c.mobile}
              onChange={(event) => onChange("complainant.mobile", event.target.value)}
              error={errors["complainant.mobile"]}
              aria-describedby={describedBy}
              // Blur-time normalisation, not per-keystroke: rewriting
              // the value while somebody is still typing 63… would move
              // the caret out from under them.
              onBlur={() => onChange("complainant.mobile", normalizeMobile(c.mobile))}
            />
          )}
        </Field>
      </fieldset>

      <fieldset className="kiosk-card mt-4 kiosk-card-pad">
        <legend className="px-1 text-[13.5px] font-bold text-navy">
          {t("confirm.address")}
        </legend>

        <Field
          id="kiosk-house-street"
          label={t("identity.address")}
          error={errors["complainant.houseStreet"]}
          required
        >
          {({ id, describedBy }) => (
            <TextInput
              id={id}
              autoComplete="address-line1"
              value={c.houseStreet}
              maxLength={200}
              onChange={(event) => onChange("complainant.houseStreet", event.target.value)}
              error={errors["complainant.houseStreet"]}
              aria-describedby={describedBy}
            />
          )}
        </Field>

        <div className="mt-4">
          <Field
            id="kiosk-purok"
            label={t("identity.purok")}
            error={errors["complainant.purok"]}
            required
          >
            {({ id, describedBy }) => (
              <TextInput
                id={id}
                value={c.purok}
                maxLength={80}
                onChange={(event) => onChange("complainant.purok", event.target.value)}
                error={errors["complainant.purok"]}
                aria-describedby={describedBy}
              />
            )}
          </Field>
        </div>

        {/* Read-only location. Not inputs, so they are skipped by the
            tab order and announced as plain text. */}
        <div className="mt-4 kiosk-grid kiosk-grid-2">
          <div>
            <span className="kiosk-label">{t("identity.barangay")}</span>
            <p className="rounded-[10px] border border-line bg-alt px-3.5 py-[11px] text-[15px] text-muted">
              {LOCATION_DEFAULTS.barangay}
            </p>
          </div>
          <div>
            <span className="kiosk-label">{t("identity.city")}</span>
            <p className="rounded-[10px] border border-line bg-alt px-3.5 py-[11px] text-[15px] text-muted">
              {LOCATION_DEFAULTS.city}
            </p>
          </div>
        </div>
      </fieldset>

      {hasErrors(errors) && !attempted ? (
        <p className="mt-4 text-[13px] text-muted" role="status">
          {t("identity.errorSummary")}
        </p>
      ) : null}
    </div>
  );
}