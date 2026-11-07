import { jsPDF } from "jspdf";
import {
  BODY_LEADING,
  BODY_SIZE,
  CONTENT_WIDTH,
  createPrintedForm,
  formDateParts,
  LEFT,
  RIGHT,
} from "../documents/printedForm.js";
import { buildReklamoFieldModel, reklamoSnapshotFromModel } from "./reklamoDocument.js";

/**
 * Reklamo Form, laid out to match supabase/manual/reklamo.png.
 *
 * Vertical positions below are the printed rows read off that sheet, expressed
 * in millimetres on A4:
 *
 *   48  Barangay Case No.            (For: on the right)
 *   62  Complainant/nagsumbong
 *   74  Respondent/sinumbong
 *   88  R E K L A M O
 *   99  complaint narrative
 *  211  Gihimo ning ika ... bulan ... tuig ...   (= narrative end + 5)
 *  223  (Mga) Nagsumbong                           (= narrative end + 17)
 *  237  Nadawat ug gitipigan niining ika ...       (= narrative end + 31)
 *  250  signature / Punong Barangay-Lupon Chairman  (= narrative end + 44)
 *
 * The reference sheet is a photograph of a filled form, so the handwriting in
 * it is not reproduced. Only the printed labels, rules and slots are drawn, and
 * every slot is filled from the complaint, the hearing record or the
 * authenticated official's profile.
 */

const ROW = {
  caseNumber: 48,
  complainant: 62,
  respondent: 74,
  title: 88,
  narrativeTop: 99,
  narrativeFloor: 206,
};

/** Footer rows, measured down from the end of the narrative. */
const FOOTER = {
  incidentDate: 5,
  complainantSignature: 17,
  receivedDate: 31,
  signature: 44,
  /** Enough room for the last row plus its signature block. */
  height: 58,
};

const SIGNATURE_X = 122;
const SIGNATURE_WIDTH = 70;

const SPACED_TITLE = "R E K L A M O";

export function buildReklamoPdf(input = {}) {
  const model = input.model || buildReklamoFieldModel(input);
  const form = createPrintedForm({
    jsPDF,
    title: `${model.caseNumber || model.trackingNumber} — Reklamo Form`,
    subject: "Barangay Abuno Reklamo Form",
  });
  const { doc } = form;

  form.letterhead();

  /* Case number and purpose, on one row as printed. */
  form.fieldRow({
    label: model.caseNumber ? "Barangay Case No." : "Tracking No.",
    value: model.caseNumber || model.trackingNumber,
    y: ROW.caseNumber,
    ruleTo: 138,
  });
  form.fieldRow({
    label: "For:",
    value: null,
    x: 148,
    y: ROW.caseNumber,
    ruleTo: RIGHT,
  });

  /* Parties. */
  form.fieldRow({
    label: "Complainant/nagsumbong:",
    value: model.complainant.name,
    y: ROW.complainant,
    ruleTo: RIGHT,
  });
  form.fieldRow({
    label: "Respondent/sinumbong:",
    value: model.respondents.length ? model.respondents.join(", ") : null,
    y: ROW.respondent,
    ruleTo: RIGHT,
  });

  form.formTitle(SPACED_TITLE, ROW.title, { size: 13 });

  /* Narrative. The sheet's ruled area runs from the title down to the date
   * line; a complaint that does not fill it keeps the same footer position,
   * and one that overruns it continues onto the next page. */
  let cursor = ROW.narrativeTop;
  for (const text of model.narrativeParagraphs) {
    if (!text) continue;
    cursor = form.paragraph(text, {
      x: LEFT,
      width: CONTENT_WIDTH,
      y: cursor,
      size: BODY_SIZE,
      leading: BODY_LEADING,
      gap: 2,
    });
  }

  /* Footer. Measured from the end of the narrative rather than at fixed
   * coordinates, so an overlong complaint pushes the whole block down instead
   * of printing it back over the last line of the narrative. When the block
   * cannot fit under the narrative it starts a fresh page rather than running
   * off the foot of this one. */
  let footer = Math.max(cursor, ROW.narrativeFloor);
  if (footer + FOOTER.height > form.bottom()) footer = form.newPage();

  /* Date the complaint was made. */
  const incident = formDateParts(model.incident.date);
  form.runParagraph(
    [
      { text: "Gihimo ning ika" },
      { text: incident?.day, rule: true, minWidth: 12 },
      { text: "bulan" },
      { text: incident?.month, rule: true, minWidth: 30 },
      { text: "tuig" },
      { text: incident?.year, rule: true, minWidth: 18 },
      { text: "." },
    ],
    { y: footer + FOOTER.incidentDate }
  );

  form.fieldRow({
    label: "(Mga) Nagsumbong:",
    value: model.complainant.name,
    y: footer + FOOTER.complainantSignature,
    ruleTo: RIGHT,
  });

  /* Date the form was received at the barangay. */
  const received = formDateParts(model.receivedAt);
  form.runParagraph(
    [
      { text: "Nadawat ug gitipigan niining ika" },
      { text: received?.day, rule: true, minWidth: 12 },
      { text: "bulan" },
      { text: received?.month, rule: true, minWidth: 30 },
      { text: "sa tuig" },
      { text: received?.year, rule: true, minWidth: 18 },
      { text: "." },
    ],
    { y: footer + FOOTER.receivedDate }
  );

  form.signatureBlock({
    x: SIGNATURE_X,
    y: footer + FOOTER.signature,
    width: SIGNATURE_WIDTH,
    name: model.signature?.name,
    title: model.signature?.title,
  });

  return { doc, model, narrativeEnd: cursor };
}

export function downloadReklamoPdf(input = {}, fileName = "reklamo-form.pdf") {
  const { doc } = buildReklamoPdf(input);
  doc.save(fileName);
}

export function reklamoPdfBlob(input = {}) {
  const { doc, model } = buildReklamoPdf(input);
  return { blob: doc.output("blob"), model };
}

export { reklamoSnapshotFromModel };
