/**
 * SUPERSEDED - do not use for a new Notice of Hearing.
 *
 * This renderer rebuilt the Notice from coordinates measured off a PNG preview
 * of the form. That is a picture of the form, not the form: it cannot carry the
 * barangay's own letterhead, fonts, rules and signature block, and it silently
 * invents rows the official master does not have.
 *
 * The authoritative renderer is lib/hearing/noticeOfHearingDocx.js, which reads
 * the untouched master out of the private `templates` bucket and fills only its
 * blank fields. Nothing imports this module; it is left in place because the
 * submission-receipt path (lib/reklamo/issueSubmissionReceipt.js) shares its
 * printed-form helpers, and removing it is a separate decision.
 *
 * Verified 2026-10-04: no application code imports this file.
 */

import { jsPDF } from "jspdf";
import { SITE } from "../constants.js";
import {
  createPrintedForm,
  displayValue,
  formDateParts,
  formTimeParts,
  LEFT,
  RIGHT,
  SLOT_MIN_WIDTH,
} from "../documents/printedForm.js";
import { officialSignatureFor } from "../documents/officialSignature.js";

/**
 * Notice of Hearing, laid out to match supabase/manual/noticeofhearing.png.
 *
 * Vertical positions are the printed rows read off that sheet, in millimetres
 * on A4:
 *
 *   53  NOTICE OF HEARING
 *   80  Barangay Case No.
 *   88  Complainant/s
 *  104  "You are hereby required to appear before … on the day of …"
 *  109  "at … o'clock in the morning/afternoon for the hearing of …"
 *  118  "This __ day of __."
 *  130  signature / Barangay Secretary
 *  159  Received by Complainants/s
 *  170  Date:
 *  190  O.R. No.:
 *  205  Doc. Stamp:
 *
 * The venue, date and time come from the hearing record; the case number from
 * the complaint's canonical barangay_case_number; the signature from the
 * authenticated official's profile. O.R. No. and Doc. Stamp are left as blank
 * printed slots because they are stamped by hand at the counter — the system
 * holds no value for either and does not invent one.
 */

const ROW = {
  title: 53,
  caseNumber: 80,
  complainant: 88,
  body: 104,
  issued: 118,
  signature: 130,
  received: 159,
  receivedDate: 170,
  orNumber: 190,
  docStamp: 205,
};

const SIGNATURE_X = 112;
const SIGNATURE_WIDTH = 80;
const RECEIVED_DATE_X = 138;

export function buildNoticeOfHearingPdf({
  complaint = {},
  complainant,
  respondent,
  hearing = null,
  officialProfile = null,
  now,
} = {}) {
  const signature = officialSignatureFor(officialProfile);
  const caseNumber = displayValue(complaint.barangay_case_number, null);
  const hearingDate = formDateParts(hearing?.hearing_date);
  const clock = formTimeParts(hearing?.hearing_time);
  const venue = displayValue(hearing?.venue, SITE.hall);

  const form = createPrintedForm({
    jsPDF,
    title: `${caseNumber || complaint.reference_number || "Case"} — Notice of Hearing`,
    subject: `Barangay Abuno Notice of Hearing${hearing?.title ? ` — ${hearing.title}` : ""}`,
  });
  const { doc } = form;

  form.letterhead();
  form.formTitle("NOTICE OF HEARING", ROW.title, { size: 13 });

  form.fieldRow({
    label: "Barangay Case No.:",
    value: caseNumber,
    y: ROW.caseNumber,
    ruleTo: 132,
  });
  form.fieldRow({
    label: "Complainant/s:",
    value: displayValue(complainant, null),
    y: ROW.complainant,
    ruleTo: RIGHT,
  });

  /* Body copy, set as printed text with the hearing details in ruled slots. */
  form.runParagraph(
    [
      { text: "You are hereby required to appear before" },
      { text: venue, rule: true, minWidth: 54 },
      { text: "on the day of" },
      {
        text: hearingDate ? `${hearingDate.month} ${hearingDate.day}, ${hearingDate.year}` : null,
        rule: true,
        minWidth: 54,
      },
    ],
    { y: ROW.body }
  );

  form.runParagraph(
    [
      { text: "at" },
      { text: clock?.time, rule: true, minWidth: 22 },
      { text: "o'clock in the" },
      { text: clock?.meridiem, rule: true, minWidth: 26 },
      { text: "for the hearing of your complaint." },
    ],
    { gap: 5 }
  );

  /* Body copy, set as printed text with the hearing details in ruled slots.
   * Measured from the end of the last line, not from a fixed coordinate, so a
   * wrapped venue or a long hall name cannot print over the issue date. */
  form.runParagraph(
    [
      { text: "This" },
      { text: hearingDate?.day, rule: true, minWidth: 12 },
      { text: "day of" },
      { text: hearingDate ? `${hearingDate.month}, ${hearingDate.year}` : null, rule: true, minWidth: 40 },
      { text: "." },
    ],
    { y: Math.max(form.state.y, ROW.issued) }
  );

  form.signatureBlock({
    x: SIGNATURE_X,
    y: Math.max(form.state.y, ROW.signature),
    width: SIGNATURE_WIDTH,
    name: signature.name,
    title: signature.title,
  });

  /* Receipt block. Left blank on generation: receiving this notice is a
   * separate act recorded against the service records, not a side effect of
   * producing the document. */
  form.fieldRow({
    label: "Received by Complainants/s:",
    value: null,
    y: ROW.received,
    ruleTo: RIGHT,
  });
  form.fieldRow({
    label: "Date:",
    value: null,
    x: RECEIVED_DATE_X,
    y: ROW.receivedDate,
    ruleTo: RIGHT,
  });
  form.fieldRow({
    label: "O.R. No.:",
    value: null,
    y: ROW.orNumber,
    ruleTo: 118,
  });
  form.fieldRow({
    label: "Doc. Stamp:",
    value: null,
    y: ROW.docStamp,
    ruleTo: LEFT + SLOT_MIN_WIDTH,
  });

  return {
    doc,
    filename: noticeFileName({ caseNumber, hearing }),
    respondent: displayValue(respondent, null),
    hearingId: hearing?.id || null,
  };
}

export function noticeFileName({ caseNumber, hearing } = {}) {
  const base = fileSafePart(`Notice of Hearing${hearing?.title ? ` — ${hearing.title}` : ""}`);
  const ref = fileSafePart(caseNumber || "case");
  return `${base}-${ref}.pdf`;
}

function fileSafePart(value) {
  return String(value || "")
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function noticeOfHearingBlob(input = {}) {
  const { doc, filename } = buildNoticeOfHearingPdf(input);
  return { blob: doc.output("blob"), filename };
}
