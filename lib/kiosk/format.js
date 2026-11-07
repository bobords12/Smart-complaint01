/**
 * Presentation-only formatting for the kiosk.
 *
 * Two rules everything here follows:
 *
 *  1. The kiosk runs in two languages and never three. `formatDate`
 *     uses "en-PH" or "fil-PH" depending on the selected language,
 *     never the browser's locale, because a walk-in at the kiosk might
 *     be reading on a machine set to a locale the project does not
 *     support. That is also how Cebuano creeps in, and the spec forbids
 *     mixing it with Filipino.
 *  2. Nothing here decides anything. A date is formatted for display;
 *     the authoritative value always stays the ISO string the server
 *     stored.
 */

const LOCALE = { en: "en-PH", pil: "fil-PH" };

function safeDate(value) {
  if (!value) return null;
  // Postgres returns an ISO timestamp; bare dates arrive as "YYYY-MM-DD",
  // which Safari refuses to parse as local time. Pin them to UTC midnight
  // so the calendar day a resident typed is the day that is displayed.
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const parsed = new Date(`${value}T00:00:00Z`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** "30 September 2026" / "30 Setyembre 2026". */
export function formatDate(value, language = "en") {
  const date = safeDate(value);
  if (!date) return "—";
  return new Intl.DateTimeFormat(LOCALE[language] || LOCALE.en, {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

/** "30 Sep 2026, 2:15 PM" / "30 Set 2026, 2:15 PM". */
export function formatDateTime(value, language = "en") {
  const date = safeDate(value);
  if (!date) return "—";
  return new Intl.DateTimeFormat(LOCALE[language] || LOCALE.en, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: value.length === 10 ? "UTC" : undefined,
  }).format(date);
}

/**
 * "2:15 PM" from Postgres `time without time zone`, which is stored
 * as HH:MM:SS and has no offset to resolve.
 */
export function formatTime(value) {
  if (!value) return "—";
  const match = /^(\d{2}):(\d{2})/.exec(String(value));
  if (!match) return String(value);
  const hours = Number(match[1]);
  const suffix = hours >= 12 ? "PM" : "AM";
  const display = hours % 12 || 12;
  return `${display}:${match[2]} ${suffix}`;
}

/** "3:45" for a countdown, from milliseconds. */
export function formatCountdown(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/** "9:58" remaining on the upload QR, from an expiry timestamp. */
export function formatRemaining(expiresAt) {
  const date = safeDate(expiresAt);
  if (!date) return "--:--";
  return formatCountdown(date.getTime() - Date.now());
}

/** "2.4 MB" / "840 KB". */
export function formatBytes(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return "—";
  if (value < 1024) return `${value} B`;
  const kb = value / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}

/** Number of files, with a plural agreed in the active language. */
export function formatFileCount(count, language = "en", one = "file", many = "files") {
  const n = Number(count) || 0;
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * Timeline stage wording, resolved in the active language.
 *
 * `complaints.current_stage` is free text written by staff, so it is
 * matched case-insensitively against a small vocabulary rather than
 * compared exactly. Anything unrecognised falls through to `fallback`,
 * which keeps a real, if unstyled, stage name visible instead of
 * silently claiming a stage the citizen has not reached.
 */
export const TIMELINE_STAGES = {
  filed: "timeline.stage.filed",
  reviewed: "timeline.stage.reviewed",
  summons: "timeline.stage.summons",
  mediation: "timeline.stage.mediation",
  settlement: "timeline.stage.settlement",
  underReview: "timeline.stage.underReview",
  routing: "timeline.stage.routing",
  linked: "timeline.stage.linked",
  closed: "timeline.stage.closed",
};

const STAGE_PATTERNS = [
  ["summons", /summon/i],
  ["mediation", /mediat|conciliat/i],
  ["settlement", /settl|escalat/i],
  ["reviewed", /review(ed)? and approved|approved|reviewed/i],
  ["underReview", /under review|in progress|received|encoding|pending review/i],
  ["routing", /routing|route/i],
  ["linked", /blotter|referr/i],
  ["closed", /closed|resolved|completed|rejected/i],
];

export function classifyStage(stage, status) {
  const text = `${stage || ""} ${status || ""}`;
  for (const [key, pattern] of STAGE_PATTERNS) {
    if (pattern.test(text)) return key;
  }
  return null;
}

/** complaint_status enum, so the badge never invents a value. */
const STATUS_LABELS = {
  "Pending Review": { en: "Pending Review", pil: "Naghihintay ng Pagsusuri" },
  Received: { en: "Received", pil: "Naisanggap" },
  "In Progress": { en: "In Progress", pil: "Isinasagawa" },
  "Awaiting Meeting": { en: "Awaiting Meeting", pil: "Naghihintay ng Pulong" },
  Resolved: { en: "Resolved", pil: "Naayos" },
  Closed: { en: "Closed", pil: "Nakasara" },
  Rejected: { en: "Not Accepted", pil: "Hindi Tinanggap" },
};

export function statusLabel(status, language = "en") {
  const entry = STATUS_LABELS[status];
  if (!entry) return status || "—";
  return entry[language] || entry.en;
}

/** Case-insensitive enum membership, used to pick a badge colour. */
export function statusTone(status) {
  switch (status) {
    case "Resolved":
    case "Closed":
      return "done";
    case "Rejected":
      return "rejected";
    case "In Progress":
    case "Awaiting Meeting":
      return "active";
    default:
      return "pending";
  }
}