import {
  BorderStyle,
  Document,
  ImageRun,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  TextWrappingType,
  VerticalAlign,
  WidthType,
} from "docx";
import PizZip from "pizzip";
import { DOCX_MIME } from "../documents/docxTemplate.js";
import { caseDateParts, caseTodayParts } from "../documents/caseDate.js";

/**
 * The programmatic Reklamo Form generator.
 *
 * The Reklamo Form is built from scratch as a real DOCX object model on US
 * Letter with the `docx` library, exactly the layout the barangay prints
 * (letterhead table, bilingual party blocks, narrative, receipt lines,
 * signature block). No master template, no `{{token}}` placeholders, and no
 * hand-written minimal WordprocessingML: the `docx` library serializes the
 * document, so a printed `<w:p>` can never leak into a text run the way the
 * old hand-rolled renderer let it.
 *
 * The letterhead reproduces the printed blank form — the same three-column
 * table, the same four seals and flag banner at the same anchors, the same
 * point sizes and the Brush Script MT office line. Only the art is borrowed,
 * and it is embedded (see letterheadArt.js) rather than read from the master,
 * because this runs in the browser as well as on the server.
 *
 * The $snapshot$ the generating layers store keeps the same field names the
 * template tokens used, so existing rows (and the case file) stay readable.
 */

/** The static officer signature the master prints. */
export const REKLAMO_SIGNOFF_NAME = "EDUARD A. LARANIO";
export const REKLAMO_SIGNOFF_TITLE = "Punong Barangay/Lupon Chairman";

/** Error code thrown when validation finds WordprocessingML leaked into text. */
export const REKLAMO_RENDER_INVALID_XML_TEXT = "REKLAMO_RENDER_INVALID_XML_TEXT";

/** US Letter portrait, the paper the barangay actually prints on. */
const PAGE_TWIPS = { width: 12240, height: 15840 };
const MARGIN_TWIPS = { top: 504, right: 1440, bottom: 1080, left: 1440, header: 708, footer: 708 };
const CONTENT_WIDTH = 9360; // 12240 - 1440 - 1440, what a full-width table may use

/** Printed text for a value; anything missing or whitespace-only prints blank. */
function printedText(value) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return text.trim() ? text : "";
}

function run(text, { bold = false, italic = false, underline = false, size, font } = {}) {
  const options = { text };
  if (bold) options.bold = true;
  if (italic) options.italics = true;
  if (underline) options.underline = {};
  if (size) options.size = size;
  if (font) options.font = font;
  return new TextRun(options);
}

/**
 * A paragraph. Newlines in the text become real line breaks. `keepNext` binds
 * the paragraph to the one after it so a signature never splits from its name.
 */
function paragraph(
  text,
  { align = "left", indent = 0, before = 0, after = 120, bold = false, italic = false, underline = false, size, font, keepNext = false } = {}
) {
  const lines = String(text).split(/\r\n|\r|\n/);
  const runs = [];
  lines.forEach((line, index) => {
    if (index > 0) runs.push(new TextRun({ break: 1 }));
    runs.push(run(line, { bold, italic, underline, size, font }));
  });
  const options = {
    children: runs,
    // No w:line: the printed form leaves its lines at the face's own leading.
    // Pinning a multiple here is what made the earlier copy's lines run at a
    // different pitch than the blank form's.
    spacing: { before, after: after ?? 120 },
  };
  if (align !== "left") options.alignment = align;
  if (indent > 0) options.indent = { left: indent };
  if (keepNext) options.keepNext = true;
  return new Paragraph(options);
}

/** A table cell holding paragraphs. */
function cell(content, width, vAlign = VerticalAlign.TOP) {
  const children = (Array.isArray(content) ? content : [content]).map(
    (item) => (typeof item === "string" ? paragraph(item, { after: 0 }) : item)
  );
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    verticalAlign: vAlign,
    children,
  });
}

const noBorders = {
  top: { style: BorderStyle.NONE },
  left: { style: BorderStyle.NONE },
  bottom: { style: BorderStyle.NONE },
  right: { style: BorderStyle.NONE },
  insideHorizontal: { style: BorderStyle.NONE },
  insideVertical: { style: BorderStyle.NONE },
};

/**
 * The letterhead, reproduced from the barangay's blank form.
 *
 * The printed form sets it as a three-column table (2200 / 4960 / 2200 twips,
 * cell margins 10 twips, no grid marks): the SK seal and the flag banner at the
 * left shoulder, the wording centred in the middle column with the Barangay
 * Abuno seal above it, and the City of Iligan seal at the right shoulder.
 *
 * Each image keeps the anchor it has in the master — same relative base, same
 * EMU offset, same printed extent — so the generated form lines up with the
 * printed blank instead of merely carrying the same pictures.
 *
 * @param {{ skSeal: Uint8Array, flagBanner: Uint8Array,
 *           barangaySeal: Uint8Array, citySeal: Uint8Array }} art
 *   the four images embedded by letterheadArt.js
 */
function letterheadTable(art) {
  const LEFT = 2200;
  const CENTER = 4960;
  const RIGHT = 2200;

  /** One anchored image, carrying the master's own anchor parameters (EMU). */
  const anchored = (data, { width, height }, horizontalPosition, verticalPosition, { behindDocument = false, name } = {}) =>
    new ImageRun({
      type: "png",
      data,
      transformation: { width, height },
      floating: {
        horizontalPosition,
        verticalPosition,
        wrap: { type: TextWrappingType.NONE },
        allowOverlap: true,
        layoutInCell: true,
        ...(behindDocument ? { behindDocument: true } : {}),
      },
      altText: { name },
    });

  const skSeal = anchored(
    art.skSeal,
    { width: 88.8, height: 76.66 },
    { relative: "leftMargin", offset: -510540 },
    { relative: "paragraph", offset: 312420 },
    { name: "Sangguniang Kabataan seal" }
  );
  // Painted behind the wording: the banner spans the sheet, not the cell.
  const flagBanner = anchored(
    art.flagBanner,
    { width: 880.8, height: 212.6 },
    { relative: "margin", offset: -1233170 },
    { relative: "page", offset: -297180 },
    { behindDocument: true, name: "Philippine flag banner" }
  );
  const barangaySeal = anchored(
    art.barangaySeal,
    { width: 92.8, height: 92.8 },
    { relative: "column", offset: -1014730 },
    { relative: "paragraph", offset: -167640 },
    { name: "Barangay Abuno seal" }
  );
  const citySeal = anchored(
    art.citySeal,
    { width: 94, height: 94 },
    { relative: "column", offset: 643890 },
    { relative: "paragraph", offset: -3810 },
    { name: "City of Iligan seal" }
  );

  /** A blank anchor paragraph: the images float, so nothing flows here. */
  const anchorLine = (children) =>
    new Paragraph({ spacing: { before: 0, after: 0 }, children });

  const leftCell = new TableCell({
    width: { size: LEFT, type: WidthType.DXA },
    verticalAlign: VerticalAlign.TOP,
    children: [anchorLine([skSeal, flagBanner])],
  });

  // The wording, in the sizes and weights the printed form uses: the office
  // line is one line of Brush Script MT, never two lines of the body face.
  const centerCell = new TableCell({
    width: { size: CENTER, type: WidthType.DXA },
    verticalAlign: VerticalAlign.TOP,
    children: [
      new Paragraph({
        alignment: "center",
        spacing: { before: 0, after: 0 },
        children: [barangaySeal, run("Republic of the Philippines", { bold: true, size: 20 })],
      }),
      paragraph("City of Iligan", { align: "center", size: 20, after: 0 }),
      paragraph("BARANGAY ABUNO", { align: "center", bold: true, size: 24, after: 0 }),
      paragraph("Zone 1 Proper Abuno     Tel. No. (063) 221-7996", {
        align: "center",
        italic: true,
        size: 15,
        after: 0,
      }),
      paragraph("Office of the Sangguniang Barangay", {
        align: "center",
        bold: true,
        italic: true,
        size: 40,
        font: "Brush Script MT",
        after: 0,
      }),
    ],
  });

  const rightCell = new TableCell({
    width: { size: RIGHT, type: WidthType.DXA },
    verticalAlign: VerticalAlign.TOP,
    children: [anchorLine([citySeal])],
  });

  return new Table({
    width: { size: LEFT + CENTER + RIGHT, type: WidthType.DXA },
    layout: TableLayoutType.FIXED,
    columnWidths: [LEFT, CENTER, RIGHT],
    margins: { top: 0, bottom: 0, left: 10, right: 10 },
    borders: noBorders,
    rows: [new TableRow({ children: [leftCell, centerCell, rightCell] })],
  });
}

/** A purely structural, borderless 2-column table (layout only, no grid marks). */
function borderlessRow(leftChildren, rightChildren, leftWidth, rightWidth) {
  return new TableRow({
    children: [
      cell(leftChildren, leftWidth, VerticalAlign.TOP),
      cell(rightChildren, rightWidth, VerticalAlign.TOP),
    ],
  });
}

/**
 * Top block A: the complainant on the left (about 55% of the line) and the
 * case information on the right (about 45%). The respondent has its own block
 * below - the case-information cell no longer doubles as the respondent's.
 *
 * A form made before the barangay assigns its case number prints the printed
 * blank: this is an official form, not a status screen, so the line is left
 * empty for the office to number - never a stand-in marker.
 */
function complaintCaseBlock(model) {
  const leftWidth = Math.floor(CONTENT_WIDTH * 0.55);
  const rightWidth = CONTENT_WIDTH - leftWidth;
  const left = [
    paragraph(model.complainant_name, { after: 0, bold: true }),
    paragraph(model.complainant_address_line1, { after: 0 }),
    paragraph(model.complainant_address_line2, { after: 0 }),
    // The printed form sets this caption at 13pt and leaves 24pt under it
    // before the respondent block; both are carried over here. The caption is
    // regular weight on the blank form, not bold.
    paragraph("Complainant/Nagsumbong", { after: 480, size: 26 }),
  ];
  const caseNumber =
    model.case_number !== ""
      ? `Barangay Case No. ${model.case_number}`
      : "Barangay Case No. ______________________";
  const right = [paragraph(caseNumber, { after: 0 }), paragraph(`For: ${model.case_for}`, { after: 0 })];
  return new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    layout: TableLayoutType.FIXED,
    borders: noBorders,
    columnWidths: [leftWidth, rightWidth],
    rows: [borderlessRow(left, right, leftWidth, rightWidth)],
  });
}

/**
 * The respondent's own full-width area, directly below the complainant block.
 * It shares the complainant's left edge - "Batok Kang" leads at the same
 * column as the complainant name above, never centered in the page and never
 * tucked under the case-information column.
 *
 * A missing piece stays simple printed blank: no address lines print when the
 * address is empty, and a complaint that names no respondent gets a single
 * blank line for the name (a paper form's field), never a stand-in word.
 */
function respondentBlock(model) {
  const address = [
    model.respondent_address_line1,
    model.respondent_address_line2,
  ].filter((value) => value !== "");
  const lines = address.map((value) => paragraph(value, { after: 0 }));
  const nameOrBlank =
    model.respondent_name !== ""
      ? paragraph(model.respondent_name, { before: 320, after: 0, bold: true })
      : paragraph("______________________", { before: 320, after: 0 });
  return [
    // The printed form sets the "Batok Kang" caption at 13pt and leaves the
    // height of one blank line between it and the ruled area below.
    paragraph("Batok Kang", { after: 0, size: 26 }),
    nameOrBlank,
    ...lines,
    paragraph("Respondent/Sinumbong", { before: 0, after: 480, size: 26 }),
  ];
}

/**
 * A signature block on the right half of the line: an empty left cell keeps the
 * signature away from the fold, and the lines sit centered inside the right
 * cell. Both signature tables share the same split so the two slips line up.
 *
 * The resident-submitted copy prints NO blank signature line - the printed name
 * is the record of who filed online. The official form (already received by the
 * barangay, `received: true`) keeps the ruled line the wet signature goes on.
 */
function signatureBlock(lines, { received = false } = {}) {
  const leftWidth = Math.floor(CONTENT_WIDTH / 2);
  const rightWidth = CONTENT_WIDTH - leftWidth;
  const content = received
    ? lines
    : lines.filter((line) => line.text !== "______________________");
  const centered = content.map(({ text, after = 0, bold = false, underline = false, size, keepNext = false }) =>
    paragraph(text, { align: "center", after, bold, underline, size, keepNext })
  );
  return new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    layout: TableLayoutType.FIXED,
    borders: noBorders,
    columnWidths: [leftWidth, rightWidth],
    rows: [borderlessRow([paragraph("", { after: 0 })], centered, leftWidth, rightWidth)],
  });
}

/**
 * Renders a Reklamo Form DOCX from a field model, with no template involved.
 *
 * @param {object} model the object `buildReklamoFormModel` returns
 * @returns {Promise<Blob>} the generated .docx on US Letter
 */
export async function renderReklamoFormDocx(model) {
  // The letterhead art is ~280 KB of embedded PNG and is only needed once a
  // document is actually being generated. This generator also runs in the
  // browser - the Captain Portal renders the official copy there - so the art
  // is loaded on demand instead of joining the page's initial bundle.
  const { loadLetterheadArt } = await import("./letterheadArt.js");
  const art = await loadLetterheadArt();
  const letterhead = letterheadTable(art);

  const prepared = `Gihimo ning ika ${model.prepared_day} bulan ${model.prepared_month}, tuig ${model.prepared_year}.`;

  // The receipt line the original form carries. Until the barangay officially
  // receives the complaint the date fields stay blank; the form never
  // fabricates a date from the online submission timestamp - that lives in the
  // audit trail, not on the paper.
  const received = model.received_day !== "";
  const footer = received
    ? `Nadawat ug gitipigan niining ika ${model.received_day} bulan sa ${model.received_month} tuig ${model.received_year}.`
    : "Nadawat ug gitipigan niining ika ____ bulan sa __________ tuig ______.";

  const complainantSignature = signatureBlock(
    [
      { text: "______________________", after: 0, keepNext: true },
      { text: model.complainant_name, after: 0, bold: true, keepNext: true },
      { text: "(Mga) Nagsumbong", after: 0 },
    ],
    { received }
  );
  const captainSignature = signatureBlock(
    [
      // The printed form rules the captain's name rather than drawing a line
      // above it, so the underline is the wet-signature line on both copies.
      { text: REKLAMO_SIGNOFF_NAME, after: 0, bold: true, underline: true, size: 24, keepNext: true },
      { text: REKLAMO_SIGNOFF_TITLE, after: 0, size: 24 },
    ],
    { received }
  );

  const body = [
    letterhead,
    // The printed blank leaves roughly four lines of air under the letterhead
    // before the case block; one paragraph carries that gap here.
    paragraph("", { before: 0, after: 680 }),
    complaintCaseBlock(model),
    ...respondentBlock(model),
    paragraph("R E K L A M O", { align: "center", before: 0, after: 480, bold: true, size: 28 }),
    // The narrative verbatim, clean paragraph text. Each stored newline is an
    // in-paragraph line break, so exactly what the resident wrote is what
    // prints - nothing is normalized, and no line is drawn under it. The ruled
    // area on the blank form runs the full text width, so this does too.
    new Paragraph({
      children: String(model.complaint_narrative || "")
        .split(/\r\n|\r|\n/)
        .map((line, index) =>
          index === 0 ? new TextRun({ text: line }) : [new TextRun({ break: 1 }), new TextRun({ text: line })]
        )
        .flat(),
      spacing: { before: 160, after: 160 },
    }),
    paragraph(prepared, { before: 160, after: 160 }),
    complainantSignature,
    paragraph(footer, { before: 160, after: 160 }),
    captainSignature,
  ];

  const doc = new Document({
    creator: "Barangay Abuno",
    title: "Reklamo",
    sections: [
      {
        properties: {
          page: {
            size: { width: PAGE_TWIPS.width, height: PAGE_TWIPS.height },
            margin: MARGIN_TWIPS,
          },
        },
        children: body,
      },
    ],
    styles: {
      default: {
        document: {
          run: {
            // The blank form's document default: Book Antiqua at 12pt.
            font: { name: "Book Antiqua", hint: "eastAsia" },
            size: 24,
          },
          paragraph: {
            spacing: { after: 0 },
          },
        },
      },
    },
  });

  let blob;
  try {
    blob = await Packer.toBlob(doc);
  } catch (error) {
    throw new Error(`The Reklamo Form could not be serialized: ${error.message}`);
  }

  await validateReklamoDocx(blob);

  return new Blob([blob], { type: DOCX_MIME });
}

/**
 * Validation gate for the generated DOCX. A document that prints raw
 * WordprocessingML (`<w:...>` shown literally) is structurally valid to Zip
 * readers but unreadable to a person, so the generator verifies its own output
 * before any caller stores it:
 *   - the package is a ZIP with the three parts a Word document must have,
 *   - word/document.xml is well-formed XML,
 *   - no `<w:...>` fragment is sitting inside a `<w:t>` text node.
 *
 * @param {Blob} blob the rendered DOCX
 */
async function validateReklamoDocx(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const zip = new PizZip(bytes);

  for (const part of ["[Content_Types].xml", "word/document.xml", "word/_rels/document.xml.rels"]) {
    if (!zip.file(part)) {
      throw reklamoValidationError(`The DOCX is missing its ${part} part.`);
    }
  }

  const documentXml = zip.file("word/document.xml").asText();
  if (!isWellFormedXml(documentXml)) {
    throw reklamoValidationError("word/document.xml is not well-formed XML.");
  }

  const textNodes = [...documentXml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map((m) => m[1]);
  const leaked = textNodes.find((text) => /<w:|\b(w:p|w:r|w:t|w:pPr|w:rPr|w:sectPr)\b/.test(unescapeXml(text)));
  if (leaked) {
    throw reklamoValidationError(
      "The Reklamo Form printed WordprocessingML markup as text. The document was not generated."
    );
  }
}

function reklamoValidationError(message) {
  const error = new Error(message);
  error.code = REKLAMO_RENDER_INVALID_XML_TEXT;
  return error;
}

function unescapeXml(value) {
  return String(value)
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

/**
 * A tiny well-formedness check for the XML a Serializer produces: balanced tags,
 * no stray `>` between tags. It is intentionally stricter than what Word needs
 * so a broken package is caught here instead of on the reader's desk.
 */
function isWellFormedXml(xml) {
  if (!/^<\?xml/.test(xml)) return false;
  const tagPattern = /<(\/?)([A-Za-z_][\w:.-]*)((?:\s[^<>]*?)?)(\/?)>/g;
  const stack = [];
  let match;
  while ((match = tagPattern.exec(xml))) {
    const [, closing, name, , selfClosing] = match;
    if (selfClosing === "/") continue;
    if (closing === "/") {
      const top = stack.pop();
      if (top !== name) return false;
    } else {
      stack.push(name);
    }
  }
  return stack.length === 0;
}

/**
 * Builds the field model for one case's Reklamo Form.
 *
 * Every value is the exact data the barangay holds on the complaint row. The
 * narrative is the resident's own words with no editing, and a missing
 * respondent stays blank rather than being filled with a stand-in.
 *
 * @param {object} input
 * @param {object} input.complaint  the canonical complaint row
 * @param {string} input.complainantName
 * @param {string} input.complainantAddressLine1
 * @param {string} input.complainantAddressLine2
 * @param {string} input.respondentName
 * @param {string} input.respondentAddressLine1
 * @param {string} input.respondentAddressLine2
 * @param {string} input.narrative   complaints.description, verbatim
 * @param {boolean} [input.requireCaseNumber] when true (default) the form refuses
 *        to print without a Barangay Case Number; the resident's own submitted
 *        form passes false so its case blank prints empty
 * @param {Date}   [input.now]      injectable clock, for tests
 */
export function buildReklamoFormModel({
  complaint,
  complainantName,
  complainantAddressLine1,
  complainantAddressLine2,
  respondentName,
  respondentAddressLine1,
  respondentAddressLine2,
  narrative,
  now,
  requireCaseNumber = true,
} = {}) {
  if (!complaint) {
    throw new Error("Complaint record could not be found.");
  }

  // Only the official case number may print here. A reference number is the
  // submission tracking number and belongs to a separate sequence, so it is
  // never a substitute. The resident's own submitted form prints the empty
  // blank because the case has not been numbered yet.
  const caseNumber = String(complaint.barangay_case_number || "").trim();
  if (!caseNumber && requireCaseNumber) {
    throw new Error("This case has no barangay case number yet.");
  }

  const prepared = caseTodayParts(now || new Date());
  if (!prepared) {
    throw new Error("The preparation date could not be determined.");
  }

  // "Nadawat ug gitipigan" is the date the complaint was officially received.
  // There is no fallback: a form for a complaint that has not been received yet
  // must print the received shoe blank empty rather than invent a date.
  const filed = complaint.official_received_at
    ? caseDateParts(complaint.official_received_at)
    : null;

  return {
    complainant_name: printedText(complainantName),
    complainant_address_line1: printedText(complainantAddressLine1),
    complainant_address_line2: printedText(complainantAddressLine2),
    case_number: caseNumber,
    case_for: printedText(complaint.title),
    respondent_name: printedText(respondentName),
    respondent_address_line1: printedText(respondentAddressLine1),
    respondent_address_line2: printedText(respondentAddressLine2),
    // The resident's own words, untouched.
    complaint_narrative: printedText(narrative),
    prepared_day: prepared.day,
    prepared_month: prepared.month,
    prepared_year: prepared.year,
    received_day: filed?.day ?? "",
    received_month: filed?.month ?? "",
    received_year: filed?.year ?? "",
  };
}