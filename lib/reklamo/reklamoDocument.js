import { formHeaderLines, FORM_HEADER_LINES } from "../documents/printedForm.js";
import { officialSignatureFor } from "../documents/officialSignature.js";

export { FORM_HEADER_LINES, formHeaderLines };

export const SUBMISSION_RECEIPT_TYPE = "submission_receipt";
export const REKLAMO_FORM_TYPE = "reklamo_form";
export const SIGNED_REKLAMO_TYPE = "signed_reklamo_form";

export const DOCUMENT_STATUS = {
  PENDING_REVIEW: "pending_review",
  DRAFT: "draft",
  FOR_SIGNATURE: "for_signature",
  OFFICIALLY_RECEIVED: "officially_received",
  SIGNED_AND_FILED: "signed_and_filed",
};

export const DOCUMENT_STATUS_LABELS = {
  [DOCUMENT_STATUS.PENDING_REVIEW]: "Pending review",
  [DOCUMENT_STATUS.DRAFT]: "Draft — not yet officially received",
  [DOCUMENT_STATUS.FOR_SIGNATURE]: "Awaiting wet signature",
  [DOCUMENT_STATUS.OFFICIALLY_RECEIVED]: "Officially received",
  [DOCUMENT_STATUS.SIGNED_AND_FILED]: "Signed and filed",
};

export const DOCUMENT_TYPE_LABELS = {
  [SUBMISSION_RECEIPT_TYPE]: "Submission Copy",
  [REKLAMO_FORM_TYPE]: "Reklamo Form",
  [SIGNED_REKLAMO_TYPE]: "Signed Reklamo Form",
};

export const SUBMISSION_RECEIPT_TITLE = "Submission Copy — Pending Barangay Review";
export const REKLAMO_FORM_TITLE = "Reklamo Form — Officially Received";
export const REKLAMO_SUBMITTED_TITLE = "Reklamo Form — Submitted by Resident";
export const SIGNED_REKLAMO_TITLE = "Reklamo Form — Signed and Filed";

export const WATERMARK_RECEIPT = "SUBMITTED — NOT YET RECEIVED";
export const WATERMARK_FORM = "OFFICIALLY RECEIVED";
export const WATERMARK_SIGNED = "SIGNED COPY — FILED";

export const SIGNED_COPY_MAX_BYTES = 10 * 1024 * 1024;

export const SIGNED_COPY_MIME_TYPES = ["application/pdf", "image/jpeg", "image/png"];

export const SIGNED_COPY_EXTENSIONS = ["pdf", "jpg", "jpeg", "png"];

export const SIGNED_COPY_ACCEPT = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  ".pdf",
  ".jpg",
  ".jpeg",
  ".png",
].join(",");

export const ABSENT = "—";

export function officialRoles() {
  return ["captain", "oic", "secretary"];
}

export function isOfficialRole(role) {
  return officialRoles().includes(role);
}

export function isOfficiallyReceived(complaint) {
  return Boolean(complaint && complaint.barangay_case_number && complaint.official_received_at);
}

function isPresent(value) {
  return value !== null && value !== undefined && String(value).trim() !== "";
}

export function displayValue(value) {
  return isPresent(value) ? String(value).trim() : ABSENT;
}

export function formatDocumentDate(value) {
  if (!value) return ABSENT;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return ABSENT;
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function formatDocumentDateTime(value) {
  if (!value) return ABSENT;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return ABSENT;
  return date.toLocaleString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function complaintStoragePath(complaintId, folder, fileName) {
  return `complaints/${complaintId}/${folder}/${fileName}`;
}

export function receiptFileName(referenceNumber) {
  const safeRef = String(referenceNumber || "pending").replace(/[^A-Za-z0-9-]/g, "");
  return `submission-copy-${safeRef}.pdf`;
}

export function receiptFolder() {
  return "receipts";
}

export function reklamoFolder() {
  return "reklamo";
}

export function signedCopyFolder() {
  return "reklamo-signed";
}

export function reklamoFileName(barangayCaseNumber, version) {
  const safeCase = String(barangayCaseNumber || "pending").replace(/[^A-Za-z0-9-]/g, "");
  return `reklamo-form-${safeCase}-v${version}.pdf`;
}

/**
 * The identifier a Reklamo DOCX file name is built from: the Barangay Case
 * Number once one has been assigned, otherwise the tracking reference number.
 * This labels the stored FILE only - the reference number is never printed.
 */
export function reklamoDocxFileIdentifier(complaint) {
  return complaint?.barangay_case_number || complaint?.reference_number || "pending";
}

/**
 * The generated master-template DOCX for one case and version, e.g.
 * "reklamo-form-AB-2026-0002-v3.docx". The version is part of the name so a
 * regenerated form is a new file rather than an overwrite of the one already
 * handed to the parties.
 */
export function reklamoFormDocxFileName(barangayCaseNumber, version) {
  const safeCase = String(barangayCaseNumber || "pending").replace(/[^A-Za-z0-9-]/g, "");
  return `reklamo-form-${safeCase}-v${version}.docx`;
}

export function signedCopyFileName(barangayCaseNumber, version) {
  const safeCase = String(barangayCaseNumber || "pending").replace(/[^A-Za-z0-9-]/g, "");
  return `signed-reklamo-${safeCase}-v${version}.pdf`;
}

export function nextReklamoVersion(documents) {
  const versions = (documents || [])
    .filter((doc) => doc.document_type === REKLAMO_FORM_TYPE)
    .map((doc) => Number(doc.version) || 1);
  return versions.length ? Math.max(...versions) + 1 : 1;
}

export function pickDocument(documents, documentType, { newest = true } = {}) {
  const matches = (documents || [])
    .filter((doc) => doc.document_type === documentType)
    .sort((a, b) => {
      const byVersion = (Number(b.version) || 1) - (Number(a.version) || 1);
      if (byVersion !== 0) return byVersion;
      return new Date(b.generated_at || b.created_at || 0) - new Date(a.generated_at || a.created_at || 0);
    });
  if (!matches.length) return null;
  return newest ? matches[0] : matches[matches.length - 1];
}

export function findReklamoBundle(documents) {
  const list = documents || [];
  const form = pickDocument(list, REKLAMO_FORM_TYPE);
  if (!form) return null;
  const version = Number(form.version) || 1;
  const signed = list.find(
    (doc) => doc.document_type === SIGNED_REKLAMO_TYPE && (Number(doc.version) || 1) === version
  );
  return { form, signed: signed || null, version };
}

export function signedCopyValidationError(file) {
  if (!file) return "No file selected.";
  const name = String(file.name || "").toLowerCase();
  const hasAllowedExtension = SIGNED_COPY_EXTENSIONS.some((ext) => name.endsWith(`.${ext}`));
  if (!SIGNED_COPY_MIME_TYPES.includes(file.type) && !hasAllowedExtension) {
    return "Signed copy must be a PDF, JPG, or PNG file.";
  }
  if (file.size > SIGNED_COPY_MAX_BYTES) {
    return "Signed copy must be 10 MB or smaller.";
  }
  if (file.size === 0) return "Signed copy is empty.";
  return null;
}

function splitList(value) {
  if (!isPresent(value)) return [];
  return String(value)
    .split(/\r?\n|;/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function respondentLines(complaint) {
  const explicit = splitList(complaint?.persons_involved);
  if (explicit.length) return explicit;
  if (!isPresent(complaint?.description)) return [];
  const firstSentence = String(complaint.description).split(/(?<=[.!?])\s+/)[0];
  return firstSentence ? [firstSentence.trim()] : [];
}

export function buildReklamoFieldModel({
  complaint = {},
  complainant = {},
  officialName = "",
  officialProfile = null,
  respondentLines: respondentOverride,
  now,
} = {}) {
  const timestamp = now ? new Date(now) : new Date();
  const isReceived = isOfficiallyReceived(complaint);
  const caseNumber = isReceived ? complaint.barangay_case_number : null;
  const respondents = respondentOverride ? splitList(respondentOverride) : respondentLines(complaint);
  const signature = officialSignatureFor(officialProfile);

  const narrative = isPresent(complaint.description) ? String(complaint.description).trim() : "";
  const narrativeParagraphs = narrative
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);

  return {
    kind: isReceived ? REKLAMO_FORM_TYPE : SUBMISSION_RECEIPT_TYPE,
    watermark: isReceived ? WATERMARK_FORM : WATERMARK_RECEIPT,
    isReceived,
    trackingNumber: displayValue(complaint.reference_number),
    caseNumber: caseNumber ? String(caseNumber) : null,
    trackingNumberLabel: caseNumber ? "Case No." : "Tracking No.",
    generatedAt: timestamp,
    generatedAtLabel: formatDocumentDate(timestamp),
    receivedAt: isReceived ? complaint.official_received_at : null,
    receivedAtLabel: isReceived ? formatDocumentDateTime(complaint.official_received_at) : null,
    receivedByLabel: isReceived ? displayValue(officialName) : null,
    signature,
    version: Number(complaint.version) || 1,
    complainant: {
      name: displayValue(complainant.name),
      contact: displayValue(complainant.contact),
      address: displayValue(complainant.address),
    },
    respondents,
    respondentLabel: respondents.length > 1 ? "(Mga) Sinumbong" : "Sinumbong",
    complainantCountLabel: "(Mga) Nagsumbong: 1",
    narrativeParagraphs: narrativeParagraphs.length ? narrativeParagraphs : [ABSENT],
    incident: {
      date: displayValue(complaint.incident_date),
      time: displayValue(complaint.incident_time),
      location: displayValue(complaint.incident_location),
    },
    personsInvolved: splitList(complaint.persons_involved),
    witnesses: splitList(complaint.witnesses),
    desiredRelief: displayValue(complaint.desired_relief),
    evidenceCount: Number(complaint.evidence_count) || 0,
    category: displayValue(complaint.official_category || complaint.predicted_category),
    urgency: displayValue(complaint.official_urgency || complaint.predicted_urgency),
  };
}

export function reklamoSnapshotFromModel(model) {
  return {
    tracking_number: model.trackingNumber,
    barangay_case_number: model.caseNumber,
    is_officially_received: model.isReceived,
    signed_by: model.signature?.name || null,
    signed_by_title: model.signature?.title || null,
    complainant: model.complainant,
    respondents: model.respondents,
    narrative: model.narrativeParagraphs,
    incident: model.incident,
    persons_involved: model.personsInvolved,
    witnesses: model.witnesses,
    desired_relief: model.desiredRelief,
    evidence_count: model.evidenceCount,
    category: model.category,
    urgency: model.urgency,
    version: model.version,
  };
}

export function sectionTitle(text) {
  return String(text || "").toUpperCase();
}

export { displayValue as safeDocumentValue };
