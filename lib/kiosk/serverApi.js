/**
 * Server-side access to the kiosk RPCs.
 *
 * Why a route handler at all, rather than calling Supabase from the
 * browser: the anon key must never be able to read the complaints
 * table, and the SECURITY DEFINER functions are the only thing
 * granted to it. Routing through the server also keeps the
 * `anon` role out of the browser entirely for writes.
 *
 * Two deliberate choices:
 *
 *  - The client is built WITHOUT cookies. createClient() in
 *    lib/supabase/server.ts forwards the visitor's session, which
 *    would make a kiosk submission act as whoever happened to be
 *    signed in on that machine. A kiosk complaint is anonymous by
 *    definition, so it must never inherit a resident session. This
 *    is the plain supabase-js client with no cookie adapter at all,
 *    which is a stronger statement of intent than a server client
 *    with deliberately empty cookie handlers.
 *  - Errors are translated, not relayed. Only the RAISE messages
 *    written in the kiosk SQL are passed through, because those are
 *    the ones authored to be read by a citizen. Everything else
 *    becomes a generic message and is logged server-side.
 *
 * Import only from route handlers.
 */

import { createClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { MODEL_VERSION } from "@/lib/classifier";
import { predictComplaint, savePrediction } from "@/lib/mlPrediction";

const RPC_TIMEOUT_MS = 15000;

/** An error that is safe to show the kiosk user. */
export class KioskError extends Error {
  constructor(message, { status = 400, code = "kiosk_error" } = {}) {
    super(message);
    this.name = "KioskError";
    this.status = status;
    this.code = code;
  }
}

/** Cookie-less anon client. Never carries a user session. */
function kioskClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      auth: { persistSession: false, autoRefreshToken: false },
    }
  );
}

async function withTimeout(promise, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new KioskError("The service took too long to respond.", { status: 504 })),
          RPC_TIMEOUT_MS
        );
      }),
    ]);
  } catch (error) {
    if (error instanceof KioskError) throw error;
    throw new KioskError(`Timeout while calling ${label}.`, { status: 504 });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Calls a kiosk RPC and returns its JSON result.
 *
 * Postgres raise_exception surfaces as code P0001 with our own
 * message. Anything else is a bug or an infrastructure fault, and is
 * logged rather than shown.
 */
async function callRpc(name, params) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    throw new KioskError(
      "Filing is not configured on this kiosk.",
      { status: 503, code: "not_configured" }
    );
  }

  const supabase = kioskClient();
  const { data, error } = await withTimeout(supabase.rpc(name, params), name);

  if (error) {
    if (error.code === "P0001") {
      // Our own RAISE, written to be citizen-facing.
      throw new KioskError(error.message, { status: 400, code: "rejected" });
    }
    if (error.code === "42501" || /permission denied/i.test(error.message || "")) {
      // The SQL has not been applied, or a GRANT is missing.
      console.error(`[kiosk] ${name} permission denied:`, error.message);
      throw new KioskError(
        "Filing is not available right now. Please ask staff for assistance.",
        { status: 503, code: "not_installed" }
      );
    }
    console.error(`[kiosk] ${name} failed:`, error.code, error.message, error.hint);
    throw new KioskError(
      "Filing is not available right now. Please ask staff for assistance.",
      { status: 503, code: "unavailable" }
    );
  }

  return data;
}

// ── Input guards ──────────────────────────────────────────────
// These are the first line of defence, not the last. The SQL
// re-validates everything, but a route handler should not forward
// an unbounded string to the database in the first place.

const FINGERPRINT = /^[0-9a-f]{8,64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUS_TOKEN = /^[0-9a-f]{64}$/;
const UPLOAD_TOKEN = /^[0-9a-f]{32}$/;
/**
 * Draft references come in two shapes and both are legitimate.
 *
 *  - The server-issued one (kiosk_create_upload_session) is 32
 *    lowercase hex characters with NO dashes — kiosk_new_token(1)
 *    strips the dashes from a UUID. This is the value that MUST
 *    reach kiosk_submit_complaint when evidence was uploaded,
 *    because step 10 of that function joins
 *    kiosk_upload_sessions.draft_reference = p_draft_reference to
 *    find the session whose files may be linked.
 *  - The client fallback (lib/kiosk/tokens.newDraftReference) is a
 *    dashed UUID, used when no upload session exists at all. It
 *    matches no session by design; it is only a local identifier.
 *
 * Accepting only the dashed form (the old requireUuid guard) made
 * the server-issued value a guaranteed 400 "Invalid draft
 * reference", so even a caller that did send the real session
 * reference — lib/kiosk/sync.js does — could never submit.
 */
const DRAFT_REFERENCE = /^[0-9a-f]{32}$|^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/;

export function requireString(value, field, { max = 500, min = 1 } = {}) {
  if (typeof value !== "string") {
    throw new KioskError(`Missing ${field}.`, { code: "invalid_input" });
  }
  const trimmed = value.trim();
  if (trimmed.length < min) {
    throw new KioskError(`Missing ${field}.`, { code: "invalid_input" });
  }
  if (trimmed.length > max) {
    throw new KioskError(`${field} is too long.`, { code: "invalid_input" });
  }
  // Strip control characters, matching public.kiosk_clean_text.
  const cleaned = trimmed.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
  if (!cleaned) {
    throw new KioskError(`Missing ${field}.`, { code: "invalid_input" });
  }
  return cleaned;
}

export function optionalString(value, field, { max = 500 } = {}) {
  if (value === null || value === undefined || value === "") return null;
  return requireString(value, field, { max });
}

export function requireFingerprint(value) {
  if (typeof value !== "string" || !FINGERPRINT.test(value)) {
    throw new KioskError("This kiosk session is not valid.", {
      status: 400,
      code: "invalid_fingerprint",
    });
  }
  return value;
}

export function requireUuid(value, field) {
  if (typeof value !== "string" || !UUID.test(value)) {
    throw new KioskError(`Invalid ${field}.`, { code: "invalid_input" });
  }
  return value;
}

export function requireDraftReference(value) {
  if (typeof value !== "string" || !DRAFT_REFERENCE.test(value)) {
    throw new KioskError("Invalid draft reference.", { code: "invalid_input" });
  }
  return value;
}

export function requireStatusToken(value) {
  if (typeof value !== "string" || !STATUS_TOKEN.test(value)) {
    throw new KioskError("Invalid tracking link.", {
      status: 400,
      code: "invalid_token",
    });
  }
  return value;
}

export function requireUploadToken(value) {
  if (typeof value !== "string" || !UPLOAD_TOKEN.test(value)) {
    throw new KioskError("This upload link is no longer valid.", {
      status: 400,
      code: "invalid_token",
    });
  }
  return value;
}

export function requireIsoDate(value, field) {
  if (typeof value !== "string" || !DATE.test(value)) {
    throw new KioskError(`Invalid ${field}.`, { code: "invalid_input" });
  }
  return value;
}

export function requireTime(value, field) {
  if (typeof value !== "string" || !TIME.test(value)) {
    throw new KioskError(`Invalid ${field}.`, { code: "invalid_input" });
  }
  // Postgres `time` wants HH:MM:SS when seconds are present.
  return value.length === 5 ? `${value}:00` : value;
}

export function requireBoolean(value, field) {
  if (typeof value !== "boolean") {
    throw new KioskError(`Invalid ${field}.`, { code: "invalid_input" });
  }
  return value;
}

export function requireOneOf(value, field, allowed) {
  if (!allowed.includes(value)) {
    throw new KioskError(`Invalid ${field}.`, { code: "invalid_input" });
  }
  return value;
}

export function requireIsoTimestamp(value, field) {
  if (typeof value !== "string") {
    throw new KioskError(`Invalid ${field}.`, { code: "invalid_input" });
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    throw new KioskError(`Invalid ${field}.`, { code: "invalid_input" });
  }
  return new Date(parsed).toISOString();
}

const OBJECT_KEYS_MAX = 60;

function requireShortObject(value, field) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new KioskError(`Invalid ${field}.`, { code: "invalid_input" });
  }
  const out = {};
  for (const [key, raw] of Object.entries(value)) {
    if (Object.keys(out).length >= OBJECT_KEYS_MAX) break;
    if (typeof raw === "string") {
      out[key] = raw.slice(0, 300);
    } else if (typeof raw === "number" || typeof raw === "boolean") {
      out[key] = raw;
    } else if (Array.isArray(raw)) {
      out[key] = raw.filter((v) => typeof v === "string").slice(0, 40);
    }
  }
  return out;
}

// ── RPC wrappers ──────────────────────────────────────────────

function requireFileSize(value) {
  if (!Number.isInteger(value) || value <= 0 || value > MAX_EVIDENCE_BYTES) {
    throw new KioskError("File must be 10 MB or smaller.", {
      code: "invalid_input",
    });
  }
  return value;
}

const OTHER_PARTY_STATUSES = ["known", "unknown", "not_applicable"];
const EVIDENCE_MAX_FILES = 5;
const MAX_EVIDENCE_BYTES = 10 * 1024 * 1024;

/**
 * Session-file ids the phone has already registered.
 *
 * The RPC contract is exact: kiosk_submit_complaint step 10 runs
 * jsonb_array_elements_text(p_evidence_file_ids) and casts each
 * element with ::uuid, so p_evidence_file_ids MUST be a jsonb array
 * of plain uuid strings. Sending objects (an earlier version sent
 * `{ id, file_name, ... }`) made the ::uuid cast raise 22P02
 * `invalid input syntax for type uuid`, which is not one of our
 * RAISE codes — it surfaced as an opaque 503 and failed the whole
 * submission. Everything the SQL needs besides the id (filename,
 * mime type, size) is re-derived server-side from the
 * kiosk_upload_session_files manifest, which is also what keeps a
 * client from forging metadata.
 *
 * Accepts either a bare uuid string or an object carrying one
 * (the shape the kiosk wizard and the offline sync engine build),
 * and always returns bare uuid strings.
 */
function requireEvidenceList(value) {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new KioskError("Invalid evidence list.", { code: "invalid_input" });
  }
  if (value.length > EVIDENCE_MAX_FILES) {
    throw new KioskError("A maximum of 5 files can be attached.", {
      code: "too_many_files",
    });
  }
  return value.map((entry) => {
    const id =
      typeof entry === "string"
        ? entry
        : entry && typeof entry === "object"
          ? (entry.id ?? entry.file_id ?? entry.storage_id)
          : null;
    if (typeof id !== "string" || !UUID.test(id)) {
      throw new KioskError("Invalid evidence reference.", { code: "invalid_input" });
    }
    return id;
  });
}

/**
 * Files a complaint. All validation has already happened on the
 * client; this re-checks because the client is untrusted.
 */
export async function submitComplaint(body) {
  const params = {
    p_client_submission_id: requireUuid(body.clientSubmissionId, "submission id"),
    p_fingerprint: requireFingerprint(body.fingerprint),
    p_status_token: requireStatusToken(body.statusToken),
    p_draft_reference: requireDraftReference(body.draftReference),
    p_complainant_snapshot: requireShortObject(body.complainantSnapshot, "complainant details"),
    p_other_party_status: requireOneOf(
      body.otherPartyStatus,
      "other party status",
      OTHER_PARTY_STATUSES
    ),
    p_respondent_name: optionalString(body.respondentName, "respondent name", { max: 180 }),
    p_respondent_address: optionalString(body.respondentAddress, "respondent address", { max: 300 }),
    p_respondent_purok: optionalString(body.respondentPurok, "respondent purok", { max: 60 }),
    p_respondent_contact: optionalString(body.respondentContact, "respondent contact", { max: 40 }),
    p_respondent_relationship: optionalString(body.respondentRelationship, "relationship", { max: 80 }),
    p_incident_date: requireIsoDate(body.incidentDate, "incident date"),
    p_incident_time: requireTime(body.incidentTime, "incident time"),
    p_incident_location: requireString(body.incidentLocation, "incident location", { max: 300 }),
    p_incident_purok: optionalString(body.incidentPurok, "incident purok", { max: 60 }),
    p_incident_ongoing: requireBoolean(body.incidentOngoing, "incident ongoing"),
    p_immediate_safety_concern: requireBoolean(body.immediateSafety, "safety concern"),
    p_narrative: requireString(body.narrative, "narrative", { max: 5000, min: 20 }),
    p_evidence_file_ids: requireEvidenceList(body.evidence),
    p_privacy_consent_at: requireIsoTimestamp(body.privacyConsentAt, "privacy consent"),
    p_accuracy_confirmation_at: requireIsoTimestamp(body.accuracyConfirmedAt, "accuracy confirmation"),
    // The classifier is advisory. These are the citizen's browser
    // values, treated as a hint and never as a decision.
    p_predicted_category: optionalString(body.predictedCategory, "predicted category", { max: 80 }),
    p_predicted_case_type: optionalString(body.predictedCaseType, "predicted case type", { max: 40 }),
    p_predicted_urgency: optionalString(body.predictedUrgency, "predicted urgency", { max: 20 }),
    p_prediction_confidence:
      typeof body.predictionConfidence === "number" &&
      body.predictionConfidence >= 0 &&
      body.predictionConfidence <= 1
        ? body.predictionConfidence
        : null,
    p_prediction_model: optionalString(body.predictionModel, "prediction model", { max: 60 }) ?? MODEL_VERSION,
    p_submitted_offline: body.submittedOffline === true,
    p_queued_at: body.queuedAt ? requireIsoTimestamp(body.queuedAt, "queued at") : null,
  };

  const prediction = await predictComplaint(params.p_narrative);
  // Client hints are never trusted. The kiosk RPC accepts only broad enum suggestions.
  params.p_predicted_category = prediction?.caseType ?? null;
  params.p_predicted_case_type = prediction?.caseType ?? null;
  params.p_predicted_urgency = null;
  params.p_prediction_confidence = null;
  params.p_prediction_model = prediction ? `svm-${prediction.modelVersion}` : null;
  const result = await callRpc("kiosk_submit_complaint", params);
  if (prediction && result?.id) {
    await savePrediction(result.id, params.p_narrative, prediction, {
      kioskSubmissionId: params.p_client_submission_id,
    });
  }
  return result;
}

/** Resident-safe status by QR token. */
export async function statusByToken({ token, fingerprint }) {
  return callRpc("kiosk_status_by_token", {
    p_token: requireStatusToken(token),
    p_fingerprint: requireFingerprint(fingerprint),
  });
}

/** Resident-safe status by tracking number plus mobile. */
export async function statusByLookup({ reference, mobile, fingerprint }) {
  return callRpc("kiosk_status_lookup", {
    p_reference: requireString(reference, "tracking number", { max: 32 }),
    p_mobile: requireString(mobile, "mobile number", { max: 32 }),
    p_fingerprint: requireFingerprint(fingerprint),
  });
}

// ── Resident-visible documents ────────────────────────────────
// kiosk_document_access() is granted to service_role ONLY, so it is
// reached through the admin client, never the anon one. It returns
// the PRIVATE storage path after re-checking the token, the
// complaint ownership, the visibility and an allow-list of document
// types. The path stays on the server: only a short-lived signed URL
// is returned to the caller.
const DOCUMENT_URL_TTL_SECONDS = 120;

export async function documentAccess({ token, documentId, fingerprint }) {
  const params = {
    p_token: requireStatusToken(token),
    p_document_id: requireUuid(documentId, "document id"),
    p_fingerprint: requireFingerprint(fingerprint),
  };

  let admin;
  try {
    admin = createAdminClient();
  } catch (error) {
    console.error("[kiosk] document access is not configured:", error?.message);
    throw new KioskError("Documents are not available right now.", {
      status: 503,
      code: "not_configured",
    });
  }

  const { data, error } = await withTimeout(
    admin.rpc("kiosk_document_access", params),
    "kiosk_document_access"
  );

  if (error) {
    console.error("[kiosk] kiosk_document_access failed:", error.code, error.message);
    throw new KioskError("Documents are not available right now.", {
      status: 503,
      code: "unavailable",
    });
  }

  if (!data || data.state !== "ok" || !data.storage_path) {
    // Unknown token, someone else's document, or a document the
    // barangay has not shared. All three answer identically.
    throw new KioskError("This document is not available.", {
      status: 404,
      code: "not_found",
    });
  }

  const { data: signed, error: signError } = await admin.storage
    .from("documents")
    .createSignedUrl(data.storage_path, DOCUMENT_URL_TTL_SECONDS);

  if (signError || !signed?.signedUrl) {
    console.error("[kiosk] document signing failed:", signError?.message);
    throw new KioskError("This document is not available right now.", {
      status: 503,
      code: "unavailable",
    });
  }

  return {
    url: signed.signedUrl,
    filename: data.filename || null,
    mimeType: data.mime_type || null,
  };
}

/** Opens an evidence upload session and returns its QR payload. */
export async function createUploadSession({ fingerprint }) {
  return callRpc("kiosk_create_upload_session", {
    p_fingerprint: requireFingerprint(fingerprint),
  });
}

/** Polls an upload session: how many files the phone has registered. */
export async function uploadSessionStatus({ token, fingerprint }) {
  return callRpc("kiosk_upload_session_status", {
    p_token: requireUploadToken(token),
    p_fingerprint: requireFingerprint(fingerprint),
  });
}

/**
 * Registers one uploaded file and asks the server to name its path.
 *
 * The path is derived here, never accepted from the phone, so a
 * caller cannot steer a write outside the session's own folder.
 */
export async function registerUploadedFile({ token, filename, mimeType, fileSize }) {
  return callRpc("kiosk_register_uploaded_file", {
    p_token: requireUploadToken(token),
    p_original_filename: requireString(filename, "file name", { max: 180 }),
    p_mime_type: requireOneOf(mimeType, "file type", [
      "image/jpeg",
      "image/jpg",
      "image/png",
      "image/webp",
      "application/pdf",
    ]),
    p_file_size: requireFileSize(fileSize),
  });
}

/** Abandons an upload session, e.g. the citizen went back. */
export async function revokeUploadSession({ token, fingerprint }) {
  return callRpc("kiosk_revoke_upload_session", {
    p_token: requireUploadToken(token),
    p_fingerprint: requireFingerprint(fingerprint),
  });
}

export { kioskClient };
