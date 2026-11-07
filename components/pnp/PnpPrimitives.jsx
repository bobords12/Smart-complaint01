"use client";

/**
 * Shared presentational pieces for the PNP Coordination Portal.
 *
 * These are presentation only. Nothing here fetches, decides or
 * guards: the status colours and empty-state wording are cosmetic,
 * and every access decision in this portal is made by RLS before a
 * row reaches a component.
 */

import { AlertTriangle, Info, Loader2 } from "lucide-react";
import { referralStatusMeta } from "@/lib/pnpReferral";

/* ── Page header ─────────────────────────────────────────── */

export function PnpPageHeader({ title, subtitle, actions, backHref, backLabel }) {
  return (
    <div className="mb-6">
      {backHref ? (
        <a
          href={backHref}
          className="mb-2 inline-flex items-center gap-1.5 text-[13px] font-medium text-secondary transition-colors hover:text-navy focus-visible:outline-2 focus-visible:outline-secondary"
        >
          <span aria-hidden="true">←</span>
          {backLabel || "Back"}
        </a>
      ) : null}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="font-heading text-2xl font-bold tracking-tight text-navy sm:text-[28px]">
            {title}
          </h1>
          {subtitle ? (
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted">{subtitle}</p>
          ) : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}

/* ── Status badge ────────────────────────────────────────── */

export function ReferralStatusBadge({ status, size = "md" }) {
  const meta = referralStatusMeta(status);
  const small = size === "sm";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-semibold ${meta.className} ${
        small ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-1 text-[11px]"
      }`}
    >
      <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
      {meta.label}
    </span>
  );
}

/* ── Safety / urgency flag ───────────────────────────────── */

/**
 * The safety-concern marker. Rendered from has_safety_concern, which
 * the Captain sets at referral time. It is a flag for triage, not an
 * allegation and not a finding.
 */
export function SafetyConcernFlag({ compact = false }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-critical-soft px-2.5 py-1 text-[11px] font-semibold text-critical">
      <AlertTriangle className="h-3 w-3" aria-hidden="true" />
      {compact ? "Safety" : "Safety concern"}
    </span>
  );
}

/* ── Cards ───────────────────────────────────────────────── */

export function StatCard({ icon: Icon, value, label, tone = "default", busy, hint }) {
  const tones = {
    default: "text-secondary",
    warning: "text-warning",
    success: "text-success",
    critical: "text-critical",
  };
  return (
    <div className="rounded-2xl border border-line bg-white p-5 shadow-sm">
      <div className="flex items-center gap-3">
        <span className={`flex h-11 w-11 items-center justify-center rounded-xl bg-alt ${tones[tone]}`}>
          {busy ? (
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
          ) : (
            <Icon className="h-5 w-5" aria-hidden="true" />
          )}
        </span>
        <div className="min-w-0">
          <p className="font-heading text-2xl font-bold tracking-tight text-navy">
            {busy ? "—" : value}
          </p>
          <p className="truncate text-[13px] text-muted">{label}</p>
        </div>
      </div>
      {hint ? <p className="mt-3 text-[11px] leading-relaxed text-muted/80">{hint}</p> : null}
    </div>
  );
}

export function Panel({ title, description, actions, children, className = "" }) {
  return (
    <section className={`rounded-2xl border border-line bg-white shadow-sm ${className}`}>
      {title ? (
        <div className="flex flex-col gap-2 border-b border-line px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h2 className="font-heading text-base font-semibold text-navy">{title}</h2>
            {description ? (
              <p className="mt-0.5 text-[13px] leading-relaxed text-muted">{description}</p>
            ) : null}
          </div>
          {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
        </div>
      ) : null}
      <div className="p-5">{children}</div>
    </section>
  );
}

/* ── States ──────────────────────────────────────────────── */

export function EmptyState({ icon: Icon, title, message, action }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-line bg-white px-6 py-12 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-alt text-muted">
        <Icon className="h-6 w-6" aria-hidden="true" />
      </span>
      <h3 className="mt-4 font-heading text-base font-semibold text-navy">{title}</h3>
      <p className="mt-1.5 max-w-md text-sm leading-relaxed text-muted">{message}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function LoadingBlock({ label = "Loading…" }) {
  return (
    <div role="status" aria-live="polite" className="flex flex-col items-center justify-center rounded-2xl border border-line bg-white px-6 py-14">
      <Loader2 className="h-7 w-7 animate-spin text-secondary" aria-hidden="true" />
      <p className="mt-3 text-sm text-muted">{label}</p>
      <span className="sr-only">Loading, please wait.</span>
    </div>
  );
}

/**
 * The "the database setup has not been applied" state.
 *
 * Worth its own component because it is a different failure from an
 * empty list. An officer with no work is told so; an officer hitting
 * a missing migration is told how to fix it, because the two look
 * identical otherwise and the second one is a support call.
 */
export function SetupMissingNotice({ files = "pnp-portal-01 through -05" }) {
  return (
    <div className="rounded-2xl border border-warning/40 bg-warning-soft p-5">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" aria-hidden="true" />
        <div>
          <h3 className="font-heading text-sm font-semibold text-navy">
            PNP referral database setup has not been applied
          </h3>
          <p className="mt-1.5 text-sm leading-relaxed text-muted">
            The pages in this portal read <code className="text-[12px]">public.complaint_referrals</code> and
            its policies, which are created by the manual migration files. Until they are
            applied, this list is empty because there is nothing to read &mdash; not because there is
            no work.
          </p>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            Apply <code className="text-[12px]">{files}</code> in the Supabase SQL Editor, in
            order. See <code className="text-[12px]">supabase/manual/PNP_SETUP_GUIDE.md</code>.
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * A note that explains a boundary rather than hiding it.
 *
 * Used where the PNP is deliberately missing something (the
 * complainant's narrative, other evidence, other officers' work), so
 * the absence reads as a decision instead of a bug.
 */
export function BoundaryNote({ children, title = "What you can see here" }) {
  return (
    <div className="rounded-xl border border-line bg-alt/60 p-4">
      <div className="flex items-start gap-2.5">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-secondary" aria-hidden="true" />
        <div>
          <p className="text-[13px] font-semibold text-navy">{title}</p>
          <div className="mt-1 text-[13px] leading-relaxed text-muted">{children}</div>
        </div>
      </div>
    </div>
  );
}

/* ── Fields ──────────────────────────────────────────────── */

export function DetailField({ label, children, mono = false, className = "" }) {
  return (
    <div className={className}>
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</dt>
      <dd
        className={`mt-1 text-sm text-navy ${mono ? "font-mono text-[13px]" : ""}`}
      >
        {children ?? <span className="text-muted">—</span>}
      </dd>
    </div>
  );
}

export function TextField({ label, hint, error, as = "input", children, ...props }) {
  const Tag = as;
  return (
    <label className="block">
      <span className="block text-[13px] font-semibold text-navy">{label}</span>
      {hint ? <span className="mt-0.5 block text-[12px] leading-relaxed text-muted">{hint}</span> : null}
      <Tag
        {...props}
        className={`mt-1.5 w-full rounded-xl border bg-white px-3.5 py-2.5 text-sm text-navy outline-none transition-colors placeholder:text-muted/60 focus:border-secondary focus:ring-2 focus:ring-secondary/20 ${
          error ? "border-critical" : "border-line"
        } ${props.className || ""}`}
      />
      {error ? <span className="mt-1 block text-[12px] font-medium text-critical">{error}</span> : null}
      {children}
    </label>
  );
}

/* ── Buttons ─────────────────────────────────────────────── */

export function PrimaryButton({ busy, children, className = "", ...props }) {
  return (
    <button
      {...props}
      disabled={busy || props.disabled}
      className={`inline-flex min-h-[40px] items-center justify-center gap-2 rounded-xl bg-secondary px-4 text-[13px] font-semibold text-white transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary disabled:cursor-not-allowed disabled:opacity-60 ${className}`}
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

export function SecondaryButton({ children, className = "", ...props }) {
  return (
    <button
      {...props}
      className={`inline-flex min-h-[40px] items-center justify-center gap-2 rounded-xl border border-line bg-white px-4 text-[13px] font-semibold text-navy transition-colors hover:border-secondary/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary disabled:cursor-not-allowed disabled:opacity-60 ${className}`}
    >
      {children}
    </button>
  );
}

/* ── Author label ────────────────────────────────────────── */

/**
 * Who wrote a timeline entry.
 *
 * author_role is written by the RPC, not by the client, so this
 * cannot be forged from the browser. A missing author shows as
 * "System" rather than blank, because a referral timeline with gaps
 * in it invites the reader to wonder what was removed.
 */
const ROLE_LABELS = {
  pnp_officer: "PNP Officer",
  captain: "Barangay Captain",
  oic: "Officer-in-Charge",
  secretary: "Barangay Secretary",
  system: "System",
};

export function AuthorLabel({ role, name }) {
  const label = ROLE_LABELS[role] || "Barangay";
  return (
    <span className="text-[12px] font-medium text-muted">
      {name ? `${name} · ${label}` : label}
    </span>
  );
}
