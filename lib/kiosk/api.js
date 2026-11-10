/**
 * Browser-side client for the kiosk API routes.
 *
 * Every function returns parsed JSON or throws a KioskRequestError
 * carrying the server's machine code, so the UI can distinguish
 * "offline", "link expired" and "ask staff" without inspecting
 * message text.
 */

/**
 * Machine codes that mean "this particular service could not answer
 * right now", not "this payload is wrong".
 *
 * `unconfirmed` belongs here on purpose: a 200 without a tracking number
 * means kiosk_submit_complaint may already have committed the row, and
 * the idempotency key makes the next attempt return that same row rather
 * than create a second complaint. Parking it as terminal would strand a
 * filing the server may already hold.
 */
const RETRYABLE_CODES = new Set([
  "network",
  "unavailable",
  "upload_failed",
  "unconfirmed",
  "rate_limited",
]);

/** Throttling and gateway statuses the client does not own. */
const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);

/**
 * The one rate-limit message the kiosk SQL raises.
 *
 * kiosk_check_rate_limit() is reported by kiosk_submit_complaint as a
 * P0001 RAISE, which arrives as code `rejected` — the same code a real
 * validation refusal uses. The message is therefore the only thing that
 * separates "try again in an hour" from "this payload is unacceptable",
 * and it must be read before the message is discarded.
 */
const RATE_LIMIT_MESSAGE = /^too many/i;

/**
 * True when the refusal is a temporary per-device budget that rolls over
 * by itself. The payload is not at fault, so the correct answer is a
 * deferral rather than a terminal park.
 */
export function isRateLimitRejection(error) {
  if (!error) return false;
  if (error.status === 429 || error.code === "rate_limited") return true;
  return (
    error.code === "rejected" &&
    typeof error.message === "string" &&
    RATE_LIMIT_MESSAGE.test(error.message)
  );
}

/** `Retry-After` in milliseconds; accepts both seconds and HTTP-date. */
export function parseRetryAfter(response) {
  const raw =
    typeof response?.headers?.get === "function"
      ? response.headers.get("retry-after")
      : null;
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(raw);
  return Number.isNaN(at) ? null : Math.max(0, at - Date.now());
}

export class KioskRequestError extends Error {
  constructor(message, { code = "unavailable", status = 0, retryAfterMs = null } = {}) {
    super(message);
    this.name = "KioskRequestError";
    this.code = code;
    this.status = status;
    /** Parsed `Retry-After`, in ms, when the server sent one. */
    this.retryAfterMs = retryAfterMs;
  }

  /** True when retrying later could plausibly succeed. */
  get retryable() {
    if (isRateLimitRejection(this)) return true;
    return RETRYABLE_CODES.has(this.code) || RETRYABLE_STATUSES.has(this.status);
  }
}

async function request(path, { method = "POST", body, signal } = {}) {
  let response;
  try {
    response = await fetch(path, {
      method,
      signal,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
  } catch (error) {
    if (error.name === "AbortError") throw error;
    throw new KioskRequestError(
      "No connection to the service.",
      { code: "network" }
    );
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    // A non-JSON body from a proxy or an edge function.
    throw new KioskRequestError(
      "The service did not respond properly.",
      { code: "unavailable", status: response.status, retryAfterMs: parseRetryAfter(response) }
    );
  }

  if (!response.ok || payload?.ok === false) {
    throw new KioskRequestError(
      payload?.message || "Something went wrong. Please try again.",
      {
        code: payload?.code || "unavailable",
        status: response.status,
        retryAfterMs: parseRetryAfter(response),
      }
    );
  }

  return payload;
}

/** Files a complaint. Throws KioskRequestError with code 'network' when offline. */
export function submitComplaint(payload, { signal } = {}) {
  return request("/api/kiosk/submit", { body: payload, signal });
}

export function fetchStatusByToken({ token, fingerprint }, { signal } = {}) {
  return request("/api/kiosk/status/token", {
    body: { token, fingerprint },
    signal,
  });
}

export function fetchStatusByLookup({ reference, mobile, fingerprint }, { signal } = {}) {
  return request("/api/kiosk/status/lookup", {
    body: { reference, mobile, fingerprint },
    signal,
  });
}

export function fetchDocumentUrl({ token, documentId, fingerprint }, { signal } = {}) {
  return request("/api/kiosk/document", {
    body: { token, documentId, fingerprint },
    signal,
  });
}

export function openUploadSession({ fingerprint }, { signal } = {}) {
  return request("/api/kiosk/upload/session", { body: { fingerprint }, signal });
}

export function pollUploadSession({ token, fingerprint }, { signal } = {}) {
  return request(
    `/api/kiosk/upload/session?token=${encodeURIComponent(token)}&fingerprint=${encodeURIComponent(fingerprint)}`,
    { method: "GET", signal }
  );
}

export function revokeUploadSession({ token, fingerprint }, { signal } = {}) {
  return request("/api/kiosk/upload/revoke", { body: { token, fingerprint }, signal });
}

/** Simple reachability probe for the "online / offline" pill. */
export async function checkOnline({ signal } = {}) {
  try {
    // The status endpoint is the cheapest authenticated round trip and
    // a deliberately malformed token is rejected locally by the
    // server's guard, so this doubles as a connectivity test.
    await request("/api/kiosk/status/lookup", {
      body: { reference: "AB-0000-0000", mobile: "0", fingerprint: "0".repeat(16) },
      signal,
    });
    return true;
  } catch (error) {
    // A 400 means the server answered, which is all we needed.
    return error.status > 0 && error.status < 500;
  }
}
