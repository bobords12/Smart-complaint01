/**
 * Anonymous device identity, used only for rate limiting.
 *
 * This is deliberately NOT a browser fingerprint. Fingerprinting
 * hardware, canvas or fonts would let the server recognise the same
 * person across browsers, which is both worse for privacy and a
 * legal problem. Instead the kiosk generates one random identifier
 * the first time it runs, keeps it in IndexedDB, and sends only a
 * SHA-256 digest of it on secure origins. On plain-HTTP LAN origins,
 * SubtleCrypto is unavailable, so a separate random rate-limit id is used.
 *
 * Consequences, all intended:
 *  - The server can throttle a single noisy kiosk without storing
 *    anything about the citizen who used it.
 *  - Clearing kiosk storage, or a different browser, yields a
 *    different rate-limit id, so the identifier cannot be correlated with
 *    a person or a household.
 *  - The identifier is not a credential. It authorises nothing; the
 *    QR and upload tokens do that, and they are separate secrets.
 */

import { IDB_DATABASE_NAME, IDB_STORE_NAME, IDB_VERSION } from "./config";

const DEVICE_RECORD_ID = "device-identity";

let cached = null;

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IDB_DATABASE_NAME, IDB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      // Reuse the kiosk database so there is one storage origin to
      // clear, but tolerate a database created before this store.
      if (!db.objectStoreNames.contains(IDB_STORE_NAME)) {
        const store = db.createObjectStore(IDB_STORE_NAME, { keyPath: "id" });
        store.createIndex("byKind", "kind", { unique: false });
        store.createIndex("bySubmission", "submissionId", { unique: false });
        store.createIndex("byCreatedAt", "createdAt", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function randomId() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function readRecord() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([IDB_STORE_NAME], "readonly");
    const request = tx.objectStore(IDB_STORE_NAME).get(DEVICE_RECORD_ID);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

async function writeRecord(record) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([IDB_STORE_NAME], "readwrite");
    tx.objectStore(IDB_STORE_NAME).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Returns the stable digest the server sees.
 *
  * Throws if IndexedDB or a cryptographic random generator is unavailable. The caller must treat that as
 * "cannot file right now" rather than falling back to a constant
 * value, because a shared constant would put every kiosk on earth
 * into one rate-limit bucket.
 */
export async function getFingerprint() {
  if (cached) return cached;
  if (typeof window === "undefined" || !window.indexedDB || !window.crypto?.getRandomValues) {
    throw new Error("This device cannot establish a secure session");
  }

  let record = await readRecord();
  if (!record?.deviceId) {
    record = { id: DEVICE_RECORD_ID, deviceId: randomId(), kind: "device" };
    await writeRecord(record);
  }

  if (crypto.subtle) {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(`scbms-kiosk:${record.deviceId}`)
    );
    cached = Array.from(new Uint8Array(digest))
      .slice(0, 16)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } else {
    // HTTP LAN is not a secure context: keep the original deviceId private.
    // Persist a DIFFERENT random, non-authorizing id for rate limiting.
    if (!record.lanRateLimitId) {
      record.lanRateLimitId = Array.from(crypto.getRandomValues(new Uint8Array(16)))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      await writeRecord(record);
    }
    cached = record.lanRateLimitId;
  }

  return cached;
}

/** Forgets the cached digest, e.g. after a privacy reset. */
export function clearFingerprintCache() {
  cached = null;
}
