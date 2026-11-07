import { officialSignatureFor } from "../documents/officialSignature.js";
import { caseDateParts, caseTimeParts, caseTodayParts, manilaToday } from "../documents/caseDate.js";

/**
 * Field map for the Notice of Hearing master.
 *
 * The master (Notice_of_Hearing_Template.docx) is US Letter with the barangay
 * letterhead in a bordered table, and each blank is a single text node. Only the
 * text of those nodes is replaced; the paragraph order, indents, tab stops,
 * right-aligned signature block and the "Received by / O.R No. / Doc. Stamp"
 * footer are left exactly as authored.
 *
 * The party block follows the same caption-then-rule shape as the Summons
 * master: "To: " introduces the respondent's name, the ruled line below it
 * carries the respondent's address, and "Complainant/s: " introduces the
 * complainant. A blank right-aligned line sits above the printed name so a wet
 * signature has somewhere to land, and another below the office title.
 *
 * Two things the form is normally expected to carry are NOT in the master and
 * are deliberately not invented: it has no case-number slot and no venue slot.
 * `MISSING_TEMPLATE_SLOTS` records that so the gap is visible to the barangay
 * instead of being papered over with invented text.
 */

export const NOTICE_MASTER_LABEL = "Notice-of-Hearing";

/** Facts the Notice template has no blank for. */
export const MISSING_TEMPLATE_SLOTS = [
  { field: "caseNumber", reason: "The master has no 'Barangay Case No.' line." },
  { field: "venue", reason: "The master states the date and time but has no venue line." },
];

/**
 * The master carries one printed name and one printed office title in the
 * signature block. Both are replaced with the authenticated official, so no
 * resident's document is ever signed by whoever happened to be typed into the
 * blank master.
 */
const SIGNOFF = ["RITCHEL P. SAYSON", "Barangay Secretary"];

/**
 * Blank rules, defined once so the master and this map cannot drift.
 *
 * The Notice follows the same caption-then-rule shape as the Summons master:
 * the printed words ("To: ", "Complainant/s: ") sit in their own text node and
 * the ruled slot is the node after it, so a party's name never has to share a
 * node with the caption that introduces it.
 */
export const RULE40 = "_".repeat(40);

/**
 * @param {object} input
 * @param {object} input.complaint   the canonical complaint row
 * @param {string} input.complainant complainant name from the resident profile
 * @param {string} input.respondent  respondent name, when one is identified
 * @param {string} input.respondentAddress
 * @param {object} input.hearing     the SAVED hearing row
 * @param {object} input.officialProfile the authenticated official's profile
 * @param {object} [input.now]       injectable clock, for tests
 */
export function buildNoticeOfHearingData({
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
    hearingId: hearing.id,
    hearingTitle: hearing.title || "First Hearing",
    venue: hearing.venue || null,
    complainant: complainant || null,
    respondent: respondent || null,
    respondentAddress: respondentAddress || null,

    day: hearingDate.day,
    month: hearingDate.month,
    year: hearingDate.year,
    time: hearingTime.time,
    meridiem: hearingTime.meridiem,

    issueDay: issued?.day ?? null,
    issueMonth: issued?.month ?? null,
    issueYear: issued?.year ?? null,
    // The same day in a sortable form, for the stored snapshot. Built from the
    // parts rather than from a Date so it can never shift across a time zone.
    issueDate: manilaToday(now || new Date()),

    // A wet signature is still taken at the hall, so an official with no
    // display name on their profile leaves the printed rule rather than
    // asserting a name that is not on the record.
    officialName: official.name,
    officialTitle: official.title,
  };
}

/**
 * The field map itself.
 *
 * `para` / `t` locate the text node, `expect` guards that the node is still the
 * blank the map was written against, and `value` is a template string resolved
 * against the data object above.
 */
export function noticeOfHearingFields() {
  return [
    // The notice is addressed to the respondent, so their name takes the ruled
    // line after the printed "To: " caption and their address the ruled line
    // below it. Both are optional: a complaint that names no respondent leaves
    // the printed rules rather than inventing a party.
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
      id: "complainant",
      para: 15,
      t: 2,
      expect: RULE40,
      value: "{{complainant}}",
    },
    {
      id: "hearing_datetime",
      para: 16,
      t: 1,
      // The master typesets a curly apostrophe in "o'clock"; it is written as an
      // escape so the guard cannot be silently broken by a lookalike character.
      expect:
        "You are hereby required to appear before on the ______________ day of __________________ 2026 at __________________ o\u2019clock in the ",
      // The date and time come from the saved hearing row, and the year is
      // written from that row rather than left as the master's hard-coded 2026.
      value:
        "You are hereby required to appear before on the {{day}} day of {{month}} {{year}} at {{time}} o\u2019clock in the ",
    },
    {
      id: "hearing_meridiem",
      para: 16,
      t: 2,
      expect: "morning/afternoon",
      value: "{{meridiem}}",
    },
    {
      id: "issued_date",
      para: 17,
      t: 1,
      expect: "This __________ day of __________________ 2026.",
      value: "This {{issueDay}} day of {{issueMonth}} {{issueYear}}.",
    },
    // Paragraph 18 is the blank right-aligned line the wet signature lands on,
    // so the printed name sits at 19 and the office title at 20.
    {
      id: "official_name",
      para: 19,
      t: 1,
      expect: SIGNOFF[0],
      optional: true,
      value: "{{officialName}}",
    },
    {
      id: "official_title",
      para: 20,
      t: 1,
      expect: SIGNOFF[1],
      optional: true,
      value: "{{officialTitle}}",
    },
  ];
}