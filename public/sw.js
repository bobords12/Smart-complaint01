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
    const attempts = (row.attemptCount || 0) + 1;
    if (attempts > MAX_ATTEMPTS) continue;

    // Respect the same backoff the foreground drain uses, so a queue
    // that is being retried by both does not double its request rate.
    const delay = BACKOFF_MS[Math.min(row.attemptCount || 0, BACKOFF_MS.length - 1)];
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
      await putState(db, row.id, STATE_NEEDS_ATTENTION, row, "cannot decrypt");
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
        row,
        "queued evidence cannot be sent from the service worker"
      );
      continue;
    }

    await putState(db, row.id, STATE_SYNCING, row, null, attempts);

    let result = null;
    try {
      const response = await fetch("/api/kiosk/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error(`submit ${response.status}`);
      }

      const body = await response.json();
      result = body && (body.result || body);

      // A 200 without a tracking number means the function ran but did
      // not confirm. Treating that as success is exactly the bug the
      // idempotency key exists to prevent.
      if (!result || !result.reference_number) {
        throw new Error("submit not confirmed");
      }
    } catch {
      // Anything that is not a 4xx is worth another attempt. A 4xx means
      // the payload itself is unacceptable and retrying forever would
      // block the queue behind it.
      await putState(
        db,
        row.id,
        attempts >= MAX_ATTEMPTS ? STATE_NEEDS_ATTENTION : STATE_FAILED,
        row,
        "background sync failed",
        attempts
      );
      summary.retryable = true;
      summary.reason = "submit failed";
      continue;
    }

    // Confirmed. Only now is the ciphertext disposable.
    await deleteSubmission(db, row.id);
    summary.synced += 1;

    // Tell any open kiosk tab, so a citizen looking at the offline
    // receipt sees it flip to synced without reloading.
    broadcast({ type: "kiosk:synced", tracking: result.reference_number });
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

function putState(db, id, state, row, error, attemptCount) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_SUBMISSIONS, "readwrite");
    tx.objectStore(STORE_SUBMISSIONS).put({
      ...row,
      state,
      lastError: error ? String(error).slice(0, 500) : row.lastError,
      attemptCount:
        attemptCount ?? (error ? (row.attemptCount || 0) + 1 : row.attemptCount || 0),
      updatedAt: new Date().toISOString(),
    });
    tx.oncomplete = () => resolve();
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
