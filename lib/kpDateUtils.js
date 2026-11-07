/**
 * Katarungang Pambarangay date-calculation utilities.
 *
 * Convention: the phase start date is treated as Day 1.
 * All dates are parsed as local dates (no UTC offset surprises).
 * Deadlines are inclusive: addDays(startDate, 15) means the 15th day
 * is the deadline, and the period spans 15 calendar days.
 */

/**
 * Parse an ISO date string into a local Date at midnight.
 * Returns null when the input is invalid.
 */
function parseDate(iso) {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    // Strip time component for local-date comparison
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  } catch {
    return null;
  }
}

/**
 * Add a whole number of days to an ISO date string.
 * Returns a new ISO string or null on invalid input.
 */
export function addDays(startDateIso, days) {
  const d = parseDate(startDateIso);
  if (!d) return null;
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

/**
 * Calculate the number of whole days between two dates (end − start).
 * The start date is Day 1, so elapsed on the start date = 1.
 * Returns 0 when inputs are invalid or end <= start.
 */
export function daysBetween(startIso, endIso) {
  const s = parseDate(startIso);
  const e = parseDate(endIso);
  if (!s || !e) return 0;
  const diffMs = e.getTime() - s.getTime();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
  return Math.max(0, diffDays);
}

/**
 * Calculate elapsed days from start to "now" (or a reference date).
 * Start date is Day 1, so on the start date elapsed = 1.
 */
export function elapsedDays(startIso, nowIso) {
  if (!startIso) return 0;
  const now = nowIso ? parseDate(nowIso) : new Date();
  if (!now) return 0;
  const start = parseDate(startIso);
  if (!start) return 0;
  const diffMs = now.getTime() - start.getTime();
  const diff = Math.round(diffMs / (1000 * 60 * 60 * 24));
  return Math.max(0, diff + 1); // +1 because start is Day 1
}

/**
 * Calculate remaining days from a deadline.
 * Returns 0 when the deadline has passed.
 */
export function remainingDays(deadlineIso, nowIso) {
  if (!deadlineIso) return 0;
  const now = nowIso ? parseDate(nowIso) : new Date();
  if (!now) return 0;
  const deadline = parseDate(deadlineIso);
  if (!deadline) return 0;
  const diffMs = deadline.getTime() - now.getTime();
  const diff = Math.round(diffMs / (1000 * 60 * 60 * 24));
  return Math.max(0, diff);
}

/**
 * Clamp progress percentage between 0 and 100.
 */
export function clampProgress(elapsed, total) {
  if (!total || total <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((elapsed / total) * 100)));
}

/**
 * Check if a period is "due soon" (3 or fewer days remaining).
 */
export function isDueSoon(deadlineIso, nowIso, threshold = 3) {
  return remainingDays(deadlineIso, nowIso) <= threshold;
}

/**
 * Format an ISO date string to a human-readable long format.
 * Example: "September 3, 2026"
 */
export function formatDateLong(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}
