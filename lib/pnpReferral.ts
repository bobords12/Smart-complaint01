/**
 * PNP referral vocabulary and helpers.
 *
 * Two audiences live in this file. The PNP portal reads
 * REFERAL_STATUS_META to colour a badge and decide which action
 * buttons to offer. The Captain's complaint detail reads
 * referralCta to know whether a referral may be created, and why
 * not when it may not.
 *
 * The status list here is documentation and UI only. The database
 * is the authority: pnp_update_referral_status() holds the
 * transition table, and a move this file believes is legal will
 * still be refused if the server disagrees.
 */

export const REFERAL_STATUSES = [
  "referred",
  "acknowledged",
  "in_progress",
  "needs_information",
  "completed",
  "information_submitted",
  "returned",
  "declined",
  "closed",
] as const;

export type ReferralStatus = (typeof REFERAL_STATUSES)[number];

/**
 * pnp_referral_requests.status, exactly as spelled by the
 * referral_request_status enum in pnp-referral-requests.sql.
 *
 * This is the one place those values are written down, and it exists
 * because a mismatch here fails silently rather than loudly. Looking
 * for "pending" when the enum says "pending_review" returns nothing,
 * so the review flow simply never appears — no error, just a review
 * button that is mysteriously absent. Anything that reads or writes a
 * request status must use these names.
 */
export const REFERRAL_REQUEST_STATUSES = [
  "pending_review",
  "more_information_required",
  "approved",
  "declined",
  "officially_referred",
  "completed",
  "cancelled",
] as const;

export const REFERRAL_REQUEST_LABELS: Record<string, string> = {
  pending_review: "Awaiting barangay decision",
  more_information_required: "Waiting on the resident",
  approved: "Approved",
  declined: "Declined",
  officially_referred: "Officially referred to the PNP",
  completed: "Completed",
  cancelled: "Cancelled by the resident",
};

/**
 * Requests a Captain still has to decide on.
 *
 * A request in either state blocks a new request on the same
 * complaint, because the unique index in pnp-referral-requests.sql
 * treats both as active. Treating only one of them as pending would
 * let the Captain start a second request behind the resident's back.
 */
export const OPEN_REFERRAL_REQUEST_STATUSES = [
  "pending_review",
  "more_information_required",
];

export const REFERAL_STATUS_LABELS: Record<string, string> = {
  referred: "Referred",
  acknowledged: "Acknowledged",
  in_progress: "In Progress",
  needs_information: "Needs Information",
  information_submitted: "Information Submitted",
  completed: "Completed",
  returned: "Returned to Barangay",
  declined: "Declined",
  closed: "Closed",
};

/** Tailwind classes, chosen to match the official portal's palette. */
export const REFERAL_STATUS_META: Record<
  string,
  { label: string; className: string; dot: string }
> = {
  referred: {
    label: "Referred",
    className: "bg-info-soft text-secondary",
    dot: "bg-secondary",
  },
  acknowledged: {
    label: "Acknowledged",
    className: "bg-info-soft text-secondary",
    dot: "bg-secondary",
  },
  in_progress: {
    label: "In Progress",
    className: "bg-gold/10 text-gold",
    dot: "bg-gold",
  },
  needs_information: {
    label: "Needs Information",
    className: "bg-warning-soft text-warning",
    dot: "bg-warning",
  },
  information_submitted: {
    label: "Information Submitted",
    className: "bg-info-soft text-secondary",
    dot: "bg-secondary",
  },
  completed: {
    label: "Completed",
    className: "bg-success-soft text-success",
    dot: "bg-success",
  },
  returned: {
    label: "Returned",
    className: "bg-alt text-muted",
    dot: "bg-muted",
  },
  declined: {
    label: "Declined",
    className: "bg-critical-soft text-critical",
    dot: "bg-critical",
  },
  closed: {
    label: "Closed",
    className: "bg-alt text-muted",
    dot: "bg-muted",
  },
};

export function referralStatusMeta(status: string | null | undefined) {
  return (
    REFERAL_STATUS_META[status || ""] || {
      label: status ? humanize(status) : "Unknown",
      className: "bg-alt text-muted",
      dot: "bg-muted",
    }
  );
}

/** Statuses that will not move again on their own. */
export const TERMINAL_REFERRAL_STATUSES = ["closed", "declined"];

/** Statuses in which the PNP still has work ahead of it. */
export const ACTIVE_REFERRAL_STATUSES = [
  "referred",
  "acknowledged",
  "in_progress",
  "needs_information",
  "information_submitted",
];

/**
 * The transitions the PNP officer's own action panel offers,
 * keyed by current status. This mirrors the table in
 * pnp_update_referral_status() minus the moves only the
 * barangay may make (returned, declined, closed).
 *
 * needs_information deliberately offers nothing. The PNP is waiting
 * for the barangay's answer, and information_submitted asserts that
 * the barangay replied — so it is written only by
 * pnp_respond_to_referral_information(), which records the answer's
 * text. Offering the PNP a button that claims the barangay answered
 * would be a false statement on the shared timeline. The RPC rejects
 * the same move, so this is a UI-truth problem, not a security one.
 */
export const PNP_OFFERED_TRANSITIONS: Record<string, ReferralStatus[]> = {
  referred: ["acknowledged"],
  acknowledged: ["in_progress", "needs_information"],
  in_progress: ["needs_information", "completed"],
  needs_information: [],
  information_submitted: ["in_progress", "needs_information"],
  completed: [],
  returned: [],
  declined: [],
  closed: [],
};

/**
 * Transitions the Captain / OIC may make from the complaint
 * detail page. Returning or declining a referral is a decision
 * about the barangay's own request, so it is not offered to the
 * PNP.
 */
export const OFFICIAL_OFFERED_TRANSITIONS: Record<string, ReferralStatus[]> = {
  referred: ["returned", "declined"],
  acknowledged: ["returned", "declined"],
  in_progress: ["returned"],
  needs_information: ["information_submitted", "returned", "declined"],
  information_submitted: ["returned", "declined"],
  completed: ["closed"],
  returned: [],
  declined: [],
  closed: [],
};

/** Moves that require a written reason. */
export function statusNeedsReason(status: string): boolean {
  return status === "returned" || status === "declined" || status === "closed";
}

export function isTerminalStatus(status: string | null | undefined): boolean {
  return (
    status === "closed" || status === "declined" || status === "returned"
  );
}

export function humanize(value: string): string {
  return value
    .replace(/[._]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** The label a status badge shows. */
export function referralStatusLabel(status: string | null | undefined): string {
  if (!status) return "Unknown";
  return REFERAL_STATUS_LABELS[status] || humanize(status);
}

/**
 * Whether a referral row is assigned to a given officer.
 *
 * The dashboard uses this to split "mine" from "unassigned" in
 * the queue. It is a display concern: the RLS policy is what
 * actually decides which rows exist.
 */
export function isAssignedTo(referral: { assigned_officer_id?: string | null }, officerId: string | null | undefined): boolean {
  if (!officerId) return false;
  return referral.assigned_officer_id === officerId;
}

export interface ReferralCtaInput {
  /** A formal referral already exists and is not finished. */
  hasOpenReferral: boolean;
  /** A resident request is waiting for a barangay decision. */
  hasPendingRequest: boolean;
  /** The complaint's respondent has been identified. */
  respondentIdentified: boolean;
  /** 'applicable' | 'not_applicable' | 'pending' */
  kpApplicability: string | null | undefined;
  /** 'incident' | 'complaint' | null */
  complaintNature: string | null | undefined;
}

export interface ReferralCta {
  label: string;
  hint: string;
  enabled: boolean;
  /** Which dialog the Captain's referral tab should open. */
  kind: "create" | "review" | "view" | null;
}

/**
 * The single button on the Captain's referral tab.
 *
 * pnp_create_referral() re-checks every rule below, because a
 * dialog is a convenience and the RPC is the boundary. This
 * function exists so the officer is told why before they click,
 * not after.
 */
export function referralCta(input: ReferralCtaInput): ReferralCta {
  if (input.hasOpenReferral) {
    return {
      label: "View Active Referral",
      hint: "This complaint has already been referred to the PNP. Open the existing referral to update it.",
      enabled: true,
      kind: "view",
    };
  }

  if (input.kpApplicability === "applicable") {
    return {
      label: "Not Eligible for Referral",
      hint: "This case is KP-applicable, so it stays in barangay mediation. A PNP referral does not apply.",
      enabled: false,
      kind: null,
    };
  }

  if (input.respondentIdentified && (!input.kpApplicability || input.kpApplicability === "pending")) {
    return {
      label: "Record KP Assessment First",
      hint: "A respondent is named and KP applicability has not been assessed. Record it in Routing Assessment before referring this case.",
      enabled: false,
      kind: null,
    };
  }

  if (input.hasPendingRequest) {
    return {
      label: "Review Resident Request",
      hint: "The resident has asked for a PNP referral. Approve or decline their request before creating a formal referral.",
      enabled: true,
      kind: "review",
    };
  }

  return {
    label: "Refer to PNP",
    hint: "Create a formal referral. The PNP will see only the summary and evidence you share.",
    enabled: true,
    kind: "create",
  };
}

/** Format a referral reference for display, or a dash. */
export function displayReference(referral: { referral_reference?: string | null } | null | undefined): string {
  return referral?.referral_reference?.trim() || "—";
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * How long a referral has been open, for the queue's age column.
 * Counts from the referral date, not from a status change, because
 * a referral's age is how long the barangay has been waiting.
 */
export function referralAge(referredAt: string | null | undefined): string {
  if (!referredAt) return "—";
  const then = new Date(referredAt).getTime();
  if (Number.isNaN(then)) return "—";
  const days = Math.max(0, Math.floor((Date.now() - then) / 86_400_000));
  if (days === 0) return "Today";
  if (days === 1) return "1 day";
  if (days < 30) return `${days} days`;
  const months = Math.floor(days / 30);
  return months === 1 ? "1 month" : `${months} months`;
}
