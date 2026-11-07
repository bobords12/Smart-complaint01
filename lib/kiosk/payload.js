/**
 * Turns wizard state into a submission payload.
 *
 * Browser-supplied classification is never used for filing: the server
 * predicts when an online kiosk submission or queued retry reaches the
 * existing idempotent RPC, then stores the granular suggestion separately.
 */

import { classifyComplaint, MODEL_VERSION } from "@/lib/aiClassifier";
import { MAX_EVIDENCE_FILES } from "./config";
import { newClientSubmissionId, newDraftReference, newStatusToken } from "./tokens";
import { normalizeMobile } from "./validation";

const CASE_TYPES = new Set(["Criminal", "Civil", "Administrative"]);
const URGENCIES = new Set(["Critical", "High", "Normal"]);

/** True when a boolean-ish form field was answered yes. */
function yes(value) {
  return value === "yes";
}

/** "09:30" from the time input, normalised for Postgres `time`. */
function incidentTime(value) {
  if (!value) return null;
  const [hours, minutes] = String(value).split(":");
  if (hours === undefined || minutes === undefined) return null;
  return `${hours.padStart(2, "0")}:${minutes.padStart(2, "0")}:00`;
}

/**
 * The complainant snapshot stored on the complaint.
 *
 * Built from the form, never from a session. `filing_mode: guest`
 * records that the citizen chose not to look up an account, which is
 * a normal path and must not read as a failure.
 *
 * The keys are FLAT and match kiosk_submit_complaint exactly:
 * first_name, middle_name, last_name, suffix, mobile_number,
 * house_street, purok, filing_mode. That is not cosmetic.
 * public.kiosk_submit_complaint rebuilds the snapshot from those
 * seven keys and drops everything else, and serverApi's
 * requireShortObject() refuses to forward nested objects at all, so
 * a nested `address: { house_street }` would be discarded twice over
 * and `complainant_snapshot->>'mobile_number'` would be NULL.
 * kiosk_status_lookup() compares exactly that column, so a nested
 * shape would break manual status search for every kiosk complaint.
 *
 * barangay and city are deliberately NOT sent. The function hardcodes
 * them to Abuno / Iligan City, which is the same thing
 * LOCATION_DEFAULTS says, so sending them could only ever disagree
 * with the database.
 */
function complainantSnapshot(form) {
  const c = form.complainant;
  return {
    first_name: c.firstName || "",
    middle_name: c.middleName || "",
    last_name: c.lastName || "",
    suffix: c.suffix || "",
    mobile_number: normalizeMobile(c.mobile),
    house_street: c.houseStreet || "",
    purok: c.purok || "",
    filing_mode: form.filingMode || "guest",
  };
}

/** Advisory classification, tolerant of a classifier failure. */
export function adviseClassification(narrative) {
  try {
    const result = classifyComplaint(narrative);
    if (!result) return null;

    const caseType = CASE_TYPES.has(result.caseType) ? result.caseType : null;
    const urgency = URGENCIES.has(result.urgencyLevel) ? result.urgencyLevel : null;
    const raw = Number(result.confidence);

    return {
      predictedCategory: caseType,
      predictedCaseType: caseType,
      predictedUrgency: urgency,
      // 0-100 in the classifier, 0-1 in the column.
      predictionConfidence:
        Number.isFinite(raw) && raw > 0
          ? Math.min(1, Math.max(0, raw / 100))
          : null,
      predictionModel: MODEL_VERSION,
      recommendedAction: result.recommendedAction ?? null,
    };
  } catch (error) {
    // A classifier problem must never cost a citizen their filing.
    console.warn("[kiosk] classification unavailable:", error);
    return null;
  }
}

/**
 * Builds the full request body for /api/kiosk/submit.
 *
 * @param {object} form        Wizard state.
 * @param {Array}  [evidence]  Files the phone delivered, already
 *                             confirmed present by the status RPC.
 * @param {object} [options]
 * @param {boolean} [options.offline]  Mark as a replayed queue entry.
 * @param {string}  [options.queuedAt]
 * @param {string}  [options.fingerprint]
 * @param {string}  [options.clientSubmissionId] Reuse on a retry.
 * @param {string}  [options.draftReference]
 * @param {string}  [options.statusToken]
 * @returns {{ body: object, secrets: object }}
 */
export function buildSubmission(form, evidence = [], options = {}) {
  const clientSubmissionId = options.clientSubmissionId || newClientSubmissionId();
  const draftReference = options.draftReference || newDraftReference();
  const statusToken = options.statusToken || newStatusToken();

  // The server classifies on sync; an offline kiosk never needs the ML service.
  const advice = null;
  const now = new Date().toISOString();

  const body = {
    clientSubmissionId,
    fingerprint: options.fingerprint,
    statusToken,
    draftReference,
    complainantSnapshot: complainantSnapshot(form),
    otherPartyStatus: form.otherPartyStatus,
    respondentName: form.respondent.name || null,
    respondentAddress: form.respondent.address || null,
    respondentPurok: form.respondent.purok || null,
    respondentContact: form.respondent.contact || null,
    respondentRelationship: form.respondent.relationship || null,
    incidentDate: form.incident.date,
    incidentTime: incidentTime(form.incident.time),
    incidentLocation: form.incident.location,
    incidentPurok: form.incident.purok || null,
    incidentOngoing: yes(form.incident.ongoing),
    immediateSafety: yes(form.incident.immediateSafety),
    narrative: form.narrative,
    evidence: evidence.slice(0, MAX_EVIDENCE_FILES).map((file) => ({
      id: file.id,
      file_name: file.name || null,
      // Informational only. kiosk_submit_complaint re-derives this from
      // the stored mime_type, so a wrong value here cannot misfile
      // anything; it just keeps the request honest.
      evidence_type: String(file.mime_type || "").startsWith("image/")
        ? "photo"
        : "document",
      caption: null,
    })),
    privacyConsentAt: now,
    accuracyConfirmedAt: now,
    predictedCategory: advice?.predictedCategory ?? null,
    predictedCaseType: advice?.predictedCaseType ?? null,
    predictedUrgency: advice?.predictedUrgency ?? null,
    predictionConfidence: advice?.predictionConfidence ?? null,
    predictionModel: null,
    submittedOffline: options.offline === true,
    queuedAt: options.queuedAt || null,
  };

  return {
    body,
    // Kept out of `body` so a caller that logs the body does not log
    // the receipt's status token.
    secrets: { statusToken, draftReference, clientSubmissionId },
  };
}
