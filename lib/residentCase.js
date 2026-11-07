/**
 * Resident-facing derivations for a complaint and its hearings.
 *
 * Everything here is a pure function over canonical Captain-side records.
 * Nothing is stored, nothing is copied into a resident-only table, and
 * nothing re-derives a status that `lib/constants.js` already owns.
 *
 * Privacy: these helpers only ever read columns the resident is entitled to.
 * Internal notes, routing rationale, staff comments and legal assessment
 * text are deliberately absent from every signature.
 */

import { residentComplaintStatus } from "@/lib/constants";
import {
  formatResidentDate,
  formatResidentSchedule,
  formatResidentTime,
  residentScheduleKey,
  isHearingInFuture,
} from "@/lib/residentDates";

/* ── Hearing status ─────────────────────────────────────────────────── */

/**
 * `hearing_status` gained the value `Held` in migration 29a when the
 * meeting record became the evidence that a session actually happened.
 * A resident reads that the same way as "Completed"; showing both labels
 * for one state is exactly the inconsistency this map exists to prevent.
 */
export const RESIDENT_HEARING_STATUS = {
  Upcoming: "Upcoming",
  Scheduled: "Upcoming",
  Held: "Completed",
  Completed: "Completed",
  Rescheduled: "Rescheduled",
  Cancelled: "Cancelled",
};

export function residentHearingStatus(status) {
  if (!status) return "Upcoming";
  return RESIDENT_HEARING_STATUS[status] ?? status;
}

/** Statuses a resident may still act on. Rescheduled and Cancelled are history. */
export function isUpcomingHearing(hearing) {
  return residentHearingStatus(hearing?.status) === "Upcoming";
}

/** A superseded session is one the barangay replaced, not one that happened. */
export function isRescheduledHearing(hearing) {
  return residentHearingStatus(hearing?.status) === "Rescheduled";
}

/* ── Category and urgency ───────────────────────────────────────────── */

/**
 * The official confirmation wins over the AI prediction. Until the Captain
 * confirms a category the card shows the AI suggestion, which is already
 * what the resident saw when they filed.
 */
export function residentCategory(complaint) {
  return (
    complaint?.confirmed_category ||
    complaint?.confirmedCategory ||
    complaint?.predicted_category ||
    complaint?.category ||
    "Uncategorized"
  );
}

export function residentUrgency(complaint) {
  return (
    complaint?.confirmed_urgency ||
    complaint?.confirmedPriority ||
    complaint?.predicted_urgency ||
    complaint?.priority ||
    "Normal"
  );
}

/* ── Barangay Case No. ──────────────────────────────────────────────── */

export const NOT_ASSIGNED_CASE_NUMBER = "Not yet assigned";

/**
 * The official case number only exists once `receive_complaint_official`
 * generated it. Before that the field reads "Not yet assigned" — never
 * "Pending", which is a word that must never reach an official document.
 */
export function residentCaseNumber(complaint) {
  const value = complaint?.barangay_case_number ?? complaint?.barangayCaseNumber ?? null;
  const text = typeof value === "string" ? value.trim() : "";
  return text || NOT_ASSIGNED_CASE_NUMBER;
}

export function hasCaseNumber(complaint) {
  return residentCaseNumber(complaint) !== NOT_ASSIGNED_CASE_NUMBER;
}

/* ── Respondent ─────────────────────────────────────────────────────── */

export const RESPONDENT_NOT_IDENTIFIED = "Respondent not yet identified";
export const RESPONDENT_NOT_APPLICABLE = "No other party involved";

/**
 * Resident-safe wording for the other party.
 *
 * The confirmed name is used when the Captain recorded one. Otherwise the
 * complainant's own description of the other party is used, because it is
 * their own submission. When neither exists the wording stays neutral —
 * "N/A" and "Unknown Person" are never shown to a resident.
 */
export function residentRespondent(complaint) {
  const named = trimToNull(complaint?.respondent_name) || trimToNull(complaint?.respondentName);
  if (named) return { label: named, state: "identified" };

  const own = trimToNull(complaint?.persons_involved) || trimToNull(complaint?.personsInvolved);
  if (own) return { label: own, state: "identified" };

  const status = complaint?.respondent_status || complaint?.respondentStatus || "";
  if (status === "not_applicable") {
    return { label: RESPONDENT_NOT_APPLICABLE, state: "not_applicable" };
  }
  return { label: RESPONDENT_NOT_IDENTIFIED, state: "unidentified" };
}

function trimToNull(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}

/* ── Resident-visible timeline ──────────────────────────────────────── */

const HEARING_DOCUMENT_LABELS = {
  hearing_notice: "Notice of Hearing",
  reklamo_form: "Reklamo Form",
  summons: null, // never surfaced to a complainant
};

const RESIDENT_VISIBLE_DOCUMENT_TYPES = new Set(["hearing_notice", "reklamo_form"]);

/**
 * One resident-visible event, newest first. `at` is an ISO instant used
 * only for ordering; `label` is the wording the resident reads.
 */
function event(at, label, kind, id) {
  return { at: at || "", label, kind, id: id || "" };
}

function hearingEventDate(hearing) {
  return formatResidentDate(hearing?.hearing_date) || "a later date";
}

function hearingEventsFor(hearing) {
  const status = residentHearingStatus(hearing?.status);
  const when = hearingEventDate(hearing);
  const clock = formatResidentTime(hearing?.hearing_time);
  const at = hearing?.updated_at || hearing?.created_at || "";
  const id = hearing?.id || "";

  if (status === "Cancelled") {
    return [event(at, `The hearing set for ${when} was cancelled.`, "hearing", id)];
  }
  if (status === "Rescheduled") {
    return [event(at, `The hearing was moved from ${when}.`, "hearing", id)];
  }
  if (status === "Completed") {
    return [event(at, `${hearing?.hearing_type || "The hearing"} completed.`, "hearing", id)];
  }
  const suffix = clock ? ` at ${clock}` : "";
  return [
    event(
      at,
      `Hearing scheduled for ${when}${suffix}.`,
      "hearing",
      id
    ),
  ];
}

function documentEventsFor(documentRow) {
  const label = HEARING_DOCUMENT_LABELS[documentRow?.document_type];
  if (!label) return [];
  return [
    event(
      documentRow?.created_at || documentRow?.generated_at,
      `${label} is available.`,
      "document",
      documentRow?.id
    ),
  ];
}

/**
 * The full resident-visible history of one complaint, newest first.
 *
 * Sources, in the order the system actually records them:
 *   1. `case_statuses.resident_visible_message` — the canonical written
 *      history the Captain workflow produces on every state change.
 *   2. `hearings` — scheduling is a resident-facing fact even when no
 *      status row was written for it.
 *   3. `official_documents` whose visibility is `resident_visible`.
 *
 * When none of those exist yet the complaint's own canonical state is
 * turned into one honest line, so a card never says "No recent update
 * available." while a complaint is plainly sitting in a known state.
 */
export function buildResidentTimeline(complaint, { caseStatuses = [], hearings = [], documents = [] } = {}) {
  const events = [];

  for (const row of caseStatuses) {
    const message = trimToNull(row?.resident_visible_message);
    if (!message) continue;
    events.push(event(row.created_at, message, "status", row.id));
  }

  for (const hearing of hearings) {
    events.push(...hearingEventsFor(hearing));
  }

  for (const documentRow of documents) {
    if (documentRow?.visibility && documentRow.visibility !== "resident_visible") continue;
    if (!RESIDENT_VISIBLE_DOCUMENT_TYPES.has(documentRow?.document_type)) continue;
    events.push(...documentEventsFor(documentRow));
  }

  if (events.length === 0) {
    const derived = derivedFallbackEvent(complaint);
    if (derived) events.push(derived);
  }

  return events.sort((a, b) => {
    if (a.at === b.at) return 0;
    if (!a.at) return 1;
    if (!b.at) return -1;
    return a.at < b.at ? 1 : -1;
  });
}

/**
 * The single line shown when no written history exists yet. Wording is
 * derived from canonical state, never invented, and never names an
 * internal enum back at the resident.
 */
function derivedFallbackEvent(complaint) {
  const status = residentComplaintStatus(complaint?.current_status || complaint?.status);

  if (status === "Rejected") {
    return event(complaint?.official_received_at, "The barangay was unable to take action on this complaint.", "derived");
  }
  if (status === "Resolved" || status === "Closed") {
    return event(complaint?.official_received_at, "Case resolved.", "derived");
  }
  if (complaint?.official_received_at || complaint?.officialReceivedAt) {
    return event(
      complaint.official_received_at || complaint.officialReceivedAt,
      "Complaint officially received by the barangay.",
      "derived"
    );
  }
  if (complaint?.submitted_at || complaint?.submittedAt) {
    return event(
      complaint.submitted_at || complaint.submittedAt,
      "Complaint submitted. Awaiting barangay review.",
      "derived"
    );
  }
  return null;
}

/** The newest resident-visible line for a complaint. */
export function latestResidentUpdate(complaint, context) {
  return buildResidentTimeline(complaint, context)[0] ?? null;
}

/* ── Resident progress ──────────────────────────────────────────────── */

/**
 * The six stages a resident can follow, mapped from canonical state.
 *
 * This is a VIEW over `complaint_status`, `completeness_status`,
 * `routing_status`, `official_received_at` and the hearing rows. It is not
 * a second workflow: nothing writes it and no two complaints can disagree
 * about it, because the same inputs always produce the same stages.
 */
export const RESIDENT_PROGRESS_STAGES = [
  { key: "filed", label: "Complaint Filed" },
  { key: "review", label: "Under Review" },
  { key: "received", label: "Officially Received" },
  { key: "processing", label: "Case Processing" },
  { key: "hearing", label: "Hearing / Mediation" },
  { key: "resolution", label: "Resolution" },
];

const CLOSED_STATUSES = new Set(["Resolved", "Closed", "Rejected"]);

/**
 * Returns one of {state, note} per stage:
 *   done       — the step happened
 *   current    — the step the case is sitting on now
 *   upcoming   — not reached yet
 *   not_applicable — the canonical state says this step will not happen
 */
export function buildResidentProgress(complaint, { hearings = [] } = {}) {
  const status = residentComplaintStatus(complaint?.current_status || complaint?.status);
  const received = Boolean(complaint?.official_received_at || complaint?.officialReceivedAt);
  const closed = CLOSED_STATUSES.has(status);
  const resolved = status === "Resolved" || status === "Closed";
  const rejected = status === "Rejected";

  const liveHearings = hearings.filter(
    (h) => residentHearingStatus(h?.status) !== "Cancelled"
  );
  const completedHearing = liveHearings.some(
    (h) => residentHearingStatus(h?.status) === "Completed"
  );
  const scheduledHearing = liveHearings.some(
    (h) => residentHearingStatus(h?.status) === "Upcoming" ||
      residentHearingStatus(h?.status) === "Rescheduled"
  );

  const stages = {};

  stages.filed = { state: "done", note: "Your complaint was recorded." };

  stages.review = received
    ? { state: "done", note: "The barangay reviewed your submission." }
    : status === "Pending Review"
      ? { state: "current", note: "The barangay is reviewing your complaint." }
      : { state: "done", note: "The barangay reviewed your submission." };

  stages.received = received
    ? { state: "done", note: "Officially received and given a barangay case number." }
    : rejected
      ? { state: "not_applicable", note: "The complaint was not accepted for official processing." }
      : { state: "upcoming", note: "Waiting for official receipt by the barangay." };

  stages.processing = closed
    ? { state: "done", note: "The case was processed to completion." }
    : received
      ? status === "Awaiting Meeting"
        ? { state: "done", note: "Case preparation is complete." }
        : { state: "current", note: "The barangay is preparing your case." }
      : { state: "upcoming", note: "Begins once the complaint is officially received." };

  stages.hearing = rejected
    ? { state: "not_applicable", note: "No hearing is required." }
    : completedHearing
      ? { state: "done", note: "Held at the barangay hall." }
      : scheduledHearing
        ? { state: "current", note: "A session has been scheduled for you." }
        : closed
          ? { state: "not_applicable", note: "Resolved without a hearing." }
          : { state: "upcoming", note: "You will be notified if a session is needed." };

  stages.resolution = resolved
    ? { state: "done", note: "The case has been resolved." }
    : rejected
      ? { state: "not_applicable", note: "Closed without resolution." }
      : closed
        ? { state: "done", note: "The case is closed." }
        : completedHearing
          ? { state: "current", note: "Awaiting the outcome of your hearing." }
          : { state: "upcoming", note: "The barangay will record the outcome here." };

  return RESIDENT_PROGRESS_STAGES.map((stage) => ({ ...stage, ...stages[stage.key] }));
}

/* ── Hearing helpers ────────────────────────────────────────────────── */

/**
 * The nearest session the resident still has to attend.
 *
 * Cancelled sessions and sessions the barangay already replaced are
 * excluded outright, and an "Upcoming" row whose date has passed is not
 * offered as upcoming. Comparison happens on the Manila schedule key, so
 * a session at 7:00 PM Manila is still upcoming at 6:00 PM Manila.
 */
export function selectNearestUpcomingHearing(hearings) {
  const candidates = (hearings || [])
    .filter((hearing) => {
      if (residentHearingStatus(hearing?.status) !== "Upcoming") return false;
      return isHearingInFuture(hearing);
    })
    .sort((a, b) => {
      const keyA = residentScheduleKey(a?.hearing_date, a?.hearing_time);
      const keyB = residentScheduleKey(b?.hearing_date, b?.hearing_time);
      if (keyA === keyB) return String(a?.id || "").localeCompare(String(b?.id || ""));
      return keyA < keyB ? -1 : 1;
    });

  return candidates[0] ?? null;
}

/** Hearings belonging to one complaint, soonest first. */
export function sortHearings(hearings) {
  return [...(hearings || [])].sort((a, b) => {
    const keyA = residentScheduleKey(a?.hearing_date, a?.hearing_time);
    const keyB = residentScheduleKey(b?.hearing_date, b?.hearing_time);
    if (keyA === keyB) return String(a?.id || "").localeCompare(String(b?.id || ""));
    return keyA < keyB ? -1 : 1;
  });
}

/**
 * The session that replaced a rescheduled one, following the canonical
 * `rescheduled_to_id` link rather than guessing from dates.
 */
export function resolveRescheduledSuccessor(hearing, hearings) {
  if (!hearing?.rescheduled_to_id) return null;
  return (hearings || []).find((h) => h.id === hearing.rescheduled_to_id) ?? null;
}

/** The session a current hearing replaced, for the Schedule History block. */
export function resolveRescheduledPredecessor(hearing, hearings) {
  if (!hearing?.rescheduled_from_id) return null;
  return (hearings || []).find((h) => h.id === hearing.rescheduled_from_id) ?? null;
}

/**
 * Canonical hearing counts. Superseded sessions are never counted as
 * upcoming, and a cancelled session never lands in any live bucket.
 */
export function summarizeHearings(hearings) {
  const rows = hearings || [];
  const upcoming = rows.filter((h) => isUpcomingHearing(h)).length;
  const completed = rows.filter((h) => residentHearingStatus(h?.status) === "Completed").length;
  const rescheduled = rows.filter((h) => isRescheduledHearing(h)).length;
  const cancelled = rows.filter((h) => residentHearingStatus(h?.status) === "Cancelled").length;
  return { total: rows.length, upcoming, completed, rescheduled, cancelled };
}

/** `1st Captain Mediation`, `2nd …` — the ordinal the resident reads. */
export function hearingSessionLabel(hearing, index) {
  const type = hearing?.hearing_type || hearing?.hearingType || "Hearing";
  const title = hearing?.title || "";
  if (title && /mediation|conciliation|hearing/i.test(title)) return title;
  const ordinals = ["1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th"];
  const ordinal = ordinals[index] ?? `${index + 1}th`;
  return `${ordinal} ${type}`;
}

/** Combined `date / time` string used for sorting keys in the UI. */
export function hearingScheduleText(hearing) {
  return formatResidentSchedule(hearing?.hearing_date, hearing?.hearing_time);
}
