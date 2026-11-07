/**
 * Resident deep-link routes and notification destination resolution.
 *
 * There is exactly one route builder for the Resident Portal. Notifications,
 * dashboard cards and the hearings workspace all go through it, so a link
 * can never point at a URL that was typed in by hand in a second place.
 *
 * No path here is hardcoded from a notification's text. A notification
 * carries `related_complaint_id` / `related_hearing_id`; the route is built
 * from those columns and from the record's type, and nothing else.
 */

import { RESIDENT_ROUTES } from "@/lib/constants";

/** Sections a deep link may ask a page to focus once it has the record. */
export const RESIDENT_SECTION = {
  overview: "overview",
  progress: "progress",
  resolution: "resolution",
  documents: "documents",
  notice: "notice",
  schedule: "schedule",
  result: "result",
};

/** `/resident/complaints/<id>` — the existing complaint detail route. */
export function residentComplaintRoute(complaintId, section) {
  if (!complaintId) return RESIDENT_ROUTES.complaints;
  const base = `${RESIDENT_ROUTES.complaints}/${complaintId}`;
  return section ? `${base}?section=${encodeURIComponent(section)}` : base;
}

/**
 * `/resident/hearings?hearing=<id>[&section=<section>]`.
 *
 * The hearings page is the resident's hearing workspace, so the session is
 * carried as a query rather than as a second route. That keeps the list as
 * the first view and lets a notification land straight on one session.
 */
export function residentHearingRoute(hearingId, section) {
  const params = new URLSearchParams();
  if (hearingId) params.set("hearing", hearingId);
  if (section) params.set("section", section);
  const query = params.toString();
  return query ? `${RESIDENT_ROUTES.hearings}?${query}` : RESIDENT_ROUTES.hearings;
}

/* ── Notification text classification ───────────────────────────────── */

/**
 * Wording signals only. These never decide what a resident may see — they
 * only choose which section of an already-authorized record to scroll to.
 */
const NOTICE_PATTERN = /notice of hearing|notice\b/i;
const RESOLUTION_PATTERN = /resolv|closed|disposed|outcome of the (?:case|complaint)/i;
const RECEIPT_PATTERN = /officially received|case no|case number|barangay case/i;
const INFORMATION_PATTERN = /additional information|provide information|information (?:is )?needed/i;

function notificationText(item) {
  return `${item?.title || ""} ${item?.message || ""}`;
}

function mentionsNotice(item) {
  return NOTICE_PATTERN.test(notificationText(item));
}

function mentionsResolution(item) {
  return RESOLUTION_PATTERN.test(notificationText(item));
}

function mentionsInformationRequest(item) {
  return INFORMATION_PATTERN.test(notificationText(item));
}

/* ── Destination resolution ─────────────────────────────────────────── */

/**
 * Turn one notification into the exact record it points at.
 *
 * Returns `{ kind, href, section }` or `null` when the notification carries
 * no related record. A `null` is not an error: a general barangay notice
 * genuinely has nothing to open, and the caller shows it as a plain notice
 * instead of navigating somewhere that would not match the text.
 *
 * A Notice of Hearing notification lands on the hearing's notice section.
 * A complaint notification lands on the complaint detail, scrolled to the
 * resolution or information-request block when that is what the message is
 * about. Nothing lands on a bare list page.
 */
export function resolveNotificationTarget(item) {
  if (!item) return null;

  const hearingId = item.related_hearing_id || null;
  const complaintId = item.related_complaint_id || null;

  if (hearingId) {
    // The complainant's copy of a hearing document is the Notice of
    // Hearing. A Respondent Summons is never the complainant's document,
    // so a summons message must not open the notice section.
    const section = mentionsNotice(item) ? RESIDENT_SECTION.notice : null;
    return { kind: "hearing", href: residentHearingRoute(hearingId, section), section };
  }

  if (complaintId) {
    let section = null;
    if (mentionsResolution(item)) section = RESIDENT_SECTION.resolution;
    else if (mentionsInformationRequest(item)) section = RESIDENT_SECTION.progress;
    return { kind: "complaint", href: residentComplaintRoute(complaintId, section), section };
  }

  return null;
}

/** Short, resident-safe wording for the record a notification opens. */
export function describeNotificationTarget(item) {
  if (item?.related_hearing_id) return "Hearing details";
  if (item?.related_complaint_id) return "Complaint details";
  return null;
}

/**
 * Resident-facing icon key for a notification type. `hearing` rows exist in
 * the schema and are written by the workflow, so the type is read straight
 * from the row rather than inferred from the message.
 */
export function notificationIconKey(item) {
  if (item?.type === "hearing") return "hearing";
  if (item?.type === "general") return "general";
  return "complaint";
}

export { mentionsNotice, mentionsResolution };
