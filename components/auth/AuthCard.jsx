import { SITE } from "@/lib/constants";

export function BrandMark() {
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-paledgold">
      <svg
        width="15"
        height="15"
        viewBox="0 0 15 15"
        fill="none"
        aria-hidden="true"
        focusable="false"
      >
        <rect x="1.875" y="3.125" width="11.25" height="10" stroke="#B7791F" strokeWidth="1.25" />
        <rect x="1.875" y="1.875" width="11.25" height="4.375" stroke="#B7791F" strokeWidth="1.25" />
      </svg>
    </span>
  );
}

export default function AuthCard({
  topLabel,
  welcome,
  title,
  titleId,
  subtitle,
  children,
}) {
  return (
    <div className="flex max-h-[calc(100dvh-2rem)] w-full flex-col overflow-hidden rounded-[24px] border border-white/10 bg-white shadow-[0_28px_80px_-28px_rgba(6,20,45,0.7)] dark:bg-alt dark:shadow-[0_28px_80px_-28px_rgba(0,0,0,0.7)]">
      {/* Brand bar */}
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line py-4 pl-5 pr-12 sm:pl-7">
        <div className="flex min-w-0 items-center gap-3">
          <BrandMark />
          <div className="min-w-0">
            <p className="font-heading text-[17px] font-bold leading-tight text-navy dark:text-secondary">
              {SITE.shortName}
            </p>
            <p className="text-[13px] text-muted">
              {SITE.barangay}, {SITE.city}
            </p>
          </div>
        </div>
      </div>

      {/* Card header — kept visible when the form body scrolls */}
      <div className="shrink-0 px-5 pt-5 sm:px-7 sm:pt-6">
        {topLabel ? <p className="eyebrow">{topLabel}</p> : null}
        {welcome ? (
          <p className="mt-2 font-heading text-base font-bold tracking-wide text-navy dark:text-secondary">
            {welcome}
          </p>
        ) : null}
        <h1
          id={titleId}
          className="mt-1 font-heading text-[26px] font-semibold leading-tight tracking-tight text-navy dark:text-secondary sm:text-[30px]"
        >
          {title}
        </h1>
        {subtitle ? (
          <p className="mt-2 text-sm leading-relaxed text-muted">{subtitle}</p>
        ) : null}
      </div>

      {/* Scrollable form body */}
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6 pt-5 sm:px-7 sm:pb-7">
        {children}
      </div>
    </div>
  );
}