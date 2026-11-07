/**
 * Resident-facing date and time formatting.
 *
 * ONE rule governs every date a resident sees: it is a calendar value in
 * Barangay Abuno, which is Asia/Manila (UTC+8, no daylight saving).
 *
 * The schema stores two shapes of date and they must NOT be treated alike:
 *
 *   `hearings.hearing_date`  is a SQL `date`  -> "2026-10-12"
 *   `hearings.hearing_time`  is a SQL `time`  -> "19:00:00"
 *
 * Both are already local calendar values. Running them through
 * `new Date("2026-10-12")` reinterprets the value as UTC midnight, which is
 * 08:00 in Manila, and any later formatting that shifts the zone pushes the
 * printed day backwards. That class of bug is why a cancelled session once
 * read "2001-10-10" style nonsense once a mapper fed a bare date into Date.
 *
 * So: date-only and time-only strings are parsed with a regex and never
 * routed through `Date` at all. Only genuine instants (timestamptz columns
 * such as `created_at`, `submitted_at`, `generated_at`) go through `Date`,
 * and they are always rendered with an explicit Asia/Manila zone.
 */

export const MANILA_TIME_ZONE = "Asia/Manila";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const SHORT_MONTHS = MONTHS.map((m) => m.slice(0, 3));

/** `2026-10-12` — a bare SQL date. Never timezone-converted. */
const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
/** `19:00` or `19:00:00` — a bare SQL time. Never timezone-converted. */
const TIME_ONLY_RE = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/;

function validMonth(index) {
  return Number.isInteger(index) && index >= 0 && index <= 11;
}

/**
 * Split a bare SQL date into calendar parts without touching `Date`.
 * Returns null when the value is not a readable calendar date.
 */
function parseDateOnly(value) {
  const match = DATE_ONLY_RE.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  if (!validMonth(monthIndex) || day < 1 || day > 31) return null;
  return { year, monthIndex, day };
}

/**
 * The calendar parts of a value, whatever shape it arrived in.
 *
 * A bare date is read literally. A bare time has no calendar part. Anything
 * else is an instant and is converted to Manila before its parts are read.
 */
function calendarParts(value) {
  const text = trimText(value);
  if (!text) return null;

  const dateOnly = parseDateOnly(text);
  if (dateOnly) return dateOnly;

  if (TIME_ONLY_RE.test(text)) return null;

  const instant = new Date(text);
  if (Number.isNaN(instant.getTime())) {
    // Not a date and not an instant. Fall back to a literal reading so a
    // stray value degrades to something a person can still recognise.
    return parseDateOnly(text.slice(0, 10));
  }

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: MANILA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);

  const get = (type) => Number(parts.find((p) => p.type === type)?.value);
  const year = get("year");
  const monthIndex = get("month") - 1;
  const day = get("day");
  if (!validMonth(monthIndex)) return null;
  return { year, monthIndex, day };
}

function trimText(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

/** `2026-10-12` or `October 12, 2026`. Returns "" when unreadable. */
export function formatResidentDate(value, { style = "long" } = {}) {
  const parts = calendarParts(value);
  if (!parts) return "";
  const month = style === "short" ? SHORT_MONTHS[parts.monthIndex] : MONTHS[parts.monthIndex];
  return style === "short"
    ? `${month} ${parts.day}, ${parts.year}`
    : `${month} ${parts.day}, ${parts.year}`;
}

/** `Oct 12, 2026` — compact form for dense cards. */
export function formatResidentDateShort(value) {
  return formatResidentDate(value, { style: "short" });
}

/**
 * `7:00 PM`. Reads a bare SQL time literally, so "19:00:00" is 7:00 PM in
 * Manila with no conversion and no possibility of drift.
 */
export function formatResidentTime(value) {
  const text = trimText(value);
  if (!text) return "";

  const match = TIME_ONLY_RE.exec(text);
  let hour24;
  let minute;

  if (match) {
    hour24 = Number(match[1]);
    minute = match[2];
    if (!Number.isInteger(hour24) || hour24 < 0 || hour24 > 23) return "";
  } else {
    const instant = new Date(text);
    if (Number.isNaN(instant.getTime())) return "";
    const formatted = new Intl.DateTimeFormat("en-US", {
      timeZone: MANILA_TIME_ZONE,
      hour: "numeric",
      minute: "2-digit",
      hour12: false,
    }).format(instant);
    const [h, m] = formatted.split(":");
    hour24 = Number(h === "24" ? "0" : h);
    minute = m;
    if (!Number.isInteger(hour24)) return "";
  }

  const suffix = hour24 < 12 ? "AM" : "PM";
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${minute} ${suffix}`;
}

/**
 * `October 12, 2026 / 7:00 PM` — the canonical resident-facing pairing.
 * Falls back to whichever half is readable rather than printing "Invalid
 * Date" when one column is empty.
 */
export function formatResidentSchedule(date, time) {
  const day = formatResidentDate(date);
  const clock = formatResidentTime(time);
  if (day && clock) return `${day} / ${clock}`;
  return day || clock || "To be announced";
}

/** `October 12, 2026 • 7:00 PM` — separator used inside detail sections. */
export function formatResidentScheduleBullet(date, time) {
  return formatResidentSchedule(date, time).replace(" / ", " • ");
}

/** `Oct 12` — for timeline gutters. */
export function formatResidentMonthDay(value) {
  const parts = calendarParts(value);
  if (!parts) return "";
  return `${SHORT_MONTHS[parts.monthIndex]} ${parts.day}`;
}

/**
 * The current calendar date in Manila as `2026-10-12`.
 *
 * Comparing a bare `hearing_date` against this string is exact and cannot
 * suffer the UTC-offset bug that `new Date()` comparisons invite.
 */
export function residentToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: MANILA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/**
 * A sortable `YYYY-MM-DD HH:MM` key for a hearing's start, evaluated in
 * Manila. Bare dates and bare times are concatenated as stored, so the key
 * is the literal barangay calendar value. An instant is converted first.
 *
 * Lexicographic comparison of two such keys is chronological, which is how
 * "the nearest upcoming hearing" is chosen without ever building a Date.
 */
export function residentScheduleKey(date, time) {
  const dateText = trimText(date);
  if (!dateText) return "";

  let dayKey = "";
  const dateOnly = parseDateOnly(dateText);
  if (dateOnly) {
    dayKey = `${String(dateOnly.year).padStart(4, "0")}-${String(dateOnly.monthIndex + 1).padStart(2, "0")}-${String(dateOnly.day).padStart(2, "0")}`;
  } else if (!TIME_ONLY_RE.test(dateText)) {
    dayKey = formatResidentDate(dateText)
      ? new Intl.DateTimeFormat("en-CA", {
          timeZone: MANILA_TIME_ZONE,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(new Date(dateText))
      : "";
  }
  if (!dayKey) return "";

  const clock = formatResidentTime(time);
  if (!clock) return `${dayKey} 00:00`;

  const match = TIME_ONLY_RE.exec(trimText(time));
  let hour24;
  let minute;
  if (match) {
    hour24 = Number(match[1]);
    minute = match[2];
  } else {
    const instant = new Date(time);
    const formatted = new Intl.DateTimeFormat("en-US", {
      timeZone: MANILA_TIME_ZONE,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(instant);
    const [h, m] = formatted.split(":");
    hour24 = Number(h === "24" ? "0" : h);
    minute = m;
  }
  if (!Number.isInteger(hour24) || !minute) return `${dayKey} 00:00`;

  return `${dayKey} ${String(hour24).padStart(2, "0")}:${minute}`;
}

/** The sortable key for "right now" in Manila. */
export function residentNowKey() {
  return `${residentToday()} ${new Intl.DateTimeFormat("en-US", {
    timeZone: MANILA_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(new Date())
    .replace("24:00", "00:00")}`;
}

/** True when a hearing's start is still ahead of the clock in Manila. */
export function isHearingInFuture(hearing) {
  const key = residentScheduleKey(hearing?.hearing_date, hearing?.hearing_time);
  if (!key) return false;
  return key > residentNowKey();
}

/** `1.2 MB`, `840 KB` — for resident-visible document sizes. */
export function formatFileSize(bytes) {
  const size = Number(bytes);
  if (!Number.isFinite(size) || size <= 0) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

/** `3h ago`, `2d ago`, `Oct 9` — for notification timestamps. */
export function formatTimeAgo(value) {
  const text = trimText(value);
  if (!text) return "";
  const instant = new Date(text);
  if (Number.isNaN(instant.getTime())) return "";

  const diffMs = Date.now() - instant.getTime();
  if (diffMs < 0) return formatResidentDateShort(text);

  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return formatResidentDateShort(text);
}
