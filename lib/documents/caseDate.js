/**
 * Case date and time phrases for the printed barangay forms.
 *
 * `hearings.hearing_date` is a Postgres `date` and `hearing_time` is a
 * `time`. Supabase returns both as bare text - "2026-06-10" and "14:00:00" -
 * with no zone marker. Handing those to `new Date()` makes the browser read
 * them as UTC midnight, which prints the previous day for anyone west of UTC:
 * a June 10 hearing would read as June 9 on an official document.
 *
 * The parts are therefore read straight out of the stored text, so a saved
 * schedule always prints as the exact day and time that was scheduled,
 * regardless of the timezone of the machine that generates the document.
 */

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function isBlank(value) {
  return value === null || value === undefined || String(value).trim() === "";
}

/**
 * The calendar parts of a stored case date.
 *
 * Accepts the bare "YYYY-MM-DD" Postgres returns, a full ISO timestamp, or a
 * Date. Only the leading date component of an ISO string is read, so a
 * timestamp can never pull the printed day across a zone boundary.
 *
 * @returns {{ day: string, month: string, year: string } | null}
 */
export function caseDateParts(value) {
  if (isBlank(value)) return null;

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return {
      day: String(value.getDate()),
      month: MONTHS[value.getMonth()],
      year: String(value.getFullYear()),
    };
  }

  const raw = String(value).trim();
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const [, year, month, day] = iso;
    const monthIndex = Number(month) - 1;
    if (monthIndex < 0 || monthIndex > 11) return null;
    return {
      day: String(Number(day)),
      month: MONTHS[monthIndex],
      year,
    };
  }

  const fallback = new Date(raw);
  if (Number.isNaN(fallback.getTime())) return null;
  return caseDateParts(fallback);
}

/**
 * A stored case time as the forms print it, with the meridiem the templates
 * offer as "morning/afternoon".
 *
 * @returns {{ time: string, meridiem: string } | null}
 */
export function caseTimeParts(value) {
  if (isBlank(value)) return null;
  const match = String(value).trim().match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;

  const hour = Number(match[1]);
  const minute = match[2];
  if (!Number.isFinite(hour) || hour < 0 || hour > 23) return null;

  const displayHour = hour % 12 === 0 ? 12 : hour % 12;
  return {
    time: `${displayHour}:${minute}`,
    meridiem: hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening",
  };
}

/**
 * Today's date as the barangay sees it.
 *
 * A document is dated when it is issued, which is "today" in Manila - not the
 * today of whichever machine happens to be signed in. Reading the calendar day
 * out of the Asia/Manila zone keeps a document generated late in the Philippine
 * evening from carrying the previous day's date when the official's own computer
 * is set to another zone.
 *
 * @returns {{ day: string, month: string, year: string } | null}
 */
export function caseTodayParts(now = new Date()) {
  try {
    // en-CA renders as YYYY-MM-DD.
    const iso = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Manila",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
    return caseDateParts(iso);
  } catch {
    return caseDateParts(now);
  }
}

/**
 * Today's calendar date in the barangay's timezone, as a sortable "YYYY-MM-DD".
 *
 * A document is dated when it is issued and a hearing is compared against
 * "now" when the panel decides what is still ahead, so both need the day the
 * barangay is actually living in rather than the day of whichever machine is
 * signed in. Returns null only if the runtime cannot format a Manila date at
 * all, in which case callers must treat the date as unknown rather than guess.
 *
 * @param {Date} [now]
 * @returns {string | null}
 */
export function manilaToday(now = new Date()) {
  try {
    // en-CA renders as YYYY-MM-DD.
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Manila",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
  } catch {
    return null;
  }
}