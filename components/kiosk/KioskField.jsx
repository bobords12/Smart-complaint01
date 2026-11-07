"use client";

import { useId } from "react";
import { AlertCircle, Info } from "lucide-react";

/**
 * Accessible form primitives for the kiosk.
 *
 * One field component for every input, so the a11y contract in one
 * place is a contract everywhere:
 *
 *  - a real <label> bound by id, never a placeholder standing in for one
 *  - aria-invalid on the control itself when it is wrong
 *  - aria-describedby pointing at BOTH the hint and the error, so a
 *    screen reader reads the help text and the problem together
 *  - the error is prefixed by an AlertCircle, so it is not signalled by
 *    red text alone
 */

const baseField =
  "w-full rounded-[10px] border border-line bg-white px-3.5 py-[11px] text-[16px] text-mirage transition-colors placeholder:text-muted/60 focus:border-secondary focus:outline-none focus:ring-2 focus:ring-secondary/25 disabled:cursor-not-allowed disabled:bg-alt disabled:text-muted";

const invalidField =
  "border-critical focus:border-critical focus:ring-critical/25";

export function Field({
  id,
  label,
  error,
  hint,
  required = false,
  optional = false,
  children,
  className = "",
}) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 block text-[13px] font-semibold text-mirage">
        {label}
        {required ? (
          <>
            <span aria-hidden="true" className="ml-0.5 text-critical">
              *
            </span>
            <span className="sr-only"> {label} is required</span>
          </>
        ) : null}
        {optional ? (
          <span className="ml-1 font-normal text-muted">(optional)</span>
        ) : null}
      </label>

      {/* The control is passed as a render prop so this component can
          inject the id, aria-invalid and aria-describedby without the
          caller having to remember any of them. */}
      {typeof children === "function" ? children({ id, errorId, hintId, describedBy }) : children}

      {hint ? (
        <p id={hintId} className="mt-1.5 text-[12.5px] leading-snug text-muted">
          {hint}
        </p>
      ) : null}

      {error ? (
        <p
          id={errorId}
          className="mt-1.5 flex items-start gap-1.5 text-[12.5px] font-medium leading-snug text-critical"
        >
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}

export function TextInput({ error, className = "", ...props }) {
  return (
    <input
      aria-invalid={error ? "true" : undefined}
      className={`${baseField} min-h-[48px] ${error ? invalidField : ""} ${className}`}
      {...props}
    />
  );
}

export function TextArea({ error, className = "", ...props }) {
  return (
    <textarea
      aria-invalid={error ? "true" : undefined}
      className={`${baseField} min-h-[180px] resize-y leading-relaxed ${
        error ? invalidField : ""
      } ${className}`}
      {...props}
    />
  );
}

export function Select({ error, className = "", children, ...props }) {
  return (
    <select
      aria-invalid={error ? "true" : undefined}
      className={`${baseField} min-h-[48px] appearance-none bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 20 20%22 fill=%22%235C697F%22><path d=%22M5.5 7.5 10 12l4.5-4.5%22 stroke=%22%235C697F%22 stroke-width=%221.6%22 fill=%22none%22 stroke-linecap=%22round%22/></svg>')] bg-[length:20px_20px] bg-[right_12px_center] bg-no-repeat pr-10 ${
        error ? invalidField : ""
      } ${className}`}
      {...props}
    >
      {children}
    </select>
  );
}

/**
 * Summary of every problem on a step.
 *
 * Rendered above the first invalid control and focused on validation
 * failure, so keyboard and screen-reader users are told what is wrong
 * without having to hunt for red borders.
 */
export function ErrorSummary({ errors, title, messages, id }) {
  const headingId = useId();
  if (!messages || messages.length === 0) return null;

  return (
    <div
      id={id}
      role="alert"
      aria-labelledby={headingId}
      tabIndex={-1}
      className="rounded-[12px] border border-critical bg-critical-soft/60 p-4"
      data-error-summary="true"
    >
      <p id={headingId} className="flex items-center gap-2 text-[13.5px] font-bold text-critical">
        <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
        {title}
      </p>
      <ul className="mt-2 list-disc space-y-1 pl-9 text-[13px] leading-snug text-critical">
        {messages.map((message) => (
          <li key={message}>{message}</li>
        ))}
      </ul>
    </div>
  );
}

/** Neutral informational note, used for advisories and hints. */
export function Note({ children, tone = "info", className = "" }) {
  const tones = {
    info: "border-line bg-alt/70 text-mirage",
    warn: "border-warning/30 bg-warning-soft text-warning",
    success: "border-success/25 bg-success-soft text-success",
    critical: "border-critical/30 bg-critical-soft text-critical",
  };

  return (
    <div
      className={`flex items-start gap-2.5 rounded-[12px] border p-3.5 text-[13px] leading-relaxed ${
        tones[tone] || tones.info
      } ${className}`}
    >
      <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/**
 * A selectable card backed by a real radio.
 *
 * Kept as a radio rather than a button with aria-pressed so arrow-key
 * navigation, grouping and "1 of 3" announcements come from the
 * platform instead of being reimplemented.
 */
export function ChoiceCard({ name, value, checked, onChange, title, description, error, disabled }) {
  const id = `${name}-${value}`;
  const describedBy = [description ? `${id}-desc` : null, error ? `${id}-error` : null]
    .filter(Boolean)
    .join(" ");

  return (
    <div>
      <label
        htmlFor={id}
        className={`kiosk-choice ${checked ? "kiosk-choice-checked" : ""} ${
          error ? "kiosk-choice-invalid" : ""
        } ${disabled ? "opacity-55" : ""}`}
      >
        <input
          id={id}
          type="radio"
          name={name}
          value={value}
          checked={checked}
          disabled={disabled}
          onChange={() => onChange(value)}
          aria-describedby={describedBy || undefined}
          className="mt-0.5 h-5 w-5 shrink-0 accent-navy"
        />
        <span className="min-w-0 flex-1">
          <span className="block text-[14.5px] font-semibold leading-snug text-mirage">
            {title}
          </span>
          {description ? (
            <span id={`${id}-desc`} className="mt-1 block text-[12.5px] leading-snug text-muted">
              {description}
            </span>
          ) : null}
        </span>
      </label>
      {error ? (
        <p
          id={`${id}-error`}
          className="mt-1.5 flex items-start gap-1.5 text-[12.5px] font-medium leading-snug text-critical"
        >
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}

/** Yes / No pair built from the same ChoiceCard semantics. */
export function YesNoChoice({ name, value, onChange, yesLabel, noLabel, error }) {
  return (
    <div
      role="radiogroup"
      aria-invalid={error ? "true" : undefined}
      className="kiosk-grid kiosk-grid-2"
    >
      <ChoiceCard
        name={name}
        value="yes"
        checked={value === "yes"}
        onChange={onChange}
        title={yesLabel}
      />
      <ChoiceCard
        name={name}
        value="no"
        checked={value === "no"}
        onChange={onChange}
        title={noLabel}
      />
      {error ? (
        <p className="kiosk-error-text col-span-full">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}

/** Consent / confirmation checkbox with its error inline. */
export function Checkbox({ id, checked, onChange, label, error, describedBy }) {
  const errorId = `${id}-error`;
  return (
    <div>
      <label
        htmlFor={id}
        className={`flex cursor-pointer items-start gap-3 rounded-[12px] border p-3.5 text-[13.5px] leading-relaxed transition-colors ${
          error ? "border-critical bg-critical-soft/50" : "border-line bg-white hover:border-secondary"
        }`}
      >
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          aria-invalid={error ? "true" : undefined}
          aria-describedby={[describedBy, error ? errorId : null].filter(Boolean).join(" ") || undefined}
          className="mt-0.5 h-5 w-5 shrink-0 accent-navy"
        />
        <span className="min-w-0">{label}</span>
      </label>
      {error ? (
        <p id={errorId} className="kiosk-error-text">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}