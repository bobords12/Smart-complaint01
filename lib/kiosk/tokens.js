/**
 * Secret generation for the kiosk.
 *
 * Split into two very different kinds of value:
 *
 *  - Capabilities. The status token and the upload token are bearer
 *    secrets. The phone scanning the QR presents the upload token;
 *    the citizen's receipt presents the status token. Neither is
 *    derived from anything guessable, and the server stores only a
 *    SHA-256 digest, so a database leak does not hand over live
 *    links.
 *
 *  - Identifiers. The client submission id is the idempotency key
 *    and the draft reference is a folder name. Both must be
 *    unguessable too, because knowing a draft reference would let
 *    someone guess at a session, but they grant no access on their
 *    own.
 *
 * All of it uses the platform CSPRNG. Math.random is not used
 * anywhere in the kiosk.
 */

/** Lowercase hex from the platform CSPRNG. */
function randomHex(bytes) {
  const view = new Uint8Array(bytes);
  crypto.getRandomValues(view);
  return Array.from(view)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function randomUuid() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  // RFC 4122 v4 layout from raw bytes.
  const view = new Uint8Array(16);
  crypto.getRandomValues(view);
  view[6] = (view[6] & 0x0f) | 0x40;
  view[8] = (view[8] & 0x3f) | 0x80;
  const hex = Array.from(view)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

/**
 * Status token shown on the receipt as a QR code.
 *
 * 256 bits of entropy as 64 hex characters, matching the
 * STATUS_TOKEN_PATTERN the UI validates before spending a request.
 * The kiosk-06 V10 check asserts no stored hash is anything other
 * than 64 hex characters, which keeps this and the server in step.
 */
export function newStatusToken() {
  return randomHex(32);
}

/**
 * Upload token embedded in the evidence QR code.
 *
 * 128 bits, which is ample for a capability that lives for ten
 * minutes and is single-use.
 */
export function newUploadToken() {
  return randomHex(16);
}

/** Idempotency key. Replayed safely by the sync engine. */
export function newClientSubmissionId() {
  return randomUuid();
}

/** Storage folder name for one filing session. */
export function newDraftReference() {
  return randomUuid();
}

/** True when a string is shaped like a status token, checked locally. */
export function isStatusToken(value) {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

/** True when a string is shaped like an upload token. */
export function isUploadToken(value) {
  return typeof value === "string" && /^[0-9a-f]{32}$/.test(value);
}
