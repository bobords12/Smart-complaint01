"use client";

import { useState } from "react";
import toast from "react-hot-toast";
import Link from "next/link";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  FileText,
  Info,
  Paperclip,
  Upload,
} from "lucide-react";
import FormField, { errorInputClass, normalInputClass } from "./FormField";
import PasswordInput from "./PasswordInput";
import SubmitButton from "./SubmitButton";
import { ROUTES } from "@/lib/constants";
import {
  AUTH_RECORDS,
  PUROKS,
  REGISTER_FIELD_ORDER,
  SEX_OPTIONS,
  SUFFIX_OPTIONS,
} from "@/data/authSampleData";
import {
  isEmailValid,
  isFutureDate,
  isPhMobileValid,
  MIN_PASSWORD_LENGTH,
} from "@/lib/authValidation";

function SectionHeading({ step, title }) {
  return (
    <h2 className="mt-8 flex items-center gap-2.5 border-t border-line pt-6 font-heading text-base font-bold text-navy dark:text-secondary first:mt-0 first:border-t-0 first:pt-0">
      <span
        aria-hidden="true"
        className="flex h-6 w-6 items-center justify-center rounded-full bg-secondary font-heading text-[12px] font-bold text-white"
      >
        {step}
      </span>
      {title}
    </h2>
  );
}

function ConsentBox({
  id,
  checked,
  onChange,
  label,
  error,
  describedBy,
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className="flex cursor-pointer items-start gap-3 rounded-[10px] border border-line bg-light px-3.5 py-3 text-[13px] leading-relaxed text-mirage transition-colors hover:border-secondary"
      >
        <input
          id={id}
          name={id}
          type="checkbox"
          checked={checked}
          onChange={onChange}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className="mt-0.5 h-4 w-4 shrink-0 rounded border-line accent-secondary"
        />
        <span>{label}</span>
      </label>
      {error ? (
        <p id={describedBy} className="mt-1.5 flex items-start gap-1.5 text-[12.5px] font-medium leading-snug text-critical">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}

export default function RegisterForm({ onSwitchView }) {
  // FUTURE: this structured object becomes the payload for Supabase auth
  // (signUp) plus an insert into a resident_profiles table, plus a
  // pending-verification record.
  const [values, setValues] = useState({
    firstName: "",
    middleName: "",
    lastName: "",
    suffix: "",
    dob: "",
    sex: "",
    houseNo: "",
    purok: "",
    barangay: AUTH_RECORDS.barangay,
    city: AUTH_RECORDS.city,
    mobile: "",
    email: "",
    password: "",
    confirmPassword: "",
    proofIdFileName: "",
    consentAccurate: false,
    consentTerms: false,
  });

  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [registered, setRegistered] = useState(false);

  const clearError = (key) => {
    if (errors[key]) {
      setErrors((current) => ({ ...current, [key]: undefined }));
    }
  };

  const updateField = (key) => (event) => {
    const nextValue =
      event.target.type === "checkbox" ? event.target.checked : event.target.value;
    setValues((current) => ({ ...current, [key]: nextValue }));
    if (key === "password" && errors.confirmPassword) {
      setErrors((current) => ({ ...current, confirmPassword: undefined }));
    }
    clearError(key);
  };

  const onFileChange = (event) => {
    const file = event.target.files?.[0];
    setValues((current) => ({
      ...current,
      proofIdFileName: file ? file.name : "",
    }));
  };

  const validate = () => {
    const next = {};
    const email = values.email.trim();
    const password = values.password;

    if (!values.firstName.trim()) next.firstName = "First name is required.";
    if (!values.lastName.trim()) next.lastName = "Last name is required.";
    if (!values.dob) next.dob = "Date of birth is required.";
    else if (isFutureDate(values.dob)) next.dob = "Date of birth cannot be in the future.";
    if (!values.sex) next.sex = "Please select a sex.";
    if (!values.houseNo.trim()) next.houseNo = "House number / street is required.";
    if (!values.purok) next.purok = "Please select your purok.";

    if (!values.mobile.trim()) {
      next.mobile = "Mobile number is required.";
    } else if (!isPhMobileValid(values.mobile)) {
      next.mobile = "Enter a valid Philippine mobile number, e.g. 09XX XXX XXXX.";
    }

    if (!email) {
      next.email = "Email address is required.";
    } else if (!isEmailValid(email)) {
      next.email = "Enter a valid email address, e.g. you@email.com.";
    }

    if (!password) {
      next.password = "Password is required.";
    } else if (password.length < MIN_PASSWORD_LENGTH) {
      next.password = `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
    }

    if (!values.confirmPassword) {
      next.confirmPassword = "Please confirm your password.";
    } else if (values.confirmPassword !== password) {
      next.confirmPassword = "Passwords do not match.";
    }

    if (!values.consentAccurate) {
      next.consentAccurate = "You must confirm that your information is accurate.";
    }
    if (!values.consentTerms) {
      next.consentTerms = "You must agree to the Terms of Service and Privacy Notice.";
    }

    return next;
  };

  const onSubmit = async (event) => {
    event.preventDefault();
    if (submitting) return;

    const nextErrors = validate();
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      const firstInvalid = REGISTER_FIELD_ORDER.find((key) => nextErrors[key]);
      if (firstInvalid) document.getElementById(firstInvalid)?.focus();
      return;
    }

    setErrors({});
    setSubmitting(true);
    const toastId = toast.loading("Creating your account...");

    const { registerResident } = await import("@/services/authService");
    const result = await registerResident({
      firstName: values.firstName,
      middleName: values.middleName,
      lastName: values.lastName,
      suffix: values.suffix,
      dob: values.dob,
      sex: values.sex,
      houseNo: values.houseNo,
      purok: values.purok,
      barangay: values.barangay,
      city: values.city,
      mobile: values.mobile,
      email: values.email,
      password: values.password,
      confirmPassword: values.confirmPassword,
    });

    toast.dismiss(toastId);

    if (result.success) {
      toast.success("Registration submitted successfully.");
      setSubmitting(false);
      setRegistered(true);
    } else {
      toast.error(result.error || "Registration failed. Please try again.");
      setSubmitting(false);
    }
  };

  const errorCount = Object.keys(errors).length;

  if (registered) {
    return (
      <div role="status">
        <div className="rounded-[14px] border border-normal/30 bg-normal/10 p-6 text-center">
          <CheckCircle2 className="mx-auto h-10 w-10 text-normal" aria-hidden="true" />
          <p className="mt-3 font-heading text-lg font-bold text-navy">
            Registration submitted successfully.
          </p>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            Your account has been created. You may need to verify your email
            address before logging in. An authorized barangay official will
            also verify your identity and residency before your account
            becomes fully active.
          </p>
          {onSwitchView ? (
            <button
              type="button"
              onClick={() => onSwitchView("login")}
              className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-[10px] bg-secondary px-6 py-3.5 font-heading text-[15px] font-bold text-white transition-colors hover:bg-navy focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary"
            >
              Continue to Login
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </button>
          ) : (
            <Link
              href={ROUTES.login}
              className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-[10px] bg-secondary px-6 py-3.5 font-heading text-[15px] font-bold text-white transition-colors hover:bg-navy focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary"
            >
              Continue to Login
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          )}
          <button
            type="button"
            onClick={() => setRegistered(false)}
            className="mt-3 text-sm font-semibold text-secondary underline underline-offset-4 transition-colors hover:text-navy dark:hover:text-secondary"
          >
            Submit another registration
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      {errorCount > 0 ? (
        <p
          role="alert"
          className="mb-4 flex items-start gap-2.5 rounded-[10px] border border-critical/25 bg-critical/10 px-3.5 py-3 text-[13px] font-medium leading-relaxed text-critical"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-critical" aria-hidden="true" />
          <span>
            Please fix the {errorCount} highlighted {errorCount === 1 ? "field" : "fields"} below.
          </span>
        </p>
      ) : null}

      <form onSubmit={onSubmit} noValidate>
        {/* A. Personal Information */}
        <SectionHeading step={1} title="Personal Information" />
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField id="firstName" label="First Name" required error={errors.firstName}>
            <input
              id="firstName"
              name="firstName"
              type="text"
              autoComplete="given-name"
              value={values.firstName}
              onChange={updateField("firstName")}
              placeholder="Juan"
              aria-invalid={errors.firstName ? true : undefined}
              aria-describedby={errors.firstName ? "firstName-error" : undefined}
              className={errors.firstName ? errorInputClass : normalInputClass}
            />
          </FormField>

          <FormField id="middleName" label="Middle Name" optional error={errors.middleName}>
            <input
              id="middleName"
              name="middleName"
              type="text"
              autoComplete="additional-name"
              value={values.middleName}
              onChange={updateField("middleName")}
              placeholder="Santos"
              className={normalInputClass}
            />
          </FormField>

          <FormField id="lastName" label="Last Name" required error={errors.lastName}>
            <input
              id="lastName"
              name="lastName"
              type="text"
              autoComplete="family-name"
              value={values.lastName}
              onChange={updateField("lastName")}
              placeholder="Dela Cruz"
              aria-invalid={errors.lastName ? true : undefined}
              aria-describedby={errors.lastName ? "lastName-error" : undefined}
              className={errors.lastName ? errorInputClass : normalInputClass}
            />
          </FormField>

          <FormField id="suffix" label="Suffix" optional error={errors.suffix}>
            <select
              id="suffix"
              name="suffix"
              value={values.suffix}
              onChange={updateField("suffix")}
              className={normalInputClass}
            >
              <option value="" disabled>
                — None —
              </option>
              {SUFFIX_OPTIONS.map((suffix) => (
                <option key={suffix} value={suffix}>
                  {suffix}
                </option>
              ))}
            </select>
          </FormField>

          <FormField id="dob" label="Date of Birth" required error={errors.dob}>
            <input
              id="dob"
              name="dob"
              type="date"
              autoComplete="bday"
              value={values.dob}
              onChange={updateField("dob")}
              aria-invalid={errors.dob ? true : undefined}
              aria-describedby={errors.dob ? "dob-error" : undefined}
              className={errors.dob ? errorInputClass : normalInputClass}
            />
          </FormField>

          <FormField id="sex" label="Sex" required error={errors.sex}>
            <select
              id="sex"
              name="sex"
              value={values.sex}
              onChange={updateField("sex")}
              aria-invalid={errors.sex ? true : undefined}
              aria-describedby={errors.sex ? "sex-error" : undefined}
              className={errors.sex ? errorInputClass : normalInputClass}
            >
              <option value="" disabled>
                Select your sex
              </option>
              {SEX_OPTIONS.map((sex) => (
                <option key={sex} value={sex}>
                  {sex}
                </option>
              ))}
            </select>
          </FormField>
        </div>

        {/* B. Resident Address */}
        <SectionHeading step={2} title="Resident Address" />
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <FormField id="houseNo" label="House Number / Street" required error={errors.houseNo}>
              <input
                id="houseNo"
                name="houseNo"
                type="text"
                autoComplete="street-address"
                value={values.houseNo}
                onChange={updateField("houseNo")}
                placeholder="25 M. Roxas St."
                aria-invalid={errors.houseNo ? true : undefined}
                aria-describedby={errors.houseNo ? "houseNo-error" : undefined}
                className={errors.houseNo ? errorInputClass : normalInputClass}
              />
            </FormField>
          </div>

          <FormField id="purok" label="Purok" required error={errors.purok}>
            <select
              id="purok"
              name="purok"
              value={values.purok}
              onChange={updateField("purok")}
              aria-invalid={errors.purok ? true : undefined}
              aria-describedby={errors.purok ? "purok-error" : undefined}
              className={errors.purok ? errorInputClass : normalInputClass}
            >
              <option value="" disabled>
                Select your purok
              </option>
              {PUROKS.map((purok) => (
                <option key={purok} value={purok}>
                  {purok}
                </option>
              ))}
            </select>
          </FormField>

          <FormField id="barangay" label="Barangay" hint=" (fixed by the system)">
            <input
              id="barangay"
              name="barangay"
              type="text"
              readOnly
              value={values.barangay}
              className={`${normalInputClass} cursor-not-allowed bg-alt text-muted`}
            />
          </FormField>

          <div className="sm:col-span-2">
            <FormField id="city" label="City" hint=" (fixed by the system)">
              <input
                id="city"
                name="city"
                type="text"
                readOnly
                value={values.city}
                className={`${normalInputClass} cursor-not-allowed bg-alt text-muted`}
              />
            </FormField>
          </div>
        </div>

        {/* C. Contact and Account Information */}
        <SectionHeading step={3} title="Contact and Account Information" />
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField id="mobile" label="Mobile Number" required error={errors.mobile}>
            <input
              id="mobile"
              name="mobile"
              type="tel"
              autoComplete="tel-national"
              value={values.mobile}
              onChange={updateField("mobile")}
              placeholder="09XX XXX XXXX"
              aria-invalid={errors.mobile ? true : undefined}
              aria-describedby={errors.mobile ? "mobile-error" : undefined}
              className={errors.mobile ? errorInputClass : normalInputClass}
            />
          </FormField>

          <FormField id="email" label="Email Address" required error={errors.email}>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              value={values.email}
              onChange={updateField("email")}
              placeholder="you@email.com"
              aria-invalid={errors.email ? true : undefined}
              aria-describedby={errors.email ? "email-error" : undefined}
              className={errors.email ? errorInputClass : normalInputClass}
            />
          </FormField>

          <FormField id="password" label="Password" required error={errors.password}>
            <PasswordInput
              id="password"
              value={values.password}
              onChange={updateField("password")}
              placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
              autoComplete="new-password"
              invalid={Boolean(errors.password)}
              describedBy={errors.password ? "password-error" : undefined}
            />
          </FormField>

          <FormField id="confirmPassword" label="Confirm Password" required error={errors.confirmPassword}>
            <PasswordInput
              id="confirmPassword"
              value={values.confirmPassword}
              onChange={updateField("confirmPassword")}
              placeholder="Repeat your password"
              autoComplete="new-password"
              invalid={Boolean(errors.confirmPassword)}
              describedBy={errors.confirmPassword ? "confirmPassword-error" : undefined}
            />
          </FormField>
        </div>

        {/* Optional identity document */}
        <SectionHeading step={4} title="Proof of Residency or Valid ID — Optional" />
        <div className="mt-4">
          <label
            htmlFor="proofId"
            className="flex cursor-pointer items-start gap-3 rounded-[10px] border border-dashed border-line bg-light px-3.5 py-3 text-sm text-muted transition-colors hover:border-secondary"
          >
            <Paperclip className="mt-0.5 h-4 w-4 shrink-0 text-secondary" aria-hidden="true" />
            <span className="leading-relaxed">
              {values.proofIdFileName
                ? `Selected: ${values.proofIdFileName}`
                : "Tap to attach an image or PDF — your document will be stored securely."}
            </span>
            <input
              id="proofId"
              name="proofId"
              type="file"
              accept="image/*,.pdf"
              onChange={onFileChange}
              className="sr-only"
            />
          </label>
          {values.proofIdFileName ? (
            <p className="mt-2 flex items-start gap-1.5 text-[12px] leading-relaxed text-muted">
              <Upload className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gold" aria-hidden="true" />
              <span>
                The file is only selected locally. Secure Supabase Storage
                integration arrives later; it will never be shown publicly.
              </span>
            </p>
          ) : (
            <p className="mt-2 flex items-start gap-1.5 text-[12px] leading-relaxed text-muted">
              <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gold" aria-hidden="true" />
              <span>Accepts image and PDF formats.</span>
            </p>
          )}
        </div>

        {/* D. Consent */}
        <SectionHeading step={5} title="Consent" />
        <div className="mt-4 space-y-3">
          <ConsentBox
            id="consentAccurate"
            checked={values.consentAccurate}
            onChange={updateField("consentAccurate")}
            error={errors.consentAccurate}
            describedBy="consentAccurate-error"
            label="I confirm that the information I provided is accurate."
          />
          <ConsentBox
            id="consentTerms"
            checked={values.consentTerms}
            onChange={updateField("consentTerms")}
            error={errors.consentTerms}
            describedBy="consentTerms-error"
            label="I agree to the Terms of Service and Privacy Notice. (Placeholder consent wording — the final Terms and Privacy Notice will be supplied by the project owner.)"
          />
          <p className="flex items-start gap-1.5 text-[12px] leading-relaxed text-muted">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gold" aria-hidden="true" />
            <span>
              Only residents self-register here. Barangay official accounts
              (Captain, OIC, Secretary, Lupon, Administrator) are created and
              assigned by an authorized administrator.
            </span>
          </p>
        </div>

        <div className="mt-7">
          <SubmitButton loading={submitting} loadingText="Creating account...">
            Create Account
          </SubmitButton>
        </div>
      </form>

      <p className="mt-6 text-center text-sm text-muted">
        Already have an account?{" "}
        {onSwitchView ? (
          <button
            type="button"
            onClick={() => onSwitchView("login")}
            className="font-semibold text-secondary transition-colors hover:text-navy dark:hover:text-secondary"
          >
            Sign in
          </button>
        ) : (
          <Link
            href={ROUTES.login}
            className="font-semibold text-secondary transition-colors hover:text-navy dark:hover:text-secondary"
          >
            Sign in
          </Link>
        )}
      </p>
    </div>
  );
}