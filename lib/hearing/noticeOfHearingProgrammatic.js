/**
 * Programmatic generator for the Notice of Hearing (DOCX).
 *
 * WHY THIS FILE EXISTS
 *   The barangay's Notice of Hearing used to be filled from a Word master in
 *   the private `templates` bucket. When that master is missing, moved, or
 *   simply an older revision of the printed form, generation fails — or worse,
 *   silently produces a document that no longer matches what the office
 *   actually hands out. This module builds the Notice from the saved hearing
 *   data with the `docx` object model, so the document can always be produced
 *   and always matches the official form it was measured against.
 *
 * SOURCE OF TRUTH
 *   The layout below is a line-for-line transcription of the barangay's
 *   official Notice_of_Hearing_Template.docx: the same US Letter page, the same
 *   margins, the same body face (Book Antiqua 12pt), the same three-column
 *   letterhead carrying the same four seals at the same anchors, and the same
 *   order and vertical rhythm of every block:
 *
 *     1. Barangay letterhead            9.  "Received by Complainant/s"
 *     2. NOTICE OF HEARING title        10. complainant signature rule
 *     3. complainant name               11. receipt date rule
 *     4. complainant address            12. O.R No.:
 *     5. "Complainant/s"                13. Doc. Stamp: P30
 *     6. hearing requirement sentence
 *     7. notice preparation date        (in between, on the right, the
 *     8. Barangay Secretary block        Barangay Secretary's name)
 *
 * WHAT IS DELIBERATELY NOT PRINTED
 *   The official form asks for none of: the reference number, the Barangay Case
 *   Number, the respondent, the venue, the case category, the urgency, the
 *   status or a document version. None of them appear here. Putting them on the
 *   paper would put facts on a resident's copy that the barangay's own printed
 *   form never asked for. `NOTICE_FORM_HAS_NO_SLOT` records each of them so the
 *   omission is a decision on the record rather than an oversight.
 *
 *   The one decorative element not reproduced is the form's translucent
 *   background watermark (a 4.1 MB image). It carries no text and reproducing
 *   it would multiply the size of every generated document.
 */

import {
  Document,
  Footer,
  Paragraph,
  Packer,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  Tab,
  TextRun,
  WidthType,
} from "docx";

import {
  caseDateParts,
  caseTimeParts,
  caseTodayParts,
} from "../documents/caseDate.js";
import {
  letterheadTable,
  NO_BORDERS,
  run,
} from "../documents/letterhead.js";
import { notifyResident } from "../complaintQueries.js";

/** The static officer the official form prints in the lower-right block. */
export const NOTICE_SIGNOFF_NAME = "RITCHEL P. SAYSON";
export const NOTICE_SIGNOFF_TITLE = "Barangay Secretary";
const DOC_STAMP = "P30";
const NOTICE_MASTER_LABEL = "Notice-of-Hearing";

/** Body face and size the printed form's document defaults declare. */
const BODY_FONT = "Book Antiqua";
const BODY_SIZE = 24; // half-points -> 12pt

/** US Letter portrait, the paper the barangay actually prints on. */
const PAGE = { width: 12240, height: 15840 };
const MARGIN = { top: 504, right: 1440, bottom: 1080, left: 1440, header: 708, footer: 708 };
const CONTENT_WIDTH = PAGE.width - MARGIN.left - MARGIN.right; // 9360

/**
 * The blank rules the printed form carries, counted off the official template
 * so a generated rule is the same length as the one on the barangay's paper.
 */
export const RULE40 = "_".repeat(40); // the two party lines
export const SIGNATURE_RULE = "_".repeat(26); // the complainant's signature line
export const DATE_RULE = "_".repeat(14); // after "Date: "

/**
 * Facts the official Notice form has no blank for. Kept as data so a reader of
 * the case file can see the omission was deliberate.
 */
export const NOTICE_FORM_HAS_NO_SLOT = [
  { field: "caseNumber", reason: "The form has no 'Barangay Case No.' line." },
  { field: "referenceNumber", reason: "The form has no reference-number line." },
  { field: "respondent", reason: "The form is addressed to the complainant only; the respondent is served by the Summons." },
  { field: "venue", reason: "The form states the date and time but has no venue line." },
  { field: "category", reason: "The form carries no case-category field." },
  { field: "urgency", reason: "The form carries no urgency field." },
  { field: "status", reason: "The form carries no status field." },
];

/** 1st, 2nd, 3rd, 4th, 11th, 12th, 13th, 21st, 22nd, 23rd, 31st. */
export function ordinalSuffix(value) {
  const suffixes = ["th", "st", "nd", "rd"];
  const mod100 = value % 100;
  if (mod100 >= 11 && mod100 <= 13) return "th";
  const mod10 = value % 10;
  return suffixes[mod10] || "th";
}

/** "15th" — the day of the month with its English ordinal. */
function ordinalDay(day) {
  const numeric = Number(day);
  return Number.isFinite(numeric) ? `${numeric}${ordinalSuffix(numeric)}` : "";
}

/** The typographic apostrophe the official form typesets in "o'clock". */
const APOSTROPHE = "\u2019";

/**
 * The hearing requirement sentence, split exactly where the printed form
 * emphasises the day period in bold:
 *
 *   "You are hereby required to appear before on the ______________ day of
 *    __________________ 2026 at __________________ o'clock in the **morning/**
 *    **afternoon** for the hearing of your complaint."
 *
 * @param {object} data the model returned by buildNoticeOfHearingProgrammaticData
 * @returns {{ before: string, emphasis: string, after: string }}
 */
export function hearingSentenceParts({
  hearingDayOrdinal,
  hearingMonth,
  hearingYear,
  hearingTime,
  dayPeriod,
} = {}) {
  return {
    before:
      `You are hereby required to appear before on the ${hearingDayOrdinal} day of ` +
      `${hearingMonth} ${hearingYear} at ${hearingTime} o${APOSTROPHE}clock in the `,
    emphasis: dayPeriod,
    after: " for the hearing of your complaint.",
  };
}

/**
 * @param {object} input
 * @param {object} input.complaint   the canonical complaint row
 * @param {string} input.complainant complainant name, from the canonical resolver
 * @param {string} input.complainantAddressLine1 house/street, canonical resolver
 * @param {string} input.complainantAddressLine2 purok, barangay, city
 * @param {object} input.hearing     the SAVED hearing row
 * @param {object} [input.now]       injectable clock, for tests
 */
export function buildNoticeOfHearingProgrammaticData({
  complaint,
  complainant,
  complainantAddressLine1,
  complainantAddressLine2,
  hearing,
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

  if (!hearingDate || !hearingTime) {
    throw new Error("Hearing date and time are required to generate a notice.");
  }

  // The notice is dated when it is prepared, which is today in Manila - never
  // the hearing date, the filing date or the official-receipt date.
  const issued = caseTodayParts(now || new Date());

  // The printed form offers "morning/afternoon". A hearing actually scheduled
  // in the evening is printed as the evening it is, because a notice that says
  // "afternoon" for a 7 PM hearing is simply wrong.
  const dayPeriod = hearingTime.meridiem;

  const address = [complainantAddressLine1, complainantAddressLine2]
    .map((part) => (part === null || part === undefined ? "" : String(part).trim()))
    .filter(Boolean)
    .join(", ");

  return {
    complainant: complainant || "",
    complainantAddress: address,
    respondent: hearing && complaint ? complaint.respondent_name || "" : "",
    respondentAddress: complaint?.respondent_address || "",

    hearingDay: hearingDate.day,
    hearingDayOrdinal: ordinalDay(hearingDate.day),
    hearingMonth: hearingDate.month,
    hearingYear: hearingDate.year,
    hearingTime: hearingTime.time,
    dayPeriod,

    issueDay: issued?.day ?? "",
    issueDayOrdinal: issued ? ordinalDay(issued.day) : "",
    issueMonth: issued?.month ?? "",
    issueYear: issued?.year ?? "",

    // Fixed by the printed form, not by whoever is signed in: this Notice is
    // always the Barangay Secretary's, never the Punong Barangay's and never
    // the name of the Captain who happened to press the button.
    officialName: NOTICE_SIGNOFF_NAME,
    officialTitle: NOTICE_SIGNOFF_TITLE,
    docStamp: DOC_STAMP,
  };
}

/** A paragraph in the body face, with the printed form's spacing semantics. */
function line(text, { before = 0, after = 0, align = "left", indent = 0, rightIndent = 0, keepNext = false } = {}) {
  const options = {
    children: [run(text)],
    spacing: { before, after },
  };
  if (align !== "left") options.alignment = align;
  if (indent) options.indent = { left: indent };
  if (rightIndent) options.indent = { ...(options.indent || {}), right: rightIndent };
  if (keepNext) options.keepNext = true;
  return new Paragraph(options);
}

/**
 * The complainant block: two data lines followed by the caption.
 *
 * The official form draws two ruled lines and prints "Complainant/s" under
 * them. A complaint that actually names a complainant fills those two lines
 * with the name and the address; a complaint that does not leaves the printed
 * rules in place rather than inventing a party. Either way the block stays
 * left-aligned, exactly as the form sets it.
 */
function complainantBlock(data) {
  const name = data.complainant && data.complainant.trim() ? data.complainant.trim() : RULE40;
  const address = data.complainantAddress && data.complainantAddress.trim()
    ? data.complainantAddress.trim()
    : RULE40;

  return [
    line(name, { before: 0, after: 0 }),
    line(address, { before: 120, after: 0 }),
    new Paragraph({
      children: [run("Complainant/s", { size: 26 })],
      spacing: { before: 0, after: 480 },
      indent: { left: 720 },
    }),
  ];
}

/**
 * The hearing requirement sentence, laid out as the printed form sets it:
 * one paragraph at 1.5 line spacing, with the day period in bold.
 */
function hearingSentence(data) {
  const parts = hearingSentenceParts(data);
  return new Paragraph({
    children: [
      new TextRun({ text: parts.before }),
      new TextRun({ text: parts.emphasis, bold: true }),
      new TextRun({ text: parts.after }),
    ],
    spacing: { before: 0, after: 240, line: 360, lineRule: "auto" },
  });
}

/**
 * The lower-right authority block.
 *
 * Right-aligned with the form's own 400-twip right indent rather than a run of
 * spaces, so it lands on the same column whatever the body face measures. The
 * name is bold and underlined - the underline is the ruled line the wet
 * signature lands on - and `keepNext` keeps the office title from ever being
 * split onto the next page.
 */
function secretaryBlock(data) {
  return [
    new Paragraph({
      children: [run(data.officialName || NOTICE_SIGNOFF_NAME, { bold: true, underline: true })],
      alignment: "right",
      indent: { right: 400 },
      keepNext: true,
    }),
    new Paragraph({
      children: [run(data.officialTitle || NOTICE_SIGNOFF_TITLE, { italic: true })],
      alignment: "right",
      indent: { right: 400 },
      spacing: { before: 0, after: 960 },
    }),
  ];
}

/**
 * "Received by Complainant/s", the signature rule and the receipt date.
 *
 * The printed form puts the signature rule and "Date:" on one line using a tab
 * stop at 6200 twips. A tab is fragile the moment a line wraps, so the same row
 * is built as a borderless two-column table with the break at that exact
 * position: the rule stays under the caption, "Date:" stays on the same
 * horizontal level at the right, and neither can drift.
 */
function receiptBlock() {
  const DATE_COLUMN = 6200;
  return [
    line("Received by Complainant/s", { before: 0, after: 360 }),
    new Table({
      width: { size: CONTENT_WIDTH, type: WidthType.DXA },
      layout: TableLayoutType.FIXED,
      columnWidths: [DATE_COLUMN, CONTENT_WIDTH - DATE_COLUMN],
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
      borders: NO_BORDERS,
      rows: [
        new TableRow({
          children: [
            new TableCell({
              width: { size: DATE_COLUMN, type: WidthType.DXA },
              children: [line(SIGNATURE_RULE, { before: 0, after: 720 })],
            }),
            new TableCell({
              width: { size: CONTENT_WIDTH - DATE_COLUMN, type: WidthType.DXA },
              children: [line(`Date: ${DATE_RULE}`, { before: 0, after: 720 })],
            }),
          ],
        }),
      ],
    }),
  ];
}

export async function renderNoticeOfHearingProgrammatic(data = {}) {
  const children = [];

  // The art is ~280 KB of embedded PNG and is only needed once a document is
  // actually being generated, so it is pulled in on demand and never joins the
  // initial page bundle.
  const { loadLetterheadArt } = await import("../reklamo/letterheadArt.js");
  const art = await loadLetterheadArt();
  children.push(letterheadTable(art));

  // The printed form leaves four blank paragraphs between the letterhead and
  // the title: three empty ones, then its own tabbed spacer, then the line the
  // background watermark floats in. The watermark artwork is not reproduced,
  // but the line it occupies is, so "NOTICE OF HEARING" keeps the exact height
  // it has on the barangay's paper instead of creeping up under the office
  // line. Title placement is part of the form; the decoration is not.
  children.push(new Paragraph({ spacing: { before: 0, after: 0 } }));
  children.push(new Paragraph({ spacing: { before: 0, after: 0 } }));
  children.push(new Paragraph({ spacing: { before: 0, after: 0 } }));
  children.push(
    new Paragraph({
      // The tab must live inside a run: a `<w:tab/>` placed directly under
      // `<w:p>` is not valid WordprocessingML and Word will drop it.
      children: [new TextRun({ children: [new Tab()] })],
      spacing: { before: 0, after: 480 },
    }),
  );
  // The printed form's last pre-title line is the one its background watermark
  // floats in. The artwork is not reproduced, but the line is kept so the title
  // sits at the height it has on the barangay's paper. Its run is present and
  // empty so the line reserves a full measure of leading rather than collapsing
  // to half a line, which is what a bare `<w:p/>` renders as.
  children.push(
    new Paragraph({
      children: [run("")],
      spacing: { before: 0, after: 0 },
    }),
  );

  children.push(
    new Paragraph({
      children: [run("NOTICE OF HEARING", { bold: true, size: 28 })],
      alignment: "center",
      spacing: { before: 0, after: 480 },
    }),
  );

  children.push(...complainantBlock(data));

  children.push(hearingSentence(data));

  children.push(
    line(
      `This ${data.issueDayOrdinal} day of ${data.issueMonth} ${data.issueYear}.`,
      { before: 120, after: 720 },
    ),
  );

  children.push(...secretaryBlock(data));
  children.push(...receiptBlock());

  children.push(line(`O.R No.: `, { before: 0, after: 0 }));
  children.push(line(`Doc. Stamp: ${data.docStamp || DOC_STAMP}`, { before: 0, after: 0 }));

  const doc = new Document({
    // The printed form's document defaults: Book Antiqua at 12pt. Stated once
    // here rather than on every run so every section of the document is set in
    // one face and no run can fall back to whatever the reader's Word defaults
    // happen to be.
    styles: {
      default: {
        document: {
          run: { font: BODY_FONT, size: BODY_SIZE },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: PAGE.width, height: PAGE.height },
            margin: MARGIN,
          },
        },
        children,
        footers: {
          default: new Footer({
            children: [new Paragraph({ children: [run("")] })],
          }),
        },
      },
    ],
  });

  return Packer.toBlob(doc);
}

/**
 * Generate and store the Notice of Hearing for one saved hearing.
 *
 * Mirrors the storage/versioning contract the case file already relies on: the
 * version comes from nextDocumentVersion(), the upload never overwrites
 * (`upsert: false`), a failed database insert rolls the uploaded file back, and
 * a lifecycle event plus a best-effort activity entry are recorded. Rescheduling
 * therefore cannot silently overwrite a notice a party already holds - a new
 * schedule produces a new version, and the earlier one stays in the case file.
 *
 * @returns {Promise<{success: boolean, document?: object, error?: string,
 *                    detail?: string}>}
 */
export async function generateNoticeOfHearingProgrammatic(
  supabase,
  { complaint, user, hearing, documents = [] } = {},
) {
  if (!complaint?.id) {
    return { success: false, error: "This complaint could not be identified." };
  }
  if (!hearing) {
    return {
      success: false,
      error: "No hearing schedule has been saved for this case.",
    };
  }

  try {
    const {
      resolveDocumentComplainantName,
      resolveDocumentComplainantAddressLine1,
      resolveDocumentComplainantAddressLine2,
      resolveDocumentRespondentName,
      resolveDocumentRespondentAddressLine1,
    } = await import("../../components/captain/complaints/complaintMeta.js");
    const { caseDocumentFileName, caseDocumentStoragePath, DOCX_MIME, nextDocumentVersion } =
      await import("../documents/docxTemplate.js");
    const { logComplaintActivity } = await import("../complaintQueries.js");

    const data = buildNoticeOfHearingProgrammaticData({
      complaint,
      // The same canonical document resolvers the Reklamo Form is built from,
      // so the complainant's name and address can never read differently on two
      // documents of the same case, and never print "undefined", "null" or a
      // dash in their place.
      complainant: resolveDocumentComplainantName(complaint),
      complainantAddressLine1: resolveDocumentComplainantAddressLine1(complaint),
      complainantAddressLine2: resolveDocumentComplainantAddressLine2(complaint),
      respondent: resolveDocumentRespondentName(complaint),
      respondentAddress: resolveDocumentRespondentAddressLine1(complaint),
      hearing,
    });

    const blob = await renderNoticeOfHearingProgrammatic(data);
    const version = nextDocumentVersion(documents, "hearing_notice");
    const filename = caseDocumentFileName(
      complaint,
      `${NOTICE_MASTER_LABEL}-v${version}`,
    );
    const storagePath = caseDocumentStoragePath(
      complaint,
      `${NOTICE_MASTER_LABEL}-v${version}`,
    );

    // upsert stays off: a version that already exists is a real document that
    // somebody may already be holding, so it is never silently replaced.
    const { error: uploadError } = await supabase.storage
      .from("documents")
      .upload(storagePath, blob, { contentType: DOCX_MIME, upsert: false });
    if (uploadError) throw uploadError;

    const { data: docInsert, error: docError } = await supabase
      .from("official_documents")
      .insert({
        complaint_id: complaint.id,
        document_type: "hearing_notice",
        title: `Notice of Hearing — ${hearing.title}`,
        filename,
        storage_path: storagePath,
        mime_type: DOCX_MIME,
        file_size: blob.size,
        // resident_visible, exactly as the previous generator wrote it. The
        // complainant is named on the face of this notice, so the copy they can
        // open from the resident portal must not depend on how it was made.
        visibility: "resident_visible",
        status: "active",
        version,
        generated_at: new Date().toISOString(),
        generated_by: user?.id || null,
        // The exact values that were printed, so the case file can be checked
        // against the stored document later without opening it.
        content_snapshot: {
          master_template: "programmatic",
          notice_form: "Notice_of_Hearing_Template.docx",
          hearing_id: hearing.id,
          hearing_date: hearing.hearing_date,
          hearing_time: hearing.hearing_time,
          complainant: data.complainant,
          complainant_address: data.complainantAddress,
          hearing_sentence: hearingSentenceParts(data),
          prepared_on: `${data.issueDayOrdinal} ${data.issueMonth} ${data.issueYear}`,
          signed_by: data.officialName,
          signatory_title: data.officialTitle,
          not_in_form: NOTICE_FORM_HAS_NO_SLOT,
        },
        uploaded_by: user?.id || null,
      })
      .select("id")
      .single();

    if (docError) {
      // The file is in the bucket but nothing in the case file points at it.
      // Remove it so a failed print cannot leave an unreferenced document
      // sitting in the case folder.
      await supabase.storage.from("documents").remove([storagePath]);
      throw docError;
    }

    if (docInsert?.id) {
      await supabase.from("document_lifecycle_events").insert({
        document_id: docInsert.id,
        complaint_id: complaint.id,
        event_type: "prepared",
        actor_id: user?.id || null,
        notes: `Notice of Hearing generated for the hearing of ${hearing.hearing_date}.`,
      });

      /**
       * Tell the complainant their Notice of Hearing is ready.
       *
       * The notification carries `related_hearing_id`, so the Resident
       * Portal opens the exact session and focuses its Documents section
       * rather than a list. The wording deliberately names the Notice —
       * never a summons, which is served on the respondent and is not the
       * complainant's document.
       *
       * Best effort: the notice is already stored and visible to the
       * resident whether or not this message goes out.
       */
      try {
        await notifyResident(
          supabase,
          complaint.id,
          complaint.resident_id,
          {
            type: "hearing",
            title: "Notice of Hearing available",
            message: `Your Notice of Hearing for ${hearing.title || "your hearing"} is ready to view and download.`,
            hearingId: hearing.id,
          }
        );
      } catch {
        // Non-fatal: the document itself is already saved.
      }
    }

    // Best-effort audit entry: the document is stored either way.
    await logComplaintActivity(supabase, {
      action: "hearing_notice_generated",
      complaintId: complaint.id,
      ref: complaint.reference_number || undefined,
      details: {
        title: `Notice of Hearing — ${hearing.title}`,
        master_template: "programmatic",
        hearing_id: hearing.id,
      },
    });

    return { success: true, document: docInsert || null };
  } catch (caught) {
    console.error(
      "mediationDocuments: could not generate Notice of Hearing (programmatic)",
      { complaintId: complaint?.id, hearingId: hearing?.id, error: caught },
    );
    return {
      success: false,
      error: caught?.message || "Could not generate the notice.",
      detail: caught?.message || null,
    };
  }
}
