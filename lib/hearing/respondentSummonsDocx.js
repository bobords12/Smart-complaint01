import { officialSignatureFor } from "../documents/officialSignature.js";
import { caseDateParts, caseTimeParts, caseTodayParts } from "../documents/caseDate.js";

/**
 * Field map for the Respondent Summons master.
 *
 * The master (Summons_Template.docx) is derived from the Notice of Hearing
 * master: it keeps the barangay letterhead table (all logos + watermark) and
 * the "Received by / O.R No. / Doc. Stamp" footer byte-for-byte, and replaces
 * only the title + body with Katarungang Pambarangay summons wording. Each blank
 * is a single text node; only that node's characters are rewritten, so the run
 * keeps its own formatting and the surrounding layout is untouched.
 *
 * Unlike the Notice, the summons DOES carry a venue line and a case-number line
 * (the "Re:" line), because a summons tells the respondent where and under what
 * case to appear.
 */

export const SUMMONS_MASTER_LABEL = "Respondent-Summons";

/** Blank rules, defined once so the master and this map cannot drift. */
export const RULE40 = "_".repeat(40); // respondent name / address / complainant
export const RULE24 = "_".repeat(24); // case number
const VENUE_RULE = "_".repeat(16); // venue, inside the body sentence
const DAY_RULE = "_".repeat(14); // hearing day
const MONTH_RULE = "_".repeat(22); // hearing month
const TIME_RULE = "_".repeat(22); // hearing time

const BODY_PREFIX =
  "You are hereby summoned to appear before the Punong Barangay of Barangay Abuno at the ";
const BODY_CLOCK = " o'clock in the ";

/** The full blank sentence the master carries in the body (t node 1). */
export const SUMMONS_BODY_BLANK =
  `${BODY_PREFIX}${VENUE_RULE} on the ${DAY_RULE} day of ${MONTH_RULE} 2026 at ${TIME_RULE}${BODY_CLOCK}`;

/**
 * The same sentence, with `{{tokens}}` where the saved hearing fills in.
 *
 * The blank above keeps a literal year because that is what the master prints
 * as its placeholder; the value replaces the whole node, so the year that ends
 * up on the summons is the hearing's own year and never the year the master was
 * authored in.
 */
const BODY_SENTENCE_VALUE =
  `${BODY_PREFIX}{{venue}} on the {{day}} day of {{month}} {{year}} at {{time}}${BODY_CLOCK}`;

export const ISSUE_BLANK = "This __________ day of __________________ 2026.";
const ISSUE_VALUE = "This {{issueDay}} day of {{issueMonth}} {{issueYear}}.";

/** The signatory printed in the blank master; replaced by the official. */
const SIGNOFF_NAME = "RITCHEL P. SAYSON";
const SIGNOFF_TITLE = "Barangay Secretary";

/**
 * Build the data the summons field map resolves against.
 *
 * @param {object} input
 * @param {object} input.complaint   the canonical complaint row
 * @param {string} input.complainant complainant name from the resident profile
 * @param {string} input.respondent  respondent name, when one is identified
 * @param {string} input.respondentAddress
 * @param {object} input.hearing     the SAVED hearing row
 * @param {object} input.officialProfile the authenticated official's profile
 * @param {object} [input.now]       injectable clock, for tests
 */
export function buildRespondentSummonsData({
  complaint,
  complainant,
  respondent,
  respondentAddress,
  hearing,
  officialProfile,
  now,
} = {}) {
  if (!complaint) {
    throw new Error("Complaint record could not be found.");
  }
  if (!hearing) {
    throw new Error("No hearing schedule has been saved for this case.");
  }

  const hearingDate = caseDateParts(hearing.hearing_date);
  const hearingTime = caseTimeParts(hearing.hearing_time);
  if (!hearingDate) {
    throw new Error("No hearing schedule has been saved for this case.");
  }
  if (!hearingTime) {
    throw new Error("The saved hearing has no time recorded.");
  }

  const issued = caseTodayParts(now || new Date());
  const official = officialSignatureFor(officialProfile);

  return {
    caseNumber: complaint.barangay_case_number || complaint.reference_number || null,
    complainant: complainant || null,
    respondent: respondent || null,
    respondentAddress: respondentAddress || null,
    venue: hearing.venue || null,

    day: hearingDate.day,
    month: hearingDate.month,
    year: hearingDate.year,
    time: hearingTime.time,
    meridiem: hearingTime.meridiem,

    issueDay: issued?.day ?? null,
    issueMonth: issued?.month ?? null,
    issueYear: issued?.year ?? null,

    officialName: official.name,
    officialTitle: official.title,
  };
}

/**
 * The field map itself.
 *
 * `para` / `t` locate the text node (1-based, counted against the whole master
 * including the letterhead table), `expect` guards the node is still the blank
 * the map was written against, and `value` is resolved against the data above.
 */
export function respondentSummonsFields() {
  return [
    {
      id: "respondent_name",
      para: 13,
      t: 2,
      expect: RULE40,
      optional: true,
      value: "{{respondent}}",
    },
    {
      id: "respondent_address",
      para: 14,
      t: 1,
      expect: RULE40,
      optional: true,
      value: "{{respondentAddress}}",
    },
    {
      id: "case_number",
      para: 15,
      t: 2,
      expect: RULE24,
      value: "{{caseNumber}}",
    },
    {
      id: "complainant",
      para: 16,
      t: 2,
      expect: RULE40,
      value: "{{complainant}}",
    },
    {
      id: "hearing_venue_datetime",
      para: 17,
      t: 1,
      expect: SUMMONS_BODY_BLANK,
      // Venue degrades to a blank if it was somehow not saved; the date and
      // time are guaranteed non-null by the guard in buildRespondentSummonsData.
      optional: true,
      value: BODY_SENTENCE_VALUE,
    },
    {
      id: "meridiem",
      para: 17,
      t: 2,
      expect: "morning/afternoon",
      value: "{{meridiem}}",
    },
    {
      id: "issued_date",
      para: 19,
      t: 1,
      expect: ISSUE_BLANK,
      value: ISSUE_VALUE,
    },
    {
      id: "official_name",
      para: 20,
      t: 1,
      expect: SIGNOFF_NAME,
      optional: true,
      value: "{{officialName}}",
    },
    {
      id: "official_title",
      para: 21,
      t: 1,
      expect: SIGNOFF_TITLE,
      optional: true,
      value: "{{officialTitle}}",
    },
  ];
}
