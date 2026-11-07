/**
 * Shared, environment-agnostic pieces of the kiosk SMS confirmation.
 *
 * This file is the SINGLE SOURCE OF TRUTH for three things that must
 * never drift apart:
 *
 *   1. the exact confirmation text sent to the complainant,
 *   2. the Philippine mobile number rules,
 *   3. the PhilSMS request/response contract.
 *
 * It is plain ESM JavaScript with no imports, no I/O and no runtime
 * APIs, so the very same file runs in three places:
 *
 *   - the Supabase Edge Function (Deno),
 *   - the Node regression script (scripts/test-kiosk-sms.mjs),
 *   - anything else that needs the same wording.
 *
 * It deliberately lives in `supabase/functions/_shared/` because that
 * is the directory the Supabase CLI uploads with a function. A module
 * that lived outside it would not be present on the Edge runtime.
 *
 * ── Provider contract (PhilSMS "New Dashboard") ─────────────────
 *
 * Base URL : https://dashboard.philsms.com/api/v3
 * Endpoint : POST /sms/send
 * Auth     : Authorization: Bearer {api_token}
 * Body     : { recipient, sender_id, type, message }
 * Success  : { "status": "success", "data": { ... } }
 * Failure  : { "status": "error",   "message": "..." }
 *
 * The endpoint and the envelope were verified against the live New
 * Dashboard: unknown routes under /api/v3 answer
 * `{"status":"error","message":"The route api/v3/... could not be
 * found."}` while the real ones answer
 * `{"status":"error","message":"Unauthenticated."}` without a token.
 * The request field names and the bearer scheme are the ones the
 * official PhilSMS API documentation publishes for its v3 API.
 *
 * ── What this file deliberately does NOT do ─────────────────────
 *
 * It never reads a phone number from a request body, never builds a
 * message from anything but a reference number and a status, and never
 * returns a recipient to the caller. The recipient always comes from
 * the persisted complaint row, so a public caller cannot make the
 * system message an arbitrary number.
 */

/**
 * The one notification type this system produces.
 *
 * It must match the value used by the database
 * (kiosk-08-sms-outbox.sql): the outbox row is keyed by
 * (complaint_id, notification_type), so a mismatch here would create a
 * second job for the same complaint and a second SMS to the citizen.
 */
export const KIOSK_SMS_NOTIFICATION_TYPE = "complaint_submitted";

/** New Dashboard base URL supplied for this project. */
export const PHILSMS_DEFAULT_BASE_URL = "https://dashboard.philsms.com/api/v3";

/** Path of the send endpoint, relative to the base URL. */
export const PHILSMS_SEND_PATH = "/sms/send";

/** Alphanumeric sender IDs are capped at 11 characters by the provider. */
export const PHILSMS_SENDER_ID_MAX_LENGTH = 11;

/**
 * The status a freshly filed kiosk complaint is persisted with.
 */
export const KIOSK_INITIAL_STATUS = "Pending Review";

/** Values that mean "off" for a feature flag. */
const DISABLED_VALUES = ["0", "false", "off", "no"];

function isOff(value) {
  return (
    typeof value === "string" && DISABLED_VALUES.includes(value.trim().toLowerCase())
  );
}

/**
 * True when the whole feature is switched on.
 *
 * KIOSK_SMS_ENABLED=0 keeps the kiosk filing exactly as it was, which
 * is the switch to use while the database migration has not been
 * applied yet.
 */
export function isKioskSmsEnabled(env = {}) {
  return !isOff(env?.KIOSK_SMS_ENABLED);
}

/**
 * True when the immediate dispatch should be attempted.
 *
 * KIOSK_SMS_DISPATCH=0 leaves the jobs in the outbox for the
 * scheduled sweeper only.
 */
export function isKioskSmsDispatchEnabled(env = {}) {
  return !isOff(env?.KIOSK_SMS_DISPATCH);
}

/**
 * Normalises a Philippine mobile number to the single canonical form
 * used everywhere in this project: 09XXXXXXXXX.
 *
 * Accepts 09171234567, +639171234567, 639171234567 and the same
 * numbers written with spaces, dashes, dots or parentheses.
 *
 * This mirrors public.kiosk_normalize_mobile() in the database, so the
 * number the worker sends is the number the complaint was filed with,
 * not a second, independently-derived value.
 *
 * @returns {string|null} the canonical number, or null when the input
 *          is not a usable Philippine mobile number.
 */
export function normalizePhMobile(value) {
  if (value === null || value === undefined) return null;

  let digits = String(value).replace(/[^0-9]/g, "");
  if (!digits) return null;

  if (digits.startsWith("63") && digits.length === 12) {
    digits = `0${digits.slice(2)}`;
  }
  if (/^9\d{9}$/.test(digits)) {
    digits = `0${digits}`;
  }

  return /^09\d{9}$/.test(digits) ? digits : null;
}

/**
 * Converts the canonical number into the recipient format the PhilSMS
 * API expects.
 *
 * The official documentation shows both `639171234567` and
 * `+639171234567`; the parameter table uses the bare country-code
 * form, so that is the default. `format: "+63"` switches to the other
 * spelling for an account whose provider route needs it.
 *
 * @param {string} mobile Canonical 09XXXXXXXXX number.
 * @param {{format?: "63"|"+63"}} [options]
 * @returns {string|null}
 */
export function toProviderRecipient(mobile, { format = "63" } = {}) {
  const canonical = normalizePhMobile(mobile);
  if (!canonical) return null;
  const national = canonical.slice(1); // 9171234567
  return format === "+63" ? `+63${national}` : `63${national}`;
}

/**
 * Builds the confirmation text.
 *
 * The wording is fixed by the barangay and must not be reworded. The
 * only two variables are the reference number (the one the database
 * actually saved) and the status (the one the complaint row actually
 * carries).
 *
 * `status` is substituted rather than hard-coded because the message
 * may only say "Pending Review" while that is the real, persisted
 * status. A kiosk complaint is filed as 'Pending Review' and this
 * message goes out within seconds of the commit, so in practice the
 * status line always reads "Status: Pending Review"; if a reviewer
 * happened to move the complaint first, the message tells the truth
 * instead of lying.
 *
 * For the same reason the one sentence that depends on the stage is
 * kept verbatim while the complaint is pending, and softened afterwards.
 *
 * @param {{referenceNumber: string, status?: string}} params
 * @returns {string}
 */
export function buildKioskConfirmationMessage({ referenceNumber, status } = {}) {
  const reference = String(referenceNumber ?? "").trim();
  const currentStatus = String(status ?? "").trim() || KIOSK_INITIAL_STATUS;
  const awaitingReview = currentStatus === KIOSK_INITIAL_STATUS;

  return [
    "BARANGAY ABUNO",
    "",
    "Your complaint has been successfully submitted through our Public Kiosk.",
    "",
    `Reference No.: ${reference}`,
    `Status: ${currentStatus}`,
    "",
    awaitingReview
      ? "Your complaint is awaiting review by the Barangay Office."
      : "Your complaint is now with the Barangay Office.",
    "",
    "Please keep your reference number and the Tracking QR Code provided at the kiosk for future updates and inquiries.",
    "",
    "This is an automated message. Please do not reply.",
  ].join("\n");
}

/**
 * Counts the billable SMS segments of a message.
 *
 * GSM-7 characters cost 160 characters per segment and 153 for every
 * part after the first; a Unicode message costs 67 and 67. The
 * confirmation text is pure ASCII, so it is a plain-text message and
 * is sent with type "plain".
 *
 * @param {string} text
 * @returns {{segments: number, encoding: "gsm7"|"ucs2", length: number}}
 */
export function countSmsSegments(text) {
  const body = String(text ?? "");
  const gsm7 = /^[\x20-\x7E\n\r\t@£$¥èéùìòÇØøÅå]*$/.test(body);
  const perSegment = gsm7 ? 160 : 67;
  const multiSegment = gsm7 ? 153 : 67;
  const length = body.length;
  if (!length) return { segments: 0, encoding: gsm7 ? "gsm7" : "ucs2", length: 0 };
  const segments =
    length <= perSegment ? 1 : Math.ceil(length / multiSegment);
  return { segments, encoding: gsm7 ? "gsm7" : "ucs2", length };
}

/**
 * The request body the PhilSMS v3 send endpoint expects.
 *
 * `recipient` is a single number (no comma separated list: this
 * system never sends to more than one person), `sender_id` is the
 * approved sender of the account and `type` is "plain" for ASCII.
 */
export function buildPhilsmsSendPayload({ recipient, senderId, message } = {}) {
  return {
    recipient: String(recipient ?? ""),
    sender_id: String(senderId ?? ""),
    type: "plain",
    message: String(message ?? ""),
  };
}

/** Full URL of the send endpoint for a given base URL. */
export function philsmsSendUrl(baseUrl = PHILSMS_DEFAULT_BASE_URL) {
  const base = String(baseUrl || PHILSMS_DEFAULT_BASE_URL).replace(/\/+$/, "");
  return `${base}${PHILSMS_SEND_PATH}`;
}

/**
 * Pulls the provider's message id out of a successful response.
 *
 * The documented envelope is `{"status":"success","data":{...}}` and
 * the published example shows `data.message_id`. The id is looked up
 * defensively because the field layout of `data` is not part of the
 * stable contract, and a missing id must never be treated as a
 * failed send.
 */
export function extractProviderMessageId(data) {
  const candidates = Array.isArray(data) ? data : [data];
  for (const entry of candidates) {
    if (!entry || typeof entry !== "object") continue;
    for (const key of ["message_id", "messageId", "sms_id", "smsId", "id", "uuid"]) {
      const value = entry[key];
      if (typeof value === "string" && value.trim()) return value.trim();
      if (typeof value === "number" && Number.isFinite(value)) return String(value);
    }
  }
  return null;
}

/**
 * Classifies what the provider actually did.
 *
 * The distinction that matters most is between "the provider refused
 * this message" and "we do not know whether the provider accepted
 * it". Only the first may be retried. Retrying an unknown outcome is
 * how a complainant ends up with two identical SMS messages.
 *
 * @param {{httpStatus?: number, body?: any, transportError?: string}} outcome
 * @returns {{kind: "accepted"|"retryable"|"uncertain"|"permanent",
 *            code: string, message: string, providerMessageId: string|null,
 *            providerStatus: string|null}}
 */
export function classifyPhilsmsOutcome({ httpStatus, body, transportError } = {}) {
  const envelopeStatus =
    body && typeof body === "object" ? body.status ?? null : null;
  const providerMessage =
    body && typeof body === "object" && typeof body.message === "string"
      ? body.message
      : null;

  // The request never reached the provider (DNS, TLS, connection
  // refused): nothing was accepted, so a later attempt is safe.
  if (transportError) {
    return {
      kind: "retryable",
      code: "transport_error",
      message: transportError,
      providerMessageId: null,
      providerStatus: null,
    };
  }

  if (envelopeStatus === "success") {
    const data = body && typeof body === "object" ? body.data : null;
    return {
      kind: "accepted",
      code: "accepted",
      message: "",
      providerMessageId: extractProviderMessageId(data),
      providerStatus:
        data && typeof data === "object" && typeof data.status === "string"
          ? data.status
          : null,
    };
  }

  // The provider answered with its error envelope. Nothing was
  // accepted, so the message may be retried when the reason is one
  // that can go away on its own.
  if (envelopeStatus === "error") {
    const text = providerMessage || "provider rejected the message";
    const lower = text.toLowerCase();
    const transient =
      /credit|balance|limit|quota|too many|rate|busy|temporar|try again|maintenance/.test(
        lower
      );
    return {
      kind: transient ? "retryable" : "permanent",
      code: transient ? "provider_transient_error" : "provider_rejected",
      message: text,
      providerMessageId: null,
      providerStatus: null,
    };
  }

  // No envelope at all. The status code decides.
  const status = Number(httpStatus) || 0;
  if (status === 401 || status === 403) {
    return {
      kind: "permanent",
      code: "provider_unauthorized",
      message: providerMessage || "the provider rejected the API credentials",
      providerMessageId: null,
      providerStatus: null,
    };
  }
  if (status === 429) {
    return {
      kind: "retryable",
      code: "provider_rate_limited",
      message: providerMessage || "the provider is rate limiting requests",
      providerMessageId: null,
      providerStatus: null,
    };
  }
  if (status >= 500 && status < 600) {
    // 502/503 are the gateway saying it never got to the SMS route;
    // 504 and 408 are the gateway saying it stopped waiting, which
    // leaves the outcome genuinely unknown.
    const unknown = status === 504 || status === 408;
    return {
      kind: unknown ? "uncertain" : "retryable",
      code: unknown ? "provider_timeout" : "provider_server_error",
      message: providerMessage || `the provider answered ${status}`,
      providerMessageId: null,
      providerStatus: null,
    };
  }
  if (status >= 400) {
    return {
      kind: "permanent",
      code: "provider_bad_request",
      message: providerMessage || `the provider answered ${status}`,
      providerMessageId: null,
      providerStatus: null,
    };
  }

  // 2xx without a readable envelope: the provider accepted the
  // request but the answer cannot be trusted. Treating it as a
  // success would claim a delivery we cannot prove; treating it as a
  // failure and sending again could duplicate the message.
  return {
    kind: "uncertain",
    code: "provider_unreadable_response",
    message: providerMessage || "the provider returned an unreadable response",
    providerMessageId: null,
    providerStatus: null,
  };
}

/**
 * Builds the sender that talks to PhilSMS.
 *
 * The returned function is deliberately tiny and side-effect free
 * apart from the HTTP call, so the tests can drive it with a mocked
 * fetch and assert exactly what would have been sent — without
 * spending a single SMS credit.
 *
 * The API token only ever appears in the Authorization header. It is
 * never placed in the URL, the body, the returned value or an error
 * message.
 *
 * @param {{apiToken: string, senderId: string, baseUrl?: string,
 *          recipientFormat?: "63"|"+63", timeoutMs?: number,
 *          fetchImpl?: typeof fetch}} options
 */
export function createPhilsmsSender({
  apiToken,
  senderId,
  baseUrl = PHILSMS_DEFAULT_BASE_URL,
  recipientFormat = "63",
  timeoutMs = 15000,
  fetchImpl,
} = {}) {
  const doFetch = fetchImpl || globalThis.fetch;
  const url = philsmsSendUrl(baseUrl);
  const from = String(senderId || "").trim();

  return async function send({ recipient, message } = {}) {
    const target = toProviderRecipient(recipient, { format: recipientFormat });
    if (!target) {
      return {
        ok: false,
        kind: "permanent",
        code: "invalid_recipient",
        message: "the recipient is not a valid Philippine mobile number",
      };
    }
    if (!from) {
      return {
        ok: false,
        kind: "permanent",
        code: "missing_sender_id",
        message: "no sender id is configured",
      };
    }
    if (!apiToken) {
      return {
        ok: false,
        kind: "permanent",
        code: "missing_api_token",
        message: "no API token is configured",
      };
    }

    const payload = buildPhilsmsSendPayload({
      recipient: target,
      senderId: from,
      message,
    });

    let response;
    try {
      response = await doFetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiToken}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      // A timeout or a dropped connection can happen AFTER the
      // provider accepted the message, so the outcome is unknown and
      // the message must not be sent again automatically.
      const timedOut =
        error?.name === "TimeoutError" || error?.name === "AbortError";
      return {
        ok: false,
        kind: timedOut ? "uncertain" : "retryable",
        code: timedOut ? "request_timeout" : "transport_error",
        message: timedOut
          ? "the provider did not answer in time"
          : String(error?.message || "the provider could not be reached"),
      };
    }

    let body = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }

    const verdict = classifyPhilsmsOutcome({
      httpStatus: response.status,
      body,
    });

    if (verdict.kind === "accepted") {
      return {
        ok: true,
        providerMessageId: verdict.providerMessageId,
        providerStatus: verdict.providerStatus,
      };
    }
    return {
      ok: false,
      kind: verdict.kind,
      code: verdict.code,
      message: verdict.message,
    };
  };
}
