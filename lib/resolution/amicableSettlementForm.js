import PizZip from "pizzip";

import { officialSignatureFor } from "../documents/officialSignature.js";
import { caseDateParts } from "../documents/caseDate.js";
import {
  DOCX_MIME,
  TemplateRenderError,
  replaceRunText,
} from "../documents/docxTemplate.js";
import {
  persistCaseDocument,
  SETTLEMENT_MASTER_LABEL,
} from "./resolutionDocuments.js";
import {
  resolveComplainantName,
  resolveConfirmedCategory,
  resolveDocumentRespondentName,
} from "../../components/captain/complaints/complaintMeta.js";

/**
 * The Amicable Settlement as the barangay's own printed form.
 *
 * WHY A SECOND SETTLEMENT GENERATOR EXISTS
 *   resolutionDocuments.js already builds an Amicable Settlement, but it
 *   builds it programmatically from the `docx` object model — the long
 *   "KNOW ALL MEN BY THESE PRESENTS" instrument. The paper form the hall
 *   actually hands out (templates/reklamo/Amicable settlement.docx) is the
 *   shorter bilingual caption form: Complainant / Batok Kang Respondent,
 *   a single "As follows:" rule for the terms, and the "Entered into this
 *   ___ day of ___, 2026" clause. Neither generator replaces the other;
 *   both file under `document_type: "settlement"`, so a case keeps ONE
 *   version series and whichever instrument was printed is on the file.
 *
 * WHERE IT IS OFFERED
 *   The hearings panel (Hearings, Attendance & Meeting Records), once a
 *   meeting record says the meeting was conducted and the outcome is
 *   Settled. The Resolution & Outcomes tab keeps its own generator
 *   untouched.
 *
 * WHY NOT THE MEETING RECORD'S "Final" STATUS
 *   hearing_minutes carries a Draft -> Submitted for Review -> Attested ->
 *   Final lifecycle, but only the Lupon portal can walk it, and only the
 *   Pangkat Secretary can reach Final (lupon_minutes_action('finalize')).
 *   The Captain portal's own save — captain_save_meeting_record — inserts
 *   'Draft' and never transitions it, so gating on Final would leave this
 *   generator unreachable for every meeting a Captain records. The signal
 *   the Captain portal actually produces is Conducted + Outcome, so that
 *   is what gates it here.
 *
 * WHY THE FIELDS ARE ADDRESSED BY INDEX
 *   The master's blanks are underscore rules, not `{{tokens}}`, so they
 *   are addressed the way the Respondent Summons is: by paragraph and
 *   text-node index, each guarded by the exact text that node holds.
 *   Only that node's characters are rewritten, so the run keeps its own
 *   formatting and the letterhead, caption spacing, tabs and page setup
 *   stay exactly as the barangay authored them. If the master is ever
 *   replaced with a layout that has drifted, the render refuses and
 *   names the field rather than filing a mislabelled official form.
 *
 * WHAT IS DELIBERATELY LEFT BLANK
 *   The signature rules under "Complainant/s" and "Respondent/s", and the
 *   whole ATTESTATION block. Those are wet signatures on a printed form.
 *   Pre-printing a name on a line a party is meant to sign would put a
 *   signature on the paper that nobody gave.
 */

/** Storage/filename label. Reused so both generators share one version series. */
export { SETTLEMENT_MASTER_LABEL };

/** The exact blank rules, defined once so the master and this map cannot drift. */
const RULE26 = "_".repeat(26);
const RULE20 = "_".repeat(20);
const RULE33 = "_".repeat(33);
const RULE28 = "_".repeat(28);
const RULE468 = "_".repeat(468);

/** The26 spaces that hold "Barangay Case No." and "For:" on the right. */
const CAPTION_GAP = " ".repeat(26);

const COMPLAINANT_BLANK = `${RULE26}${CAPTION_GAP}`;
const CASE_NUMBER_BLANK = `Barangay Case No. ${RULE20}`;
const FOR_BLANK = `${RULE26}${CAPTION_GAP}For: ${RULE33}`;
const RESPONDENT_BLANK = RULE28;
const TERMS_BLANK = RULE468;
const ENTERED_BLANK = "Entered into this _____day of _______, 2026.";

/* ── Data assembly ─────────────────────────────────────────────── */

function ordinalSuffix(value) {
  const suffixes = ["th", "st", "nd", "rd"];
  const mod100 = value % 100;
  if (mod100 >= 11 && mod100 <= 13) return "th";
  return suffixes[value % 10] || "th";
}

/**
 * Build the data the field map resolves against.
 *
 * The terms come from the meeting record the officer saved (the Agreements
 * text), and the "Entered into this" date is the hearing the settlement was
 * reached at — both chosen so the paper restates what is already on the
 * case file rather than inventing a date.
 *
 * @param {object} input
 * @param {object} input.complaint    the canonical complaint row
 * @param {object} input.hearing      the SAVED hearing row the meeting was held at
 * @param {object} input.meeting      the saved meeting record
 * @param {object} input.officialProfile the signed-in official's profile
 */
export function buildAmicableSettlementFormData({
  complaint,
  hearing,
  meeting,
  officialProfile,
} = {}) {
  if (!complaint) {
    throw new Error("Complaint record could not be found.");
  }

  const entered = caseDateParts(hearing?.hearing_date);
  if (!entered) {
    throw new Error("The settlement hearing has no date recorded.");
  }

  const official = officialSignatureFor(officialProfile);

  return {
    caseNumber: complaint.barangay_case_number || complaint.reference_number || "",
    complainant: resolveComplainantName(complaint) || "",
    respondent: resolveDocumentRespondentName(complaint) || "",
    nature: resolveConfirmedCategory(complaint) || "",
    terms: String(meeting?.agreements || "").trim(),
    enteredDay: `${Number(entered.day)}${ordinalSuffix(Number(entered.day))}`,
    enteredMonth: entered.month,
    enteredYear: entered.year,
    officialName: official?.name || "",
    officialTitle: official?.title || "",
  };
}

/**
 * The field map itself.
 *
 * `para` / `t` locate the text node (1-based, counted against the whole master
 * including the letterhead), `expect` guards the node is still the blank the
 * map was written against, and `value` is the text that node should hold.
 *
 * The signature rules and the ATTESTATION block carry no field on purpose.
 */
export function amicableSettlementFormFields() {
  return [
    {
      id: "complainant",
      para: 11,
      t: 1,
      expect: COMPLAINANT_BLANK,
      optional: true,
      value: (data) => `${data.complainant}${CAPTION_GAP}`,
    },
    {
      id: "case_number",
      para: 11,
      t: 2,
      expect: CASE_NUMBER_BLANK,
      optional: true,
      value: (data) => (data.caseNumber ? `Barangay Case No. ${data.caseNumber}` : CASE_NUMBER_BLANK),
    },
    {
      id: "nature_of_case",
      para: 11,
      t: 3,
      expect: FOR_BLANK,
      optional: true,
      // The leading26-rule is the caption's own alignment, not a blank to
      // fill, so it is written back exactly as the master holds it.
      value: (data) => (data.nature ? `${RULE26}${CAPTION_GAP}For: ${data.nature}` : FOR_BLANK),
    },
    {
      id: "respondent",
      para: 14,
      t: 2,
      expect: RESPONDENT_BLANK,
      optional: true,
      // The three rules were one continuous writing line, so the name replaces
      // the line. The trailing space restores the gap the line itself used to
      // put between the name and the "Respondent/Sinumbong" caption.
      value: (data) => (data.respondent ? `${data.respondent} ` : ""),
    },
    {
      id: "respondent_padding",
      para: 14,
      t: 3,
      expect: RESPONDENT_BLANK,
      optional: true,
      // The name spans one node; the two rules beside it were only ever
      // spare width, so they are emptied rather than left as stray boxes.
      value: () => "",
    },
    {
      id: "respondent_padding_2",
      para: 14,
      t: 4,
      expect: RESPONDENT_BLANK,
      optional: true,
      value: () => "",
    },
    {
      id: "settlement_terms",
      para: 16,
      t: 4,
      expect: TERMS_BLANK,
      // Written through replaceRunText so each stored newline becomes a real
      // <w:br/>: a literal line feed inside one <w:t> is collapsed by Word,
      // which would lose the line breaks the officer actually typed.
      value: (data) => data.terms,
    },
    {
      id: "entered_into_this",
      para: 16,
      t: 6,
      expect: ENTERED_BLANK,
      value: (data) =>
        `Entered into this ${data.enteredDay} day of ${data.enteredMonth}, ${data.enteredYear}.`,
    },
  ];
}

/* ── Render ────────────────────────────────────────────────────── */

/**
 * Fill the master's blanks, leaving every other run untouched.
 *
 * Each field goes through replaceRunText(), which locates the node by the
 * same index + expect guard the other masters use and rewrites its text with
 * textRunXml(). For a single-line value that is byte-identical to the plain
 * field replacement; for the terms it is what turns a newline into a line
 * break Word will actually honour.
 *
 * @param {Uint8Array} masterBytes the untouched master, as read from the bucket
 * @param {Array} fields           the field map above
 * @param {object} data            resolved values, keyed by the data builder
 * @returns {Blob}
 */
export function renderAmicableSettlementForm(masterBytes, fields, data) {
  const zip = new PizZip(masterBytes);
  const part = "word/document.xml";
  const file = zip.file(part);
  if (!file) {
    throw new TemplateRenderError("Document template is not available.", {
      cause: "The master has no word/document.xml part, so it is not a Word document.",
    });
  }

  let xml = file.asText();

  // Back to front, and this is not cosmetic.
  //
  // A replacement can only ever add nodes at its own position: the settlement
  // terms carry newlines, and textRunXml() turns each one into a real <w:br/>
  // between two <w:t> nodes. Paragraph 16 therefore gains nodes the moment the
  // terms are written, and every text-node index after that point shifts.
  // Applying the fields in descending order means each index is still the one
  // the map was written against at the instant it is addressed — which is what
  // the expect guard on the next field is there to prove.
  const ordered = [...fields].sort((a, b) => b.para - a.para || b.t - a.t);

  for (const field of ordered) {
    const raw = typeof field.value === "function" ? field.value(data) : field.value;
    xml = replaceRunText(xml, field, raw == null ? "" : String(raw));
  }

  // Only the master's own wording is inspected: a "{{" an officer typed into
  // the terms prints as written, while a placeholder the renderer could not
  // recognise is refused rather than printed on an official form.
  if (xml.includes("{{")) {
    const leftover = xml.slice(xml.indexOf("{{"), xml.indexOf("{{") + 40);
    throw new TemplateRenderError("Document template is not available.", {
      cause: `An unresolved field placeholder remained after rendering: ${JSON.stringify(leftover)}.`,
    });
  }

  zip.file(part, xml);
  return new Blob([zip.generate({ type: "uint8array" })], { type: DOCX_MIME });
}

/* ── Public entry point ────────────────────────────────────────── */

/**
 * Generate and store the Amicable Settlement from the barangay's printed form.
 *
 * Gated on a meeting record that says the meeting was conducted and that the
 * outcome was Settled, with the agreed terms recorded.
 *
 * It is deliberately NOT gated on the record being 'Final'. Only the Lupon
 * portal can walk hearing_minutes to Final, and only the Pangkat Secretary
 * can reach it, so that gate would have left this unreachable for every
 * meeting a Captain records. Because a Draft can still be edited, the
 * officer-facing rule instead lives in generateAmicableSettlementIfStale(),
 * which reprints whenever the terms or the date change — so a printed copy
 * never silently disagrees with the record it came from.
 *
 * Nothing else is written. Recording the settlement on the Resolution &
 * Outcomes tab stays a separate, deliberate act — preparing a document here
 * never records a legal settlement behind the officer's back.
 *
 * @returns {Promise<{success: boolean, document?: object, error?: string,
 *                    detail?: string, templateUnavailable?: boolean}>}
 */
export async function generateAmicableSettlementFromForm(
  supabase,
  { complaint, user, hearing, meeting, documents = [] } = {},
) {
  if (!complaint?.id) {
    return { success: false, error: "This complaint could not be identified." };
  }
  if (!hearing) {
    return {
      success: false,
      error: "No hearing has been saved for this case.",
    };
  }
  if (!meeting) {
    return {
      success: false,
      error: "Record what happened at the meeting first.",
    };
  }
  if (meeting.outcome !== "Settled") {
    return {
      success: false,
      error: "This meeting was not recorded as Settled, so there is no settlement to print.",
    };
  }
  if (meeting.conducted !== "Yes") {
    return {
      success: false,
      error:
        "Record that the meeting was conducted before generating the settlement. " +
        "A settlement only exists if the parties actually met.",
    };
  }
  if (!String(meeting.agreements || "").trim()) {
    return {
      success: false,
      error: "Record the terms of the settlement in the meeting record first.",
    };
  }
  if (!hearing.hearing_date) {
    return {
      success: false,
      error: "This hearing has no date recorded, so the settlement cannot be dated.",
    };
  }

  try {
    const { fetchMasterTemplate, caseDocumentFileName } = await import(
      "../documents/docxTemplate.js"
    );

    const { bytes, file: masterFile } = await fetchMasterTemplate(
      supabase,
      "amicable_settlement",
    );

    const data = buildAmicableSettlementFormData({
      complaint,
      hearing,
      meeting,
      officialProfile: user,
    });

    const blob = renderAmicableSettlementForm(bytes, amicableSettlementFormFields(), data);

    return await persistCaseDocument(supabase, {
      complaint,
      user,
      documentType: "settlement",
      label: SETTLEMENT_MASTER_LABEL,
      title: "Amicable Settlement",
      blob,
      documents,
      contentSnapshot: {
        master_template: masterFile,
        case_number: data.caseNumber,
        complainant: data.complainant,
        respondent: data.respondent,
        nature_of_case: data.nature || null,
        hearing_id: hearing.id,
        hearing_date: hearing.hearing_date,
        entered_into_this: `${data.enteredDay} day of ${data.enteredMonth}, ${data.enteredYear}`,
        terms: data.terms,
        // The attestation block is signed on paper; the record still says who
        // produced the document and in what capacity.
        generated_by_name: data.officialName || null,
        generated_by_role: data.officialTitle || null,
      },
      activityAction: "amicable_settlement_generated",
      activityDetails: {
        source: "printed_form",
        hearing_id: hearing.id,
        meeting_status: meeting.status,
      },
      notify: {
        // `complaint` is one of only three types the notifications CHECK
        // constraint allows (complaint, hearing, general) — `document` is
        // not, and an insert with it is rejected and then swallowed by
        // persistCaseDocument's best-effort notify, so the complainant was
        // never told. The link is driven by related_complaint_id, which
        // resolveNotificationTarget() turns into the case's own page.
        type: "complaint",
        title: "Amicable Settlement available",
        message:
          "The Amicable Settlement for this case is ready to view and download. A copy is issued to both parties.",
      },
    });
  } catch (err) {
    const unavailable =
      err instanceof TemplateRenderError || err?.name === "TemplateRenderError";
    console.error("amicableSettlementForm: could not generate the settlement", {
      complaintId: complaint?.id,
      hearingId: hearing?.id,
      error: err,
    });
    return {
      success: false,
      templateUnavailable: unavailable,
      error: unavailable
        ? "Document generation unavailable. The required barangay template is not configured."
        : "The Amicable Settlement could not be generated.",
      detail: String(err?.message || err),
    };
  }
}

/* ── Keep the printed copy in step with the record ────────────── */

/**
 * The three things printed on the paper that the record can change.
 *
 * Everything else on the form (names, case number, nature of case) comes
 * from the complaint and does not move once the case exists, so comparing
 * these three is enough to know whether the copy on file still says what
 * the record says.
 */
function printedKeysFor(data) {
  return {
    terms: data.terms,
    entered_into_this: `${data.enteredDay} day of ${data.enteredMonth}, ${data.enteredYear}`,
  };
}

/**
 * Generate the settlement only when the copy on file has gone stale.
 *
 * WHY THIS EXISTS
 *   The Captain portal saves hearing_minutes as a Draft and never locks it,
 *   so the officer can still correct the agreed terms or move the hearing
 *   date after a settlement has been printed. Handing a party a document
 *   that no longer matches the record is the failure this prevents.
 *
 * THE RULE
 *   Eligible at all (conducted, Settled, terms and a hearing date) and
 *   either no settlement is on file, or the one on file prints different
 *   terms, a different date, or came from a different hearing. Identical
 *   content is skipped, so re-saving a record does not pile up versions or
 *   re-notify the complainant for nothing.
 *
 * The comparison reads the stored `content_snapshot` straight from the
 * database rather than trusting a list the caller may be holding from
 * before the save, which would make a stale list reprint an identical copy.
 *
 * @returns {Promise<{generated: boolean, skipped: boolean, reason?: string,
 *                    success?: boolean, error?: string, document?: object}>}
 */
export async function generateAmicableSettlementIfStale(
  supabase,
  { complaint, user, hearing, meeting } = {},
) {
  if (!complaint?.id || !hearing || !meeting) {
    return { generated: false, skipped: true, reason: "not_eligible" };
  }
  if (meeting.conducted !== "Yes" || meeting.outcome !== "Settled") {
    return { generated: false, skipped: true, reason: "not_eligible" };
  }
  if (!String(meeting.agreements || "").trim() || !hearing.hearing_date) {
    return { generated: false, skipped: true, reason: "incomplete" };
  }

  let current;
  try {
    current = buildAmicableSettlementFormData({
      complaint,
      hearing,
      meeting,
      officialProfile: user,
    });
  } catch (err) {
    // Nothing printed can be compared, so nothing is written.
    return { generated: false, skipped: true, reason: "unbuildable", error: String(err?.message || err) };
  }

  const wanted = printedKeysFor(current);
  const enteredIntoThis = wanted.entered_into_this;

  const { data: rows, error } = await supabase
    .from("official_documents")
    // document_type has to be selected, not just filtered on: the version
    // numbering below re-filters this list by it, and a list without the
    // column looks empty and re-issues v1 — which the non-upserting upload
    // then rejects, losing the reprint entirely.
    .select("id, document_type, version, content_snapshot")
    .eq("complaint_id", complaint.id)
    .eq("document_type", "settlement")
    .neq("status", "superseded")
    .order("version", { ascending: false });

  if (error) {
    // A failed lookup must never be read as "nothing on file" — that is
    // exactly how an identical settlement gets filed twice.
    return {
      generated: false,
      skipped: true,
      reason: "lookup_failed",
      error: error.message,
    };
  }

  const onFile = rows || [];
  const latest = onFile[0] || null;
  const printed = latest?.content_snapshot || null;

  if (
    printed &&
    printed.terms === wanted.terms &&
    printed.entered_into_this === enteredIntoThis &&
    printed.hearing_id === hearing.id
  ) {
    return { generated: false, skipped: true, reason: "unchanged", document: latest };
  }

  const result = await generateAmicableSettlementFromForm(supabase, {
    complaint,
    user,
    hearing,
    meeting,
    // Deliberately the list just read back, not the one the caller holds.
    // persistCaseDocument derives the next version from it, and the caller's
    // copy predates the save that triggered this call — passing it through
    // would re-issue version 1 and fail the non-upserting upload.
    documents: onFile,
  });

  return { ...result, generated: Boolean(result.success), skipped: !result.success };
}
