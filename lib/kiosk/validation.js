/**
 * Kiosk validation.
 *
 * Every validator returns a map of field path -> i18n KEY, never a
 * finished sentence. That is what lets a language switch re-render
 * errors in the new language without re-running validation.
 */

import {
  EVIDENCE_ACCEPTED_EXTENSIONS,
  EVIDENCE_ACCEPTED_MIME,
  MAX_EVIDENCE_BYTES,
  MAX_EVIDENCE_FILES,
  MAX_NARRATIVE_CHARS,
  MIN_NARRATIVE_CHARS,
} from "./config";

/** Earliest date accepted as a real incident. */
const MIN_INCIDENT_YEAR = 1900;

export function normalizeMobile(value) {
  if (!value) return "";
  let digits = String(value).replace(/[^0-9]/g, "");
  if (digits.startsWith("63") && digits.length === 12) digits = `0${digits.slice(2)}`;
  if (/^9\d{9}$/.test(digits)) digits = `0${digits}`;
  return digits;
}

export function isValidPhMobile(value) {
  return /^09\d{9}$/.test(normalizeMobile(value));
}

export function formatMobile(value) {
  const d = normalizeMobile(value);
  if (!/^09\d{9}$/.test(d)) return value || "";
  return `${d.slice(0, 4)} ${d.slice(4, 7)} ${d.slice(7)}`;
}

export function composeFullName(complainant) {
  if (!complainant) return "";
  return [complainant.firstName, complainant.middleName, complainant.lastName, complainant.suffix]
    .map((part) => (part || "").trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export function composeAddress(complainant) {
  if (!complainant) return "";
  return [complainant.houseStreet, complainant.purok, "Abuno", "Iligan City"]
    .map((part) => (part || "").trim())
    .filter(Boolean)
    .join(", ");
}

/** "2026-09-30" -> true when it parses as a real calendar date. */
export function isRealDateString(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return false;
  const [y, m, d] = value.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
  );
}

export function isValidIncidentTime(value) {
  if (!/^\d{2}:\d{2}$/.test(value || "")) return false;
  const [h, m] = value.split(":").map(Number);
  return h >= 0 && h <= 23 && m >= 0 && m <= 59;
}

export function isValidIncidentDate(value) {
  if (!isRealDateString(value)) return false;
  const year = Number(value.slice(0, 4));
  if (year < MIN_INCIDENT_YEAR) return false;
  // Compare against the local calendar day, not UTC, so a
  // complaint filed late in the evening in Iligan is not rejected.
  const today = new Date();
  const todayUtcMidnight = Date.UTC(
    today.getFullYear(),
    today.getMonth(),
    today.getDate()
  );
  return Date.UTC(year, Number(value.slice(5, 7)) - 1, Number(value.slice(8, 10))) <= todayUtcMidnight;
}

export function validateIdentity(form) {
  const errors = {};
  const c = form.complainant || {};

  if (composeFullName(c).length < 2) errors["complainant.firstName"] = "err.fullName";
  if (!isValidPhMobile(c.mobile)) errors["complainant.mobile"] = "err.mobile";
  if (!(c.houseStreet || "").trim()) errors["complainant.houseStreet"] = "err.address";
  if (!(c.purok || "").trim()) errors["complainant.purok"] = "err.purok";

  return errors;
}

export function validateOtherParty(form) {
  const errors = {};
  if (!form.otherPartyStatus) {
    errors.otherPartyStatus = "err.otherParty";
    return errors;
  }
  if (form.otherPartyStatus === "known" && !(form.respondent?.name || "").trim()) {
    errors["respondent.name"] = "err.respondentName";
  }
  return errors;
}

export function validateIncident(form) {
  const errors = {};
  const i = form.incident || {};

  if (!i.date) {
    errors["incident.date"] = "err.incidentDate";
  } else if (!isRealDateString(i.date)) {
    errors["incident.date"] = "err.incidentDateInvalid";
  } else if (!isValidIncidentDate(i.date)) {
    errors["incident.date"] = "err.incidentDateFuture";
  }

  if (!i.time) errors["incident.time"] = "err.incidentTime";
  else if (!isValidIncidentTime(i.time)) errors["incident.time"] = "err.incidentTime";

  if (!(i.location || "").trim()) errors["incident.location"] = "err.incidentLocation";
  if (!(i.purok || "").trim()) errors["incident.purok"] = "err.incidentPurok";

  if (i.ongoing !== "yes" && i.ongoing !== "no") {
    errors["incident.ongoing"] = "err.incidentOngoing";
  }
  if (i.immediateSafety !== "yes" && i.immediateSafety !== "no") {
    errors["incident.immediateSafety"] = "err.incidentImmediate";
  }

  return errors;
}

export function validateNarrative(form) {
  const errors = {};
  const text = form.narrative || "";

  if (!text.trim()) {
    errors.narrative = "err.narrative";
  } else if (text.length < MIN_NARRATIVE_CHARS) {
    errors.narrative = "err.narrativeShort";
  } else if (text.length > MAX_NARRATIVE_CHARS) {
    errors.narrative = "err.narrativeLong";
  }

  return errors;
}

export function validateConsent(form) {
  const errors = {};
  if (!form.consent?.privacy) errors["consent.privacy"] = "err.consentPrivacy";
  if (!form.consent?.accuracy) errors["consent.accuracy"] = "err.consentAccuracy";
  return errors;
}

export function isAllowedEvidenceFile(file) {
  if (!file) return false;
  const mimeOk = EVIDENCE_ACCEPTED_MIME.includes(file.type);
  const ext = (file.name || "").split(".").pop()?.toLowerCase() || "";
  const extOk = EVIDENCE_ACCEPTED_EXTENSIONS.includes(ext);
  return mimeOk && extOk;
}

/** Field-level checks for one candidate file. Returns an i18n key or null. */
export function validateEvidenceFile(file, currentCount) {
  if (!isAllowedEvidenceFile(file)) return "err.fileType";
  if (file.size > MAX_EVIDENCE_BYTES) return "err.fileSize";
  if (currentCount >= MAX_EVIDENCE_FILES) return "err.fileCount";
  return null;
}

/** Per-step validation, used by Continue and by Edit-and-return. */
export function validateStep(stepId, form) {
  switch (stepId) {
    case "identity":
      return validateIdentity(form);
    case "confirm":
      return {};
    case "otherParty":
      return validateOtherParty(form);
    case "incident":
      return validateIncident(form);
    case "narrative":
      return validateNarrative(form);
    case "evidence":
      return {};
    case "review":
      return validateConsent(form);
    default:
      return {};
  }
}

/**
 * Full re-validation, run again immediately before submission so a
 * value that became invalid while the resident was away cannot
 * reach the database.
 */
export function validateAll(form) {
  return {
    ...validateIdentity(form),
    ...validateOtherParty(form),
    ...validateIncident(form),
    ...validateNarrative(form),
    ...validateConsent(form),
  };
}

export function hasErrors(errors) {
  return Boolean(errors) && Object.keys(errors).length > 0;
}

/** Distinct, translated error messages for the summary box. */
export function summariseErrors(errors, t) {
  const seen = new Set();
  const list = [];
  Object.values(errors || {}).forEach((key) => {
    if (seen.has(key)) return;
    seen.add(key);
    list.push(t(key));
  });
  return list;
}
