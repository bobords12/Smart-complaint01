/**
 * Choosing which saved hearing the portal should act on.
 *
 * A case can hold several hearing rows over its life: the first hearing, a
 * rescheduled replacement, a cancelled date, and later sessions. Every part of
 * the portal that needs "the" hearing - the tracker, the derived party status,
 * and the Notice of Hearing that gets generated - has to agree on that choice,
 * or a notice can be printed for a hearing the tracker is not showing.
 *
 * The rule is deliberately narrow:
 *
 *   - a Cancelled hearing is never the active one; it is history, and the
 *     cancelled row is kept rather than deleted
 *   - among the rest, a hearing that still has to happen outranks one that is
 *     already over, so a completed first hearing cannot mask the rescheduled
 *     second hearing sitting behind it
 *   - ties break on date, then time, then id, so the choice is stable and does
 *     not depend on the order the rows happened to come back from the database
 */

/** Sort key for a hearing: date, then time, then id for a stable total order. */
function compareHearings(a, b) {
  return (
    String(a?.hearing_date || "").localeCompare(String(b?.hearing_date || "")) ||
    String(a?.hearing_time || "").localeCompare(String(b?.hearing_time || "")) ||
    String(a?.id || "").localeCompare(String(b?.id || ""))
  );
}

/** Every hearing for a case, earliest first, cancelled ones included. */
export function sortHearings(hearings) {
  return [...(hearings || [])].sort(compareHearings);
}

/** Hearings that have not been cancelled, earliest first. */
export function liveHearings(hearings) {
  return sortHearings(hearings).filter((h) => h?.status !== "Cancelled");
}

/**
 * The hearing that is still to happen, if there is one.
 *
 * "Still to happen" is judged on the stored date against `today` in the
 * barangay's own timezone, so a hearing earlier today that has not been marked
 * Completed is still the active one. Pass `today` as "YYYY-MM-DD" to keep the
 * result independent of the browser's timezone.
 */
export function nextUpcomingHearing(hearings, { today = null } = {}) {
  // Rescheduled is a historical state, not a pending one. It used to be
  // included here, so a hearing that had been moved to another date could
  // still be chosen as "the" hearing the portal acts on, and the Notice of
  // Hearing could be printed for a date that no longer applies.
  const live = liveHearings(hearings).filter(
    (h) => h?.status !== "Completed" && h?.status !== "Rescheduled"
  );
  if (!live.length) return null;
  if (!today) return live[0];

  // A row with no date cannot be compared, so it is treated as still ahead.
  return live.find((h) => !h?.hearing_date || h.hearing_date >= today) || null;
}

/**
 * The hearing the portal should present and print from.
 *
 * The next upcoming hearing wins. When every hearing is over, the most recent
 * one still describes where the case actually is, so it is shown rather than
 * leaving the panel blank.
 */
export function activeHearing(hearings, { today = null } = {}) {
  const upcoming = nextUpcomingHearing(hearings, { today });
  if (upcoming) return upcoming;

  // Nothing is still to happen. The most recent hearing that was not
  // cancelled or rescheduled describes where the case is. Rescheduled rows
  // are excluded here too: the replacement is the live hearing, not the
  // date it replaced.
  const live = liveHearings(hearings).filter((h) => h?.status !== "Rescheduled");
  if (!live.length) return null;
  return live[live.length - 1];
}

/**
 * Today's calendar date in the barangay's timezone, as "YYYY-MM-DD".
 *
 * Re-exported from the date helpers so the schedule and the printed documents
 * can never disagree about which day "today" is.
 */
export { manilaToday } from "../documents/caseDate.js";