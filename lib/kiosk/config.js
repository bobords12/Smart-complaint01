/**
 * Kiosk configuration: the single source of truth for the filing
 * wizard's step model, limits, and enumerations.
 *
 * Progress values in the header come from KIOSK_STEPS.length, so
 * "Step 4 of 7" and "Hakbang 4 ng 7" can never disagree.
 */

export const KIOSK_STEPS = [
  { id: "identity", en: "Identity", pil: "Pagkakakilanlan" },
  { id: "confirm", en: "Confirm Details", pil: "Kumpirmahin ang Detalye" },
  { id: "otherParty", en: "Other Party", pil: "Iba Pang Partido" },
  { id: "incident", en: "Incident Details", pil: "Detalye ng Insidente" },
  { id: "narrative", en: "Complaint Narrative", pil: "Kuwento ng Reklamo" },
  { id: "evidence", en: "Evidence", pil: "Ebidensiya" },
  { id: "review", en: "Review and Submit", pil: "Suriin at Isumite" },
];

export const TOTAL_STEPS = KIOSK_STEPS.length;

/** Zero-based index of each step, for edit links from the review screen. */
export const STEP_INDEX = KIOSK_STEPS.reduce((acc, step, i) => {
  acc[step.id] = i;
  return acc;
}, {});

/** 1-based step number, for display. */
export function stepNumber(stepId) {
  return STEP_INDEX[stepId] + 1;
}

/** The editable form state. Starts empty; nothing is persisted. */
export function createEmptyForm() {
  return {
    filingMode: "guest",
    complainant: {
      firstName: "",
      middleName: "",
      lastName: "",
      suffix: "",
      mobile: "",
      houseStreet: "",
      purok: "",
    },
    otherPartyStatus: "",
    respondent: {
      name: "",
      address: "",
      purok: "",
      contact: "",
      relationship: "",
    },
    incident: {
      date: "",
      time: "",
      location: "",
      purok: "",
      ongoing: "",
      immediateSafety: "",
    },
    narrative: "",
    evidenceMethod: "",
    consent: {
      privacy: false,
      accuracy: false,
    },
  };
}

export const OTHER_PARTY_STATUSES = [
  { value: "known", en: "Known Person", pil: "Kilalang Tao" },
  { value: "unknown", en: "Unknown or Not Identified", pil: "Hindi Kilala o Hindi Natukoy" },
  { value: "not_applicable", en: "No Other Party Applicable", pil: "Walang Iba Pang Partido" },
];

export const EVIDENCE_METHODS = [
  { value: "qr", en: "Scan to Upload", pil: "I-scan Para Mag-upload" },
  { value: "skip", en: "Skip Evidence", pil: "Lagpasan ang Ebidensiya" },
];

export const EVIDENCE_ACCEPTED_MIME = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "application/pdf",
];

export const EVIDENCE_ACCEPTED_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "pdf"];

export const MAX_EVIDENCE_BYTES = 10 * 1024 * 1024;
export const MAX_EVIDENCE_FILES = 5;
export const MAX_NARRATIVE_CHARS = 5000;
export const MIN_NARRATIVE_CHARS = 20;

export const NARRATIVE_MIN_HINT_EN = `At least ${MIN_NARRATIVE_CHARS} characters`;
export const NARRATIVE_MIN_HINT_PIL = `Hindi bababa sa ${MIN_NARRATIVE_CHARS} na karakter`;

/** Read-only location defaults: the kiosk is inside Abuno, Iligan City. */
export const LOCATION_DEFAULTS = {
  barangay: "Abuno",
  city: "Iligan City",
};

/** Inactivity privacy timer, per spec section 29. */
export const INACTIVITY_WARNING_MS = 4 * 60 * 1000;
export const INACTIVITY_COUNTDOWN_SECONDS = 30;

/** How long a QR upload session stays valid, in ms (server owns the truth). */
export const UPLOAD_SESSION_MS = 10 * 60 * 1000;

/** Retention for abandoned offline queue entries, in days. */
export const OFFLINE_RETENTION_DAYS = 7;

export const IDB_DATABASE_NAME = "scbms_kiosk";
export const IDB_STORE_NAME = "submissions";
export const IDB_KEY_STORE_NAME = "keys";

/**
 * Bearer capabilities as they appear in a URL.
 *
 * Both are checked here, in the browser, before any request is made, so an
 * obviously malformed QR link fails fast instead of spending a rate-limit
 * slot on the server. The server still validates independently and stores
 * only a SHA-256 digest, so a bypassed check is not an authorisation.
 *
 * The lengths are not arbitrary: kiosk_new_token() in
 * supabase/manual/kiosk-03-status-token-security.sql builds its value from
 * uuid_generate_v4() with the dashes stripped, which is 32 hex characters
 * per group. The 64-character status token is produced by joining two of
 * them in the browser before submission.
 */
export const UPLOAD_TOKEN_PATTERN = /^[0-9a-f]{32}$/;
export const STATUS_TOKEN_PATTERN = /^[0-9a-f]{64}$/;
export const IDB_VERSION = 1;

export const OFFLINE_STATES = {
  PENDING: "pending_sync",
  SYNCING: "syncing",
  SYNCED: "synced",
  FAILED: "sync_failed",
  NEEDS_ATTENTION: "needs_attention",
};

/** Kitchen location line shown on the welcome screen. */
export const KIOSK_LOCATION_LABEL = "Barangay Abuno Hall, Iligan City";
