/**
 * Offline queue synchronisation tests: scripts/test-kiosk-offline-sync.mjs
 *
 * Covers the kiosk offline-first sync engine end to end:
 *
 *   1. a `needs_attention` entry is skipped silently and does not stall
 *      the queue behind it,
 *   2. transient faults (network, 502-unconfirmed, 503, 504) stay
 *      retryable while payload validation stays terminal,
 *   3. a rate limit defers without consuming the six-attempt budget and
 *      honours `Retry-After`,
 *   4. the page engine (lib/kiosk/sync.js) and the background engine
 *      (public/sw.js) reach the *same* verdict for the *same* response,
 *   5. queued ciphertext is never modified by any of it,
 *   6. a stale service worker write can neither resurrect a confirmed
 *      filing nor un-park one held for attention, and it always counts
 *      attempts against the latest stored record.
 *
 * Environment notes
 * -----------------
 * - The kiosk modules are the real production sources, loaded through
 *   scripts/kiosk-test-resolver.mjs (extensionless + `@/` resolution).
 * - IndexedDB is a purpose-built in-memory stand-in: these tests run in
 *   Node, so there is no browser profile, no real `scbms_kiosk` database
 *   and no real submission anywhere near this process. Nothing in a
 *   user's browser is read, written, reset or deleted here.
 * - `public/sw.js` is evaluated as a classic script, exactly as a browser
 *   evaluates a non-module service worker.
 *
 * Run: node scripts/test-kiosk-offline-sync.mjs
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

// ── A minimal IndexedDB ───────────────────────────────────────────────
//
// Only what lib/kiosk/offlineStore.js and public/sw.js actually use:
// open/upgrade, readwrite and readonly transactions that complete when
// their requests drain, keyed stores, and the two indexes the queue
// filters on. Requests resolve on a microtask and transactions commit on
// a macrotask, which is the same shape the real API has: work inside a
// transaction must not await anything but IndexedDB itself.

function createFakeIndexedDb() {
  const databases = new Map();

  function ensure(name) {
    let db = databases.get(name);
    if (!db) {
      db = { version: 0, stores: new Map() };
      databases.set(name, db);
    }
    return db;
  }

  function makeStore(storeDef, tx) {
    const { keyPath, records, indexes } = storeDef;

    function request(compute) {
      const req = { onsuccess: null, onerror: null, result: undefined, error: null };
      tx.pending += 1;
      queueMicrotask(() => {
        tx.pending -= 1;
        req.result = compute();
        req.onsuccess?.({ target: req });
        tx.schedule();
      });
      return req;
    }

    function indexRows(indexDef, key) {
      const rows = [];
      for (const [recordKey, value] of records) {
        if (key !== undefined && value?.[indexDef.keyPath] !== key) continue;
        rows.push({ key: recordKey, value });
      }
      return rows;
    }

    return {
      put(value) {
        const key = value?.[keyPath];
        if (key === undefined || key === null) {
          throw new Error(`A record without "${keyPath}" cannot be stored`);
        }
        records.set(key, value);
        return request(() => key);
      },
      get(key) {
        return request(() => records.get(key));
      },
      delete(key) {
        records.delete(key);
        return request(() => undefined);
      },
      getAll(key) {
        return request(() => {
          const out = [];
          for (const [recordKey, value] of records) {
            if (key !== undefined && recordKey !== key) continue;
            out.push(value);
          }
          return out;
        });
      },
      getAllKeys(key) {
        return request(() => {
          const out = [];
          for (const [recordKey] of records) {
            if (key !== undefined && recordKey !== key) continue;
            out.push(recordKey);
          }
          return out;
        });
      },
      index(name) {
        const indexDef = indexes.get(name);
        if (!indexDef) throw new Error(`Index "${name}" does not exist`);
        return {
          getAll: (key) => request(() => indexRows(indexDef, key).map((row) => row.value)),
          getAllKeys: (key) => request(() => indexRows(indexDef, key).map((row) => row.key)),
        };
      },
    };
  }

  function makeTransaction(dbState, storeNames, mode) {
    const names = Array.isArray(storeNames) ? storeNames : [storeNames];
    const stores = new Map();

    const tx = {
      mode,
      oncomplete: null,
      onerror: null,
      onabort: null,
      error: null,
      pending: 0,
      finished: false,
      aborted: false,
      armed: false,
      objectStore(name) {
        if (!names.includes(name)) throw new Error(`"${name}" is not in this transaction`);
        if (!dbState.stores.has(name)) throw new Error(`Store "${name}" is not in this database`);
        if (!stores.has(name)) stores.set(name, makeStore(dbState.stores.get(name), tx));
        return stores.get(name);
      },
      abort() {
        if (tx.finished) return;
        tx.aborted = true;
        tx.schedule();
      },
      schedule() {
        if (tx.armed || tx.finished) return;
        tx.armed = true;
        setTimeout(() => {
          tx.armed = false;
          if (tx.finished) return;
          if (tx.pending > 0) {
            tx.schedule();
            return;
          }
          tx.finished = true;
          if (tx.aborted) {
            tx.onabort?.({ target: tx });
            return;
          }
          tx.oncomplete?.({ target: tx });
        }, 0);
      },
    };

    tx.schedule();
    return tx;
  }

  function makeDatabase(dbState) {
    return {
      onversionchange: null,
      objectStoreNames: {
        contains: (name) => dbState.stores.has(name),
        length: dbState.stores.size,
        item: (i) => [...dbState.stores.keys()][i] ?? null,
      },
      createObjectStore(name, options = {}) {
        const storeDef = {
          keyPath: options.keyPath ?? "id",
          records: new Map(),
          indexes: new Map(),
        };
        dbState.stores.set(name, storeDef);
        return {
          createIndex(indexName, indexKeyPath) {
            storeDef.indexes.set(indexName, { keyPath: indexKeyPath });
          },
        };
      },
      transaction(storeNames, mode) {
        return makeTransaction(dbState, storeNames, mode || "readonly");
      },
      close() {},
    };
  }

  const database = {
    databases,
    open(name, version = 1) {
      const req = {
        onupgradeneeded: null,
        onsuccess: null,
        onerror: null,
        onblocked: null,
        error: null,
        result: null,
      };
      queueMicrotask(() => {
        const dbState = ensure(name);
        const oldVersion = dbState.version;
        const needsUpgrade = version > oldVersion;
        req.result = makeDatabase(dbState);
        if (needsUpgrade) {
          dbState.version = version;
          req.onupgradeneeded?.({ target: req, oldVersion, newVersion: version });
        }
        req.onsuccess?.({ target: req });
      });
      return req;
    },
    /** Test-only: read a record exactly as it sits on disk. */
    raw(dbName, storeName, key) {
      return databases.get(dbName)?.stores.get(storeName)?.records.get(key);
    },
  };

  return database;
}

// ── Environment ───────────────────────────────────────────────────────

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SW_PATH = path.resolve(HERE, "..", "public", "sw.js");

register("./kiosk-test-resolver.mjs", import.meta.url);

const fakeIndexedDb = createFakeIndexedDb();
globalThis.window = globalThis;
globalThis.indexedDB = fakeIndexedDb;

const offlineStore = await import("../lib/kiosk/offlineStore.js");
const sync = await import("../lib/kiosk/sync.js");
const api = await import("../lib/kiosk/api.js");
const { OFFLINE_STATES, IDB_DATABASE_NAME, IDB_STORE_NAME } = await import("../lib/kiosk/config.js");

const {
  canTransition,
  deleteSubmission,
  getSubmission,
  listQueue,
  queueSubmission,
  setState,
} = offlineStore;
const { syncQueue, rateLimitDeferralEndsAt } = sync;
const { KioskRequestError, isRateLimitRejection, submitComplaint } = api;

// ── Helpers ───────────────────────────────────────────────────────────

function makeResponse(status, body, headers = {}) {
  const map = new Map(
    Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value])
  );
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => map.get(String(name).toLowerCase()) ?? null },
    json: async () => {
      if (body === undefined) throw new SyntaxError("Unexpected token in JSON");
      return body;
    },
  };
}

function stubFetch(handler) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const entry = {
      url: String(url),
      init,
      body: init?.body ? JSON.parse(init.body) : null,
    };
    calls.push(entry);
    return handler(entry, calls.length);
  };
  return calls;
}

function captureWarnings() {
  const warnings = [];
  const original = console.warn;
  console.warn = (...args) => {
    warnings.push(args.map((arg) => (arg instanceof Error ? arg.message : String(arg))).join(" "));
  };
  return {
    warnings,
    refusals: () => warnings.filter((line) => line.includes("refusing transition")),
    restore: () => {
      console.warn = original;
    },
  };
}

function makePayload(extra = {}) {
  return {
    clientSubmissionId: crypto.randomUUID(),
    fingerprint: "0123456789abcdef",
    statusToken: "a".repeat(64),
    draftReference: crypto.randomUUID(),
    complainantSnapshot: {
      first_name: "Juan",
      last_name: "Dela Cruz",
      mobile_number: "09171234567",
      house_street: "123 Main St",
      purok: "Purok 1",
      filing_mode: "guest",
    },
    otherPartyStatus: "known",
    respondentName: "Persona Non Grata",
    incidentDate: "2026-11-01",
    incidentTime: "09:30:00",
    incidentLocation: "Abuno",
    incidentOngoing: false,
    immediateSafety: false,
    narrative: "A sufficiently long narrative for this test complaint.",
    evidence: [],
    privacyConsentAt: new Date().toISOString(),
    accuracyConfirmedAt: new Date().toISOString(),
    submittedOffline: true,
    queuedAt: new Date().toISOString(),
    ...extra,
  };
}

async function queueRow(extra = {}) {
  const payload = makePayload(extra);
  const { id } = await queueSubmission({ payload, evidence: [] });
  return { id, payload };
}

async function readRow(id) {
  const record = await getSubmission(id);
  if (!record) return null;
  return {
    state: record.state,
    attemptCount: record.attemptCount || 0,
    lastError: record.lastError,
    payload: record.payload,
  };
}

async function cleanup(ids) {
  for (const id of ids) {
    try {
      await deleteSubmission(id);
    } catch {
      // Already gone; the tests assert on what they can see.
    }
  }
}

// ── The service worker, evaluated as a classic script ─────────────────

const swHandlers = {};

globalThis.self = {
  addEventListener(type, handler) {
    (swHandlers[type] ??= []).push(handler);
  },
  crypto: globalThis.crypto,
  indexedDB: globalThis.indexedDB,
  clients: { matchAll: async () => [] },
  registration: { sync: { register: async () => {} } },
  skipWaiting() {},
  location: new URL("https://kiosk.test/sw.js"),
};

vm.runInThisContext(readFileSync(SW_PATH, "utf8"), { filename: "public/sw.js" });

// Top-level function declarations in a classic script become properties
// of the global object, so the worker's own putState/openDb are callable
// here without going through a handler.
const { openDb, putState } = globalThis;

/**
 * Fires the worker's Background Sync handler.
 *
 * The handler rejects on purpose when the queue still owes the server a
 * retry — that rejection IS how a service worker asks the browser to wake
 * it again — so a rejection is reported as `{ retryable: true }`.
 */
async function runBackgroundSync() {
  const handlers = swHandlers.sync ?? [];
  assert.ok(handlers.length > 0, "sw.js must register a sync handler");

  let promise = null;
  for (const handler of handlers) {
    handler({ tag: "kiosk-outbox", waitUntil: (work) => { promise = work; } });
  }
  assert.ok(promise, "the sync handler must call waitUntil()");

  try {
    await promise;
    return { retryable: false };
  } catch {
    return { retryable: true };
  }
}

// ── 1. State machine ──────────────────────────────────────────────────

test("needs_attention can only ever return to pending_sync", () => {
  const S = OFFLINE_STATES;
  assert.equal(canTransition(S.NEEDS_ATTENTION, S.SYNCING), false,
    "the state machine must refuse needs_attention -> syncing");
  assert.equal(canTransition(S.NEEDS_ATTENTION, S.SYNCED), false);
  assert.equal(canTransition(S.NEEDS_ATTENTION, S.FAILED), false);
  assert.equal(canTransition(S.NEEDS_ATTENTION, S.PENDING), true,
    "a person moving the entry back to pending_sync is the only way out");

  assert.equal(canTransition(S.PENDING, S.SYNCING), true);
  assert.equal(canTransition(S.SYNCING, S.SYNCING), true, "concurrent drains tolerate same-state");
  assert.equal(canTransition(S.SYNCING, S.FAILED), true);
  assert.equal(canTransition(S.SYNCING, S.SYNCED), true);
  assert.equal(canTransition(S.SYNCING, S.PENDING), true, "crash recovery");
  assert.equal(canTransition(S.FAILED, S.SYNCING), true);
  assert.equal(canTransition(S.SYNCED, S.PENDING), false, "synced is terminal");
});

// ── 2. Error classification ───────────────────────────────────────────

test("retryable covers throttling, gateway faults and unconfirmed; validation stays terminal", () => {
  const retryable = (code, status, message = "boom") =>
    new KioskRequestError(message, { code, status }).retryable;

  // Retryable.
  assert.equal(retryable("network", 0), true, "temporary network failure");
  assert.equal(retryable("unavailable", 500), true, "unexpected server fault");
  assert.equal(retryable("upload_failed", 0), true, "evidence upload fault");
  assert.equal(retryable("unconfirmed", 502), true,
    "a 200 without a tracking number may already be filed; idempotency makes the retry safe");
  assert.equal(retryable("rate_limited", 429), true);
  assert.equal(retryable("anything", 429), true, "HTTP 429 is a deferral");
  assert.equal(retryable("anything", 503), true);
  assert.equal(retryable("anything", 504), true);
  assert.equal(retryable("stall", 502), true, "bad gateway is worth another attempt");

  // Terminal: the payload itself is refused.
  assert.equal(retryable("invalid_input", 400), false);
  assert.equal(retryable("not_found", 404), false);
  assert.equal(retryable("rejected", 400, "Enter your full name."), false,
    "a genuine server rejection must not be retried");
});

test("the SQL rate-limit RAISE is recognised as a deferral, not a rejection", () => {
  const limit = new KioskRequestError("Too many submissions. Please try again later.", {
    code: "rejected",
    status: 400,
  });
  assert.equal(isRateLimitRejection(limit), true,
    "code rejected + a 'Too many…' message is kiosk_submit_complaint's throttle");
  assert.equal(limit.retryable, true);

  const refusal = new KioskRequestError("Enter your full name.", {
    code: "rejected",
    status: 400,
  });
  assert.equal(isRateLimitRejection(refusal), false, "same code, real refusal");
  assert.equal(refusal.retryable, false);

  assert.equal(isRateLimitRejection(new KioskRequestError("slow down", { code: "rate_limited", status: 429 })), true);
  assert.equal(isRateLimitRejection(null), false);
});

test("Retry-After is parsed from the response in both supported shapes", async (t) => {
  t.after(() => stubFetch(() => makeResponse(200, { ok: true, result: {} })));

  stubFetch(() =>
    makeResponse(429, { ok: false, code: "rate_limited", message: "Too many requests" }, { "Retry-After": "90" })
  );
  const seconds = await submitComplaint(makePayload()).catch((error) => error);
  assert.ok(seconds instanceof KioskRequestError);
  assert.equal(seconds.retryAfterMs, 90000, "seconds form");
  assert.equal(seconds.retryable, true);

  const when = new Date(Date.now() + 60_000).toUTCString();
  stubFetch(() =>
    makeResponse(503, { ok: false, code: "unavailable", message: "later" }, { "Retry-After": when })
  );
  const date = await submitComplaint(makePayload()).catch((error) => error);
  assert.ok(date.retryAfterMs > 55_000 && date.retryAfterMs <= 60_000, "HTTP-date form");

  stubFetch(() => makeResponse(500, { ok: false, code: "unavailable", message: "no header" }));
  const none = await submitComplaint(makePayload()).catch((error) => error);
  assert.equal(none.retryAfterMs, null);
});

// ── 3. Page engine: lib/kiosk/sync.js ─────────────────────────────────

test("a parked entry is skipped silently and does not stall the queue behind it", async (t) => {
  const parked = await queueRow();
  const healthy = await queueRow();
  t.after(() => cleanup([parked.id, healthy.id]));

  // attemptCount 6 would cost a 60 s backoff sleep if the parked row were
  // still taken through the normal path.
  await setState(parked.id, OFFLINE_STATES.NEEDS_ATTENTION, {
    error: "invalid_input",
    attemptCount: 6,
  });

  stubFetch(() => makeResponse(200, { ok: true, result: { reference_number: "AB-TEST-0001" } }));
  const log = captureWarnings();
  const startedAt = Date.now();
  let summary;
  try {
    summary = await syncQueue();
  } finally {
    log.restore();
  }
  const elapsed = Date.now() - startedAt;

  assert.deepEqual(log.refusals(), [], "no transition may be attempted on a parked entry");
  assert.equal(summary.needsAttention, 1, "the parked entry is still counted");
  assert.equal(summary.synced, 1, "the healthy entry behind it still syncs");

  const stillParked = await readRow(parked.id);
  assert.equal(stillParked.state, OFFLINE_STATES.NEEDS_ATTENTION);
  assert.equal(stillParked.attemptCount, 6, "the parked entry is not touched at all");
  assert.equal(await readRow(healthy.id), null, "the healthy entry synced and was removed");

  assert.ok(elapsed < 5000,
    `the parked entry must be skipped before the backoff sleep, took ${elapsed}ms`);
});

test("an unconfirmed 200 is retried with the same idempotency key, so no duplicate can appear", async (t) => {
  const row = await queueRow();
  t.after(() => cleanup([row.id]));

  const calls = stubFetch(() => makeResponse(200, { ok: true, result: {} }));
  const log = captureWarnings();
  let summary;
  try {
    summary = await syncQueue();
  } finally {
    log.restore();
  }

  assert.equal(summary.failed, 1, "unconfirmed is retryable, not terminal");
  assert.equal(summary.needsAttention, 0);
  assert.deepEqual(log.refusals(), []);

  const afterFirst = await readRow(row.id);
  assert.equal(afterFirst.state, OFFLINE_STATES.FAILED, "retried later, not parked");
  assert.equal(afterFirst.attemptCount, 1, "exactly one unit of budget spent");
  assert.equal(afterFirst.lastError, "unconfirmed");

  const retryCalls = stubFetch(() =>
    makeResponse(200, { ok: true, result: { reference_number: "AB-TEST-0002" } })
  );
  const second = await syncQueue();

  assert.equal(second.synced, 1);
  assert.equal(retryCalls.length, 1, "one request per pass");
  assert.equal(
    retryCalls[0].body.clientSubmissionId,
    calls[0].body.clientSubmissionId,
    "the idempotency key must be reused so the server can return the existing row"
  );
  assert.equal(await readRow(row.id), null, "confirmed, then removed");
});

test("a payload the server refuses stays in needs_attention and is never retried", async (t) => {
  const row = await queueRow();
  t.after(() => cleanup([row.id]));

  const calls = stubFetch(() =>
    makeResponse(400, { ok: false, code: "invalid_input", message: "Enter your full name." })
  );
  const log = captureWarnings();
  let summary;
  try {
    summary = await syncQueue();
    const parked = await readRow(row.id);
    assert.equal(parked.state, OFFLINE_STATES.NEEDS_ATTENTION);
    assert.equal(parked.attemptCount, 1);
    assert.equal(parked.lastError, "invalid_input");

    const again = await syncQueue();
    assert.equal(again.needsAttention, 1);
    assert.equal(calls.length, 1, "a parked entry is not sent again");
    assert.deepEqual(log.refusals(), []);
  } finally {
    log.restore();
  }

  assert.equal(summary.needsAttention, 1);
});

test("HTTP 503 and a dropped connection stay retryable and eventually succeed", async (t) => {
  const gateway = await queueRow();
  const dropped = await queueRow();
  t.after(() => cleanup([gateway.id, dropped.id]));

  let phase = 1;
  const calls = stubFetch((entry, n) => {
    if (phase === 1) {
      if (n === 1) return makeResponse(503, { ok: false, code: "unavailable", message: "Filing is not available right now." });
      throw new TypeError("fetch failed");
    }
    return makeResponse(200, { ok: true, result: { reference_number: "AB-TEST-0003" } });
  });

  const first = await syncQueue();
  assert.equal(first.failed, 2, "both faults are retryable");
  assert.equal(first.needsAttention, 0);

  assert.equal((await readRow(gateway.id)).state, OFFLINE_STATES.FAILED);
  assert.equal((await readRow(gateway.id)).lastError, "unavailable");
  const droppedRow = await readRow(dropped.id);
  assert.equal(droppedRow.state, OFFLINE_STATES.FAILED);
  assert.equal(droppedRow.lastError, "network");
  assert.equal(droppedRow.attemptCount, 1, "one failed attempt spends one unit");

  // Park nothing; drop the second row so the retry pass only pays its
  // own backoff, then prove the 503 row really does go on to sync.
  await cleanup([dropped.id]);
  phase = 2;

  const second = await syncQueue();
  assert.equal(second.synced, 1);
  assert.equal(calls.length, 3, "two failures then one retry");
  assert.equal(await readRow(gateway.id), null);
});

// ── 4. Background engine: public/sw.js ────────────────────────────────

test("the service worker leaves a parked entry alone and sends nothing", async (t) => {
  const parked = await queueRow();
  t.after(() => cleanup([parked.id]));

  await setState(parked.id, OFFLINE_STATES.NEEDS_ATTENTION, {
    error: "invalid_input",
    attemptCount: 3,
  });

  const calls = stubFetch(() => makeResponse(200, { ok: true, result: { reference_number: "AB-SW-0001" } }));
  const result = await runBackgroundSync();

  assert.equal(calls.length, 0, "needs_attention is outside the worker's pending set");
  const stillParked = await readRow(parked.id);
  assert.equal(stillParked.state, OFFLINE_STATES.NEEDS_ATTENTION);
  assert.equal(stillParked.attemptCount, 3, "untouched");
  assert.equal(result.retryable, false, "an empty queue must not ask for another wake-up");
});

test("both engines reach the same verdict for the same response", async (t) => {
  const CASES = [
    {
      name: "HTTP 400 validation",
      make: () => makeResponse(400, { ok: false, code: "invalid_input", message: "Enter your full name." }),
      state: OFFLINE_STATES.NEEDS_ATTENTION,
      lastError: "invalid_input",
      attempts: 1,
      workerRetryable: false,
    },
    {
      name: "HTTP 503",
      make: () => makeResponse(503, { ok: false, code: "unavailable", message: "not now" }),
      state: OFFLINE_STATES.FAILED,
      lastError: "unavailable",
      attempts: 1,
      workerRetryable: true,
    },
    {
      name: "HTTP 504 with an unrelated code",
      make: () => makeResponse(504, { ok: false, code: "stall", message: "gateway timed out" }),
      state: OFFLINE_STATES.FAILED,
      lastError: "stall",
      attempts: 1,
      workerRetryable: true,
    },
    {
      name: "unconfirmed 200",
      make: () => makeResponse(200, { ok: true, result: {} }),
      state: OFFLINE_STATES.FAILED,
      lastError: "unconfirmed",
      attempts: 1,
      workerRetryable: true,
    },
    {
      name: "dropped connection",
      make: () => { throw new TypeError("fetch failed"); },
      state: OFFLINE_STATES.FAILED,
      lastError: "network",
      attempts: 1,
      workerRetryable: true,
    },
    {
      name: "confirmed submission",
      make: () => makeResponse(200, { ok: true, result: { reference_number: "AB-TEST-0004" } }),
      state: null,
      lastError: null,
      attempts: null,
      workerRetryable: false,
    },
  ];

  const results = [];
  for (const testCase of CASES) {
    // Page engine, alone in the queue.
    const onPage = await queueRow({ testCase: `page:${testCase.name}` });
    stubFetch(testCase.make);
    await syncQueue();
    const pageRow = await readRow(onPage.id);
    await cleanup([onPage.id]);

    // Background engine, alone in the queue.
    const onWorker = await queueRow({ testCase: `sw:${testCase.name}` });
    stubFetch(testCase.make);
    const worker = await runBackgroundSync();
    const workerRow = await readRow(onWorker.id);
    await cleanup([onWorker.id]);

    assert.equal(pageRow?.state ?? null, testCase.state, `${testCase.name}: page state`);
    assert.equal(workerRow?.state ?? null, testCase.state, `${testCase.name}: worker state`);
    assert.equal(pageRow?.lastError ?? null, testCase.lastError, `${testCase.name}: page lastError`);
    assert.equal(workerRow?.lastError ?? null, testCase.lastError, `${testCase.name}: worker lastError`);
    assert.equal(pageRow?.attemptCount ?? null, testCase.attempts, `${testCase.name}: page budget`);
    assert.equal(workerRow?.attemptCount ?? null, testCase.attempts, `${testCase.name}: worker budget`);
    assert.equal(worker.retryable, testCase.workerRetryable, `${testCase.name}: worker backpressure`);

    results.push({
      name: testCase.name,
      page: pageRow ? `${pageRow.state}/${pageRow.lastError}/${pageRow.attemptCount}` : "removed",
      worker: workerRow ? `${workerRow.state}/${workerRow.lastError}/${workerRow.attemptCount}` : "removed",
    });
  }

  for (const row of results) {
    assert.equal(row.page, row.worker, `${row.name}: page and worker must agree (${row.page} vs ${row.worker})`);
  }
});

test("neither engine may modify a parked submission's ciphertext or metadata", async (t) => {
  const row = await queueRow({ complainant: "keep me" });
  t.after(() => cleanup([row.id]));

  await setState(row.id, OFFLINE_STATES.NEEDS_ATTENTION, {
    error: "invalid_input",
    attemptCount: 6,
  });

  const before = fakeIndexedDb.raw(IDB_DATABASE_NAME, IDB_STORE_NAME, row.id);
  assert.ok(before, "the fixture must exist before the engines run");
  const sealedBefore = Buffer.concat([Buffer.from(before.payload.iv), Buffer.from(before.payload.data)]);

  stubFetch(() => makeResponse(200, { ok: true, result: { reference_number: "AB-NEVER" } }));
  const log = captureWarnings();
  let pageSummary;
  try {
    pageSummary = await syncQueue();
  } finally {
    log.restore();
  }
  const worker = await runBackgroundSync();

  const after = fakeIndexedDb.raw(IDB_DATABASE_NAME, IDB_STORE_NAME, row.id);
  assert.ok(after, "the entry must still exist after both engines ran");
  const sealedAfter = Buffer.concat([Buffer.from(after.payload.iv), Buffer.from(after.payload.data)]);

  assert.deepEqual(sealedAfter, sealedBefore, "the AES-GCM ciphertext must be byte-identical");
  assert.equal(after.state, OFFLINE_STATES.NEEDS_ATTENTION);
  assert.equal(after.attemptCount, 6);
  assert.equal(after.lastError, "invalid_input");
  assert.equal(after.updatedAt, before.updatedAt, "no write may happen at all");
  assert.equal(pageSummary.synced, 0);
  assert.equal(worker.retryable, false);

  // The entry still decrypts to what the citizen filed.
  const decrypted = await readRow(row.id);
  assert.equal(decrypted.payload.complainant, "keep me");

  const listed = (await listQueue()).find((entry) => entry.id === row.id);
  assert.ok(listed, "the entry stays visible in the queue listing");
  assert.equal(listed.state, OFFLINE_STATES.NEEDS_ATTENTION);
  assert.equal(log.refusals().length, 0);
});

test("a rate limit defers without spending the attempt budget and honours Retry-After", async (t) => {
  const row = await queueRow();
  t.after(() => cleanup([row.id]));

  const calls = stubFetch(() =>
    makeResponse(
      429,
      { ok: false, code: "rate_limited", message: "Too many requests. Please wait before trying again." },
      { "Retry-After": "120" }
    )
  );

  const log = captureWarnings();
  let summary;
  let endsAt = 0;
  try {
    summary = await syncQueue();
    endsAt = rateLimitDeferralEndsAt();
  } finally {
    log.restore();
  }

  assert.equal(summary.deferred, 1, "the entry is deferred, not failed or parked");
  assert.equal(summary.failed, 0);
  assert.equal(summary.needsAttention, 0);
  assert.deepEqual(log.refusals(), []);

  const deferred = await readRow(row.id);
  assert.equal(deferred.state, OFFLINE_STATES.FAILED, "waiting, not terminal");
  assert.equal(deferred.attemptCount, 0, "the six-attempt budget is untouched");
  assert.match(deferred.lastError, /^rate_limited:/, "the reason is kept for inspection");

  const remaining = endsAt - Date.now();
  assert.ok(remaining > 100_000 && remaining <= 120_000,
    `Retry-After: 120 must defer for ~120s, got ${Math.round(remaining / 1000)}s`);

  // The 30 s interval must not hammer the server during the deferral.
  const quiet = await syncQueue();
  assert.equal(quiet.deferred, 1);
  assert.equal(calls.length, 1, "no request leaves the browser while deferred");
  assert.equal((await readRow(row.id)).attemptCount, 0);
});


test("the service worker defers on the SQL rate-limit RAISE without spending the budget", async (t) => {
  const row = await queueRow();
  t.after(() => cleanup([row.id]));

  const calls = stubFetch(() =>
    makeResponse(400, {
      ok: false,
      code: "rejected",
      message: "Too many submissions. Please try again later.",
    })
  );

  const first = await runBackgroundSync();
  assert.equal(first.retryable, true, "the worker must ask to be woken later, not give up");

  const deferred = await readRow(row.id);
  assert.equal(deferred.state, OFFLINE_STATES.FAILED, "deferred, not parked");
  assert.equal(deferred.attemptCount, 0, "a throttle is not a failed attempt");
  assert.equal(deferred.lastError,
    "rate_limited: Too many submissions. Please try again later.");

  const second = await runBackgroundSync();
  assert.equal(second.retryable, true);
  assert.equal(calls.length, 1, "no request while the device is deferred");
  assert.equal((await readRow(row.id)).attemptCount, 0);
});

// ── 5. Stale service worker writes ─────────────────────────────────────
//
// The worker's drain holds rows it read at the start of its pass. By the
// time it writes, the page engine may have confirmed and removed the
// filing, or parked it for a person, or spent attempts of its own.
// putState() must answer for the record as it sits NOW, not as the drain
// last saw it.

test("a stale worker write cannot resurrect a deleted submission", async (t) => {
  const row = await queueRow();
  // The page engine confirmed it and removed it while the worker was
  // still mid-pass holding the old snapshot.
  await cleanup([row.id]);
  t.after(() => cleanup([row.id]));

  assert.equal(
    fakeIndexedDb.raw(IDB_DATABASE_NAME, IDB_STORE_NAME, row.id),
    undefined,
    "the fixture must be gone before the stale write"
  );

  const db = await openDb();
  const written = await putState(db, row.id, OFFLINE_STATES.SYNCING, null, "increment");

  assert.equal(written, false, "a record that no longer exists is never written");
  assert.equal(
    fakeIndexedDb.raw(IDB_DATABASE_NAME, IDB_STORE_NAME, row.id),
    undefined,
    "the stale worker write must not recreate a confirmed filing"
  );
});

test("a stale worker write cannot un-park a needs_attention submission", async (t) => {
  const row = await queueRow();
  t.after(() => cleanup([row.id]));

  await setState(row.id, OFFLINE_STATES.NEEDS_ATTENTION, {
    error: "invalid_input",
    attemptCount: 3,
  });
  const parked = { ...fakeIndexedDb.raw(IDB_DATABASE_NAME, IDB_STORE_NAME, row.id) };

  const db = await openDb();

  // Two intents a stale drain could still hold: start an attempt, or
  // record a failure. Neither may overrule the parked verdict.
  assert.equal(
    await putState(db, row.id, OFFLINE_STATES.SYNCING, null, "increment"),
    false
  );
  assert.equal(
    await putState(db, row.id, OFFLINE_STATES.FAILED, "network", "keep"),
    false
  );

  assert.deepEqual(
    fakeIndexedDb.raw(IDB_DATABASE_NAME, IDB_STORE_NAME, row.id),
    parked,
    "not a single field of the parked record may change"
  );
});

test("worker writes count against the latest stored attemptCount, not a stale read", async (t) => {
  const row = await queueRow();
  t.after(() => cleanup([row.id]));

  // The stored record says 5 — the value the worker finds when it
  // re-reads inside the transaction. A snapshot taken at the start of a
  // drain would still say 0, and writing that back would erase five
  // real attempts.
  await setState(row.id, OFFLINE_STATES.FAILED, { error: "network", attemptCount: 5 });
  const db = await openDb();
  const count = () => fakeIndexedDb.raw(IDB_DATABASE_NAME, IDB_STORE_NAME, row.id).attemptCount;

  // This attempt is counted against the latest baseline, not 0 + 1.
  assert.equal(await putState(db, row.id, OFFLINE_STATES.SYNCING, null, "increment"), true);
  assert.equal(count(), 6, "increment builds on the latest stored count");

  // A failure after the syncing write keeps the count that write set.
  assert.equal(await putState(db, row.id, OFFLINE_STATES.FAILED, "network", "keep"), true);
  assert.equal(count(), 6, "keep must not double-count or roll back");

  // A rate limit hands back exactly one attempt — never the stale
  // baseline the drain started from.
  assert.equal(
    await putState(db, row.id, OFFLINE_STATES.FAILED, "rate_limited: too many", "rollback"),
    true
  );
  assert.equal(count(), 5, "rollback undoes exactly the last attempt");
});

test("normal pending and syncing updates still write through the worker", async (t) => {
  const row = await queueRow();
  t.after(() => cleanup([row.id]));

  const before = { ...fakeIndexedDb.raw(IDB_DATABASE_NAME, IDB_STORE_NAME, row.id) };
  const db = await openDb();

  assert.equal(await putState(db, row.id, OFFLINE_STATES.SYNCING, null, "increment"), true);
  const syncing = fakeIndexedDb.raw(IDB_DATABASE_NAME, IDB_STORE_NAME, row.id);
  assert.equal(syncing.state, OFFLINE_STATES.SYNCING);
  assert.equal(syncing.attemptCount, 1, "a fresh queue entry counts its first attempt");
  assert.equal(syncing.lastError, before.lastError, "no error to record yet");
  assert.equal(syncing.clientSubmissionId, before.clientSubmissionId, "identity survives");
  assert.equal(syncing.evidenceCount, before.evidenceCount);
  assert.equal(syncing.createdAt, before.createdAt);
  assert.deepEqual(syncing.payload, before.payload, "the sealed payload is carried over untouched");

  assert.equal(await putState(db, row.id, OFFLINE_STATES.FAILED, "network", "keep"), true);
  const failed = fakeIndexedDb.raw(IDB_DATABASE_NAME, IDB_STORE_NAME, row.id);
  assert.equal(failed.state, OFFLINE_STATES.FAILED);
  assert.equal(failed.attemptCount, 1, "the failure must not double-count the attempt");
  assert.equal(failed.lastError, "network");
  assert.deepEqual(failed.payload, before.payload, "ciphertext untouched by a failure write");
});
