/**
 * The two documents the Katarungang Pambarangay process owes at its end:
 * the AMICABLE SETTLEMENT and the CERTIFICATE TO FILE ACTION.
 *
 * WHY THIS FILE EXISTS
 *   Case file records that a settlement was signed and it records that
 *   conciliation failed, but neither one produced anything the parties
 *   could be handed. The tab said "produce it under Case Documents" and
 *   Case Documents had no generator for either, so the two outcomes the
 *   process actually exists to reach were the only two that ended in a
 *   sentence rather than a document.
 *
 *   This module builds both from the saved case data with the `docx`
 *   object model — the same route `lib/hearing/noticeOfHearingProgrammatic.js`
 *   takes — so neither depends on a Word master living in a private
 *   bucket, and both always print exactly what is stored.
 *
 * STANDARD BEHAVIOUR REPRODUCED
 *   Amicable Settlement (RA 7160 §407(c)):
 *     written, signed by both parties, attested by the Barangay Captain
 *     or the Pangkat Chairperson, and — ten days after the date it was
 *     signed — possessing the force and effect of a judgment of a court
 *     of law, unless either party repudiates it within those ten days
 *     for fraud, violence or intimidation.
 *
 *   Certificate to File Action (RA 7160 §416(c)):
 *     issued by the Lupon or Pangkat to the party who initiated the
 *     proceeding when conciliation fails, which is what lets the
 *     complainant go to a regular court.
 *
 * ONE DOCUMENT, BOTH PARTIES
 *   The settlement is a single instrument signed by both parties, so it
 *   is generated once and names both of them. It is stored
 *   `resident_visible`, which is how the complainant's copy reaches the
 *   Resident Portal; the barangay prints the respondent's copy from the
 *   same file under Case Documents. `issued_to` in the content snapshot
 *   records that both copies are owed from this one generation.
 *
 * SAME PERSISTENCE CONTRACT AS EVERY OTHER GENERATED DOCUMENT
 *   version from nextDocumentVersion(), upload with `upsert: false`, a
 *   failed insert rolls the uploaded file back, then a lifecycle event
 *   and a best-effort activity entry. Regenerating therefore adds a
 *   version instead of overwriting a document a party already holds.
 */

import {
  Document,
  Footer,
  Paragraph,
  Packer,
  Table,
  TableLayoutType,
  TableRow,
  TableCell,
  TextRun,
  WidthType,
} from "docx";

import { caseDateParts, caseTodayParts } from "../documents/caseDate.js";
import { letterheadTable, NO_BORDERS, run } from "../documents/letterhead.js";

/** Storage/filename labels. Stable: they are what the version number hangs off. */
export const SETTLEMENT_MASTER_LABEL = "Amicable-Settlement";
export const CFA_MASTER_LABEL = "Certificate-to-File-Action";

/** The statutory periods these two documents put on the face of the paper. */
export const SETTLEMENT_EFFECTIVENESS_DAYS = 10;
export const REPUDIATION_WINDOW_DAYS = 10;

/** Body face and size, matching the other programmatic barangay forms. */
const BODY_FONT = "Book Antiqua";
const BODY_SIZE = 24; // half-points -> 12pt

/** US Letter portrait, the paper the barangay actually prints on. */
const PAGE = { width: 12240, height: 15840 };
const MARGIN = { top: 720, right: 1440, bottom: 1080, left: 1440, header: 708, footer: 708 };
const CONTENT_WIDTH = PAGE.width - MARGIN.left - MARGIN.right; // 9360

/** The ruled line a wet signature lands on. */
const SIGNATURE_RULE = "__________________________";
const DATE_RULE = "______________";

/* ── Small typographic helpers ─────────────────────────────────── */

/** A paragraph in the body face. Newlines become real line breaks. */
function line(
  text,
  { before = 0, after = 0, align = "left", indent = 0, bold = false, italic = false, keepNext = false } = {},
) {
  const lines = String(text ?? "").split(/\r\n|\r|\n/);
  const children = [];
  lines.forEach((value, index) => {
    if (index > 0) children.push(new TextRun({ break: 1 }));
    children.push(run(value, { bold, italic }));
  });
  const options = { children, spacing: { before, after } };
  if (align !== "left") options.alignment = align;
  if (indent) options.indent = { left: indent };
  if (keepNext) options.keepNext = true;
  return new Paragraph(options);
}

/** The centred, bold document title under the letterhead. */
function title(text) {
  return line(text, { align: "center", bold: true, after: 360 });
}

/** A labelled heading inside the body, e.g. "TERMS AND CONDITIONS". */
function heading(text) {
  return line(text, { bold: true, before: 240, after: 120, keepNext: true });
}

/** The lower-right block: name ruled underneath, then the office title. */
function attestationBlock({ name, role }) {
  return [
    line("ATTESTED BY:", { bold: true, before: 360, after: 240, keepNext: true }),
    line(name || role || "", { bold: true, after: 0, keepNext: true }),
    line(SIGNATURE_RULE, { after: 0 }),
    line(role || "", { italic: true, after: 360 }),
  ];
}

/**
 * The party signature row: two ruled lines with their captions, side by
 * side, so both parties sign the same instrument on the same page.
 */
function partySignatures({ complainant, respondent, dateLine }) {
  const half = Math.floor(CONTENT_WIDTH / 2);
  const signCell = (caption, name) =>
    new TableCell({
      width: { size: half, type: WidthType.DXA },
      children: [
        line(name || "", { after: 0 }),
        line(SIGNATURE_RULE, { after: 0 }),
        line(caption, { italic: true, after: 240 }),
      ],
    });

  return new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    layout: TableLayoutType.FIXED,
    columnWidths: [half, CONTENT_WIDTH - half],
    margins: { top: 0, bottom: 0, left: 0, right: 0 },
    borders: NO_BORDERS,
    rows: [
      new TableRow({
        children: [
          signCell("Complainant", complainant),
          signCell("Respondent", respondent),
        ],
      }),
      new TableRow({
        children: [
          new TableCell({
            width: { size: half, type: WidthType.DXA },
            children: [line(`Date signed: ${dateLine || DATE_RULE}`, { after: 0 })],
          }),
          new TableCell({
            width: { size: CONTENT_WIDTH - half, type: WidthType.DXA },
            children: [line(`Date signed: ${dateLine || DATE_RULE}`, { after: 0 })],
          }),
        ],
      }),
    ],
  });
}

/** The closing "IN WITNESS WHEREOF" clause with its place and date. */
function witnessClause({ dayLine, place = "Barangay Abuno, City of Iligan" }) {
  return line(
    `IN WITNESS WHEREOF, we have hereunto set our hands this ${dayLine} at ${place}, Philippines.`,
    { before: 360, after: 240 },
  );
}

/* ── Document bodies ───────────────────────────────────────────── */

/**
 * The Amicable Settlement: who settled with whom, the terms as stored,
 * the two signatures, the attestation, and the two statutory consequences
 * (force of a judgment after ten days; repudiation inside ten days).
 *
 * @param {object} data
 * @returns {Promise<Blob>}
 */
export async function renderAmicableSettlement(data = {}) {
  const children = [];

  const { loadLetterheadArt } = await import("../reklamo/letterheadArt.js");
  children.push(letterheadTable(await loadLetterheadArt()));

  // Breathing room under the letterhead; the other forms reserve the same
  // spacer so the title sits at the same height on the page.
  children.push(new Paragraph({ spacing: { before: 0, after: 0 } }));
  children.push(new Paragraph({ spacing: { before: 0, after: 0 } }));

  children.push(title("AMICABLE SETTLEMENT"));

  if (data.caseNumber) {
    children.push(line(`Barangay Case No. ${data.caseNumber}`, { align: "center", after: 240 }));
  }

  children.push(line("KNOW ALL MEN BY THESE PRESENTS:", { bold: true, after: 240 }));

  children.push(
    line(
      "That this is to record the amicable settlement reached by the parties in the dispute " +
        "filed before the Lupon Tagapamayapa of Barangay Abuno, City of Iligan, and conciliated " +
        "under the Katarungang Pambarangay provisions of Republic Act No. 7160, otherwise known " +
        "as the Local Government Code of 1991.",
      { after: 240 },
    ),
  );

  children.push(heading("BETWEEN:"));
  children.push(line(data.complainant || "", { after: 0 }));
  children.push(line(data.complainantAddress || "", { italic: true, after: 120 }));
  children.push(line("Complainant", { bold: true, after: 240 }));

  children.push(line("- versus -", { align: "center", after: 240 }));

  children.push(heading("AND:"));
  children.push(line(data.respondent || "", { after: 0 }));
  children.push(line(data.respondentAddress || "", { italic: true, after: 120 }));
  children.push(line("Respondent", { bold: true, after: 240 }));

  children.push(
    line(
      `The parties, having voluntarily agreed to settle the dispute, hereby set out the terms ` +
        `of their settlement signed on ${data.signedOn}.`,
      { after: 120 },
    ),
  );

  children.push(heading("TERMS AND CONDITIONS:"));
  if (data.termsLines.length > 1) {
    data.termsLines.forEach((term, index) => {
      children.push(line(`${index + 1}. ${term}`, { indent: 360, after: 120 }));
    });
  } else {
    children.push(line(data.termsLines[0] || "", { indent: 360, after: 120 }));
  }

  children.push(witnessClause({ dayLine: data.issueDayLine }));

  children.push(
    partySignatures({
      complainant: data.complainant,
      respondent: data.respondent,
      dateLine: data.signedOnDate,
    }),
  );

  children.push(...attestationBlock({ name: data.attestedByName, role: data.attestedByRole }));

  children.push(
    line(
      `This settlement was signed on ${data.signedOn}. It shall be deemed fulfilled and shall ` +
        `have the force and effect of a judgment of a court of law upon the expiration of ` +
        `${SETTLEMENT_EFFECTIVENESS_DAYS} (ten) days therefrom, or on ${data.effectivenessDate}, ` +
        `unless repudiated by either party within the same period on the grounds of fraud, ` +
        `violence or intimidation.`,
      { before: 120, after: 240 },
    ),
  );

  children.push(line("Issued:", { bold: true, after: 0 }));
  children.push(line(`Date: ${data.issueDateLine}`));
  children.push(line(`Prepared by: ${data.preparedBy}`, { after: 0 }));

  return pack(children);
}

/**
 * The Certificate to File Action: what was filed, that conciliation was
 * attempted and failed, the reason on record, and the release that lets
 * the complainant go to court.
 *
 * @param {object} data
 * @returns {Promise<Blob>}
 */
export async function renderCertificateToFileAction(data = {}) {
  const children = [];

  const { loadLetterheadArt } = await import("../reklamo/letterheadArt.js");
  children.push(letterheadTable(await loadLetterheadArt()));

  children.push(new Paragraph({ spacing: { before: 0, after: 0 } }));
  children.push(new Paragraph({ spacing: { before: 0, after: 0 } }));

  children.push(title("CERTIFICATE TO FILE ACTION"));

  if (data.caseNumber) {
    children.push(line(`Barangay Case No. ${data.caseNumber}`, { align: "center", after: 240 }));
  }

  children.push(line("TO WHOM IT MAY CONCERN:", { bold: true, after: 240 }));

  children.push(
    line(
      "This is to certify that a complaint was filed by " +
        `${data.complainant} against ${data.respondent} before the Lupon Tagapamayapa of ` +
        "Barangay Abuno, City of Iligan, and docketed as " +
        `${data.caseNumber ? `Barangay Case No. ${data.caseNumber}` : "the case referenced above"}` +
        ", over which the parties were duly called for conciliation.",
      { after: 240 },
    ),
  );

  children.push(
    line(
      "That the parties appeared and were heard by the Lupon Tagapamayapa / Pangkat " +
        "Tagapagkasundo, and that despite every effort at conciliation the parties have failed " +
        "to amicably settle the dispute.",
      { after: 240 },
    ),
  );

  if (data.proceedingsLine) {
    children.push(line(`Proceedings: ${data.proceedingsLine}`, { after: 240 }));
  }

  children.push(heading("GROUNDS FOR ISSUANCE:"));
  children.push(line(data.reason || "", { indent: 360, after: 240 }));

  children.push(
    line(
      "WHEREFORE, this Certificate is issued to the complainant to enable the party who " +
        "initiated the proceeding to file the case in the proper court, pursuant to Section " +
        "416 (c) in relation to Section 418 of Republic Act No. 7160, otherwise known as the " +
        "Local Government Code of 1991.",
      { after: 360 },
    ),
  );

  children.push(
    line(`ISSUED this ${data.issueDayLine} at Barangay Abuno, City of Iligan, Philippines.`, {
      after: 240,
    }),
  );

  children.push(...attestationBlock({ name: data.attestedByName, role: data.attestedByRole }));

  children.push(line(`Date issued: ${data.issueDateLine}`, { before: 120, after: 0 }));
  children.push(line(`Prepared by: ${data.preparedBy}`, { after: 0 }));

  return pack(children);
}

/** Assemble the sections into a Blob in the face the printed forms use. */
function pack(children) {
  const doc = new Document({
    styles: { default: { document: { run: { font: BODY_FONT, size: BODY_SIZE } } } },
    sections: [
      {
        properties: {
          page: { size: { width: PAGE.width, height: PAGE.height }, margin: MARGIN },
        },
        children,
        footers: { default: new Footer({ children: [new Paragraph({ children: [run("")] })] }) },
      },
    ],
  });
  return Packer.toBlob(doc);
}

/* ── Data assembly ─────────────────────────────────────────────── */

/** "October 15, 2026" for the body prose. */
function longDate(value) {
  const parts = caseDateParts(value);
  if (!parts) return "";
  return `${parts.month} ${Number(parts.day)}, ${parts.year}`;
}

function ordinalSuffix(value) {
  const suffixes = ["th", "st", "nd", "rd"];
  const mod100 = value % 100;
  if (mod100 >= 11 && mod100 <= 13) return "th";
  const mod10 = value % 10;
  return suffixes[mod10] || "th";
}

/** `settlement_terms` as the lines the document will print. */
function termsLines(terms) {
  const lines = String(terms || "")
    .split(/\r\n|\r|\n/)
    .map((value) => value.trim())
    .filter(Boolean);
  return lines.length ? lines : ["(No terms were recorded for this settlement.)"];
}

/**
 * Who attested, by name.
 *
 * The resolution stores the attester's id and the role they attested as.
 * The name is resolved from the signed-in official or from the panel
 * (which carries `profiles.display_name`) so the paper never prints a
 * uuid; failing both, the role itself is printed rather than "undefined".
 */
function resolveAttester({ resolution, luponPanels = [], user }) {
  const role = resolution?.attestation_role || "";
  const id = resolution?.attested_by || null;

  if (id) {
    if (user?.id === id && user?.display_name) {
      return { name: user.display_name, role };
    }
    const member = (luponPanels || []).find((row) => row?.member_id === id);
    const name = member?.profiles?.display_name;
    if (name) return { name, role };
  }

  // Fall back to whoever holds the role: the chair of the constituted
  // panel, or the official pressing the button.
  if (role === "Pangkat Chairperson") {
    const chair = (luponPanels || []).find(
      (row) => row?.status === "active" && row?.role === "chairperson",
    );
    if (chair?.profiles?.display_name) return { name: chair.profiles.display_name, role };
  }
  if (user?.display_name) return { name: user.display_name, role };
  return { name: "", role };
}

/** The dates a resolution's document is dated from, all in Manila. */
function resolutionDates(resolution, now) {
  const issued = caseTodayParts(now || new Date());
  // caseDateParts/caseTodayParts return a month NAME, so the prose date is
  // composed straight from the parts rather than round-tripped through a
  // string that caseDateParts would not recognise.
  const issueDateLine = issued
    ? `${issued.month} ${Number(issued.day)}, ${issued.year}`
    : "";
  const issueDayLine = issued
    ? `${Number(issued.day)}${ordinalSuffix(Number(issued.day))} day of ${issued.month} ${issued.year}`
    : "";

  const signed = resolution?.settlement_date ? caseDateParts(resolution.settlement_date) : null;
  const signedOn = signed ? longDate(resolution.settlement_date) : "";
  const signedOnDate = signed ? `${signed.month} ${Number(signed.day)}, ${signed.year}` : "";

  const effectiveness = plusDays(resolution?.settlement_date, SETTLEMENT_EFFECTIVENESS_DAYS);

  return {
    issueDateLine,
    issueDayLine,
    signedOn: signedOn || "the date given",
    signedOnDate,
    effectivenessDate: effectiveness ? longDate(effectiveness) : "",
  };
}

/** A `YYYY-MM-DD` string plus whole days — no timezone can shift the day. */
function plusDays(iso, days) {
  if (!iso) return null;
  const parsed = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

/* ── Persistence ───────────────────────────────────────────────── */

/**
 * Store a generated case document.
 *
 * Identical contract to `generateNoticeOfHearingProgrammatic`: version from
 * nextDocumentVersion(), `upsert: false`, rollback the uploaded file when the
 * insert fails, then a lifecycle event and a best-effort activity entry.
 *
 * Exported so the template-driven Amicable Settlement
 * (amicableSettlementForm.js) stores through exactly this path: one version
 * series per document type per case, never a silent overwrite of a file a
 * party already holds.
 *
 * @returns {Promise<{success: boolean, document?: object, error?: string}>}
 */
export async function persistCaseDocument(
  supabase,
  {
    complaint,
    user,
    documentType,
    label,
    title: docTitle,
    blob,
    documents = [],
    contentSnapshot = {},
    activityAction,
    activityDetails = {},
    notify = null,
  },
) {
  const { caseDocumentFileName, caseDocumentStoragePath, DOCX_MIME, nextDocumentVersion } =
    await import("../documents/docxTemplate.js");

  const version = nextDocumentVersion(documents, documentType);
  const filename = caseDocumentFileName(complaint, `${label}-v${version}`);
  const storagePath = caseDocumentStoragePath(complaint, `${label}-v${version}`);

  const { error: uploadError } = await supabase.storage
    .from("documents")
    .upload(storagePath, blob, { contentType: DOCX_MIME, upsert: false });
  if (uploadError) throw uploadError;

  const { data: docInsert, error: docError } = await supabase
    .from("official_documents")
    .insert({
      complaint_id: complaint.id,
      document_type: documentType,
      title: docTitle,
      filename,
      storage_path: storagePath,
      mime_type: DOCX_MIME,
      file_size: blob.size,
      // The complainant is named on the face of both of these, so their copy
      // must not depend on how the document was made: same visibility the
      // Notice of Hearing already uses.
      visibility: "resident_visible",
      status: "active",
      version,
      generated_at: new Date().toISOString(),
      generated_by: user?.id || null,
      content_snapshot: { master_template: "programmatic", ...contentSnapshot },
      uploaded_by: user?.id || null,
    })
    .select("id")
    .single();

  if (docError) {
    // Nothing in the case file points at this file: do not leave it behind.
    await supabase.storage.from("documents").remove([storagePath]);
    throw docError;
  }

  if (docInsert?.id) {
    await supabase.from("document_lifecycle_events").insert({
      document_id: docInsert.id,
      complaint_id: complaint.id,
      event_type: "prepared",
      actor_id: user?.id || null,
      notes: `${docTitle} generated.`,
    });
  }

  await logActivity(supabase, {
    action: activityAction,
    complaintId: complaint.id,
    ref: complaint.reference_number || undefined,
    details: { title: docTitle, version, document_type: documentType, ...activityDetails },
  });

  if (notify) {
    try {
      const { notifyResident } = await import("../complaintQueries.js");
      await notifyResident(supabase, complaint.id, complaint.resident_id, notify);
    } catch {
      // Non-fatal: the document is already stored and visible.
    }
  }

  return { success: true, document: docInsert };
}

async function logActivity(supabase, payload) {
  try {
    const { logComplaintActivity } = await import("../complaintQueries.js");
    await logComplaintActivity(supabase, payload);
  } catch {
    // Best effort, exactly as the other generators treat it.
  }
}

/* ── The two public entry points ───────────────────────────────── */

/**
 * Generate and store the Amicable Settlement for a recorded settlement.
 *
 * @returns {Promise<{success: boolean, document?: object, error?: string}>}
 */
export async function generateAmicableSettlement(
  supabase,
  { complaint, user, resolution, luponPanels = [], documents = [], now } = {},
) {
  if (!complaint?.id) {
    return { success: false, error: "This complaint could not be identified." };
  }
  if (!resolution?.settlement_date) {
    return {
      success: false,
      error: "Record the settlement terms and the date both parties signed first.",
    };
  }
  if (!String(resolution.settlement_terms || "").trim()) {
    return { success: false, error: "Record the terms of the settlement first." };
  }

  try {
    const {
      resolveComplainantName,
      resolveDocumentComplainantAddressLine1,
      resolveDocumentComplainantAddressLine2,
      resolveDocumentRespondentName,
      resolveDocumentRespondentAddressLine1,
    } = await import("../../components/captain/complaints/complaintMeta.js");

    const dates = resolutionDates(resolution, now);
    const attester = resolveAttester({ resolution, luponPanels, user });

    const data = {
      caseNumber: complaint.barangay_case_number || complaint.reference_number || "",
      complainant: resolveComplainantName(complaint),
      complainantAddress: [
        resolveDocumentComplainantAddressLine1(complaint),
        resolveDocumentComplainantAddressLine2(complaint),
      ]
        .filter(Boolean)
        .join(", "),
      respondent: resolveDocumentRespondentName(complaint),
      respondentAddress: resolveDocumentRespondentAddressLine1(complaint) || "",
      termsLines: termsLines(resolution.settlement_terms),
      attestedByName: attester.name,
      attestedByRole: attester.role,
      preparedBy: user?.display_name || attester.name || attester.role || "",
      ...dates,
    };

    const blob = await renderAmicableSettlement(data);

    return await persistCaseDocument(supabase, {
      complaint,
      user,
      documentType: "settlement",
      label: SETTLEMENT_MASTER_LABEL,
      title: "Amicable Settlement",
      blob,
      documents,
      contentSnapshot: {
        case_number: data.caseNumber,
        complainant: data.complainant,
        respondent: data.respondent,
        settlement_date: resolution.settlement_date,
        effectiveness_date: plusDays(resolution.settlement_date, SETTLEMENT_EFFECTIVENESS_DAYS),
        repudiation_deadline: plusDays(resolution.settlement_date, REPUDIATION_WINDOW_DAYS),
        attestation_role: resolution.attestation_role || null,
        attested_by: resolution.attested_by || null,
        // One instrument, two copies owed from this single generation.
        issued_to: ["complainant", "respondent"],
        terms: resolution.settlement_terms,
        printed_on: dates.issueDateLine,
      },
      activityAction: "amicable_settlement_generated",
      activityDetails: { settlement_date: resolution.settlement_date },
      notify: {
        type: "document",
        title: "Amicable Settlement available",
        message:
          "The Amicable Settlement for this case is ready to view and download. A copy is issued to both parties.",
      },
    });
  } catch (err) {
    return {
      success: false,
      error: "The Amicable Settlement could not be generated.",
      detail: String(err?.message || err),
    };
  }
}

/**
 * Generate and store the Certificate to File Action for a failed
 * conciliation.
 *
 * @returns {Promise<{success: boolean, document?: object, error?: string}>}
 */
export async function generateCertificateToFileAction(
  supabase,
  { complaint, user, resolution, luponPanels = [], documents = [], hearings = [], now } = {},
) {
  if (!complaint?.id) {
    return { success: false, error: "This complaint could not be identified." };
  }
  if (!resolution?.cfa_required) {
    return {
      success: false,
      error: "Record that conciliation failed before releasing the certificate.",
    };
  }
  if (!String(resolution.cfa_reason || "").trim()) {
    return { success: false, error: "Record why conciliation failed first." };
  }

  try {
    const {
      resolveComplainantName,
      resolveDocumentRespondentName,
    } = await import("../../components/captain/complaints/complaintMeta.js");

    const dates = resolutionDates(resolution, now);
    const attester = resolveAttester({ resolution, luponPanels, user });

    // The hearings actually held, as the span the Lupon sat over. Read from
    // the stored sessions so the certificate describes what happened rather
    // than asserting a hearing that was never recorded.
    const held = (hearings || [])
      .filter((row) => row && row.status !== "Cancelled" && row.hearing_date)
      .map((row) => row.hearing_date)
      .sort();
    const proceedingsLine =
      held.length === 0
        ? ""
        : held.length === 1
          ? `One session held on ${longDate(held[0])}.`
          : `${held.length} sessions held from ${longDate(held[0])} to ${longDate(
              held[held.length - 1],
            )}.`;

    const data = {
      caseNumber: complaint.barangay_case_number || complaint.reference_number || "",
      complainant: resolveComplainantName(complaint),
      respondent: resolveDocumentRespondentName(complaint),
      reason: resolution.cfa_reason,
      proceedingsLine,
      attestedByName: attester.name,
      attestedByRole: attester.role,
      preparedBy: user?.display_name || attester.name || attester.role || "",
      ...dates,
    };

    const blob = await renderCertificateToFileAction(data);

    return await persistCaseDocument(supabase, {
      complaint,
      user,
      documentType: "certificate_to_file_action",
      label: CFA_MASTER_LABEL,
      title: "Certificate to File Action",
      blob,
      documents,
      contentSnapshot: {
        case_number: data.caseNumber,
        complainant: data.complainant,
        respondent: data.respondent,
        cfa_reason: resolution.cfa_reason,
        cfa_issued_at: resolution.cfa_issued_at || new Date().toISOString(),
        proceedings: proceedingsLine || null,
        attested_by: resolution.attested_by || null,
        issued_to: ["complainant"],
        printed_on: dates.issueDateLine,
      },
      activityAction: "certificate_to_file_action_generated",
      activityDetails: { issued_at: resolution.cfa_issued_at || null },
      notify: {
        type: "document",
        title: "Certificate to File Action available",
        message:
          "Your Certificate to File Action is ready to view and download. It lets you file the case with the proper court.",
      },
    });
  } catch (err) {
    return {
      success: false,
      error: "The Certificate to File Action could not be generated.",
      detail: String(err?.message || err),
    };
  }
}
