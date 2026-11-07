/**
 * Captain complaint workflow — shared presentational primitives.
 *
 * Used only by the Captain Portal -> Complaints page. Imported by the
 * Captain card, the Captain list page and the Captain workflow panels
 * so the badges, chips and status colours are identical across the two
 * halves of the page.
 *
 * Colours reuse the application's existing design tokens (navy,
 * secondary, jordy, mirage, muted, line, alt, and the success /
 * warning / critical soft pairs). No new palette is introduced.
 */

export const TONE_CHIP = {
  ok: "border-[#17774e]/25 bg-success-soft text-success",
  warning: "border-[#b45309]/25 bg-warning-soft text-warning",
  critical: "border-[#b5493b]/25 bg-critical-soft text-critical",
  info: "border-[#1b4c8c]/20 bg-info-soft text-secondary",
  action: "border-[#2563b0]/25 bg-info-soft text-action",
  neutral: "border-line bg-alt text-muted",
};

export const TONE_BAR = {
  ok: "bg-success",
  warning: "bg-warning",
  critical: "bg-critical",
  info: "bg-secondary",
  action: "bg-action",
  neutral: "bg-muted",
};

export function chipClass(tone) {
  return TONE_CHIP[tone] || TONE_CHIP.neutral;
}

export function barClass(tone) {
  return TONE_BAR[tone] || TONE_BAR.neutral;
}

/** Small rounded label used for status, situation and classification. */
export function WorkflowChip({ tone = "neutral", children, className = "" }) {
  return (
    <span
      className={`inline-flex max-w-full items-center gap-1 truncate rounded-full border px-2.5 py-1 text-[11px] font-semibold ${chipClass(tone)} ${className}`}
    >
      {children}
    </span>
  );
}

/** Section wrapper matching the rest of the case file. */
export function WorkflowPanel({ title, description, action, children, className = "", bodyClassName = "" }) {
  return (
    <section
      className={`overflow-hidden rounded-2xl border border-line bg-white shadow-soft ${className}`}
    >
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
        <div className="min-w-0">
          <h3 className="font-heading text-sm font-semibold text-navy">{title}</h3>
          {description ? (
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted">{description}</p>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </header>
      <div className={`px-5 py-4 ${bodyClassName}`}>{children}</div>
    </section>
  );
}

/** Label/value pair used across the workflow panels. */
export function WorkflowField({ label, children, className = "" }) {
  return (
    <div className={`min-w-0 ${className}`}>
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted">{label}</p>
      <div className="mt-1 text-sm font-semibold text-mirage">{children || "—"}</div>
    </div>
  );
}

/** Primary / secondary button shapes copied from the existing case file. */
export function PrimaryAction({ children, onClick, disabled, title, type = "button", className = "" }) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`inline-flex h-11 items-center justify-center gap-2 rounded-full bg-jordy px-5 text-sm font-semibold text-white shadow-button transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:bg-alt disabled:text-muted disabled:shadow-none ${className}`}
    >
      {children}
    </button>
  );
}

export function SecondaryAction({ children, onClick, disabled, title, type = "button", className = "" }) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`inline-flex h-11 items-center justify-center gap-2 rounded-full border border-line bg-white px-4 text-sm font-semibold text-mirage transition-colors hover:bg-alt disabled:cursor-not-allowed disabled:opacity-60 ${className}`}
    >
      {children}
    </button>
  );
}

/** Inline explanation strip. `tone` maps to the soft token pairs. */
const NOTE_TONE = {
  ok: "border-[#17774e]/25 bg-success-soft text-success",
  warning: "border-[#b45309]/25 bg-warning-soft text-warning",
  critical: "border-[#b5493b]/25 bg-critical-soft text-critical",
  info: "border-line bg-info-soft text-mirage",
  neutral: "border-line bg-alt text-muted",
};

export function WorkflowNote({ tone = "info", icon: Icon, children }) {
  return (
    <p
      className={`flex items-start gap-2.5 rounded-xl border px-4 py-3 text-xs leading-relaxed ${NOTE_TONE[tone] || NOTE_TONE.info}`}
    >
      {Icon ? <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> : null}
      <span className="min-w-0">{children}</span>
    </p>
  );
}