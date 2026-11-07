/**
 * Encrypted offline queue for kiosk submissions.
 *
 * Design constraints that drive this file:
 *
 *  1. Nothing sensitive is ever written to localStorage, sessionStorage
 *     or unencrypted IndexedDB fields. A walk-in's narrative, name,
 *     mobile number and QR tokens are all sealed with AES-GCM before
 *     they touch disk.
 *  2. The key is generated with `extractable: false`. It can be used
 *     to encrypt and decrypt but can never be read back out, so
 *     neither XSS nor a stolen IndexedDB dump yields plaintext.
 *     Non-extractable does NOT stop the Service Worker from using the
 *     key: a CryptoKey stored in IndexedDB is usable by any same-origin
 *     context, so public/sw.js decrypts with exactly this key to drain
 *     the queue in the background.
 *  3. Evidence is stored as its own record per file. Listing the
 *     queue must not have to pull tens of megabytes of ciphertext
 *     into memory just to render "1 pending".
 *  4. The status token and upload token live INSIDE the encrypted
 *     payload. They are bearer capabilities; leaving them in a
 *     plaintext index would defeat the hashing done server-side.
 *
 * Everything here is browser-only. Callers must check
 * isOfflineQueueAvailable() first, because this module touches
 * indexedDB and crypto.subtle at call time, never at import time.
 */

import {
  IDB_DATABASE_NAME,
  IDB_STORE_NAME,
  IDB_KEY_STORE_NAME,
  IDB_VERSION,
  OFFLINE_STATES,
  OFFLINE_RETENTION_DAYS,
} from "./config";

const DEVICE_KEY_ID = "device-key";
const SUBMISSION_KIND = "submission";
const FILE_KIND = "file";
const IV_BYTES = 12; // 96-bit nonce, the AES-GCM standard size

// ── Availability ──────────────────────────────────────────────

/**
 * The offline queue needs IndexedDB, Web Crypto and
 * SubtleCrypto.encrypt/decrypt. Anything less and the kiosk must
 * refuse to queue rather than silently storing plaintext.
 */
export function isOfflineQueueAvailable() {
  if (typeof window === "undefined") return false;
  if (!window.indexedDB || !window.crypto || !window.crypto.subtle) return false;
  if (!window.crypto.subtle.encrypt || !window.crypto.subtle.decrypt) return false;
  return true;
}

/** Structured clone support for CryptoKey, which Safari lacked for years. */
function supportsCryptoKeyCloning() {
  try {
    if (typeof structuredClone !== "function") return false;
    // A Uint8Array probe only proves structuredClone exists, not
    // that it can carry a CryptoKey, so probe with a real key.
    return structuredClone(
      globalThis.crypto.generateKey
        ? globalThis.crypto.generateKey({ name: "AES-GCM", length: 128 }, false, [
            "encrypt",
            "decrypt",
          ])
        : new Uint8Array([0])
    ) instanceof Object;
  } catch {
    return false;
  }
}

// ── Database ──────────────────────────────────────────────────

let dbPromise = null;

function openKioskDb() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(IDB_DATABASE_NAME, IDB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(IDB_STORE_NAME)) {
        const store = db.createObjectStore(IDB_STORE_NAME, { keyPath: "id" });
        // Listing the queue filters on kind, and deleting a submission
        // has to find its evidence files without loading them.
        store.createIndex("byKind", "kind", { unique: false });
        store.createIndex("bySubmission", "submissionId", { unique: false });
        store.createIndex("byCreatedAt", "createdAt", { unique: false });
      }

      if (!db.objectStoreNames.contains(IDB_KEY_STORE_NAME)) {
        db.createObjectStore(IDB_KEY_STORE_NAME, { keyPath: "id" });
      }
    };

    request.onsuccess = () => {
      const db = request.result;
      // A second tab upgrading the schema would otherwise block.
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () =>
      reject(new Error("Kiosk storage is in use by another tab"));
  });

  // Do not cache a rejected promise; a later attempt should retry.
  dbPromise.catch(() => {
    dbPromise = null;
  });

  return dbPromise;
}

/**
 * Runs `work` inside a single IndexedDB transaction.
 *
 * `work` may be async, but every await inside it must be on an
 * IndexedDB request. A transaction stays active only while the
 * control stack has not returned to the event loop, and awaiting a
 * non-IDB promise (crypto.subtle, fetch, a timer) can let the
 * transaction auto-commit first, after which any further request
 * throws TransactionInactiveError.
 */
function runTransaction(storeNames, mode, work) {
  return openKioskDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(storeNames, mode);
        let result;
        let settled = false;

        tx.oncomplete = () => {
          if (!settled) resolve(result);
        };
        tx.onerror = () => {
          if (!settled) {
            settled = true;
            reject(tx.error);
          }
        };
        tx.onabort = () => {
          if (!settled) {
            settled = true;
            reject(tx.error || new Error("Transaction aborted"));
          }
        };

        // Start in a microtask, not synchronously, so a throwing
        // work() is caught by the same rejection path.
        Promise.resolve()
          .then(() => work(tx))
          .then((value) => {
            result = value;
          })
          .catch((error) => {
            if (settled) return;
            settled = true;
            reject(error);
            try {
              tx.abort();
            } catch {
              // Already finished; the reject above is what matters.
            }
          });
      })
  );
}

function requestAsPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// ── Crypto ────────────────────────────────────────────────────

/**
 * Returns the device key, generating it on first use.
 *
 * The stored record holds a CryptoKey, not raw bytes. Web Crypto
 * stores it as an opaque handle; `extractable: false` means no code
 * path can ask for the raw key material, including this one.
 */
export async function getDeviceKey() {
  const existing = await runTransaction([IDB_KEY_STORE_NAME], "readonly", (tx) =>
    requestAsPromise(tx.objectStore(IDB_KEY_STORE_NAME).get(DEVICE_KEY_ID))
  );
  if (existing && existing.key) return existing.key;

  if (!supportsCryptoKeyCloning()) {
    throw new Error(
      "This browser cannot store the kiosk encryption key safely"
    );
  }

  const key = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    false, // not extractable
    ["encrypt", "decrypt"]
  );

  await runTransaction([IDB_KEY_STORE_NAME], "readwrite", (tx) =>
    requestAsPromise(
      tx.objectStore(IDB_KEY_STORE_NAME).put({
        id: DEVICE_KEY_ID,
        algorithm: "AES-GCM",
        key,
        createdAt: new Date().toISOString(),
      })
    )
  );

  // Read it back rather than trusting the write. If the browser
  // stored something other than a usable CryptoKey the queue would
  // silently be undecryptable later, so fail now and loudly.
  const verified = await runTransaction([IDB_KEY_STORE_NAME], "readonly", (tx) =>
    requestAsPromise(tx.objectStore(IDB_KEY_STORE_NAME).get(DEVICE_KEY_ID))
  );
  if (!verified || !verified.key || verified.key.type !== "secret") {
    throw new Error(
      "This browser did not retain the kiosk encryption key. Offline filing is unavailable."
    );
  }

  return verified.key;
}

function randomIv() {
  return crypto.getRandomValues(new Uint8Array(IV_BYTES));
}

/** Seals bytes with a fresh nonce. Returns storable plain objects. */
export async function encryptBytes(bytes, key) {
  const iv = randomIv();
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, bytes);
  return {
    iv: iv.buffer,
    data: ciphertext,
    algorithm: "AES-GCM",
  };
}

/** Opens a sealed payload produced by encryptBytes. */
export async function decryptBytes(sealed, key) {
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: new Uint8Array(sealed.iv) },
    key,
    sealed.data
  );
  return new Uint8Array(plaintext);
}

async function sealJson(value, key) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return encryptBytes(bytes, key);
}

async function openJson(sealed, key) {
  const bytes = await decryptBytes(sealed, key);
  return JSON.parse(new TextDecoder().decode(bytes));
}

// ── Identifiers ───────────────────────────────────────────────

function newId(prefix) {
  const uuid =
    typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : Array.from(crypto.getRandomValues(new Uint8Array(16)))
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");
  return `${prefix}_${uuid}`;
}

// ── Writing ───────────────────────────────────────────────────

/**
 * Stores a submission and its evidence, all encrypted.
 *
 * @param {object} input
 * @param {object} input.payload     Form data, the idempotency key and
 *                                   every token. Sealed as one blob.
 * @param {Array}  [input.evidence]  `{ name, mime, size, blob }` items.
 * @returns {Promise<{ id: string, queuedAt: string }>}
 */
export async function queueSubmission({ payload, evidence = [] }) {
  if (!isOfflineQueueAvailable()) {
    throw new Error("Offline storage is not available on this device");
  }

  const key = await getDeviceKey();
  const id = newId("sub");
  const now = new Date().toISOString();

  const sealedPayload = await sealJson(payload, key);

  const files = [];
  for (let index = 0; index < evidence.length; index += 1) {
    const file = evidence[index];
    const buffer = await file.blob.arrayBuffer();
    const sealed = await encryptBytes(buffer, key);
    files.push({
      id: newId("file"),
      kind: FILE_KIND,
      submissionId: id,
      index,
      // Name, mime and size are shown in the queue UI, so they stay
      // readable. The bytes never do.
      name: file.name,
      mime: file.mime,
      size: file.size,
      createdAt: now,
      sealed,
    });
  }

  await runTransaction([IDB_STORE_NAME], "readwrite", async (tx) => {
    const store = tx.objectStore(IDB_STORE_NAME);
    await requestAsPromise(
      store.put({
        id,
        kind: SUBMISSION_KIND,
        state: OFFLINE_STATES.PENDING,
        attemptCount: 0,
        lastError: null,
        createdAt: now,
        updatedAt: now,
        // Non-sensitive enough to render without decrypting: a random
        // draft id and the idempotency key, neither of which is a
        // credential on its own.
        draftReference: payload.draftReference ?? null,
        clientSubmissionId: payload.clientSubmissionId ?? null,
        evidenceCount: files.length,
        payload: sealedPayload,
      })
    );
    for (const file of files) {
      await requestAsPromise(store.put(file));
    }
  });

  return { id, queuedAt: now };
}

// ── Reading ───────────────────────────────────────────────────

/** Queue entries with no ciphertext, safe to render directly. */
export async function listQueue() {
  const rows = await runTransaction([IDB_STORE_NAME], "readonly", (tx) =>
    requestAsPromise(
      tx
        .objectStore(IDB_STORE_NAME)
        .index("byKind")
        .getAll(SUBMISSION_KIND)
    )
  );
  return (rows || [])
    .map(({ payload, ...rest }) => rest)
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}

/** Counts entries that still owe the server a submission. */
export async function countPending() {
  const rows = await listQueue();
  return rows.filter(
    (row) =>
      row.state === OFFLINE_STATES.PENDING ||
      row.state === OFFLINE_STATES.SYNCING ||
      row.state === OFFLINE_STATES.FAILED
  ).length;
}

/** The full decrypted record, including any sealed evidence. */
export async function getSubmission(id) {
  const key = await getDeviceKey();
  const record = await runTransaction([IDB_STORE_NAME], "readonly", (tx) =>
    requestAsPromise(tx.objectStore(IDB_STORE_NAME).get(id))
  );
  if (!record || record.kind !== SUBMISSION_KIND) return null;

  const payload = await openJson(record.payload, key);
  const fileRows = await runTransaction([IDB_STORE_NAME], "readonly", (tx) =>
    requestAsPromise(
      tx.objectStore(IDB_STORE_NAME).index("bySubmission").getAll(id)
    )
  );

  const evidence = [];
  for (const row of (fileRows || []).sort((a, b) => a.index - b.index)) {
    const bytes = await decryptBytes(row.sealed, key);
    evidence.push({
      name: row.name,
      mime: row.mime,
      size: row.size,
      blob: new Blob([bytes], { type: row.mime }),
    });
  }

  return { ...record, payload, evidence };
}

// ── State transitions ─────────────────────────────────────────

const ALLOWED_TRANSITIONS = {
  [OFFLINE_STATES.PENDING]: [
    OFFLINE_STATES.SYNCING,
    OFFLINE_STATES.FAILED,
    OFFLINE_STATES.NEEDS_ATTENTION,
  ],
  [OFFLINE_STATES.SYNCING]: [
    OFFLINE_STATES.PENDING,
    OFFLINE_STATES.FAILED,
    OFFLINE_STATES.SYNCED,
  ],
  [OFFLINE_STATES.FAILED]: [
    OFFLINE_STATES.SYNCING,
    OFFLINE_STATES.PENDING,
    OFFLINE_STATES.NEEDS_ATTENTION,
  ],
  [OFFLINE_STATES.SYNCED]: [],
  [OFFLINE_STATES.NEEDS_ATTENTION]: [OFFLINE_STATES.PENDING],
};

export function canTransition(from, to) {
  if (from === to) return true;
  return (ALLOWED_TRANSITIONS[from] || []).includes(to);
}

/**
 * Moves an entry to a new state.
 *
 * A tab crash mid-sync leaves rows stuck in 'syncing'. The next
 * queue pass resets those back to 'pending' so a crash can never
 * strand a complaint, which is why SYNCING may return to PENDING.
 */
export async function setState(id, state, { error = null, attemptCount } = {}) {
  let applied = null;

  await runTransaction([IDB_STORE_NAME], "readwrite", async (tx) => {
    const store = tx.objectStore(IDB_STORE_NAME);
    const record = await requestAsPromise(store.get(id));
    if (!record) throw new Error("Queue entry not found");

    if (!canTransition(record.state, state)) {
      // A stale transition is not worth losing data over. Keep the
      // complaint and report the state that actually stuck, so the
      // citizen's filing is never silently dropped.
      console.warn(
        `[kiosk] refusing transition ${record.state} -> ${state} for ${id}`
      );
      applied = record.state;
      return;
    }

    applied = state;
    await requestAsPromise(
      store.put({
        ...record,
        state,
        lastError: error ? String(error).slice(0, 500) : record.lastError,
        attemptCount:
          attemptCount ??
          (error ? (record.attemptCount || 0) + 1 : record.attemptCount || 0),
        updatedAt: new Date().toISOString(),
      })
    );
  });

  return applied;
}

/** Recovers rows abandoned mid-flight by a closed or crashed tab. */
export async function releaseStaleSyncing() {
  const rows = await listQueue();
  const stale = rows.filter((row) => row.state === OFFLINE_STATES.SYNCING);
  for (const row of stale) {
    await setState(row.id, OFFLINE_STATES.PENDING);
  }
  return stale.length;
}

// ── Deleting ──────────────────────────────────────────────────

/** Removes a submission and its evidence. Used after a confirmed sync. */
export async function deleteSubmission(id) {
  await runTransaction([IDB_STORE_NAME], "readwrite", async (tx) => {
    const store = tx.objectStore(IDB_STORE_NAME);
    const files = await requestAsPromise(
      store.index("bySubmission").getAllKeys(id)
    );
    for (const fileKey of files) {
      await requestAsPromise(store.delete(fileKey));
    }
    await requestAsPromise(store.delete(id));
  });
}

/**
 * Drops entries the citizen walked away from, so an unattended kiosk
 * does not accumulate ciphertext forever. Only PENDING and FAILED
 * entries can be pruned; anything mid-flight is left alone.
 */
export async function pruneExpired(days = OFFLINE_RETENTION_DAYS) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const rows = await listQueue();
  const expired = rows.filter(
    (row) =>
      (row.state === OFFLINE_STATES.PENDING ||
        row.state === OFFLINE_STATES.FAILED) &&
      new Date(row.updatedAt || row.createdAt).getTime() < cutoff
  );
  for (const row of expired) {
    await deleteSubmission(row.id);
  }
  return expired.length;
}

/** Approximate queue size, for the storage line in the UI. */
export async function estimateUsage() {
  if (!navigator.storage || !navigator.storage.estimate) return null;
  try {
    const { usage, quota } = await navigator.storage.estimate();
    return { usage, quota };
  } catch {
    return null;
  }
}
