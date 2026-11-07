import { SITE } from "../constants.js";

/**
 * Shared primitives for the printed barangay forms.
 *
 * The reference sheets in supabase/manual are the layout authority for the
 * Reklamo Form and the Notice of Hearing, so both are drawn here on one A4
 * portrait sheet with the same letterhead, the same rule weight, and the same
 * "label + slot" idiom. Nothing in this module is specific to a single form.
 */

/** A4 portrait. The reference sheets are 3:4 photos, but A4 is the paper the
 *  existing PDF builder and the print preview already assume. */
export const PAGE = { width: 210, height: 297 };

export const MARGIN = { top: 15, right: 18, bottom: 16, left: 18 };

export const LEFT = MARGIN.left;
export const RIGHT = PAGE.width - MARGIN.right;
export const CENTER = PAGE.width / 2;
export const CONTENT_WIDTH = RIGHT - LEFT;

export const BODY_SIZE = 10.5;
export const BODY_LEADING = 4.6;
export const RULE_WEIGHT = 0.25;
export const SLOT_MIN_WIDTH = 24;

/**
 * Letterhead printed on both reference forms, top to bottom.
 *
 * The city is reduced to "CITY OF ILIGAN" because that is how the reference
 * prints it; SITE.city stays the display form ("Iligan City") for the app.
 *
 * The seal and logo artwork that flanks this block on the printed sheet is a
 * physical asset the barangay supplies. It is not reproduced here, so the
 * flanks are left blank rather than filled with a substitute.
 */
export const FORM_HEADER_LINES = [
  "REPUBLIC OF THE PHILIPPINES",
  `CITY OF ${SITE.city.replace(/\s+City$/i, "").toUpperCase()}`,
  SITE.barangay.toUpperCase(),
  "OFFICE OF THE SANGGUNIANGSANGGUNIAN BARANGAY",
];

export function formHeaderLines() {
  return [...FORM_HEADER_LINES];
}

export function isPresent(value) {
  return value !== null && value !== undefined && String(value).trim() !== "";
}

export function displayValue(value, fallback = "—") {
  return isPresent(value) ? String(value).trim() : fallback;
}

export function createPrintedForm({ jsPDF, title, subject, creator }) {
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  doc.setProperties({
    title,
    subject,
    creator: creator || SITE.name,
  });

  const state = { y: MARGIN.top };
  const bottom = () => PAGE.height - MARGIN.bottom;

  function setFont(size = BODY_SIZE, style = "normal") {
    doc.setFont("helvetica", style);
    doc.setFontSize(size);
    doc.setTextColor(0, 0, 0);
  }

  /** Starts a new page when `height` no longer fits. Returns true if it did. */
  function need(height) {
    if (state.y + height <= bottom()) return false;
    doc.addPage();
    state.y = MARGIN.top;
    return true;
  }

  function rule(x1, x2, y) {
    if (x2 <= x1) return;
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(RULE_WEIGHT);
    doc.line(x1, y, x2, y);
  }

  function text(value, x, y, { size = BODY_SIZE, style = "normal", align = "left" } = {}) {
    setFont(size, style);
    doc.text(String(value), x, y, { align });
    return y;
  }

  /** Centred bold form title. `value` carries its own letter spacing. */
  function formTitle(value, y, { size = 13 } = {}) {
    setFont(size, "bold");
    doc.text(String(value), CENTER, y, { align: "center" });
    return y;
  }

  /** The four-line letterhead. Returns the y just below it. */
  function letterhead({ top = MARGIN.top, leading = 5 } = {}) {
    let cursor = top + BODY_SIZE * 0.35;
    for (const lineText of FORM_HEADER_LINES) {
      setFont(9.5, "bold");
      doc.text(lineText, CENTER, cursor, { align: "center" });
      cursor += leading;
    }
    state.y = cursor;
    return cursor;
  }

  /**
   * `Label:` followed by the value and a rule closing the field at `ruleTo`.
   * The reference forms print their slots this way: label, value, then a rule
   * running to the end of the field.
   */
  function fieldRow({
    label: labelText,
    value,
    x = LEFT,
    y = state.y,
    ruleTo = RIGHT,
    size = BODY_SIZE,
  }) {
    let rowY = y;
    if (need(size * 0.6)) rowY = state.y;
    setFont(size, "normal");
    doc.text(String(labelText), x, rowY);
    let slotStart = x + doc.getTextWidth(String(labelText)) + 1.8;
    if (isPresent(value)) {
      doc.text(String(value).trim(), slotStart, rowY);
      slotStart += doc.getTextWidth(String(value).trim()) + 1.8;
    }
    rule(slotStart, ruleTo, rowY);
    state.y = rowY;
    return rowY;
  }

  /** An empty printed slot, e.g. "For:", "O.R. No." or "Doc. Stamp". */
  function slot({ x = LEFT, y = state.y, width = SLOT_MIN_WIDTH }) {
    rule(x, x + width, y);
    state.y = y;
    return y;
  }

  /**
   * Wet-signature block: the rule the official signs on, the printed name, and
   * the office title beneath it. `align` positions the whole block.
   */
  function signatureBlock({
    x = LEFT,
    y = state.y,
    width = 64,
    name,
    title,
    align = "center",
    size = BODY_SIZE,
  }) {
    let ruleY = y;
    if (need(16)) ruleY = state.y;
    setFont(size, "normal");
    const anchorX = align === "center" ? x + width / 2 : align === "right" ? x + width : x;
    const anchor = { align };
    rule(x, x + width, ruleY);
    let cursor = ruleY + 5;
    if (isPresent(name)) {
      text(name, anchorX, cursor, { size, style: "bold", align });
      cursor += BODY_LEADING;
    }
    if (isPresent(title)) {
      text(title, anchorX, cursor, { size, align });
      cursor += BODY_LEADING;
    }
    state.y = cursor;
    return cursor;
  }

  /** Wrapped plain paragraph. Starts at `y` and advances the cursor. */
  function paragraph(value, options = {}) {
    const {
      x = LEFT,
      width = CONTENT_WIDTH,
      y = state.y,
      size = BODY_SIZE,
      leading = BODY_LEADING,
      align = "left",
      gap = 0,
    } = options;
    setFont(size, "normal");
    const source = isPresent(value) ? String(value).trim() : "";
    if (!source) return state.y;
    const lines = doc.splitTextToSize(source, width);
    let cursor = y;
    for (const lineText of lines) {
      state.y = cursor;
      if (need(leading)) cursor = state.y;
      doc.text(lineText, x, cursor, { align });
      cursor += leading;
    }
    state.y = cursor + gap;
    return state.y;
  }

  /**
   * Wrapped paragraph built from mixed text and slot segments, which is how the
   * reference forms set their body copy:
   *
   *   runParagraph([
   *     { text: "You are hereby required to appear before" },
   *     { text: venue, rule: true },
   *     { text: "on the day of" },
   *     { text: date, rule: true },
   *   ])
   *
   * Words wrap individually. A `rule` segment is a printed form blank: it is
   * kept whole, moved to the next line when it does not fit, and closed by a
   * rule under the baseline. An empty slot still draws its rule, so an
   * unfilled field reads as a blank to be completed by hand.
   */
  function runParagraph(segments, options = {}) {
    const {
      x = LEFT,
      width = CONTENT_WIDTH,
      y = state.y,
      size = BODY_SIZE,
      leading = BODY_LEADING,
      gap = 0,
      indent = 0,
    } = options;
    setFont(size, "normal");

    const items = [];
    for (const segment of segments || []) {
      if (!segment) continue;
      if (segment.rule) {
        const value = isPresent(segment.text) ? String(segment.text).trim() : "";
        const pad = 1.8;
        items.push({
          slot: true,
          value,
          width: value ? doc.getTextWidth(value) + pad : segment.minWidth ?? SLOT_MIN_WIDTH,
          pad,
        });
        continue;
      }
      const words = isPresent(segment.text) ? String(segment.text).trim().split(/\s+/) : [];
      for (const word of words) items.push({ slot: false, value: word, width: doc.getTextWidth(`${word} `) });
    }

    let cursor = y;
    let lineX = x + indent;
    let used = indent;

    const newLine = () => {
      cursor += leading;
      lineX = x;
      used = 0;
      if (cursor + leading > bottom()) {
        doc.addPage();
        cursor = MARGIN.top;
      }
    };

    for (const item of items) {
      if (used > 0 && used + item.width > width) newLine();
      if (item.slot) {
        if (item.value) {
          doc.text(item.value, lineX, cursor);
          rule(lineX, lineX + item.width - item.pad, cursor + 1.2);
        } else {
          rule(lineX, lineX + item.width - item.pad, cursor);
        }
        lineX += item.width;
        used += item.width;
      } else {
        doc.text(item.value, lineX, cursor);
        lineX += item.width;
        used += item.width;
      }
    }
    if (used > 0) cursor += leading;

    state.y = cursor + gap;
    return state.y;
  }

  return {
    doc,
    state,
    moveTo(y) {
      state.y = y;
    },
    /** True when `height` still fits on the current page. */
    fits(height) {
      return state.y + height <= bottom();
    },
    newPage() {
      doc.addPage();
      state.y = MARGIN.top;
      return state.y;
    },
    bottom,
    setFont,
    rule,
    text,
    formTitle,
    letterhead,
    fieldRow,
    slot,
    signatureBlock,
    paragraph,
    runParagraph,
  };
}

export function printedFormBlob(form) {
  return form.doc.output("blob");
}

/* ── Date and time phrases used by the printed slots ─────────────────── */

/**
 * Splits a stored date into the three pieces the reference forms print in
 * their "ika ___ bulan ___, tuig ___" slots.
 * @returns {{ day: string, month: string, year: string } | null}
 */
export function formDateParts(value) {
  if (!isPresent(value)) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return {
    day: String(date.getDate()),
    month: date.toLocaleDateString("en-US", { month: "long" }),
    year: String(date.getFullYear()),
  };
}

/**
 * A hearing time as the notice prints it, together with the meridiem the
 * reference form offers as "morning/afternoon".
 * @returns {{ time: string, meridiem: string } | null}
 */
export function formTimeParts(value) {
  if (!isPresent(value)) return null;
  const [rawHour, rawMinute] = String(value).split(":");
  const hour = Number(rawHour);
  if (!Number.isFinite(hour)) return null;
  const minute = String(rawMinute ?? "00").padStart(2, "0");
  const displayHour = hour % 12 === 0 ? 12 : hour % 12;
  return {
    time: `${displayHour}:${minute}`,
    meridiem: hour < 12 ? "morning" : "afternoon",
  };
}
