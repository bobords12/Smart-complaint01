/**
 * The Barangay Abuno letterhead, built as a real DOCX object model.
 *
 * WHY THIS FILE EXISTS
 *   Two official forms carry the same printed letterhead: the Reklamo Form and
 *   the Notice of Hearing. Both are generated programmatically — neither one is
 *   filled into a Word master at runtime — so both need the letterhead built
 *   out of the `docx` object model rather than copied out of a template.
 *
 *   `lib/reklamo/reklamoForm.js` already carries this builder, and it is the one
 *   that was measured back against the barangay's blank form (every image within
 *   1px of the printed sheet). This module is that same builder, unchanged, so
 *   the Notice of Hearing can reproduce the identical letterhead without the
 *   two documents ever drifting apart.
 *
 * WHY THE ART IS IMPORTED FROM lib/reklamo/
 *   The four images (SK seal, flag banner, Barangay Abuno seal, City of Iligan
 *   seal) ship as base64 in `lib/reklamo/letterheadArt.js`, because the same
 *   generator has to run in a browser where `fs` is unavailable. The bytes were
 *   checked against the Notice of Hearing form as well and are identical
 *   (image1-4.png, same SHA-256), so one module can hold them for both forms.
 *
 * WHAT IS NOT INCLUDED
 *   The Notice of Hearing form also carries a large translucent background
 *   watermark (word/media/image5.png, 4.1 MB). It is decorative, it is not part
 *   of the form's text layout, and embedding it would multiply the size of every
 *   generated document, so it is deliberately left out. Everything that carries
 *   meaning — the wording, the seals and the flag — is reproduced.
 */

import {
  BorderStyle,
  ImageRun,
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

/** The letterhead's three columns, in twips, exactly as the printed form sets them. */
export const LETTERHEAD_COLUMNS = [2200, 4960, 2200];
export const LETTERHEAD_WIDTH =
  LETTERHEAD_COLUMNS[0] + LETTERHEAD_COLUMNS[1] + LETTERHEAD_COLUMNS[2];

/** Printed text for a value; anything missing or whitespace-only prints blank. */
export function printedText(value) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return text.trim() ? text : "";
}

/** One text run in the sizes and weights the printed forms use. */
export function run(text, { bold = false, italic = false, underline = false, size, font } = {}) {
  const options = { text };
  if (bold) options.bold = true;
  if (italic) options.italics = true;
  if (underline) options.underline = {};
  if (size) options.size = size;
  if (font) options.font = font;
  return new TextRun(options);
}

/**
 * A paragraph. Newlines in the text become real line breaks.
 *
 * No `w:line` is ever pinned: the printed forms leave their lines at the face's
 * own leading, and pinning a multiple is what made an earlier copy's lines run
 * at a different pitch than the blank form's.
 */
export function paragraph(
  text,
  {
    align = "left",
    indent = 0,
    before = 0,
    after = 120,
    bold = false,
    italic = false,
    underline = false,
    size,
    font,
    keepNext = false,
  } = {},
) {
  const lines = String(text).split(/\r\n|\r|\n/);
  const runs = [];
  lines.forEach((line, index) => {
    if (index > 0) runs.push(new TextRun({ break: 1 }));
    runs.push(run(line, { bold, italic, underline, size, font }));
  });
  const options = {
    children: runs,
    spacing: { before, after: after ?? 120 },
  };
  if (align !== "left") options.alignment = align;
  if (indent > 0) options.indent = { left: indent };
  if (keepNext) options.keepNext = true;
  return new Paragraph(options);
}

/** A table cell holding paragraphs. */
export function cell(content, width, vAlign = VerticalAlign.TOP) {
  const children = (Array.isArray(content) ? content : [content]).map(
    (item) => (typeof item === "string" ? paragraph(item, { after: 0 }) : item),
  );
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    verticalAlign: vAlign,
    children,
  });
}

/** Every border suppressed — the printed forms rule nothing around their blocks. */
export const NO_BORDERS = {
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
 * Each image keeps the anchor it has in the printed form — same relative base,
 * same EMU offset, same printed extent — so the generated form lines up with
 * the printed blank instead of merely carrying the same pictures.
 *
 * @param {{ skSeal: Uint8Array, flagBanner: Uint8Array,
 *           barangaySeal: Uint8Array, citySeal: Uint8Array }} art
 *   the four images decoded by letterheadArt.js
 */
export function letterheadTable(art) {
  const [LEFT, CENTER, RIGHT] = LETTERHEAD_COLUMNS;

  /** One anchored image, carrying the printed form's own anchor parameters (EMU). */
  const anchored = (
    data,
    { width, height },
    horizontalPosition,
    verticalPosition,
    { behindDocument = false, name } = {},
  ) =>
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
    { name: "Sangguniang Kabataan seal" },
  );
  // Painted behind the wording: the banner spans the sheet, not the cell.
  const flagBanner = anchored(
    art.flagBanner,
    { width: 880.8, height: 212.6 },
    { relative: "margin", offset: -1233170 },
    { relative: "page", offset: -297180 },
    { behindDocument: true, name: "Philippine flag banner" },
  );
  const barangaySeal = anchored(
    art.barangaySeal,
    { width: 92.8, height: 92.8 },
    { relative: "column", offset: -1014730 },
    { relative: "paragraph", offset: -167640 },
    { name: "Barangay Abuno seal" },
  );
  const citySeal = anchored(
    art.citySeal,
    { width: 94, height: 94 },
    { relative: "column", offset: 643890 },
    { relative: "paragraph", offset: -3810 },
    { name: "City of Iligan seal" },
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
    width: { size: LETTERHEAD_WIDTH, type: WidthType.DXA },
    layout: TableLayoutType.FIXED,
    columnWidths: LETTERHEAD_COLUMNS,
    margins: { top: 0, bottom: 0, left: 10, right: 10 },
    borders: NO_BORDERS,
    rows: [new TableRow({ children: [leftCell, centerCell, rightCell] })],
  });
}
