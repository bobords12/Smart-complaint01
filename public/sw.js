/**
 * Barangay Abuno Public Kiosk — service worker.
 *
 * Registered only for the /kiosk/ scope. Nothing under /resident,
 * /captain, /oic, /secretary, /lupon or /pnp is in scope, so this file
 * cannot intercept a single request belonging to a staff portal.
 *
 * ── What is cached ──────────────────────────────────────────────
 * The application shell only:
 *
 *   - /_next/static/*   content-hashed build output, immutable, safe to
 *                      serve from cache forever
 *   - /kiosk           the wizard shell, so a walk-in who finds the
 *                      hall's internet down still gets a working screen
 *                      that can accept an offline filing
 *   - /kiosk/status    the manual lookup shell
 *
 * ── What is never cached ────────────────────────────────────────
 *   /api/kiosk/*       every one of these is per-citizen: a submission,
 *                      a status payload, an upload session. Caching any
 *                      of them would put one resident's complaint in
 *                      front of the next one. They are passed straight
 *                      through, and a failure is reported as a failure
 *                      rather than masked by a stale copy.
 *
 *   /kiosk/upload/*    token-bearing. A cached copy of someone's upload
 *                      page would outlive the token and defeat its
 *                      ten-minute expiry.
 *   /kiosk/status/*    same reasoning: the path IS the credential.
 *
 * ── Background Sync ─────────────────────────────────────────────
 * This is the part that makes "saved, will send itself" true after the
 * citizen walks away from the kiosk. `sync.js` registers the tag from the
 * page; this handler drains the encrypted queue when the browser decides
 * connectivity is back.
 *
 * The old comment in offlineStore.js claimed the Service Worker could not
 * do this because the device key is non-extractable. That was wrong, and
 * it was wrong in a way that mattered: `extractable: false` prevents
 * reading the raw key bytes out, and nothing more. A CryptoKey stored in
 * IndexedDB is fully usable by any same-origin context, worker included,
 * so `crypto.subtle.decrypt` works here exactly as it does in the page.
 * The handler below proves it rather than asserting it.
 *
 * If any of that is unavailable — no SubtleCrypto (a plain-http LAN
 * address is not a secure context), an old browser, no Background Sync at
 * all — the handler returns quietly and the page's own drain (a 30s
 * interval plus the `online` event, in app/kiosk/page.jsx) takes over.
 * Nothing here is required for the kiosk to work.
 */

const VERSION = "kiosk-v1";
const SHELL_CACHE = `${VERSION}-shell`;
const STATIC_CACHE = `${VERSION}-static`;

/** The two documents that make up the cached application shell. */
const SHELL_URLS = ["/kiosk", "/kiosk/status"];

/** Sync tags this worker owns. */
const SYNC_TAG = "kiosk-outbox";

// ─────────────────────────────────────────────────────────────
// Queue constants. These mirror lib/kiosk/config.js and
// lib/kiosk/offlineStore.js and MUST stay in step with them.
//
// They are duplicated rather than imported because a service worker is a
// classic script served from /public: it cannot resolve the "@/" alias and
// has no build step. Keeping the values in one commented block here makes
// the coupling visible instead of hiding it in a build config.
// ─────────────────────────────────────────────────────────────
const IDB_NAME = "scbms_kiosk";
const IDB_VERSION = 1;
const STORE_SUBMISSIONS = "submissions";
const STORE_KEYS = "keys";
const DEVICE_KEY_ID = "device-key";
const KIND_SUBMISSION = "submission";
const STATE_PENDING = "pending_sync";
const STATE_SYNCING = "syncing";
const STATE_FAILED = "sync_failed";
const STATE_NEEDS_ATTENTION = "needs_attention";

/** Attempts before an entry stops being retried automatically. */
const MAX_ATTEMPTS = 6;

/** Backoff in ms, parallel to BACKOFF_MS in lib/kiosk/sync.js. */
const BACKOFF_MS = [0, 2000, 5000, 15000, 30000, 60000];

// ─────────────────────────────────────────────────────────────
// Retryable-versus-terminal classification.
//
// These mirror KioskRequestError.retryable in lib/kiosk/api.js and MUST
// stay in step with it: the page engine and this worker drain the same
// queue, and a filing that one engine retries while the other parks is a
// filing that ends up in the wrong state depending on which one ran last.
// They are duplicated rather than imported for the same reason the queue
// constants above are: this file is a classic script with no build step.
// ─────────────────────────────────────────────────────────────

/** Codes that mean "the service could not answer", not "the payload is wrong". */
const RETRYABLE_CODES = new Set([
  "network",
  "unavailable",
  "upload_failed",
  "unconfirmed",
  "rate_limited",
]);

/** Throttling and gateway statuses this client does not own. */
const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);

/** The one rate-limit message the kiosk SQL raises (see kiosk-02). */
const RATE_LIMIT_MESSAGE = /^too many/i;

/** Cooldown when the server refuses a rate-limited submission with no
 *  Retry-After. Parallel to RATE_LIMIT_COOLDOWN_MS in lib/kiosk/sync.js. */
const RATE_LIMIT_COOLDOWN_MS = 5 * 60 * 1000;

/** Bounds for a server-supplied Retry-After. */
const RETRY_AFTER_MIN_MS = 30 * 1000;
const RETRY_AFTER_MAX_MS = 30 * 60 * 1000;

/** When the device's submission budget next allows another attempt.
 *  Parallel to rateLimitedUntil in lib/kiosk/sync.js (each engine keeps
 *  its own copy because neither can share state with the other). */
let rateLimitedUntil = 0;

function deferMs(retryAfterMs) {
  const asked = Number.isFinite(retryAfterMs) ? retryAfterMs : RATE_LIMIT_COOLDOWN_MS;
  return Math.min(Math.max(asked, RETRY_AFTER_MIN_MS), RETRY_AFTER_MAX_MS);
}

/** `Retry-After` in ms; seconds or an HTTP-date. Mirrors parseRetryAfter
 *  in lib/kiosk/api.js. */
function parseRetryAfter(headers) {
  const raw = typeof headers?.get === "function" ? headers.get("retry-after") : null;
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(raw);
  return Number.isNaN(at) ? null : Math.max(0, at - Date.now());
}

/**
 * Decides what a refused submit means: retry, defer, or park.
 *
 * @returns {{ ok: false, retryable: boolean, deferred?: boolean,
 *             retryAfterMs?: number|null, label: string }}
 */
function classifyRejection(status, body, headers) {
  const code = body && typeof body.code === "string" ? body.code : "unavailable";
  const message = body && typeof body.message === "string" ? body.message : null;

  // 1. A temporary budget. Checked before anything else, because the
  //    SQL raises it as code `rejected` — the same code a genuine
  //    refusal uses — and only the message tells them apart.
  if (
    status === 429 ||
    code === "rate_limited" ||
    (code === "rejected" && message && RATE_LIMIT_MESSAGE.test(message))
  ) {
    return {
      ok: false,
      retryable: true,
      deferred: true,
      retryAfterMs: parseRetryAfter(headers),
      label: `rate_limited: ${message || `submit ${status}`}`,
    };
  }

  // 2. Everything else: identical rule to KioskRequestError.retryable.
  //    A body that is not a JSON object counts as `unavailable`, which
  //    is what the page engine calls it too.
  const retryable = RETRYABLE_CODES.has(code) || RETRYABLE_STATUSES.has(status);
  return { ok: false, retryable, label: code };
}

/**
 * One attempt at POST /api/kiosk/submit.
 *
 * Never throws: every failure is turned into a verdict, so the caller
 * can classify instead of guessing from an error string.
 */
async function submitOnce(payload) {
  let response;
  try {
    response = await fetch("/api/kiosk/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
    });
  } catch {
    // No connection at all. Worth another attempt.
    return { ok: false, retryable: true, label: "network" };
  }

  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!response.ok || (body && body.ok === false)) {
    return classifyRejection(response.status, body, response.headers);
  }

  const result = body && (body.result || body);

  // A 200 without a tracking number means the function ran but did not
  // confirm. Treating that as success is exactly the bug the idempotency
  // key exists to prevent, and treating it as terminal would strand a
  // filing the server may already hold — so it is retried, and the next
  // attempt returns the real row.
  if (!result || !result.reference_number) {
    return { ok: false, retryable: true, label: "unconfirmed" };
  }

  return { ok: true, result };
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // Individually, so one 404 does not abort the whole install and
      // leave the kiosk with no worker at all.
      await Promise.all(
        SHELL_URLS.map((url) =>
          cache.add(new Request(url, { cache: "reload" })).catch(() => {})
        )
      );
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Drop every cache from a previous VERSION so an update cannot
      // serve a stale shell forever.
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name !== SHELL_CACHE && name !== STATIC_CACHE)
          .map((name) => caches.delete(name))
      );

      // A previous worker may still be controlling a kiosk tab that was
      // left open across the update.
      await self.clients.claim();

      // Background Sync survives a worker being replaced, but only if the
      // pending tag is re-registered. Doing it here covers the case
      // where an update landed between queueing and reconnecting.
      try {
        await self.registration.sync.register(SYNC_TAG);
      } catch {
        // No Background Sync on this browser. The page-level drain
        // covers it; see the header comment.
      }
    })()
  );
});

self.addEventListener("message", (event) => {
  const type = event.data && event.data.type;

  if (type === "kiosk:skip-waiting") {
    self.skipWaiting();
    return;
  }

  // A page asking for a drain it cannot do itself, e.g. it just came
  // back to the foreground.
  if (type === "kiosk:drain") {
    event.waitUntil(drainQueue().then((result) => {
      if (event.source) event.source.postMessage({ type: "kiosk:drained", ...result });
    }));
  }
});

self.addEventListener("sync", (event) => {
  if (event.tag !== SYNC_TAG) return;

  event.waitUntil(
    drainQueue().then((result) => {
      // Throwing is how a Service Worker asks the browser to schedule
      // another attempt, which is the only backpressure available here.
      // Only for a transient failure: a rejected request should be
      // retried, an empty queue should not.
      if (result.retryable) {
        throw new Error("kiosk outbox still has work");
      }
    })
  );
});

// ─────────────────────────────────────────────────────────────
// Fetch
// ─────────────────────────────────────────────────────────────
self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }

  if (url.origin !== self.location.origin) return;

  // Never cache a single API response. This is the rule that keeps the
  // shared kiosk safe: no complaint, no status payload, no signed
  // evidence URL and no auth response is ever written to disk by the
  // worker.
  if (url.pathname.startsWith("/api/")) return;

  // Token-bearing pages. Network only, and a failure stays a failure.
  if (url.pathname.startsWith("/kiosk/upload/")) return;
  if (url.pathname.startsWith("/kiosk/status/")) return;

  // Build output. Content-hashed filenames make this safe to serve
  // without revalidating, and it is what lets the shell render with no
  // network at all.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  // Shell navigations. Network first so a citizen always sees current
  // behaviour when the hall has internet, cache second so they still get
  // a working screen when it does not.
  if (SHELL_URLS.includes(url.pathname)) {
    event.respondWith(networkFirst(request, SHELL_CACHE, url.pathname));
    return;
  }

  // Everything else under the kiosk scope (e.g. the logo) is passed
  // through and only opportunistically cached.
  if (url.pathname.startsWith("/kiosk")) {
    event.respondWith(staleWhileRevalidate(request, STATIC_CACHE));
  }
});

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;

  const response = await fetch(request);
  if (response.ok && response.type === "basic") {
    cache.put(request, response.clone()).catch(() => {});
  }
  return response;
}

async function networkFirst(request, cacheName, shellPath) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok && response.type === "basic") {
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch (error) {
    const hit = (await cache.match(request)) || (await cache.match(shellPath));
    if (hit) return hit;
    throw error;
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);

  const network = fetch(request)
    .then((response) => {
      if (response.ok && response.type === "basic") {
        cache.put(request, response.clone()).catch(() => {});
      }
      return response;
    })
    .catch(() => hit);

  return hit || network;
}

// ─────────────────────────────────────────────────────────────
// The outbox drain
// ─────────────────────────────────────────────────────────────

/**
 * Sends every queued complaint and clears the ones the server confirms.
 *
 * The safety property is idempotency, not bookkeeping. Every payload
 * carries its own `clientSubmissionId`, and kiosk_submit_complaint()
 * returns the existing row when it meets a key it has already used, so
 * running this twice, or running it after a half-finished attempt, cannot
 * produce a second complaint. That is why the handler below re-sends the
 * whole body rather than trying to remember how far it got.
 *
 * @returns {Promise<{ synced: number, retryable: boolean, reason: string }>}
 */
async function drainQueue() {
  const summary = { synced: 0, retryable: false, reason: "" };

  // No SubtleCrypto means this is not a secure context, so the queue was
  // never usable and there is nothing to decrypt.
  if (!self.crypto || !self.crypto.subtle || !self.indexedDB) {
    return summary;
  }

  let db;
  try {
    db = await openDb();
  } catch {
    return summary;
  }

  let rows;
  try {
    rows = await getAll(db, STORE_SUBMISSIONS, KIND_SUBMISSION);
  } catch {
    return summary;
  }

  const pending = rows
    .filter((row) => row.state === STATE_PENDING || row.state === STATE_FAILED)
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));

  for (const row of pending) {
    // The same device-wide deferral the page engine applies: while the
    // fingerprint's submit budget is spent, every row would be refused
    // by the same wall, so nothing is sent and the browser is asked to
    // wake us again later rather than spinning on a closed door.
    if (Date.now() < rateLimitedUntil) {
      summary.retryable = true;
      summary.reason = "rate limited";
      break;
    }

    const previousAttempts = row.attemptCount || 0;
    const attempts = previousAttempts + 1;
    if (attempts > MAX_ATTEMPTS) {
      // Already past the budget. Park it exactly as the page engine
      // parks an entry whose attempts are exhausted, instead of leaving
      // it in sync_failed where neither engine would look again.
      await putState(db, row.id, STATE_NEEDS_ATTENTION, "retries exhausted", "increment");
      continue;
    }

    // Respect the same backoff the foreground drain uses, so a queue
    // that is being retried by both does not double its request rate.
    const delay = BACKOFF_MS[Math.min(previousAttempts, BACKOFF_MS.length - 1)];
    if (delay > 0) await sleep(delay);

    let payload = null;
    try {
      const key = await getDeviceKey(db);
      if (!key) return { ...summary, retryable: true, reason: "no-key" };
      payload = await openJson(row.payload, key);
    } catch {
      // Undecryptable. The ciphertext is still here, so it is left in
      // place and flagged rather than deleted: silently dropping a
      // citizen's complaint is the one outcome never acceptable.
      await putState(db, row.id, STATE_NEEDS_ATTENTION, "cannot decrypt", "increment");
      continue;
    }

    // Evidence.
    //
    // The kiosk's offline flow stores no evidence blobs: the only
    // evidence route in the design is a phone scanning a QR code, which
    // needs a working connection, so an offline filing has no
    // attachments. An entry that somehow carries files is NOT submitted
    // without them, because that would file a complaint whose evidence
    // was silently dropped. It is parked for staff attention instead.
    if ((row.evidenceCount || 0) > 0) {
      await putState(
        db,
        row.id,
        STATE_NEEDS_ATTENTION,
        "queued evidence cannot be sent from the service worker",
        "increment"
      );
      continue;
    }

    await putState(db, row.id, STATE_SYNCING, null, "increment");

    const outcome = await submitOnce(payload);

    if (outcome.ok) {
      // Confirmed. Only now is the ciphertext disposable.
      await deleteSubmission(db, row.id);
      summary.synced += 1;

      // Tell any open kiosk tab, so a citizen looking at the offline
      // receipt sees it flip to synced without reloading.
      broadcast({ type: "kiosk:synced", tracking: outcome.result.reference_number });
      continue;
    }

    if (outcome.deferred) {
      // A rate limit is a deferral, not a failure: the payload is fine
      // and the window rolls over by itself, so the attempt budget is
      // handed back untouched.
      rateLimitedUntil = Date.now() + deferMs(outcome.retryAfterMs);
      await putState(db, row.id, STATE_FAILED, outcome.label, "rollback");
      summary.retryable = true;
      summary.reason = "rate limited";
      continue;
    }

    if (!outcome.retryable) {
      // The payload itself is unacceptable. Retrying it would block the
      // queue behind a row that can never succeed, so it is parked for
      // staff attention — the same verdict the page engine reaches.
      await putState(db, row.id, STATE_NEEDS_ATTENTION, outcome.label, "keep");
      continue;
    }

    // Transient. Try again later; past the budget, park it.
    await putState(
      db,
      row.id,
      attempts >= MAX_ATTEMPTS ? STATE_NEEDS_ATTENTION : STATE_FAILED,
      outcome.label,
      "keep"
    );
    summary.retryable = true;
    summary.reason = outcome.label;
  }

  return summary;
}

function broadcast(message) {
  self.clients
    .matchAll({ includeUncontrolled: true, type: "window" })
    .then((clients) => {
      for (const client of clients) client.postMessage(message);
    })
    .catch(() => {});
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── IndexedDB ───────────────────────────────────────────────────
// The transaction discipline mirrors lib/kiosk/offlineStore.js: only
// IndexedDB requests are awaited inside a transaction, because awaiting
// anything else lets it auto-commit under us.

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IDB_NAME, IDB_VERSION);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("kiosk storage is in use"));
  });
}

function getAll(db, storeName, kind) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const index = tx.objectStore(storeName).index("byKind");
    const request = index.getAll(kind);
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

function getDeviceKey(db) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_KEYS, "readonly");
    const request = tx.objectStore(STORE_KEYS).get(DEVICE_KEY_ID);
    request.onsuccess = () =>
      resolve(request.result && request.result.key ? request.result.key : null);
    request.onerror = () => reject(request.error);
  });
}

/** AES-GCM, using the device key stored by offlineStore.getDeviceKey(). */
function openJson(sealed, key) {
  return crypto.subtle
    .decrypt({ name: "AES-GCM", iv: new Uint8Array(sealed.iv) }, key, sealed.data)
    .then((plaintext) => JSON.parse(new TextDecoder().decode(plaintext)));
}

/**
 * Writes a state change against the LATEST stored record.
 *
 * The drain holds rows read at the start of its pass; between that read
 * and this write the page engine may have moved the row on, parked it,
 * or the server may have confirmed it and removed it. Writing the old
 * snapshot back would resurrect a confirmed filing, un-park one a person
 * is looking at, or roll the attempt budget backwards — so the record is
 * re-read inside this transaction and the write is based on that:
 *
 *   - gone            → no write (never resurrect a confirmed filing)
 *   - needs_attention → no write (a parked verdict outranks a stale one)
 *   - otherwise       → the latest record, updated per `attemptMode`:
 *       "increment" count this attempt (syncing, and the
 *                                pre-send parks that never sent)
 *                         "keep"     leave the count the syncing write set
 *                         "rollback" hand back the attempt the rate
 *                                limit refused to open
 *
 * Resolves `true` only once the transaction has committed with a write,
 * `false` when the write was skipped; transaction errors and aborts
 * reject.
 */
function putState(db, id, state, error, attemptMode) {
  if (attemptMode !== "increment" && attemptMode !== "keep" && attemptMode !== "rollback") {
    return Promise.reject(new Error(`putState: unknown attempt mode "${attemptMode}"`));
  }

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_SUBMISSIONS, "readwrite");
    const store = tx.objectStore(STORE_SUBMISSIONS);
    let written = false;

    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const current = getReq.result;
      // Skipped: the filing is already gone (confirmed and removed by
      // the page, or an earlier drain), or it is parked for a person and
      // a stale snapshot may not overrule that verdict.
      if (!current || current.state === STATE_NEEDS_ATTENTION) return;

      const base = current.attemptCount || 0;
      const attemptCount =
        attemptMode === "increment" ? base + 1 :
        attemptMode === "rollback" ? Math.max(0, base - 1) :
        base;

      store.put({
        ...current,
        state,
        lastError: error ? String(error).slice(0, 500) : current.lastError,
        attemptCount,
        updatedAt: new Date().toISOString(),
      });
      written = true;
    };
    getReq.onerror = () => reject(getReq.error);
    // Resolving only on commit means a `true` answer is a durable write.
    tx.oncomplete = () => resolve(written);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("aborted"));
  });
}

function deleteSubmission(db, id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_SUBMISSIONS, "readwrite");
    const store = tx.objectStore(STORE_SUBMISSIONS);

    const fileKeysRequest = store.index("bySubmission").getAllKeys(id);
    fileKeysRequest.onsuccess = () => {
      for (const key of fileKeysRequest.result || []) store.delete(key);
      store.delete(id);
    };

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("aborted"));
  });
}
